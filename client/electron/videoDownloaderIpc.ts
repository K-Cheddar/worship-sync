import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { buildLocalAssetProtocolUrl, type LocalAssetStore } from "./localAssetStore";
import { finalizeExternalVideo } from "./externalVideoFinalization";
import type { VideoDownloadPreferencesStore } from "./videoDownloadPreferences";
import { getVideoContentType } from "../src/utils/mediaFileTypes";
import type { VideoDownloader } from "./videoDownloader";

type Dependencies = {
  ipcMain: Pick<IpcMain, "handle">;
  assertControllerSender: (sender: WebContents) => void;
  getDownloader: () => VideoDownloader | null;
  getLocalAssetStore: () => LocalAssetStore | null;
  getPreferencesStore: () => VideoDownloadPreferencesStore | null;
  selectVideoFile: (sender: WebContents) => Promise<string | undefined>;
  selectVideoDirectory: (sender: WebContents, defaultPath?: string) => Promise<string | undefined>;
  isDirectoryAvailable: (path: string) => Promise<boolean>;
  notifyLocalVideoChanged?: (assetId: string) => void;
};

const requireDownloader = (getDownloader: Dependencies["getDownloader"]) => {
  const downloader = getDownloader();
  if (!downloader) throw new Error("Video downloads are available in the Windows desktop app.");
  return downloader;
};

const assertSender = (
  event: IpcMainInvokeEvent,
  assertControllerSender: Dependencies["assertControllerSender"],
) => assertControllerSender(event.sender);

export const registerVideoDownloaderIpc = ({
  ipcMain,
  assertControllerSender,
  getDownloader,
  getLocalAssetStore,
  getPreferencesStore,
  selectVideoFile,
  selectVideoDirectory,
  isDirectoryAvailable,
  notifyLocalVideoChanged,
}: Dependencies) => {
  // Opaque selections and job bindings are native-only and scoped to the
  // authorized WebContents. Renderer paths are never accepted as authority.
  const selections = new Map<string, { senderId: number; directory: string }>();
  const destinations = new Map<string, { senderId: number; directory?: string }>();
  const selectionFor = (sender: WebContents, directory?: string) => {
    if (!directory) return {};
    const existing = [...selections].find(([, value]) =>
      value.senderId === sender.id && value.directory === directory);
    const destinationDirectoryId = existing?.[0] ?? randomUUID();
    selections.set(destinationDirectoryId, { senderId: sender.id, directory });
    return { destinationDirectoryId, destinationDirectoryDisplay: directory };
  };

  ipcMain.handle("is-video-downloader-available", (event) => {
    assertSender(event, assertControllerSender);
    return getDownloader() !== null;
  });

  ipcMain.handle("inspect-video-url", async (event, rawUrl: unknown) => {
    assertSender(event, assertControllerSender);
    return requireDownloader(getDownloader).inspect(rawUrl);
  });

  ipcMain.handle("start-video-download", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object") throw new Error("The download request is invalid.");
    const value = input as { inspectionId?: unknown; quality?: unknown; jobId?: unknown; destinationDirectoryId?: unknown };
    if (typeof value.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.jobId)) {
      throw new Error("The download job is invalid.");
    }
    const bound = destinations.get(value.jobId);
    if (bound && bound.senderId !== event.sender.id) throw new Error("The download job belongs to another window.");
    if (!bound) {
      const selection = typeof value.destinationDirectoryId === "string"
        ? selections.get(value.destinationDirectoryId) : undefined;
      if (value.destinationDirectoryId !== undefined && (!selection || selection.senderId !== event.sender.id)) {
        throw new Error("Choose the destination folder again before downloading.");
      }
      destinations.set(value.jobId, { senderId: event.sender.id, directory: selection?.directory });
    }
    return requireDownloader(getDownloader).startDownload(value as {
      inspectionId: unknown; quality: unknown; jobId: unknown;
    });
  });

  ipcMain.handle("cancel-video-download", (event, jobId: unknown) => {
    assertSender(event, assertControllerSender);
    if (typeof jobId !== "string") throw new Error("The download job is invalid.");
    return requireDownloader(getDownloader).cancelDownload(jobId);
  });

  ipcMain.handle("import-downloaded-video", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object") throw new Error("The video import details are invalid.");
    const value = input as {
      jobId?: unknown;
      workspaceId?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const { jobId, workspaceId, width, height } = value;
    if (
      typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId) ||
      typeof workspaceId !== "string" || workspaceId.length > 200 ||
      !Number.isInteger(width) || Number(width) <= 0 || Number(width) > 7680 ||
      !Number.isInteger(height) || Number(height) <= 0 || Number(height) > 4320
    ) throw new Error("The video import details are invalid.");
    const downloader = requireDownloader(getDownloader);
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const completed = downloader.getCompletedFile(jobId);
    const descriptor = await store.importFile({
      assetId: `local_video_download_${jobId}`,
      workspaceId,
      kind: "video",
      sourcePath: completed.path,
      fileName: "downloaded-video.mp4",
      contentType: "video/mp4",
      width: Number(width),
      height: Number(height),
    });
    return { ...descriptor, url: buildLocalAssetProtocolUrl(descriptor) };
  });

  ipcMain.handle("upload-downloaded-video-to-mux", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object") throw new Error("The cloud upload request is invalid.");
    const value = input as { jobId?: unknown; url?: unknown };
    if (typeof value.jobId !== "string") throw new Error("The cloud upload request is invalid.");
    return requireDownloader(getDownloader).uploadToMux(value.jobId, value.url);
  });

  ipcMain.handle("upload-local-video-asset-to-mux", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("The local video upload request is invalid.");
    }
    const value = input as { jobId?: unknown; assetId?: unknown; url?: unknown };
    if (
      typeof value.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.jobId) ||
      typeof value.assetId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.assetId) ||
      typeof value.url !== "string" || value.url.length > 8192
    ) throw new Error("The local video upload request is invalid.");
    const downloader = requireDownloader(getDownloader);
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const opened = await store.openForRead(value.assetId);
    if (!opened || opened.descriptor.kind !== "video") {
      await opened?.handle.close().catch(() => undefined);
      throw new Error("This video is not available on this device.");
    }
    return downloader.uploadLocalAssetToMux(
      value.jobId,
      opened.handle,
      opened.descriptor.size,
      value.url,
    );
  });

  ipcMain.handle("cleanup-video-download", async (event, jobId: unknown) => {
    assertSender(event, assertControllerSender);
    if (typeof jobId !== "string") throw new Error("The download job is invalid.");
    await requireDownloader(getDownloader).cleanup(jobId);
    return true;
  });

  ipcMain.handle("get-video-download-preferences", async (event) => {
    assertSender(event, assertControllerSender);
    const preferencesStore = getPreferencesStore();
    if (!preferencesStore) throw new Error("Video download preferences are not ready.");
    const preferences = await preferencesStore.get();
    const directoryAvailable = preferences.lastDirectory
      ? await isDirectoryAvailable(preferences.lastDirectory)
      : false;
    return {
      saveOutsideWorshipSync: preferences.saveOutsideWorshipSync,
      uploadToCloud: preferences.uploadToCloud,
      hasDestinationDirectory: Boolean(preferences.lastDirectory),
      ...selectionFor(event.sender, preferences.lastDirectory),
      destinationDirectoryAvailable: directoryAvailable,
    };
  });

  ipcMain.handle("update-video-download-preferences", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("The video download preferences are invalid.");
    }
    const patch = input as { saveOutsideWorshipSync?: unknown; uploadToCloud?: unknown };
    const normalized: { saveOutsideWorshipSync?: boolean; uploadToCloud?: boolean } = {};
    if (patch.saveOutsideWorshipSync !== undefined) {
      if (typeof patch.saveOutsideWorshipSync !== "boolean") throw new Error("The video download preferences are invalid.");
      normalized.saveOutsideWorshipSync = patch.saveOutsideWorshipSync;
    }
    if (patch.uploadToCloud !== undefined) {
      if (typeof patch.uploadToCloud !== "boolean") throw new Error("The video download preferences are invalid.");
      normalized.uploadToCloud = patch.uploadToCloud;
    }
    const preferencesStore = getPreferencesStore();
    if (!preferencesStore) throw new Error("Video download preferences are not ready.");
    const preferences = await preferencesStore.update(normalized);
    return {
      saveOutsideWorshipSync: preferences.saveOutsideWorshipSync,
      uploadToCloud: preferences.uploadToCloud,
      hasDestinationDirectory: Boolean(preferences.lastDirectory),
      ...selectionFor(event.sender, preferences.lastDirectory),
      destinationDirectoryAvailable: preferences.lastDirectory
        ? await isDirectoryAvailable(preferences.lastDirectory)
        : false,
    };
  });

  ipcMain.handle("choose-video-download-directory", async (event) => {
    assertSender(event, assertControllerSender);
    const preferencesStore = getPreferencesStore();
    if (!preferencesStore) throw new Error("Video download preferences are not ready.");
    const current = await preferencesStore.get();
    const selected = await selectVideoDirectory(event.sender, current.lastDirectory);
    if (!selected) return undefined;
    const preferences = await preferencesStore.update({ lastDirectory: selected });
    return {
      hasDestinationDirectory: true,
      ...selectionFor(event.sender, preferences.lastDirectory),
      destinationDirectoryAvailable: Boolean(preferences.lastDirectory && await isDirectoryAvailable(preferences.lastDirectory)),
    };
  });

  ipcMain.handle("link-local-video-file", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The local video details are invalid.");
    const workspaceId = (input as { workspaceId?: unknown }).workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 200) {
      throw new Error("The local video details are invalid.");
    }
    const selected = await selectVideoFile(event.sender);
    if (!selected) return undefined;
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const fileName = basename(selected);
    const descriptor = await store.linkFile({
      assetId: `local_video_link_${randomUUID()}`,
      workspaceId,
      kind: "video",
      sourcePath: selected,
      fileName,
      contentType: getVideoContentType({ name: fileName, type: "" }),
    });
    return { ...descriptor, url: buildLocalAssetProtocolUrl(descriptor) };
  });

  ipcMain.handle("relink-local-video-file", async (event, assetId: unknown) => {
    assertSender(event, assertControllerSender);
    if (typeof assetId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(assetId)) {
      throw new Error("The local video reference is invalid.");
    }
    const selected = await selectVideoFile(event.sender);
    if (!selected) return undefined;
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const fileName = basename(selected);
    const descriptor = await store.relinkFile(assetId, {
      kind: "video",
      sourcePath: selected,
      fileName,
      contentType: getVideoContentType({ name: fileName, type: "" }),
    });
    return { ...descriptor, url: buildLocalAssetProtocolUrl(descriptor) };
  });

  ipcMain.handle("commit-relink-local-video-file", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    const value = input as { assetId?: unknown; candidateId?: unknown } | null;
    if (!value || typeof value.assetId !== "string" || typeof value.candidateId !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(value.assetId) || !/^[A-Za-z0-9_-]{1,160}$/.test(value.candidateId)) {
      throw new Error("The local video reference is invalid.");
    }
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const descriptor = await store.commitRelinkFile(value.assetId, value.candidateId);
    notifyLocalVideoChanged?.(descriptor.assetId);
    return { ...descriptor, url: buildLocalAssetProtocolUrl(descriptor) };
  });

  ipcMain.handle("get-local-video-relink-status", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    const value = input as { assetId?: unknown; candidateId?: unknown } | null;
    if (!value || typeof value.assetId !== "string" || typeof value.candidateId !== "string" ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(value.assetId) || !/^[A-Za-z0-9_-]{1,160}$/.test(value.candidateId)) {
      throw new Error("The local video reference is invalid.");
    }
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const result = await store.getRelinkStatus(value.assetId, value.candidateId);
    return { ...result, asset: result.asset ? { ...result.asset, url: buildLocalAssetProtocolUrl(result.asset) } : undefined };
  });

  ipcMain.handle("notify-local-video-asset-changed", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    const value = input as { assetId?: unknown; contentHash?: unknown } | null;
    if (!value || typeof value.assetId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value.assetId) ||
        typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
      throw new Error("The local video reference is invalid.");
    }
    const descriptor = await getLocalAssetStore()?.getRegisteredDescriptor(value.assetId);
    if (!descriptor || descriptor.contentHash !== value.contentHash) return false;
    notifyLocalVideoChanged?.(value.assetId);
    return true;
  });

  ipcMain.handle("save-downloaded-video-externally", async (event, input: unknown) => {
    assertSender(event, assertControllerSender);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The external save request is invalid.");
    const value = input as { jobId?: unknown; workspaceId?: unknown; displayName?: unknown; width?: unknown; height?: unknown };
    if (
      typeof value.jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.jobId) ||
      typeof value.workspaceId !== "string" || !value.workspaceId.trim() || value.workspaceId.length > 200 ||
      typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 300 ||
      !Number.isInteger(value.width) || Number(value.width) <= 0 || Number(value.width) > 7680 ||
      !Number.isInteger(value.height) || Number(value.height) <= 0 || Number(value.height) > 4320
    ) throw new Error("The external save request is invalid.");
    const downloader = requireDownloader(getDownloader);
    const store = getLocalAssetStore();
    if (!store) throw new Error("Local media storage is not ready.");
    const destination = destinations.get(value.jobId);
    if (!destination || destination.senderId !== event.sender.id || !destination.directory) {
      throw new Error("This job has no selected destination folder. Start a new download with a folder selected.");
    }
    const directory = destination.directory;
    if (!(await isDirectoryAvailable(directory))) {
      throw new Error("The original download folder is unavailable. Reconnect the drive or restore the folder, then retry this download.");
    }
    const completed = downloader.getCompletedFile(value.jobId);
    const result = await finalizeExternalVideo({
      sourcePath: completed.path,
      sourceDirectory: completed.directory,
      destinationDirectory: directory,
      displayName: value.displayName,
      assetId: `local_video_download_${value.jobId}`,
      workspaceId: value.workspaceId,
      width: Number(value.width),
      height: Number(value.height),
      store,
    });
    return {
      ...result.asset,
      url: buildLocalAssetProtocolUrl(result.asset),
      savedFileName: result.fileName,
    };
  });
};
