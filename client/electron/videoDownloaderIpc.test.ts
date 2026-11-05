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
      getPreferencesStore: () => null,
      selectVideoFile: jest.fn(async () => undefined),
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
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
      getPreferencesStore: () => null,
      selectVideoFile: jest.fn(async () => undefined),
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
    });

    await expect(handlers.get("inspect-video-url")!(
      { sender: { id: 1 } } as unknown as IpcMainInvokeEvent,
      "https://youtu.be/video123",
    )).resolves.toEqual({ inspectionId: "inspection" });
    expect(inspect).toHaveBeenCalledWith("https://youtu.be/video123");
  });

  it("uses only the native file selection for linked videos and authorizes the dialog", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const selectedPath = "C:\\Users\\Operator\\Videos\\welcome.mp4";
    const selectVideoFile = jest.fn(async () => selectedPath);
    const linkFile = jest.fn(async (input: {
      assetId: string;
      sourcePath: string;
      fileName: string;
      contentType: string;
    }) => ({
      assetId: input.assetId,
      kind: "video" as const,
      fileName: "welcome.mp4",
      contentType: "video/mp4",
      size: 100,
      contentHash: "a".repeat(64),
      storageMode: "linked" as const,
      createdAt: "2026-11-05T12:00:00.000Z",
      updatedAt: "2026-11-05T12:00:00.000Z",
    }));
    const assertControllerSender = jest.fn();
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender,
      getDownloader: () => null,
      getLocalAssetStore: () => ({ linkFile }) as never,
      getPreferencesStore: () => null,
      selectVideoFile,
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
    });
    const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent;

    const linked = await handlers.get("link-local-video-file")!(event, {
      workspaceId: "church-1",
      sourcePath: "C:\\Users\\Operator\\Documents\\private.mp4",
    }) as { assetId: string };

    expect(selectVideoFile).toHaveBeenCalledWith(event.sender);
    expect(linkFile).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: selectedPath,
      fileName: "welcome.mp4",
      contentType: "video/mp4",
    }));
    expect(linkFile.mock.calls[0][0]).not.toHaveProperty("sourcePath", "C:\\Users\\Operator\\Documents\\private.mp4");
    expect(linked.assetId).toMatch(/^local_video_link_/);

    const unauthorizedHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const unauthorizedSelect = jest.fn(async () => selectedPath);
    registerVideoDownloaderIpc({
      ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown) => unauthorizedHandlers.set(channel, handler),
      } as unknown as IpcMain,
      assertControllerSender: () => { throw new Error("controller only"); },
      getDownloader: () => null,
      getLocalAssetStore: () => ({ linkFile }) as never,
      getPreferencesStore: () => null,
      selectVideoFile: unauthorizedSelect,
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
    });
    await expect(unauthorizedHandlers.get("link-local-video-file")!(event, {
      workspaceId: "church-1",
    })).rejects.toThrow("controller only");
    expect(unauthorizedSelect).not.toHaveBeenCalled();
  });

  it("streams a registered video by asset id and rejects renderer-supplied paths", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    } as unknown as IpcMain;
    const handle = { close: jest.fn(async () => undefined) };
    const openForRead = jest.fn(async () => ({
      descriptor: { kind: "video" as const, size: 2048 },
      handle,
    }));
    const uploadLocalAssetToMux = jest.fn(async () => undefined);
    registerVideoDownloaderIpc({
      ipcMain,
      assertControllerSender: jest.fn(),
      getDownloader: () => ({ uploadLocalAssetToMux }) as never,
      getLocalAssetStore: () => ({ openForRead }) as never,
      getPreferencesStore: () => null,
      selectVideoFile: jest.fn(async () => undefined),
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
    });

    await handlers.get("upload-local-video-asset-to-mux")!(
      { sender: { id: 1 } } as unknown as IpcMainInvokeEvent,
      {
        jobId: "12345678-1234-4123-8123-123456789abc",
        assetId: "local_video_link_1",
        url: "https://upload.mux.com/upload-token",
        sourcePath: "C:\\Users\\Operator\\Documents\\private.mp4",
      },
    );

    expect(openForRead).toHaveBeenCalledWith("local_video_link_1");
    expect(uploadLocalAssetToMux).toHaveBeenCalledWith(
      "12345678-1234-4123-8123-123456789abc",
      handle,
      2048,
      "https://upload.mux.com/upload-token",
    );
    expect(handle.close).not.toHaveBeenCalled();
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
      getPreferencesStore: () => null,
      selectVideoFile: jest.fn(async () => undefined),
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
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
      getPreferencesStore: () => null,
      selectVideoFile: jest.fn(async () => undefined),
      selectVideoDirectory: jest.fn(async () => undefined),
      isDirectoryAvailable: jest.fn(async () => false),
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
