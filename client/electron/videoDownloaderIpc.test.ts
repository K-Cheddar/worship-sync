import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerVideoDownloaderIpc } from "./videoDownloaderIpc";

describe("native video downloader IPC authorization", () => {
  it("checks the controller sender before inspecting a URL", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const inspect = jest.fn().mockResolvedValue({ inspectionId: "inspection" });
    const assertControllerSender = jest.fn(() => { throw new Error("controller only"); });
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender,
      getDownloader: () => ({ inspect }) as never,
      getLocalAssetStore: () => null,
    });

    await expect(Promise.resolve(handlers.get("inspect-video-url")!(
      { sender: { id: 1 } } as unknown as IpcMainInvokeEvent,
      "https://youtu.be/video123",
    ))).rejects.toThrow("controller only");
    expect(assertControllerSender).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("allows an authorized controller to invoke the native inspection service", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const inspect = jest.fn().mockResolvedValue({ inspectionId: "inspection" });
    const assertControllerSender = jest.fn();
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender,
      getDownloader: () => ({ inspect }) as never,
      getLocalAssetStore: () => null,
    });

    await expect(handlers.get("inspect-video-url")!(
      { sender: { id: 1 } } as unknown as IpcMainInvokeEvent,
      "https://youtu.be/video123",
    )).resolves.toEqual({ inspectionId: "inspection" });
    expect(inspect).toHaveBeenCalledWith("https://youtu.be/video123");
  });

  it("does not acknowledge an import when permanent Media Library registration fails", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const importFile = jest.fn().mockRejectedValue(new Error("disk full"));
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender: jest.fn(),
      getDownloader: () => ({
        getCompletedFile: jest.fn(() => ({ path: "managed/video.mp4" })),
      }) as never,
      getLocalAssetStore: () => ({ importFile }) as never,
    });

    await expect(handlers.get("import-downloaded-video")!(
      { sender: { id: 1 } } as unknown as IpcMainInvokeEvent,
      {
        jobId: "12345678-1234-4123-8123-123456789abc",
        workspaceId: "church-1",
        width: 1920,
        height: 1080,
      },
    )).rejects.toThrow("disk full");
    expect(importFile).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "local_video_download_12345678-1234-4123-8123-123456789abc",
      kind: "video",
      contentType: "video/mp4",
    }));
  });

  it("reuses the same permanent asset id when a completed job is imported again", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const importFile = jest.fn(async (input: { assetId: string }) => ({
      assetId: input.assetId,
      kind: "video" as const,
      contentType: "video/mp4",
      size: 100,
      width: 1920,
      height: 1080,
      createdAt: "2026-10-29T12:00:00.000Z",
      updatedAt: "2026-10-29T12:00:00.000Z",
      url: "worshipsync-local-asset://video",
    }));
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender: jest.fn(),
      getDownloader: () => ({ getCompletedFile: jest.fn(() => ({ path: "managed/video.mp4" })) }) as never,
      getLocalAssetStore: () => ({ importFile }) as never,
    });
    const importVideo = handlers.get("import-downloaded-video")!;
    const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent;
    const request = {
      jobId: "12345678-1234-4123-8123-123456789abc",
      workspaceId: "church-1",
      width: 1920,
      height: 1080,
    };

    const first = await importVideo(event, request) as { assetId: string };
    const retried = await importVideo(event, request) as { assetId: string };

    expect(first.assetId).toBe(retried.assetId);
    expect(importFile).toHaveBeenCalledTimes(2);
    expect(importFile.mock.calls[0][0].assetId).toBe(importFile.mock.calls[1][0].assetId);
  });
});
