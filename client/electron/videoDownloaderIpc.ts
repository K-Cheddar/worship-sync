import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { buildLocalAssetProtocolUrl, type LocalAssetStore } from "./localAssetStore";
import type { VideoDownloader } from "./videoDownloader";

type Dependencies = {
  ipcMain: Pick<IpcMain, "handle">;
  assertControllerSender: (sender: WebContents) => void;
  getDownloader: () => VideoDownloader | null;
  getLocalAssetStore: () => LocalAssetStore | null;
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
}: Dependencies) => {
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
    const value = input as { inspectionId?: unknown; quality?: unknown; jobId?: unknown };
    return requireDownloader(getDownloader).startDownload(value as {
      inspectionId: unknown;
      quality: unknown;
      jobId?: unknown;
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

  ipcMain.handle("cleanup-video-download", async (event, jobId: unknown) => {
    assertSender(event, assertControllerSender);
    if (typeof jobId !== "string") throw new Error("The download job is invalid.");
    await requireDownloader(getDownloader).cleanup(jobId);
    return true;
  });
};
