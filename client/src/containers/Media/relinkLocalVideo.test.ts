import type { MediaType } from "../../types";
import type { DesktopVideoDownloadOwner } from "../../components/DesktopVideoDownloadManager/desktopVideoDownloadController";
import { mediaItemDocId } from "../../utils/mediaDocUtils";
import * as videoFiles from "../../utils/localVideoFileAssets";
import * as mux from "./utils/muxUpload";
import { cleanupLinkedVideoReplacement, discardUnadoptedLinkedVideo, linkedVideoRecoveryPatch, persistLinkedVideoReplacement, registerLinkedVideoReplacementRecovery, restoreUncommittedLinkedVideo, retryLinkedVideoReplacement } from "./relinkLocalVideo";
import type { AppDispatch } from "../../store/store";
import { claimMediaUpload } from "../../utils/mediaOperationClaims";

const original: MediaType = {
  id: "video", name: "Sermon", path: "", createdAt: "today", updatedAt: "today",
  type: "video", format: "mp4", width: 1920, height: 1080, duration: 60,
  publicId: "video", background: "local-video-file://original", thumbnail: "old-thumbnail",
  muxAssetId: "mux-old", muxPlaybackId: "playback-old",
  localVideoFile: {
    id: "original", contentHash: "a".repeat(64), ownerDeviceId: "device", ownerLabel: "PC",
    fileName: "sermon.mp4", contentType: "video/mp4", storageMode: "linked",
    storagePolicy: "local-and-cloud", cloudMediaId: "mux-old", cloudUrl: "cloud-old", audioEnabled: false,
  },
};
const linked: MediaType = { ...original, width: 1280, height: 720, duration: 90,
  background: "local-video-file://candidate", localVideoFile: {
    ...original.localVideoFile!, id: "candidate", contentHash: "b".repeat(64), storagePolicy: "local-only",
  },
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const harness = () => {
  const docs = new Map<string, Record<string, unknown>>([
    ["media-library-meta", { schemaVersion: 2 }],
    [mediaItemDocId(original.id), { ...copy(original), _id: mediaItemDocId(original.id), _rev: "1", docType: "mediaItem" }],
  ]);
  let current = true;
  let failWrite = false;
  let loseAck = false;
  let conflictOnce = false;
  const db = {
    get: jest.fn(async (id: string) => {
      const doc = docs.get(id);
      if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
      return copy(doc);
    }),
    put: jest.fn(async (doc: Record<string, unknown>) => {
      if (failWrite) throw new Error("disk full");
      if (conflictOnce) {
        conflictOnce = false;
        docs.set(String(doc._id), { ...docs.get(String(doc._id)), name: "Concurrent rename", folderId: "new-folder", _rev: "2" });
        throw Object.assign(new Error("conflict"), { status: 409 });
      }
      docs.set(String(doc._id), copy({ ...doc, _rev: "3" }));
      if (loseAck) throw new Error("acknowledgement lost");
      return { ok: true, id: doc._id, rev: "3" };
    }),
    allDocs: jest.fn(async () => ({ rows: [...docs.values()]
      .filter((doc) => doc.docType === "mediaItem").map((doc) => ({ doc: copy(doc) })) })),
  };
  const owner: DesktopVideoDownloadOwner = {
    churchId: "church-a", workspaceId: "church-a", controllerProfileId: "presentation", routePath: "/controller",
    folderId: null, dbAtStart: db,
  };
  const isOwnerCurrent = () => current;
  const save = (candidate = linked) => persistLinkedVideoReplacement({ original, linked: candidate, candidateAssetId: "candidate", owner, isOwnerCurrent });
  const cleanup = () => cleanupLinkedVideoReplacement(original.id, owner, isOwnerCurrent, () => []);
  return { docs, db, owner, isOwnerCurrent, save, cleanup, setCurrent: (value: boolean) => { current = value; },
    failWrite: () => { failWrite = true; }, loseAck: () => { loseAck = true; }, conflict: () => { conflictOnce = true; } };
};

describe("linked replacement durable commit and cleanup", () => {
  const deleteLocal = jest.spyOn(videoFiles, "deleteLocalVideoFile");
  const deleteMux = jest.spyOn(mux, "deleteMuxAsset");
  const getCache = jest.spyOn(videoFiles, "getLocalVideoFile");
  const saveCache = jest.spyOn(videoFiles, "saveLocalVideoFile");
  beforeEach(() => {
    deleteLocal.mockReset().mockResolvedValue(undefined);
    deleteMux.mockReset().mockResolvedValue(undefined);
    getCache.mockReset().mockResolvedValue(undefined);
    saveCache.mockReset().mockResolvedValue(undefined);
    window.electronAPI = { getLocalVideoRelinkStatus: jest.fn(async () => ({ status: "pending", asset: { workspaceId: "church-a", contentHash: "a".repeat(64) } })), commitRelinkLocalVideoFile: jest.fn(async () => ({ assetId: "original", contentHash: "b".repeat(64), size: 100 })) } as unknown as typeof window.electronAPI;
  });
  afterAll(() => { deleteLocal.mockRestore(); deleteMux.mockRestore(); getCache.mockRestore(); saveCache.mockRestore(); delete window.electronAPI; });

  it("preserves identity and concurrent edits, then retires only unreferenced sources", async () => {
    const h = harness(); h.conflict();
    const result = await h.save();
    expect(result.item).toMatchObject({ id: "video", name: "Concurrent rename", folderId: "new-folder", localVideoFile: { id: "original", audioEnabled: false } });
    expect(result.item.muxAssetId).toBeUndefined();
    expect(deleteMux).not.toHaveBeenCalled();
    await h.cleanup();
    expect(deleteLocal).toHaveBeenCalledWith("candidate");
    expect(deleteMux).toHaveBeenCalledWith("mux-old", "church-a");
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toEqual([]);
    expect([...h.docs.values()].filter((doc) => doc.docType === "mediaItem")).toHaveLength(1);
  });

  it("preserves the original when persistence fails", async () => {
    const h = harness(); h.failWrite();
    await expect(h.save()).rejects.toThrow("disk full");
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject(original);
    expect(deleteLocal).not.toHaveBeenCalled(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("reconciles a lost write acknowledgement before retiring the original", async () => {
    const h = harness(); h.loseAck();
    await expect(h.save()).resolves.toMatchObject({ item: { localVideoFile: { id: "original", contentHash: "b".repeat(64) } } });
    await h.cleanup();
    expect(deleteMux).toHaveBeenCalledTimes(1);
  });

  it("retains the cloud copy when content is identical", async () => {
    const h = harness();
    const result = await h.save({ ...linked, localVideoFile: { ...linked.localVideoFile!, contentHash: original.localVideoFile!.contentHash } });
    expect(result.item).toMatchObject({ muxAssetId: "mux-old", thumbnail: "old-thumbnail", localVideoFile: { cloudMediaId: "mux-old", storagePolicy: "local-and-cloud" } });
    jest.mocked(window.electronAPI!.commitRelinkLocalVideoFile).mockResolvedValueOnce({ contentHash: "a".repeat(64), size: 100 } as never);
    await h.cleanup(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("retains shared cloud references, including legacy cloudMediaId", async () => {
    const h = harness(); await h.save();
    h.docs.set(mediaItemDocId("other"), { ...copy(original), id: "other", _id: mediaItemDocId("other"), muxAssetId: undefined, localVideoFile: { ...original.localVideoFile, id: "other-file" }, docType: "mediaItem" });
    await h.cleanup(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("keeps a durable retry checkpoint after cleanup failure and resumes after a scope switch", async () => {
    const h = harness(); await h.save();
    deleteMux.mockRejectedValueOnce(new Error("Mux offline"));
    await expect(h.cleanup()).rejects.toThrow("Mux offline");
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toHaveLength(1);
    h.setCurrent(false);
    await expect(h.cleanup()).rejects.toThrow("original church");
    expect(deleteMux).toHaveBeenCalledTimes(1);
    h.setCurrent(true); await h.cleanup();
    expect(deleteMux).toHaveBeenCalledTimes(2);
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toEqual([]);
  });

  it("keeps cloud storage when authoritative references cannot be read", async () => {
    const h = harness(); await h.save(); h.db.allDocs.mockRejectedValueOnce(new Error("offline"));
    await expect(h.cleanup()).rejects.toThrow("offline");
    expect(deleteMux).not.toHaveBeenCalled();
  });

  it("preserves storage for unknown schemas and incomplete cloud references", async () => {
    const h = harness(); await h.save();
    h.docs.set("media-library-meta", { schemaVersion: 3 });
    await expect(h.cleanup()).rejects.toThrow("schema is uncertain");
    h.docs.set("media-library-meta", { schemaVersion: 2 });
    h.docs.set(mediaItemDocId("legacy"), { ...copy(original), _id: mediaItemDocId("legacy"), id: "legacy",
      muxAssetId: undefined, localVideoFile: undefined, docType: "mediaItem" });
    await expect(h.cleanup()).rejects.toThrow("uncertain asset reference");
    expect(deleteMux).not.toHaveBeenCalled();
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toHaveLength(1);
  });

  it("does not write after the church changes during the database read", async () => {
    const h = harness();
    h.db.get.mockImplementationOnce(async () => { h.setCurrent(false); return { schemaVersion: 2 }; });
    await expect(h.save()).rejects.toThrow("could not be confirmed");
    expect(h.db.put).not.toHaveBeenCalled();
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject(original);
  });

  it("rejects a stale relink when another source was committed during validation", async () => {
    const h = harness(); const doc = h.docs.get(mediaItemDocId("video"))!;
    h.docs.set(mediaItemDocId("video"), { ...doc, localVideoFile: { ...original.localVideoFile, id: "newer-source" } });
    await expect(h.save()).rejects.toThrow("changed while");
    expect(deleteMux).not.toHaveBeenCalled(); expect(h.db.put).not.toHaveBeenCalled();
  });

  it("restores the previous library metadata after a confirmed native non-commit", async () => {
    const h = harness(); const saved = await h.save();
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({ status: "pending", asset: { workspaceId: "church-a", contentHash: original.localVideoFile!.contentHash } })) as never;
    await restoreUncommittedLinkedVideo(original, saved.patch, "candidate", h.owner, h.isOwnerCurrent);
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject(original);
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toEqual([expect.objectContaining({ rolledBack: true })]);
    expect(saveCache).not.toHaveBeenCalled(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("preserves a native commit with a lost acknowledgement and resumes its persisted checkpoint", async () => {
    const h = harness(); const saved = await h.save();
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({ status: "committed", asset: { workspaceId: "church-a", contentHash: linked.localVideoFile!.contentHash } })) as never;
    await restoreUncommittedLinkedVideo(original, saved.patch, "candidate", h.owner, h.isOwnerCurrent);
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject({ localVideoFile: { id: "original", contentHash: "b".repeat(64) } });
    await discardUnadoptedLinkedVideo({ assetId: "candidate" } as never, h.owner, h.isOwnerCurrent, () => []);
    expect(deleteLocal).not.toHaveBeenCalled();
    const current = { ...original, name: "Unsaved rename", folderId: "unsaved-folder" };
    const patch = linkedVideoRecoveryPatch(saved.item, current);
    expect({ ...current, ...patch }).toMatchObject({ name: "Unsaved rename", folderId: "unsaved-folder", localVideoFile: { id: "original", contentHash: "b".repeat(64) } });
    await h.cleanup();
    expect(deleteMux).toHaveBeenCalledWith("mux-old", "church-a");
    expect(h.docs.get(mediaItemDocId("video"))?.pendingLinkedVideoCleanup).toEqual([]);
  });

  it("preserves concurrent audio and thumbnail edits when native adoption fails", async () => {
    const h = harness();
    const doc = h.docs.get(mediaItemDocId("video"))!;
    h.docs.set(mediaItemDocId("video"), { ...doc, localVideoFile: { ...original.localVideoFile, audioEnabled: true } });
    const saved = await h.save();
    expect(saved.item.localVideoFile?.audioEnabled).toBe(true);
    h.docs.set(mediaItemDocId("video"), { ...h.docs.get(mediaItemDocId("video")), thumbnail: "concurrent-thumbnail" });
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({ status: "pending", asset: { workspaceId: "church-a", contentHash: original.localVideoFile!.contentHash } })) as never;
    await restoreUncommittedLinkedVideo(original, saved.patch, "candidate", h.owner, h.isOwnerCurrent);
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject({ thumbnail: "concurrent-thumbnail",
      localVideoFile: { ...original.localVideoFile, audioEnabled: true }, pendingLinkedVideoCleanup: [expect.objectContaining({ rolledBack: true })] });
  });

  it("blocks a new relink while recovered finalization is paused before updating the local cache", async () => {
    const h = harness(); await h.save();
    let resume!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    getCache.mockImplementationOnce(() => new Promise((resolve) => {
      started(); resume = () => resolve(undefined);
    }));
    const retry = retryLinkedVideoReplacement(original.id, h.owner, h.isOwnerCurrent, () => []);
    await reading;
    expect(claimMediaUpload(original.id)).toBeNull();
    resume(); await retry;
    expect(saveCache).toHaveBeenCalledWith(expect.objectContaining({ id: "original", contentHash: "b".repeat(64) }), expect.anything());
    const next = claimMediaUpload(original.id);
    expect(next).not.toBeNull(); next!.release();
  });

  it("restores the durable original after route retirement and disconnected candidate/source drives", async () => {
    const h = harness(); await h.save(); h.setCurrent(false);
    await expect(h.cleanup()).rejects.toThrow("original church");
    h.setCurrent(true);
    jest.mocked(window.electronAPI!.commitRelinkLocalVideoFile).mockRejectedValue(new Error("candidate drive disconnected"));
    window.electronAPI!.getLocalVideoRelinkStatus = jest.fn(async () => ({ status: "pending", asset: {
      workspaceId: "church-a", contentHash: original.localVideoFile!.contentHash,
    } })) as never;
    // No original route snapshot or available-file lookup is passed to recovery.
    const adopted = jest.fn();
    await retryLinkedVideoReplacement(original.id, h.owner, h.isOwnerCurrent, () => [], undefined, adopted);
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject({ ...original, pendingLinkedVideoCleanup: [] });
    expect(adopted).toHaveBeenCalledWith(expect.objectContaining({ localVideoFile: expect.objectContaining({ cloudUrl: "cloud-old" }) }));
    expect(saveCache).not.toHaveBeenCalled(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("preserves edits persisted after route retirement when recovery rolls back a native non-commit", async () => {
    const h = harness(); await h.save();
    // The original route and its proposed patch are gone. Another edit lands
    // before Activity reconstructs recovery from the durable checkpoint.
    h.docs.set(mediaItemDocId("video"), { ...h.docs.get(mediaItemDocId("video")),
      thumbnail: "later-thumbnail", width: 1440,
      localVideoFile: { ...linked.localVideoFile, id: "original", audioEnabled: true,
        cloudUrl: undefined, cloudMediaId: undefined, preferCloudPlayback: undefined } });
    jest.mocked(window.electronAPI!.commitRelinkLocalVideoFile).mockRejectedValue(new Error("candidate drive disconnected"));
    await retryLinkedVideoReplacement(original.id, h.owner, h.isOwnerCurrent, () => []);
    expect(h.docs.get(mediaItemDocId("video"))).toMatchObject({ thumbnail: "later-thumbnail", width: 1440,
      height: original.height, muxAssetId: original.muxAssetId,
      localVideoFile: { ...original.localVideoFile, audioEnabled: true }, pendingLinkedVideoCleanup: [] });
    expect(saveCache).not.toHaveBeenCalled(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("notifies output caches again after the committed local metadata transaction", async () => {
    const h = harness(); await h.save();
    const events: string[] = [];
    jest.mocked(window.electronAPI!.commitRelinkLocalVideoFile).mockImplementation(async () => {
      events.push("native commit"); return { contentHash: "b".repeat(64), size: 100 } as never;
    });
    saveCache.mockImplementation(async () => { events.push("metadata transaction"); });
    window.electronAPI!.notifyLocalVideoAssetChanged = jest.fn(async () => { events.push("metadata notification"); return true; });
    await h.cleanup();
    expect(events).toEqual(["native commit", "metadata transaction", "metadata notification"]);
  });

  it("retains Mux storage when a legacy row has only its Mux background URL", async () => {
    const h = harness(); await h.save();
    h.docs.set(mediaItemDocId("legacy"), { ...copy(original), _id: mediaItemDocId("legacy"), id: "legacy",
      source: "mux", background: "https://stream.mux.com/legacy-playback.m3u8",
      muxAssetId: undefined, muxPlaybackId: undefined, localVideoFile: undefined, docType: "mediaItem" });
    await expect(h.cleanup()).rejects.toThrow("uncertain asset reference");
    expect(deleteMux).not.toHaveBeenCalled();
  });

  it("does not adopt or retire a native source owned by another church", async () => {
    const h = harness(); await h.save();
    jest.mocked(window.electronAPI!.getLocalVideoRelinkStatus).mockResolvedValueOnce({ status: "pending", asset: { workspaceId: "church-b" } } as never);
    await expect(h.cleanup()).rejects.toThrow("different church");
    expect(window.electronAPI!.commitRelinkLocalVideoFile).not.toHaveBeenCalled();
    expect(deleteLocal).not.toHaveBeenCalled(); expect(deleteMux).not.toHaveBeenCalled();
  });

  it("refreshes same-content filename metadata without invalidating its thumbnail again", async () => {
    const h = harness(); await h.save();
    getCache.mockResolvedValueOnce({ contentHash: "b".repeat(64), fileName: "previous-name.mp4" } as never);
    await h.cleanup();
    expect(saveCache).toHaveBeenCalledWith(expect.objectContaining({ fileName: linked.localVideoFile!.fileName }),
      expect.objectContaining({ invalidateThumbnail: false }));
  });

  it("publishes recovered adoption and retires its Redux checkpoint through the retained Activity action", async () => {
    const h = harness(); const saved = await h.save();
    let items = [{ ...original, name: "Unsaved rename" }];
    const actions = new Map<string, () => void | Promise<void>>();
    const transfer = { updateTransfer: jest.fn(), removeTransfer: jest.fn(),
      registerTransferAction: (id: string, key: string, handler: () => void | Promise<void>) => {
        actions.set(`${id}:${key}`, handler); return () => { actions.delete(`${id}:${key}`); };
      } };
    const dispatch = jest.fn((action: { payload: { id: string; patch: Partial<MediaType> } }) => {
      items = items.map((item) => item.id === action.payload.id ? { ...item, ...action.payload.patch } : item);
      return action;
    });
    registerLinkedVideoReplacementRecovery({ item: saved.item, owner: h.owner, isOwnerCurrent: h.isOwnerCurrent,
      getItems: () => items, dispatch: dispatch as unknown as AppDispatch, transfer, error: new Error("acknowledgement lost") });
    await actions.get("media-relink-cleanup-church-a:video:retry-cleanup")!();
    expect(items[0]).toMatchObject({ name: "Unsaved rename", localVideoFile: { id: "original", contentHash: "b".repeat(64) }, pendingLinkedVideoCleanup: [] });
    expect(transfer.removeTransfer).toHaveBeenCalledWith("media-relink-cleanup-church-a:video");
  });
});
