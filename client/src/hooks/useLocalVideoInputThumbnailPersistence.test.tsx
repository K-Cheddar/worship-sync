import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import mediaReducer from "../store/mediaSlice";
import type { MediaType } from "../types";
import * as controllerInfo from "../context/controllerInfo";
import { GlobalInfoContext } from "../context/globalInfo";
import { MEDIA_LIBRARY_META_ID, MEDIA_FOLDERS_ID, mediaItemDocId } from "../utils/mediaDocUtils";
import { updateMediaItemFields } from "../store/mediaSlice";
import type { LocalImageUploadJob } from "../utils/localImageAssets";
import * as uploadQueue from "../utils/localImageUploadQueue";
import {
  useLocalVideoInputThumbnailPersistence,
  VideoInputMediaWriteOutcomeUnknownError,
} from "./useLocalVideoInputThumbnailPersistence";

jest.mock("../utils/localImageAssets", () => {
  const actual = jest.requireActual("../utils/localImageAssets") as Record<string, unknown>;
  return {
    ...actual,
    saveLocalImage: jest.fn().mockResolvedValue(undefined),
    deleteLocalImage: jest.fn().mockResolvedValue(undefined),
    deleteLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    getLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    getRememberedLocalImagePolicy: jest.fn(() => "local-only"),
    putLocalImageUploadJob: jest.fn().mockResolvedValue(undefined),
    restoreStagedLocalImageUploadCleanupJob: jest.fn().mockResolvedValue(true),
    stageLocalImageUploadCleanupJobAtomically: jest.fn(async (job) => ({
      job,
      previous: undefined,
    })),
  };
});

jest.mock("../utils/localImageUploadQueue", () => ({
  cancelLocalImageUpload: jest.fn().mockResolvedValue(undefined),
  confirmStagedLocalVideoThumbnailReference: jest.fn(),
  enqueueLocalImageUpload: jest.fn().mockResolvedValue(undefined),
  releaseStagedLocalVideoThumbnailReference: jest.fn().mockResolvedValue(undefined),
  renewStagedLocalVideoThumbnailReference: jest.fn().mockResolvedValue(undefined),
  stageLocalVideoInputThumbnailUpload: jest.fn(),
}));

let stagedThumbnailUploadJob: LocalImageUploadJob | undefined;

const mediaId = "local_input_camera-source";
const source = {
  kind: "local-video-input" as const,
  sourceId: "camera-source",
  deviceId: "camera-device",
  label: "Booth camera",
};
const oldLocalImage = {
  id: "old-thumbnail-asset",
  ownerDeviceId: "device-a",
  ownerLabel: "Camera owner",
  fileName: "original.webp",
  contentType: "image/webp",
  storagePolicy: "local-only" as const,
};

const createMediaRow = (): MediaType => ({
  id: mediaId,
  name: "Booth camera",
  path: "",
  createdAt: "created-before-relink",
  updatedAt: "updated-before-relink",
  format: "live",
  height: 1080,
  width: 1920,
  publicId: mediaId,
  type: "video",
  background: "local-video-input://camera-source",
  thumbnail: "https://images.example.com/original.webp",
  placeholderImage: "",
  source: "local",
  folderId: "existing-folder",
  localVideoInput: source,
  localImage: oldLocalImage,
  providerStorage: {
    provider: "mux",
    assetId: "existing-owner-asset",
    churchId: "church-1",
    permanent: true,
  },
} as MediaType);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createPouchDb = (initialRow: MediaType, persistInitialRow = true) => {
  const docs = new Map<string, Record<string, unknown>>([
    [MEDIA_LIBRARY_META_ID, {
      _id: MEDIA_LIBRARY_META_ID,
      docType: "mediaLibraryMeta",
      schemaVersion: 2,
    }],
    [MEDIA_FOLDERS_ID, {
      _id: MEDIA_FOLDERS_ID,
      docType: "mediaFolders",
      folders: [{ id: "existing-folder", name: "Cameras", parentId: null }],
    }],
  ]);
  if (persistInitialRow) {
    docs.set(mediaItemDocId(initialRow.id), {
      ...initialRow,
      _id: mediaItemDocId(initialRow.id),
      _rev: "1-existing",
      docType: "mediaItem",
    });
  }
  const pendingPut = deferred<PouchDB.Core.Response>();
  let deferNextRowPut = false;
  let rejectNextRowPut = false;
  let rowPatchOnNextGet:
    | { patch: Partial<MediaType>; onRead?: () => void }
    | undefined;
  let allDocsFailuresAfterNextRowPut = 0;
  let pendingAllDocsFailures = 0;
  const db = {
    name: "thumbnail-persistence-test",
    get: jest.fn(async (id: string) => {
      let doc = docs.get(id);
      if (!doc) throw Object.assign(new Error("missing"), { status: 404 });
      if (id === mediaItemDocId(mediaId) && rowPatchOnNextGet) {
        const { patch, onRead } = rowPatchOnNextGet;
        rowPatchOnNextGet = undefined;
        doc = { ...doc, ...patch, _rev: "2-concurrent" };
        docs.set(id, doc);
        onRead?.();
      }
      return { ...doc };
    }),
    allDocs: jest.fn(async () => {
      if (pendingAllDocsFailures > 0) {
        pendingAllDocsFailures -= 1;
        throw new Error("temporary media read failure");
      }
      return {
        rows: [...docs.entries()]
          .filter(([id]) => id.startsWith("media-item:"))
          .map(([id, doc]) => ({ id, doc: { ...doc } })),
      };
    }),
    put: jest.fn((input: Record<string, unknown>) => {
      const id = String(input._id);
      const response = { ok: true, id, rev: "2-updated" } as PouchDB.Core.Response;
      const persist = () => {
        docs.set(id, { ...input, _rev: response.rev });
        if (
          id === mediaItemDocId(mediaId) &&
          allDocsFailuresAfterNextRowPut > 0
        ) {
          pendingAllDocsFailures = allDocsFailuresAfterNextRowPut;
          allDocsFailuresAfterNextRowPut = 0;
        }
        return response;
      };
      if (id === mediaItemDocId(mediaId) && rejectNextRowPut) {
        rejectNextRowPut = false;
        return Promise.reject(new Error("write failed"));
      }
      if (id === mediaItemDocId(mediaId) && deferNextRowPut) {
        deferNextRowPut = false;
        return pendingPut.promise.then(persist);
      }
      return Promise.resolve(persist());
    }),
    deferNextRowPut: () => {
      deferNextRowPut = true;
    },
    rejectNextRowPut: () => {
      rejectNextRowPut = true;
    },
    commitDeferredPut: () => pendingPut.resolve({ ok: true, id: mediaItemDocId(mediaId), rev: "2-updated" }),
    readRow: () => docs.get(mediaItemDocId(mediaId)),
    removeRow: () => docs.delete(mediaItemDocId(mediaId)),
    changePersistedSourceId: (sourceId: string) => {
      const row = docs.get(mediaItemDocId(mediaId));
      if (!row) return;
      const localVideoInput = row.localVideoInput as Record<string, unknown>;
      docs.set(mediaItemDocId(mediaId), {
        ...row,
        localVideoInput: { ...localVideoInput, sourceId },
      });
    },
    updatePersistedRow: (patch: Partial<MediaType>) => {
      const row = docs.get(mediaItemDocId(mediaId));
      if (!row) return;
      docs.set(mediaItemDocId(mediaId), { ...row, ...patch });
    },
    updateRowOnNextGet: (
      patch: Partial<MediaType>,
      onRead?: () => void,
    ) => {
      rowPatchOnNextGet = { patch, onRead };
    },
    failReadAfterNextRowPut: (count = 1) => {
      allDocsFailuresAfterNextRowPut = count;
    },
  };
  return db;
};

const renderPersistenceHook = (
  row = createMediaRow(),
  persistInitialRow = true,
  reduxRow = row,
  scope = { churchId: "", isGuestSession: true },
) => {
  const db = createPouchDb(row, persistInitialRow);
  const store = configureStore({ reducer: { media: mediaReducer } });
  store.dispatch({
    type: "media/initiateMediaList",
    payload: [reduxRow],
  });
  (controllerInfo as unknown as { globalDb: PouchDB.Database }).globalDb =
    db as unknown as PouchDB.Database;
  let scopeDb = db;
  let activeChurchId = scope.churchId;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>
      <controllerInfo.ControllerInfoContext.Provider
        value={{ db: scopeDb, isGuestSession: scope.isGuestSession } as never}
      >
        <GlobalInfoContext.Provider value={{ churchId: activeChurchId } as never}>
          {children}
        </GlobalInfoContext.Provider>
      </controllerInfo.ControllerInfoContext.Provider>
    </Provider>
  );
  const view = renderHook(
    () => useLocalVideoInputThumbnailPersistence(),
    { wrapper },
  );
  const switchScope = (nextDb: typeof db, nextChurchId = activeChurchId) => {
    scopeDb = nextDb;
    activeChurchId = nextChurchId;
    (controllerInfo as unknown as { globalDb: PouchDB.Database }).globalDb =
      nextDb as unknown as PouchDB.Database;
    view.rerender();
  };
  return { ...view, db, store, switchScope };
};

describe("useLocalVideoInputThumbnailPersistence", () => {
  beforeEach(() => {
    const assets = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
      deleteLocalImageUploadJob: jest.Mock;
      getLocalImageUploadJob: jest.Mock;
      getRememberedLocalImagePolicy: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      restoreStagedLocalImageUploadCleanupJob: jest.Mock;
      saveLocalImage: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    assets.deleteLocalImage.mockReset().mockResolvedValue(undefined);
    assets.deleteLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.getLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.getRememberedLocalImagePolicy.mockReset().mockReturnValue("local-only");
    assets.putLocalImageUploadJob.mockReset().mockResolvedValue(undefined);
    assets.restoreStagedLocalImageUploadCleanupJob.mockReset().mockResolvedValue(true);
    assets.saveLocalImage.mockReset().mockResolvedValue(undefined);
    assets.stageLocalImageUploadCleanupJobAtomically
      .mockReset()
      .mockImplementation(async (job) => ({ job, previous: undefined }));
    const queue = jest.requireMock("../utils/localImageUploadQueue") as {
      cancelLocalImageUpload: jest.Mock;
      confirmStagedLocalVideoThumbnailReference: jest.Mock;
      enqueueLocalImageUpload: jest.Mock;
      releaseStagedLocalVideoThumbnailReference: jest.Mock;
      renewStagedLocalVideoThumbnailReference: jest.Mock;
      stageLocalVideoInputThumbnailUpload: jest.Mock;
    };
    queue.cancelLocalImageUpload.mockReset().mockResolvedValue(undefined);
    queue.enqueueLocalImageUpload.mockReset().mockResolvedValue(undefined);
    stagedThumbnailUploadJob = undefined;
    queue.stageLocalVideoInputThumbnailUpload.mockReset().mockImplementation(async (input) => {
      const ownerId = "reference-owner";
      stagedThumbnailUploadJob = {
        id: input.assetId,
        assetId: input.assetId,
        itemId: "",
        workspaceId: input.workspaceId,
        uploadPreset: input.uploadPreset,
        mediaId: input.mediaId,
        localVideoInputThumbnail: input.localVideoInputThumbnail,
        status: "pending",
        phase: "queued",
        attemptCount: 0,
        nextAttemptAt: 0,
        thumbnailReferenceState: "staged",
        thumbnailReferenceOwnerId: ownerId,
        thumbnailReferenceLeaseExpiresAt: Date.now() + 120_000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { job: stagedThumbnailUploadJob, ownerId };
    });
    queue.confirmStagedLocalVideoThumbnailReference
      .mockReset()
      .mockImplementation(async () => stagedThumbnailUploadJob
        ? { ...stagedThumbnailUploadJob, thumbnailReferenceState: "confirmed" }
        : undefined);
    queue.releaseStagedLocalVideoThumbnailReference
      .mockReset()
      .mockResolvedValue(undefined);
    queue.renewStagedLocalVideoThumbnailReference
      .mockReset()
      .mockImplementation(async (_assetId, ownerId) => stagedThumbnailUploadJob
        ? { ...stagedThumbnailUploadJob, thumbnailReferenceOwnerId: ownerId }
        : undefined);
  });

  afterEach(() => {
    (controllerInfo as unknown as { globalDb: undefined }).globalDb = undefined;
  });

  it("retains the prior thumbnail until a local-only replacement commits", async () => {
    const { result, db, store } = renderPersistenceHook();
    const frame = {
      blob: new Blob(["replacement"], { type: "image/webp" }),
      width: 640,
      height: 360,
    };
    db.deferNextRowPut();

    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, frame);
    });
    await waitFor(() => expect(db.put).toHaveBeenCalled());

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
      }),
    );

    await act(async () => {
      db.commitDeferredPut();
      await saving;
    });

    const persisted = db.readRow() as MediaType;
    expect(persisted).toEqual(
      expect.objectContaining({
        id: mediaId,
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        providerStorage: {
          provider: "mux",
          assetId: "existing-owner-asset",
          churchId: "church-1",
          permanent: true,
        },
        thumbnail: "",
        localImage: expect.objectContaining({
          id: expect.not.stringMatching(oldLocalImage.id),
          storagePolicy: "local-only",
        }),
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ localImage: persisted.localImage }),
    );
    const { deleteLocalImage } = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
    };
    expect(deleteLocalImage).toHaveBeenCalledWith(oldLocalImage.id);
  });

  it("preserves the existing thumbnail, folder, and metadata when only relinking source fields", async () => {
    const { result, db, store } = renderPersistenceHook();
    const nextSource = { ...source, label: "Relinked booth camera" };

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: nextSource.label,
        updatedAt: "updated-after-relink",
        localVideoInput: nextSource,
      });
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        id: mediaId,
        name: "Relinked booth camera",
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
        providerStorage: {
          provider: "mux",
          assetId: "existing-owner-asset",
          churchId: "church-1",
          permanent: true,
        },
      }),
    );
    expect(store.getState().media.list).toHaveLength(1);
  });

  it("keeps the prior Media reference when the thumbnail write fails", async () => {
    const { result, db, store } = renderPersistenceHook();
    const before = db.readRow();
    db.rejectNextRowPut();

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    expect(db.readRow()).toEqual(before);
    expect(store.getState().media.list[0]).toEqual(createMediaRow());
    const { deleteLocalImage } = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
    };
    expect(deleteLocalImage).toHaveBeenCalled();
  });

  it("applies a thumbnail to the latest row after a rename and source edit during image storage", async () => {
    const initialRow = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: undefined,
    } as MediaType;
    const { result, db, store } = renderPersistenceHook(initialRow);
    const stored = deferred<void>();
    const assets = jest.requireMock("../utils/localImageAssets") as {
      saveLocalImage: jest.Mock;
    };
    assets.saveLocalImage.mockImplementationOnce(() => stored.promise);
    const latestSource = {
      ...source,
      label: "Updated booth input",
      deviceId: "new-camera-device",
    };
    const latestPatch = {
      name: "Renamed booth input",
      folderId: "new-camera-folder",
      localVideoInput: latestSource,
    };
    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });
    await waitFor(() => expect(assets.saveLocalImage).toHaveBeenCalled());

    db.updatePersistedRow(latestPatch);
    act(() => {
      store.dispatch(updateMediaItemFields({ id: mediaId, patch: latestPatch }));
    });

    await act(async () => {
      stored.resolve();
      await saving;
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        name: "Renamed booth input",
        folderId: "new-camera-folder",
        localVideoInput: latestSource,
        thumbnail: "",
        localImage: expect.objectContaining({ storagePolicy: "local-only" }),
        providerStorage: createMediaRow().providerStorage,
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ ...latestPatch, thumbnail: "" }),
    );
  });

  it("keeps a thumbnail when a concurrent updatedAt edit wins during persistence", async () => {
    const { result, db, store } = renderPersistenceHook();
    const concurrentUpdatedAt = "updated-by-another-controller";
    db.updateRowOnNextGet({ updatedAt: concurrentUpdatedAt }, () => {
      store.dispatch(
        updateMediaItemFields({
          id: mediaId,
          patch: { updatedAt: concurrentUpdatedAt },
        }),
      );
    });

    let saving!: Promise<string>;
    await act(async () => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
      await saving;
    });

    const { saveLocalImage, deleteLocalImage } = jest.requireMock(
      "../utils/localImageAssets",
    ) as { saveLocalImage: jest.Mock; deleteLocalImage: jest.Mock };
    const savedAssetId = saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        updatedAt: concurrentUpdatedAt,
        localImage: expect.objectContaining({ id: savedAssetId }),
      }),
    );
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({
        updatedAt: concurrentUpdatedAt,
        localImage: expect.objectContaining({ id: savedAssetId }),
      }),
    );
    expect(deleteLocalImage).not.toHaveBeenCalledWith(savedAssetId);
  });

  it("recovers a committed thumbnail when the verification read fails once", async () => {
    const { result, db, store } = renderPersistenceHook();
    db.failReadAfterNextRowPut();

    let saving!: Promise<string>;
    await act(async () => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
      await saving;
    });

    const { saveLocalImage, deleteLocalImage } = jest.requireMock(
      "../utils/localImageAssets",
    ) as { saveLocalImage: jest.Mock; deleteLocalImage: jest.Mock };
    const savedAssetId = saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        localImage: expect.objectContaining({ id: savedAssetId }),
      }),
    );
    expect(store.getState().media.list[0].localImage?.id).toBe(savedAssetId);
    expect(deleteLocalImage).not.toHaveBeenCalledWith(savedAssetId);
  });

  it("stages the durable cloud job before Media and activates it only after verification", async () => {
    const { result, db } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");

    await act(async () => {
      await result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });

    const assetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    const queue = uploadQueue as typeof uploadQueue;
    const stagedOrder = jest.mocked(queue.stageLocalVideoInputThumbnailUpload).mock.invocationCallOrder[0];
    const mediaWriteOrder = db.put.mock.invocationCallOrder[0];
    const activationOrder = jest.mocked(queue.confirmStagedLocalVideoThumbnailReference).mock.invocationCallOrder[0];
    expect(stagedOrder).toBeLessThan(mediaWriteOrder);
    expect(mediaWriteOrder).toBeLessThan(activationOrder);
    expect(jest.mocked(queue.stageLocalVideoInputThumbnailUpload)).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId,
        workspaceId: "church-1",
        localVideoInputThumbnail: expect.objectContaining({
          targetMediaId: mediaId,
          targetSourceId: source.sourceId,
        }),
      }),
    );
    expect(jest.mocked(queue.confirmStagedLocalVideoThumbnailReference))
      .toHaveBeenCalledWith(assetId, "reference-owner");
  });

  it("does not commit Media after the staged reference lease is claimed by recovery", async () => {
    const { result, db } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
      deleteLocalImage: jest.Mock;
      deleteLocalImageUploadJob: jest.Mock;
    };
    const queue = jest.requireMock("../utils/localImageUploadQueue") as {
      renewStagedLocalVideoThumbnailReference: jest.Mock;
      releaseStagedLocalVideoThumbnailReference: jest.Mock;
      confirmStagedLocalVideoThumbnailReference: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");
    queue.renewStagedLocalVideoThumbnailReference.mockImplementationOnce(async () => {
      stagedThumbnailUploadJob = {
        ...stagedThumbnailUploadJob!,
        thumbnailReferenceOwnerId: "manager-owner",
      };
      return stagedThumbnailUploadJob;
    });

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The cloud thumbnail upload is already being recovered.");

    const assetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    expect(db.put).not.toHaveBeenCalled();
    expect(stagedThumbnailUploadJob).toEqual(expect.objectContaining({
      assetId,
      thumbnailReferenceOwnerId: "manager-owner",
      thumbnailReferenceState: "staged",
    }));
    expect(assets.deleteLocalImage).not.toHaveBeenCalledWith(assetId);
    expect(assets.deleteLocalImageUploadJob).not.toHaveBeenCalledWith(assetId);
    expect(queue.releaseStagedLocalVideoThumbnailReference)
      .toHaveBeenCalledWith(assetId, "reference-owner");
    expect(queue.confirmStagedLocalVideoThumbnailReference).not.toHaveBeenCalled();
  });

  it("retains a staged job when the write may have committed but verification reads fail", async () => {
    const { result, db } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
      deleteLocalImage: jest.Mock;
      deleteLocalImageUploadJob: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");
    db.failReadAfterNextRowPut(2);

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    const assetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(expect.objectContaining({
      localImage: expect.objectContaining({ id: assetId, storagePolicy: "local-and-cloud" }),
    }));
    expect(stagedThumbnailUploadJob).toEqual(expect.objectContaining({
      assetId,
      thumbnailReferenceState: "staged",
    }));
    expect(uploadQueue.releaseStagedLocalVideoThumbnailReference)
      .toHaveBeenCalledWith(assetId, "reference-owner");
    expect(assets.deleteLocalImage).not.toHaveBeenCalledWith(assetId);
    expect(assets.deleteLocalImageUploadJob).not.toHaveBeenCalledWith(assetId);
    expect(uploadQueue.confirmStagedLocalVideoThumbnailReference).not.toHaveBeenCalled();
  });

  it("removes the staged job when the Media write definitively fails", async () => {
    const { result, db } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
      deleteLocalImage: jest.Mock;
      deleteLocalImageUploadJob: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");
    db.rejectNextRowPut();

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    const assetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()?.localImage).toEqual(oldLocalImage);
    expect(assets.deleteLocalImageUploadJob).toHaveBeenCalledWith(assetId);
    expect(assets.deleteLocalImage).toHaveBeenCalledWith(assetId);
    expect(uploadQueue.confirmStagedLocalVideoThumbnailReference).not.toHaveBeenCalled();
  });

  it("preserves a new asset when neither post-write read can establish its outcome", async () => {
    const { result, db } = renderPersistenceHook();
    db.failReadAfterNextRowPut(2);

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    const { saveLocalImage, deleteLocalImage } = jest.requireMock(
      "../utils/localImageAssets",
    ) as { saveLocalImage: jest.Mock; deleteLocalImage: jest.Mock };
    const savedAssetId = saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        localImage: expect.objectContaining({ id: savedAssetId }),
      }),
    );
    expect(deleteLocalImage).not.toHaveBeenCalledWith(savedAssetId);
  });

  it("marks a combined initial add as uncertain when both post-write reads fail", async () => {
    const optimisticRow = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: undefined,
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      optimisticRow,
      false,
      optimisticRow,
    );
    db.failReadAfterNextRowPut(2);

    await expect(
      result.current.saveVideoInputThumbnail(
        mediaId,
        {
          blob: new Blob(["still"], { type: "image/webp" }),
          width: 640,
          height: 360,
        },
        {
          mediaPatch: { name: "New camera", localVideoInput: source },
          allowCreate: true,
        },
      ),
    ).rejects.toBeInstanceOf(VideoInputMediaWriteOutcomeUnknownError);

    const { saveLocalImage, deleteLocalImage } = jest.requireMock(
      "../utils/localImageAssets",
    ) as { saveLocalImage: jest.Mock; deleteLocalImage: jest.Mock };
    const savedAssetId = saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        name: "New camera",
        localVideoInput: source,
        localImage: expect.objectContaining({ id: savedAssetId }),
      }),
    );
    expect(deleteLocalImage).not.toHaveBeenCalledWith(savedAssetId);
  });

  it("does not clear a newer cloud-only thumbnail while removal cleanup is staged", async () => {
    const firstUrl = "https://res.cloudinary.com/demo/image/upload/v1/thumbnail-a.webp";
    const secondUrl = "https://res.cloudinary.com/demo/image/upload/v1/thumbnail-b.webp";
    const row = {
      ...createMediaRow(),
      thumbnail: firstUrl,
      localImage: undefined,
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImageUploadJob: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    const staging = deferred<{ job: LocalImageUploadJob; previous: undefined }>();
    assets.stageLocalImageUploadCleanupJobAtomically.mockImplementationOnce(
      () => staging.promise,
    );

    let removing!: Promise<void>;
    act(() => {
      removing = result.current.removeVideoInputThumbnail(mediaId);
    });
    await waitFor(() =>
      expect(assets.stageLocalImageUploadCleanupJobAtomically).toHaveBeenCalled(),
    );
    db.updatePersistedRow({ thumbnail: secondUrl });
    const stagedJob = assets.stageLocalImageUploadCleanupJobAtomically.mock
      .calls[0][0] as LocalImageUploadJob;

    await act(async () => {
      staging.resolve({ job: stagedJob, previous: undefined });
      await expect(removing).rejects.toThrow("This thumbnail changed.");
    });

    expect(db.readRow()).toEqual(expect.objectContaining({ thumbnail: secondUrl }));
    expect(db.put).not.toHaveBeenCalled();
    expect(assets.deleteLocalImageUploadJob).not.toHaveBeenCalledWith(stagedJob.assetId);
    expect(assets.putLocalImageUploadJob).toHaveBeenCalledWith(expect.objectContaining({
      assetId: stagedJob.assetId,
      cleanupReady: true,
    }));
  });

  it("keeps removal cleanup staged when Media verification read failed", async () => {
    const row = {
      ...createMediaRow(),
      thumbnail: "https://res.cloudinary.com/demo/image/upload/v1/thumbnail-a.webp",
      localImage: {
        ...oldLocalImage,
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "thumbnail-a-public-id",
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    db.failReadAfterNextRowPut(2);

    await expect(result.current.removeVideoInputThumbnail(mediaId)).rejects.toThrow(
      "The thumbnail could not be removed from Media. Try again.",
    );

    expect(db.readRow()).toEqual(expect.objectContaining({ thumbnail: "" }));
    expect(db.readRow()).not.toHaveProperty("localImage");
    const assets = jest.requireMock("../utils/localImageAssets") as {
      putLocalImageUploadJob: jest.Mock;
      restoreStagedLocalImageUploadCleanupJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    const staged = assets.stageLocalImageUploadCleanupJobAtomically.mock.calls[0][0];
    expect(staged).toEqual(expect.objectContaining({
      assetId: staged.assetId,
      cleanupOnly: true,
      cleanupReady: false,
    }));
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalled();
    expect(assets.restoreStagedLocalImageUploadCleanupJob).not.toHaveBeenCalled();
  });

  it("restores the staged cleanup job after a definitive removal failure", async () => {
    const row = {
      ...createMediaRow(),
      thumbnail: "https://res.cloudinary.com/demo/image/upload/v1/thumbnail-a.webp",
      localImage: {
        ...oldLocalImage,
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "thumbnail-a-public-id",
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    db.rejectNextRowPut();

    await expect(result.current.removeVideoInputThumbnail(mediaId)).rejects.toThrow(
      "The thumbnail could not be removed from Media. Try again.",
    );

    expect(db.readRow()).toEqual(expect.objectContaining({
      thumbnail: row.thumbnail,
      localImage: row.localImage,
    }));
    const assets = jest.requireMock("../utils/localImageAssets") as {
      putLocalImageUploadJob: jest.Mock;
      restoreStagedLocalImageUploadCleanupJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    const staged = assets.stageLocalImageUploadCleanupJobAtomically.mock.calls[0][0];
    expect(assets.restoreStagedLocalImageUploadCleanupJob).toHaveBeenCalledWith(
      staged,
      undefined,
    );
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalled();
  });

  it("keeps staged removal intent when both the write and reconciliation outcome are unknown", async () => {
    const row = {
      ...createMediaRow(),
      thumbnail: "https://res.cloudinary.com/demo/image/upload/v1/thumbnail-a.webp",
      localImage: {
        ...oldLocalImage,
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "thumbnail-a-public-id",
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    db.failReadAfterNextRowPut(3);

    await expect(result.current.removeVideoInputThumbnail(mediaId)).rejects.toThrow(
      "The thumbnail could not be removed from Media. Try again.",
    );

    expect(db.readRow()).toEqual(expect.objectContaining({ thumbnail: "" }));
    const assets = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImageUploadJob: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      restoreStagedLocalImageUploadCleanupJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    const staged = assets.stageLocalImageUploadCleanupJobAtomically.mock.calls[0][0];
    expect(staged).toEqual(expect.objectContaining({ cleanupOnly: true, cleanupReady: false }));
    expect(assets.restoreStagedLocalImageUploadCleanupJob).not.toHaveBeenCalled();
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalled();
    expect(assets.deleteLocalImageUploadJob).not.toHaveBeenCalledWith(staged.assetId);
  });

  it("does not remove a replacement thumbnail after removal starts for an older asset", async () => {
    const row = { ...createMediaRow(), thumbnail: "" };
    const { result, db } = renderPersistenceHook(row, true, row);
    const activeJob: LocalImageUploadJob = {
      id: oldLocalImage.id,
      assetId: oldLocalImage.id,
      itemId: "",
      workspaceId: "device-a",
      uploadPreset: "preset",
      mediaId: "thumbnail-cloud-media",
      status: "uploading",
      phase: "uploading",
      attemptCount: 1,
      nextAttemptAt: 0,
      createdAt: "created-a",
      updatedAt: "updated-a",
    };
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getLocalImageUploadJob: jest.Mock;
      deleteLocalImage: jest.Mock;
    };
    let currentJob: LocalImageUploadJob | undefined = activeJob;
    assets.getLocalImageUploadJob.mockImplementation(async (assetId: string) =>
      assetId === oldLocalImage.id ? currentJob : undefined,
    );
    const replacement = {
      ...oldLocalImage,
      id: "replacement-thumbnail-asset",
      fileName: "replacement.webp",
    };
    const cancellation = deferred<void>();
    jest.mocked(uploadQueue.cancelLocalImageUpload).mockImplementationOnce(
      async () => {
        await cancellation.promise;
        currentJob = { ...activeJob, status: "cancelled", phase: "cancelled" };
        db.updatePersistedRow({
          localImage: replacement,
          updatedAt: "updated-with-replacement",
        });
      },
    );

    let removing!: Promise<void>;
    act(() => {
      removing = result.current.removeVideoInputThumbnail(mediaId);
    });
    await waitFor(() =>
      expect(uploadQueue.cancelLocalImageUpload).toHaveBeenCalledWith(
        oldLocalImage.id,
      ),
    );

    await act(async () => {
      cancellation.resolve();
      await expect(removing).rejects.toThrow("This thumbnail changed.");
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({ localImage: replacement }),
    );
    expect(db.put).not.toHaveBeenCalled();
    expect(assets.deleteLocalImage).not.toHaveBeenCalledWith(replacement.id);
  });

  it("does not commit Media when the cloud upload intent cannot be staged", async () => {
    const { result, db } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
      deleteLocalImage: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");
    jest.mocked(uploadQueue.stageLocalVideoInputThumbnailUpload)
      .mockRejectedValueOnce(new Error("upload job storage unavailable"));

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).rejects.toThrow("upload job storage unavailable");

    const savedAssetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        localImage: oldLocalImage,
      }),
    );
    expect(db.put).not.toHaveBeenCalled();
    expect(assets.deleteLocalImage).toHaveBeenCalledWith(savedAssetId);
  });

  it("keeps a committed cloud intent staged when upload activation needs recovery", async () => {
    const previousCloudUrl = "https://res.cloudinary.com/demo/image/upload/v1/previous-thumbnail.webp";
    const row = {
      ...createMediaRow(),
      thumbnail: previousCloudUrl,
      localImage: {
        ...oldLocalImage,
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "previous-cloud-public-id",
        cloudUrl: previousCloudUrl,
        cloudMediaId: "previous-cloud-media-id",
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getRememberedLocalImagePolicy: jest.Mock;
      saveLocalImage: jest.Mock;
      deleteLocalImage: jest.Mock;
    };
    assets.getRememberedLocalImagePolicy.mockReturnValue("local-and-cloud");
    jest.mocked(uploadQueue.confirmStagedLocalVideoThumbnailReference).mockRejectedValueOnce(
      new Error("reference activation unavailable"),
    );

    await expect(
      result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      }),
    ).resolves.toBe("Thumbnail saved here. Its cloud upload will resume automatically.");

    const savedAssetId = assets.saveLocalImage.mock.calls[0][0].id as string;
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: previousCloudUrl,
        localImage: expect.objectContaining({
          id: savedAssetId,
          storagePolicy: "local-and-cloud",
        }),
      }),
    );
    expect(assets.deleteLocalImage).not.toHaveBeenCalledWith(savedAssetId);
    expect(stagedThumbnailUploadJob).toEqual(expect.objectContaining({
      assetId: savedAssetId,
      thumbnailReferenceState: "staged",
      localVideoInputThumbnail: expect.objectContaining({
        targetMediaId: mediaId,
        targetSourceId: source.sourceId,
      }),
    }));
    expect(uploadQueue.releaseStagedLocalVideoThumbnailReference)
      .toHaveBeenCalledWith(savedAssetId, "reference-owner");
  });

  it("keeps an active thumbnail upload checkpoint when a local-only replacement commits", async () => {
    const previousCloudUrl = "https://res.cloudinary.com/example/previous.webp";
    const row = {
      ...createMediaRow(),
      thumbnail: previousCloudUrl,
      localImage: {
        ...oldLocalImage,
        id: "thumbnail-a",
        storagePolicy: "local-and-cloud" as const,
        cloudPublicId: "previous-cloud-public-id",
        cloudUrl: previousCloudUrl,
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    const activeUpload: LocalImageUploadJob = {
      id: "thumbnail-a",
      assetId: "thumbnail-a",
      itemId: "",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "thumbnail-a-cloud-media",
      status: "uploading",
      phase: "uploading",
      attemptCount: 1,
      nextAttemptAt: 0,
      providerUploadId: "upload-intent-a",
      providerExpectedPublicId: "thumbnail-a-public-id",
      leaseOwnerId: "upload-tab-a",
      leaseExpiresAt: Date.now() + 60_000,
      localVideoInputThumbnail: {
        targetMediaId: mediaId,
        previousAssetId: "previous-thumbnail",
        previousCloudPublicId: "previous-cloud-public-id",
      },
      createdAt: "created-a",
      updatedAt: "updated-a",
    };
    let currentUpload = activeUpload;
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getLocalImageUploadJob: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    assets.getLocalImageUploadJob.mockImplementation(async (assetId: string) =>
      assetId === activeUpload.assetId ? currentUpload : undefined,
    );
    const cancellation = deferred<void>();
    jest.mocked(uploadQueue.cancelLocalImageUpload).mockImplementationOnce(
      () => cancellation.promise,
    );

    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });
    await waitFor(() => {
      const persisted = db.readRow() as MediaType | undefined;
      expect(persisted?.localImage?.id).not.toBe(activeUpload.assetId);
    });
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "",
        localImage: expect.objectContaining({
          id: expect.not.stringMatching(activeUpload.assetId),
          storagePolicy: "local-only",
        }),
      }),
    );
    expect(db.readRow()?.localImage).not.toHaveProperty("cloudPublicId");
    expect(assets.stageLocalImageUploadCleanupJobAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.stringMatching(/^thumbnail-cloud-cleanup-/),
        cleanupCloudPublicId: "previous-cloud-public-id",
        cleanupOnly: true,
        cleanupReady: false,
      }),
      expect.any(Number),
    );
    expect(assets.putLocalImageUploadJob).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.stringMatching(/^thumbnail-cloud-cleanup-/),
        cleanupCloudPublicId: "previous-cloud-public-id",
        cleanupOnly: true,
        cleanupReady: true,
      }),
    );
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );

    currentUpload = {
      ...activeUpload,
      status: "failed",
      phase: "failed",
      cancelRequested: true,
      lastError: "Cloud upload failed after the replacement.",
      leaseOwnerId: undefined,
      leaseExpiresAt: undefined,
    };
    await act(async () => {
      cancellation.reject(new Error("The upload could not be reconciled yet."));
      await saving;
    });

    expect(currentUpload).toEqual(
      expect.objectContaining({
        providerUploadId: "upload-intent-a",
        providerExpectedPublicId: "thumbnail-a-public-id",
        status: "failed",
      }),
    );
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );
    expect(db.readRow()).toEqual(
      expect.objectContaining({
        thumbnail: "",
        localImage: expect.objectContaining({ storagePolicy: "local-only" }),
      }),
    );
  });

  it("does not replace an active upload job when it has no cloud public ID yet", async () => {
    const row = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: {
        ...oldLocalImage,
        id: "thumbnail-without-cloud-id",
        storagePolicy: "local-and-cloud" as const,
      },
    } as MediaType;
    const { result, db } = renderPersistenceHook(
      row,
      true,
      row,
      { churchId: "church-1", isGuestSession: false },
    );
    const activeUpload: LocalImageUploadJob = {
      id: row.localImage!.id,
      assetId: row.localImage!.id,
      itemId: "",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "thumbnail-cloud-media",
      status: "uploading",
      phase: "uploading",
      attemptCount: 2,
      nextAttemptAt: 0,
      providerUploadId: "provider-upload-still-pending",
      providerExpectedPublicId: "thumbnail-provider-public-id",
      leaseOwnerId: "upload-tab-a",
      leaseExpiresAt: Date.now() + 60_000,
      localVideoInputThumbnail: {
        targetMediaId: mediaId,
        targetSourceId: source.sourceId,
      },
      createdAt: "created-a",
      updatedAt: "updated-a",
    };
    let currentUpload = activeUpload;
    const assets = jest.requireMock("../utils/localImageAssets") as {
      getLocalImageUploadJob: jest.Mock;
      putLocalImageUploadJob: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    assets.getLocalImageUploadJob.mockImplementation(async (assetId: string) =>
      assetId === activeUpload.assetId ? currentUpload : undefined,
    );
    const cancellation = deferred<void>();
    jest.mocked(uploadQueue.cancelLocalImageUpload).mockImplementationOnce(
      () => cancellation.promise,
    );

    let saving!: Promise<string>;
    act(() => {
      saving = result.current.saveVideoInputThumbnail(mediaId, {
        blob: new Blob(["replacement"], { type: "image/webp" }),
        width: 640,
        height: 360,
      });
    });
    await waitFor(() => {
      const persisted = db.readRow() as MediaType | undefined;
      expect(persisted?.localImage?.id).not.toBe(activeUpload.assetId);
    });
    expect(db.readRow()).toEqual(expect.objectContaining({
      thumbnail: "",
      localImage: expect.objectContaining({ storagePolicy: "local-only" }),
    }));
    expect(assets.stageLocalImageUploadCleanupJobAtomically).not.toHaveBeenCalled();
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );

    currentUpload = {
      ...activeUpload,
      status: "failed",
      phase: "failed",
      cancelRequested: true,
      lastError: "The provider response is still being reconciled.",
    };
    await act(async () => {
      cancellation.reject(new Error("Upload cancellation is still pending."));
      await saving;
    });

    expect(currentUpload).toEqual(expect.objectContaining({
      providerUploadId: "provider-upload-still-pending",
      providerExpectedPublicId: "thumbnail-provider-public-id",
      status: "failed",
      cancelRequested: true,
    }));
    expect(assets.putLocalImageUploadJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetId: activeUpload.assetId }),
    );
  });

  it("does not recreate an existing Media row removed from Pouch by a concurrent change", async () => {
    const { result, db } = renderPersistenceHook();
    db.removeRow();

    await expect(
      result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: "Stale relink",
      }),
    ).rejects.toThrow("This video input no longer exists in Media.");

    expect(db.readRow()).toBeUndefined();
    expect(db.put).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer persisted source binding", async () => {
    const { result, db } = renderPersistenceHook();
    db.changePersistedSourceId("newer-source-binding");

    await expect(
      result.current.persistVideoInputMediaPatch(mediaId, source.sourceId, {
        name: "Stale relink",
      }),
    ).rejects.toThrow("This video input changed. Reopen it and try again.");

    expect((db.readRow()?.localVideoInput as { sourceId: string }).sourceId).toBe(
      "newer-source-binding",
    );
    expect(db.put).not.toHaveBeenCalled();
  });

  it("does not publish an old database completion into a newly active scope", async () => {
    const { result, db, store, switchScope } = renderPersistenceHook();
    const nextDb = createPouchDb(createMediaRow());
    db.deferNextRowPut();

    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        { name: "Saved in the original church" },
      );
    });
    await waitFor(() => expect(db.put).toHaveBeenCalled());
    switchScope(nextDb);

    await act(async () => {
      db.commitDeferredPut();
      await saving;
    });

    expect((db.readRow() as MediaType).name).toBe("Saved in the original church");
    expect(store.getState().media.list[0].name).toBe("Booth camera");
  });

  it("does not publish an old church completion when the database handle is reused", async () => {
    const { result, db, store, switchScope } = renderPersistenceHook(
      createMediaRow(),
      true,
      createMediaRow(),
      { churchId: "church-a", isGuestSession: false },
    );
    db.deferNextRowPut();
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        { name: "Saved in church A" },
      );
    });
    await waitFor(() => expect(db.put).toHaveBeenCalled());
    switchScope(db as ReturnType<typeof createPouchDb>, "church-b");

    await act(async () => {
      db.commitDeferredPut();
      await saving;
    });

    expect((db.readRow() as MediaType).name).toBe("Saved in church A");
    expect(store.getState().media.list[0].name).toBe("Booth camera");
  });

  it("creates a newly added input only when the caller explicitly allows it", async () => {
    const row = createMediaRow();
    const { result, db } = renderPersistenceHook(row, false);

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        {
          name: "New camera input",
          localVideoInput: source,
        },
        true,
      );
    });

    expect(db.readRow()).toEqual(
      expect.objectContaining({
        id: mediaId,
        name: "New camera input",
        localVideoInput: source,
      }),
    );
  });

  it("commits a new input and its captured still in the same Media write", async () => {
    const optimisticRow = {
      ...createMediaRow(),
      name: "New booth input",
      createdAt: "new-input",
      updatedAt: "new-input",
      thumbnail: "",
      localImage: undefined,
      providerStorage: undefined,
    } as MediaType;
    const { result, db, store } = renderPersistenceHook(
      optimisticRow,
      false,
      optimisticRow,
      { churchId: "", isGuestSession: true },
    );
    const frame = {
      blob: new Blob(["still"], { type: "image/webp" }),
      width: 640,
      height: 360,
    };
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({ localVideoInput: source }),
    );

    await act(async () => {
      await result.current.saveVideoInputThumbnail(mediaId, frame, {
        mediaPatch: {
          name: "New booth input",
          localVideoInput: source,
        },
        allowCreate: true,
      });
    });

    expect(db.put).toHaveBeenCalledTimes(1);
    expect(db.readRow()).toEqual(expect.objectContaining({
      name: "New booth input",
      localVideoInput: source,
      localImage: expect.objectContaining({ contentType: "image/webp" }),
    }));
    expect(store.getState().media.list[0]).toEqual(expect.objectContaining({
      localImage: expect.objectContaining({ contentType: "image/webp" }),
    }));
  });

  it("leaves no persisted source row when the combined initial still write fails", async () => {
    const optimisticRow = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: undefined,
    } as MediaType;
    const { result, db } = renderPersistenceHook(optimisticRow, false, optimisticRow);
    db.rejectNextRowPut();

    await expect(result.current.saveVideoInputThumbnail(mediaId, {
      blob: new Blob(["still"], { type: "image/webp" }),
      width: 640,
      height: 360,
    }, {
      mediaPatch: { name: "New camera", localVideoInput: source },
      allowCreate: true,
    })).rejects.toThrow("The thumbnail could not be saved to Media. Try again.");

    expect(db.readRow()).toBeUndefined();
    const { deleteLocalImage } = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
    };
    expect(deleteLocalImage).toHaveBeenCalled();
  });

  it("removes a guest local-only thumbnail without staging an unserviceable cleanup job", async () => {
    const row = {
      ...createMediaRow(),
      thumbnail: "",
      localImage: { ...oldLocalImage, storagePolicy: "local-only" as const },
    };
    const { result, db } = renderPersistenceHook(row, true, row, {
      churchId: "",
      isGuestSession: true,
    });

    await act(async () => {
      await result.current.removeVideoInputThumbnail(mediaId);
    });

    expect(db.readRow()).toEqual(expect.objectContaining({ thumbnail: "" }));
    const assets = jest.requireMock("../utils/localImageAssets") as {
      deleteLocalImage: jest.Mock;
      stageLocalImageUploadCleanupJobAtomically: jest.Mock;
    };
    expect(assets.deleteLocalImage).toHaveBeenCalledWith(oldLocalImage.id);
    expect(assets.stageLocalImageUploadCleanupJobAtomically).not.toHaveBeenCalled();
  });

  it("restores existing persisted metadata when Redux only has a new-row placeholder", async () => {
    const persistedRow = createMediaRow();
    const optimisticRow = {
      ...persistedRow,
      createdAt: "placeholder-created-at",
      thumbnail: "",
      localImage: undefined,
      folderId: undefined,
      providerStorage: undefined,
    } as MediaType;
    const { result, store } = renderPersistenceHook(
      persistedRow,
      true,
      optimisticRow,
    );

    await act(async () => {
      await result.current.persistVideoInputMediaPatch(
        mediaId,
        source.sourceId,
        {
          name: "Booth camera relinked",
          localVideoInput: source,
        },
        true,
      );
    });

    expect(store.getState().media.list).toHaveLength(1);
    expect(store.getState().media.list[0]).toEqual(
      expect.objectContaining({
        id: mediaId,
        createdAt: "created-before-relink",
        folderId: "existing-folder",
        thumbnail: "https://images.example.com/original.webp",
        localImage: oldLocalImage,
        providerStorage: persistedRow.providerStorage,
      }),
    );
  });
});
