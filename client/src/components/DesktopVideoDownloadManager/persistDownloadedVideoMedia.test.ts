import type { MediaType } from "../../types";
import type { RootState, AppDispatch } from "../../store/store";
import { addItemToMediaList, removeItemFromMediaList, updateMediaItemFields } from "../../store/mediaSlice";
import type { MuxUploadResult } from "../../containers/Media/MediaUploadInput.types";
import * as mediaDocs from "../../utils/mediaDocUtils";
import * as mediaFlush from "../../utils/flushMediaLibraryDoc";
import {
  persistDownloadedVideoMedia,
  removeDownloadedVideoAssetIfUnreferenced,
  removeDownloadedVideoMuxAssetIfUnreferenced,
} from "./persistDownloadedVideoMedia";
import type { DesktopVideoDownloadOwner } from "./desktopVideoDownloadController";

const media: MediaType = {
  path: "",
  createdAt: "2026-10-29T12:00:00.000Z",
  updatedAt: "2026-10-29T12:00:00.000Z",
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "Sunday Service",
  publicId: "local_video_download_job-1",
  type: "video",
  id: "local_video_download_job-1",
  background: "local-video-file://local_video_download_job-1",
  thumbnail: "",
  duration: 90,
  source: "local",
  folderId: "folder-a",
  localVideoFile: {
    id: "local_video_download_job-1",
    contentRevision: "2026-10-29T12:00:00.000Z",
    ownerDeviceId: "device-1",
    ownerLabel: "Desktop",
    fileName: "Sunday Service.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only",
    audioEnabled: true,
  },
};

const owner: DesktopVideoDownloadOwner = {
  churchId: "church-a",
  workspaceId: "church-a",
  controllerProfileId: "presentation",
  folderId: "folder-a",
  routePath: "/controller",
  dbAtStart: { name: "church-a" },
};

const muxResult: MuxUploadResult = {
  playbackId: "playback-one",
  assetId: "mux-asset-one",
  playbackUrl: "https://stream.mux.com/playback-one.m3u8",
  thumbnailUrl: "https://image.mux.com/playback-one/thumbnail.png",
  name: "Sunday Service",
  durationSeconds: 90,
};

describe("persistDownloadedVideoMedia", () => {
  const loadMediaLibrary = jest.spyOn(mediaDocs, "loadMediaLibrary");
  const readMediaItemForDeletion = jest.spyOn(mediaDocs, "readMediaItemForDeletion");
  const flushMediaLibraryDocToPouch = jest.spyOn(mediaFlush, "flushMediaLibraryDocToPouch");

  beforeEach(() => {
    jest.clearAllMocks();
    loadMediaLibrary.mockResolvedValue({ list: [], folders: [] });
    readMediaItemForDeletion.mockResolvedValue({ doc: {} as never, item: media });
    flushMediaLibraryDocToPouch.mockResolvedValue({ ok: true });
  });

  it("publishes a deferred write after a lost acknowledgement only when a fresh Pouch read confirms it", async () => {
    const db = owner.dbAtStart as PouchDB.Database;
    let mediaState = { list: [] as MediaType[], folders: [], isInitialized: true, loadStatus: "ready" as const } as unknown as RootState["media"];
    const dispatch = jest.fn((action: { type: string; payload: unknown }) => {
      if (action.type === addItemToMediaList.type) {
        mediaState = { ...mediaState, list: [...mediaState.list, action.payload as MediaType] };
      }
      if (action.type === updateMediaItemFields.type) {
        const value = action.payload as { id: string; patch: Partial<MediaType> };
        mediaState = { ...mediaState, list: mediaState.list.map((item) => item.id === value.id ? { ...item, ...value.patch } : item) };
      }
      return action;
    });
    const getState = () => ({ media: mediaState } as RootState);
    const isOwnerCurrent = jest.fn(() => true);
    let authoritativePouchItem: MediaType | null = null;
    let finishWrite!: (value: { ok: false; error: Error }) => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    flushMediaLibraryDocToPouch.mockImplementation(() => {
      markWriteStarted();
      return new Promise((resolve) => { finishWrite = resolve; });
    });
    readMediaItemForDeletion.mockImplementation(async () => authoritativePouchItem
      ? { doc: {} as never, item: authoritativePouchItem }
      : null);

    const registration = persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState,
      isOwnerCurrent,
    });
    await writeStarted;
    // Pouch committed the document, but its write promise reports a lost acknowledgement.
    authoritativePouchItem = media;
    finishWrite({ ok: false, error: new Error("Write acknowledgement was lost.") });
    await registration;

    expect(dispatch.mock.calls.filter(([action]) => action.type === addItemToMediaList.type)).toHaveLength(1);
    expect(dispatch.mock.calls.filter(([action]) => action.type === updateMediaItemFields.type)).toHaveLength(0);
    expect(mediaState.list).toHaveLength(1);
    expect(flushMediaLibraryDocToPouch).toHaveBeenCalledTimes(1);
    expect(readMediaItemForDeletion).toHaveBeenCalledWith(db, media.id);
    expect(authoritativePouchItem).toEqual(media);
  });

  it("does not leave a Redux item behind after a definitive Pouch failure", async () => {
    let mediaState = { list: [] as MediaType[], folders: [], isInitialized: true, loadStatus: "ready" as const } as unknown as RootState["media"];
    const dispatch = jest.fn((action: { type: string; payload: unknown }) => {
      if (action.type === addItemToMediaList.type) mediaState = { ...mediaState, list: [...mediaState.list, action.payload as MediaType] };
      if (action.type === removeItemFromMediaList.type) mediaState = { ...mediaState, list: mediaState.list.filter((row) => row.id !== action.payload) };
      return action;
    });
    flushMediaLibraryDocToPouch.mockResolvedValue({ ok: false, error: new Error("Disk write failed.") });
    readMediaItemForDeletion.mockResolvedValue(null);

    await expect(persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState: () => ({ media: mediaState } as RootState),
      isOwnerCurrent: () => true,
    })).rejects.toThrow("Disk write failed.");

    expect(mediaState.list).toEqual([]);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: addItemToMediaList.type }));
  });

  it("removes only an unchanged stale optimistic row when Pouch confirms it was never saved", async () => {
    const unrelated = { ...media, id: "unrelated", localVideoFile: { ...media.localVideoFile!, id: "other-asset" } };
    let mediaState = { list: [media, unrelated], folders: [], isInitialized: true, loadStatus: "ready" as const } as unknown as RootState["media"];
    const dispatch = jest.fn((action: { type: string; payload: unknown }) => {
      if (action.type === removeItemFromMediaList.type) mediaState = { ...mediaState, list: mediaState.list.filter((row) => row.id !== action.payload) };
      return action;
    });
    flushMediaLibraryDocToPouch.mockResolvedValue({ ok: false, error: new Error("Disk write failed.") });
    readMediaItemForDeletion.mockResolvedValue(null);

    await expect(persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState: () => ({ media: mediaState } as RootState),
      isOwnerCurrent: () => true,
    })).rejects.toThrow("Disk write failed.");

    expect(mediaState.list).toEqual([unrelated]);
    expect(dispatch).toHaveBeenCalledWith(removeItemFromMediaList(media.id));
  });

  it("does not read, dispatch, or flush after the captured church scope changes", async () => {
    const dispatch = jest.fn();
    const isOwnerCurrent = jest.fn(() => false);

    await expect(persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState: () => ({ media: { list: [], folders: [] } } as unknown as RootState),
      isOwnerCurrent,
    })).rejects.toThrow(/active church changed/i);

    expect(loadMediaLibrary).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(flushMediaLibraryDocToPouch).not.toHaveBeenCalled();
  });

  it("preserves a local asset when an uncertain Media Library write is now present in Pouch", async () => {
    const db = owner.dbAtStart as PouchDB.Database;
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [media], folders: [] });

    const persisted = await removeDownloadedVideoAssetIfUnreferenced({
      media,
      assetId: media.localVideoFile!.id,
      owner,
      deleteAsset,
      isOwnerCurrent: () => true,
    });

    expect(loadMediaLibrary).toHaveBeenCalledWith(db);
    expect(persisted).toEqual(media);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced local asset only after a successful authoritative read", async () => {
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [], folders: [] });

    await removeDownloadedVideoAssetIfUnreferenced({
      media,
      assetId: media.localVideoFile!.id,
      owner,
      deleteAsset,
      isOwnerCurrent: () => true,
    });

    expect(deleteAsset).toHaveBeenCalledWith(media.localVideoFile!.id);
  });

  it("keeps the asset when the authoritative reference check fails or changes scope", async () => {
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockRejectedValueOnce(new Error("Pouch is unavailable."));

    await expect(removeDownloadedVideoAssetIfUnreferenced({
      media,
      assetId: media.localVideoFile!.id,
      owner,
      deleteAsset,
      isOwnerCurrent: () => true,
    })).rejects.toThrow("Pouch is unavailable.");

    await expect(removeDownloadedVideoAssetIfUnreferenced({
      media,
      assetId: media.localVideoFile!.id,
      owner,
      deleteAsset,
      isOwnerCurrent: () => false,
    })).rejects.toThrow(/church changed/i);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("keeps the local file when a concurrent in-memory item still references it", async () => {
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [], folders: [] });

    await expect(removeDownloadedVideoAssetIfUnreferenced({
      media,
      assetId: media.localVideoFile!.id,
      owner,
      deleteAsset,
      getInMemoryMediaItem: () => ({ ...media, name: "Concurrent edit" }),
      isOwnerCurrent: () => true,
    })).rejects.toThrow(/unsaved reference/i);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("preserves a Mux asset when any authoritative Media Library item references it", async () => {
    const registered = { ...media, providerStorage: { provider: "mux" as const, assetId: muxResult.assetId, churchId: owner.churchId, permanent: true as const } };
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [registered], folders: [] });

    await expect(removeDownloadedVideoMuxAssetIfUnreferenced({ result: muxResult, owner, deleteAsset, isOwnerCurrent: () => true }))
      .resolves.toEqual(registered);
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("deletes a Mux asset only after a successful authoritative read proves it unreferenced", async () => {
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [], folders: [] });

    await removeDownloadedVideoMuxAssetIfUnreferenced({ result: muxResult, owner, deleteAsset, isOwnerCurrent: () => true });
    expect(deleteAsset).toHaveBeenCalledWith(muxResult.assetId, owner.churchId);

    deleteAsset.mockClear();
    loadMediaLibrary.mockRejectedValueOnce(new Error("Pouch is unavailable."));
    await expect(removeDownloadedVideoMuxAssetIfUnreferenced({ result: muxResult, owner, deleteAsset, isOwnerCurrent: () => true }))
      .rejects.toThrow("Pouch is unavailable.");
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it("retains a Mux asset when an in-memory Media Library row may still reference it", async () => {
    const deleteAsset = jest.fn(async () => undefined);
    loadMediaLibrary.mockResolvedValue({ list: [], folders: [] });

    await expect(removeDownloadedVideoMuxAssetIfUnreferenced({
      result: muxResult,
      owner,
      deleteAsset,
      getInMemoryMediaItems: () => [{ ...media, muxAssetId: muxResult.assetId }],
      isOwnerCurrent: () => true,
    })).rejects.toThrow(/unsaved reference/i);
    expect(deleteAsset).not.toHaveBeenCalled();
  });
});
