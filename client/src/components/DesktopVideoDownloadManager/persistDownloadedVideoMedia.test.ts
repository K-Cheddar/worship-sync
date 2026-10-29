import type { MediaType } from "../../types";
import type { RootState, AppDispatch } from "../../store/store";
import { addItemToMediaList, updateMediaItemFields } from "../../store/mediaSlice";
import * as mediaDocs from "../../utils/mediaDocUtils";
import * as mediaFlush from "../../utils/flushMediaLibraryDoc";
import { persistDownloadedVideoMedia, removeDownloadedVideoAssetIfUnreferenced } from "./persistDownloadedVideoMedia";
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

  it("upserts the same stable Media ID after an uncertain first write instead of adding a duplicate", async () => {
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
    flushMediaLibraryDocToPouch
      .mockResolvedValueOnce({ ok: false, error: new Error("Write acknowledgement was lost.") })
      .mockResolvedValueOnce({ ok: true });

    await expect(persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState,
      isOwnerCurrent,
    })).rejects.toThrow("Write acknowledgement was lost.");

    await persistDownloadedVideoMedia({
      incoming: media,
      owner,
      dispatch: dispatch as unknown as AppDispatch,
      getState,
      isOwnerCurrent,
    });

    expect(dispatch.mock.calls.filter(([action]) => action.type === addItemToMediaList.type)).toHaveLength(1);
    expect(dispatch.mock.calls.filter(([action]) => action.type === updateMediaItemFields.type)).toHaveLength(1);
    expect(mediaState.list).toHaveLength(1);
    expect(flushMediaLibraryDocToPouch).toHaveBeenCalledTimes(2);
    expect(readMediaItemForDeletion).toHaveBeenCalledWith(db, media.id);
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
});
