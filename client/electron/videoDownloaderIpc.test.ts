import type { IpcMain, IpcMainInvokeEvent } from "electron";
import * as finalization from "./externalVideoFinalization";
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


describe("job-bound native external destinations", () => {
  const finalize = jest.spyOn(finalization, "finalizeExternalVideo");
  afterEach(() => finalize.mockReset());
  afterAll(() => finalize.mockRestore());

  const harness = () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let directory = "D:\\Folder A";
    let available = true;
    const event = { sender: { id: 1 } } as IpcMainInvokeEvent;
    const preferences = { get: async () => ({ lastDirectory: directory, saveOutsideWorshipSync: true, uploadToCloud: false }),
      update: jest.fn(async () => ({ lastDirectory: directory, saveOutsideWorshipSync: true, uploadToCloud: false })) };
    const startDownload = jest.fn(async (input: { jobId: string }) => ({ jobId: input.jobId }));
    registerVideoDownloaderIpc({
      ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain,
      assertControllerSender: jest.fn(), getDownloader: () => ({ startDownload, cancelDownload: jest.fn(),
        getCompletedFile: () => ({ path: "temporary/video.mp4", directory: "temporary" }) }) as never,
      getLocalAssetStore: () => ({}) as never, getPreferencesStore: () => preferences as never,
      selectVideoFile: async () => undefined, selectVideoDirectory: async () => directory,
      isDirectoryAvailable: async () => available,
    });
    finalize.mockResolvedValue({ asset: { assetId: "asset", contentHash: "a".repeat(64) } as never, fileName: "video.mp4" });
    const invoke = (channel: string, input?: unknown, sender = event) => Promise.resolve(handlers.get(channel)!(sender, input));
    const start = (jobId: string, destinationDirectoryId: string) => invoke("start-video-download", { jobId, inspectionId: "inspection", quality: 720, destinationDirectoryId });
    const save = (jobId: string, sender = event) => invoke("save-downloaded-video-externally", { jobId, workspaceId: "church-a", displayName: "Video", width: 1920, height: 1080, destinationDirectory: "C:\\untrusted" }, sender);
    return { invoke, start, save, startDownload, event, setDirectory: (value: string) => { directory = value; }, setAvailable: (value: boolean) => { available = value; } };
  };
  const jobA = "12345678-1234-4123-8123-123456789abc";
  const jobB = "12345678-1234-4123-8123-123456789abd";

  it("keeps A in Folder A after the default changes, while B uses Folder B; retry retains A", async () => {
    const h = harness();
    const selectedA = await h.invoke("get-video-download-preferences") as { destinationDirectoryId: string; destinationDirectoryDisplay: string };
    expect(selectedA.destinationDirectoryDisplay).toBe("D:\\Folder A");
    await h.start(jobA, selectedA.destinationDirectoryId);
    h.setDirectory("D:\\Folder B");
    const selectedB = await h.invoke("choose-video-download-directory") as { destinationDirectoryId: string };
    await h.start(jobB, selectedB.destinationDirectoryId);
    await h.invoke("cancel-video-download", jobA);
    await h.start(jobA, selectedB.destinationDirectoryId);
    await h.save(jobA); await h.save(jobB);
    expect(finalize.mock.calls.map(([args]) => args.destinationDirectory)).toEqual(["D:\\Folder A", "D:\\Folder B"]);
  });

  it("requires restoring an unavailable original folder and never falls back to a new default", async () => {
    const h = harness();
    const selection = await h.invoke("get-video-download-preferences") as { destinationDirectoryId: string };
    await h.start(jobA, selection.destinationDirectoryId);
    h.setDirectory("D:\\Folder B"); h.setAvailable(false);
    await expect(h.save(jobA)).rejects.toThrow("original download folder is unavailable");
    expect(finalize).not.toHaveBeenCalled();
    h.setAvailable(true); await h.save(jobA);
    expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ destinationDirectory: "D:\\Folder A" }));
  });

  it("rejects arbitrary paths, foreign selection tokens and foreign job access", async () => {
    const h = harness();
    await expect(h.start(jobA, "C:\\untrusted")).rejects.toThrow("Choose the destination folder again");
    const selection = await h.invoke("get-video-download-preferences") as { destinationDirectoryId: string };
    const foreign = { sender: { id: 2 } } as IpcMainInvokeEvent;
    await expect(h.invoke("start-video-download", { jobId: jobB, destinationDirectoryId: selection.destinationDirectoryId }, foreign)).rejects.toThrow("Choose the destination folder again");
    await h.start(jobA, selection.destinationDirectoryId);
    await expect(h.save(jobA, foreign)).rejects.toThrow("no selected destination");
    expect(finalize).not.toHaveBeenCalled();
  });
});


it("authorizes relink reconciliation and broadcasts only the current committed cache revision", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const notifyLocalVideoChanged = jest.fn();
  const descriptor = { assetId: "stable", contentHash: "a".repeat(64) };
  const getRelinkStatus = jest.fn(async () => ({ status: "pending", asset: descriptor }));
  registerVideoDownloaderIpc({
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain,
    assertControllerSender: (sender) => { if (sender.id !== 1) throw new Error("controller only"); },
    getDownloader: () => null,
    getLocalAssetStore: () => ({ getRegisteredDescriptor: async () => descriptor, getRelinkStatus }) as never,
    getPreferencesStore: () => null, selectVideoFile: async () => undefined,
    selectVideoDirectory: async () => undefined, isDirectoryAvailable: async () => true, notifyLocalVideoChanged,
  });
  const controller = { sender: { id: 1 } } as IpcMainInvokeEvent;
  const output = { sender: { id: 2 } } as IpcMainInvokeEvent;
  await expect(handlers.get("get-local-video-relink-status")!(output, { assetId: "stable", candidateId: "candidate" })).rejects.toThrow("controller only");
  expect(getRelinkStatus).not.toHaveBeenCalled();
  await expect(handlers.get("get-local-video-relink-status")!(controller, { assetId: "stable", candidateId: "candidate" })).resolves.toMatchObject({ status: "pending" });
  await expect(handlers.get("notify-local-video-asset-changed")!(output, { assetId: "stable", contentHash: "a".repeat(64) })).rejects.toThrow("controller only");
  await expect(handlers.get("notify-local-video-asset-changed")!(controller, { assetId: "stable", contentHash: "b".repeat(64) })).resolves.toBe(false);
  expect(notifyLocalVideoChanged).not.toHaveBeenCalled();
  await expect(handlers.get("notify-local-video-asset-changed")!(controller, { assetId: "stable", contentHash: "a".repeat(64) })).resolves.toBe(true);
  expect(notifyLocalVideoChanged).toHaveBeenCalledWith("stable");
});
