import type { MediaType } from "../../types";
import type { ElectronLocalAsset, DesktopVideoDownloadEvent, DesktopVideoInspection } from "../../types/electron";
import type { Transfer } from "../../context/transferModel";
import type { MuxUploadResult } from "../../containers/Media/MediaUploadInput.types";
import { DesktopVideoDownloadManager, type DesktopVideoDownloadDependencies, type DesktopVideoDownloadOwner } from "./desktopVideoDownloadController";

const inspection: DesktopVideoInspection = {
  inspectionId: "inspection-one",
  title: "Sunday Service",
  thumbnail: "",
  duration: 90,
  heights: [1080, 720],
  defaultQuality: 1080,
};

const asset: ElectronLocalAsset = {
  assetId: "local_video_download_12345678-1234-4123-8123-123456789abc",
  kind: "video",
  fileName: "downloaded-video.mp4",
  contentType: "video/mp4",
  size: 512,
  width: 1920,
  height: 1080,
  createdAt: "2026-10-29T12:00:00.000Z",
  updatedAt: "2026-10-29T12:00:00.000Z",
  url: "worshipsync-local-asset://downloaded-video",
};

const media: MediaType = {
  path: "",
  createdAt: asset.createdAt,
  updatedAt: asset.createdAt,
  format: "mp4",
  height: 1080,
  width: 1920,
  name: "Sunday Service",
  publicId: asset.assetId,
  type: "video",
  id: asset.assetId,
  background: `local-video-file://${asset.assetId}`,
  thumbnail: "",
  duration: 90,
  source: "local",
  localVideoFile: {
    id: asset.assetId,
    contentRevision: asset.createdAt,
    ownerDeviceId: "device-one",
    ownerLabel: "Test desktop",
    fileName: "Sunday Service.mp4",
    contentType: "video/mp4",
    storagePolicy: "local-only",
    audioEnabled: true,
  },
};

const muxResult: MuxUploadResult = {
  playbackId: "playback-one",
  assetId: "mux-asset-one",
  playbackUrl: "https://stream.mux.com/playback-one.m3u8",
  thumbnailUrl: "https://image.mux.com/playback-one/thumbnail.png",
  name: "Sunday Service",
  durationSeconds: 90,
};

const completion = (jobId: string): DesktopVideoDownloadEvent => ({
  jobId,
  stage: "complete",
  progress: 100,
  result: { width: 1920, height: 1080, duration: 90, size: 512 },
});

const makeHarness = (overrides: Partial<DesktopVideoDownloadDependencies> = {}) => {
  const handlers = new Map<string, () => void | Promise<void>>();
  const transfers = new Map<string, Transfer>();
  const native = {
    inspectVideoUrl: jest.fn(async () => inspection),
    startVideoDownload: jest.fn(async ({ jobId }: { jobId: string }) => ({ jobId })),
    cancelVideoDownload: jest.fn(async () => true),
    cleanupVideoDownload: jest.fn(async () => undefined),
    importDownloadedVideo: jest.fn(async () => asset),
    deleteLocalAsset: jest.fn(async () => true),
    onVideoDownloadProgress: jest.fn((_callback: (event: DesktopVideoDownloadEvent) => void) => jest.fn()),
  };
  const transfer = {
    updateTransfer: jest.fn((value: Transfer) => transfers.set(value.id, value)),
    removeTransfer: jest.fn((id: string) => transfers.delete(id)),
    registerTransferAction: jest.fn((id: string, key: string, handler: () => void | Promise<void>) => {
      const actionId = `${id}:${key}`;
      handlers.set(actionId, handler);
      return () => {
        if (handlers.get(actionId) === handler) handlers.delete(actionId);
      };
    }),
  };
  const deps: DesktopVideoDownloadDependencies = {
    native,
    getDatabase: () => ({ name: "church-a" }),
    isOwnerCurrent: () => true,
    createLocalMedia: jest.fn(async () => media),
    registerLocalMedia: jest.fn(async () => undefined),
    registerCloudMedia: jest.fn(async () => undefined),
    removeUnregisteredLocalMedia: jest.fn(async () => undefined),
    uploadToCloud: jest.fn(async () => muxResult),
    buildCloudPatch: jest.fn((_media, result, churchId) => ({
      muxPlaybackId: result.playbackId,
      muxAssetId: result.assetId,
      providerStorage: { provider: "mux", assetId: result.assetId, churchId, permanent: true },
    })),
    viewMedia: jest.fn(),
    notifyCloudStorageChanged: jest.fn(),
    transfer,
    makeJobId: () => "12345678-1234-4123-8123-123456789abc",
    ...overrides,
  };
  const manager = new DesktopVideoDownloadManager(deps);
  const start = (destination: "computer" | "cloud" = "computer") => manager.start({
    inspection,
    inspectedUrl: "https://youtu.be/video123",
    displayName: "Sunday Service",
    quality: 1080,
    destination,
    owner: {
      churchId: "church-a",
      workspaceId: "church-a",
      controllerProfileId: "presentation",
      folderId: "folder-one",
      routePath: "/controller",
    },
  });
  const action = (jobId: string, key: string) => {
    const handler = handlers.get(`video-download-${jobId}:${key}`);
    if (!handler) throw new Error(`Missing ${key} action`);
    return handler();
  };
  return { manager, start, action, deps, handlers, transfers, native };
};

describe("desktop video download lifecycle manager", () => {
  it("keeps the job after its dialog closes and registers one media item on completion", async () => {
    const harness = makeHarness();
    const jobId = harness.start();
    // The inspection dialog can close or unmount here; only the provider-owned manager holds the job.
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.deps.native.importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(harness.deps.createLocalMedia).toHaveBeenCalledTimes(1);
    expect(harness.deps.registerLocalMedia).toHaveBeenCalledTimes(1);
    expect(harness.transfers.get(`video-download-${jobId}`)).toMatchObject({ status: "complete", result: { actionKey: "view" } });
  });

  it("registers Activity actions when a job is created and waits for cancellation cleanup", async () => {
    const harness = makeHarness();
    let resolveCleanup!: () => void;
    let markCleanupInvoked!: () => void;
    const cleanupPending = new Promise<void>((resolve) => { resolveCleanup = resolve; });
    const cleanupInvoked = new Promise<void>((resolve) => { markCleanupInvoked = resolve; });
    harness.native.cleanupVideoDownload.mockImplementation(() => {
      markCleanupInvoked();
      return cleanupPending.then(() => undefined);
    });
    const jobId = harness.start();
    expect(harness.handlers.has(`video-download-${jobId}:cancel`)).toBe(true);
    expect(harness.handlers.has(`video-download-${jobId}:retry`)).toBe(true);
    const cancellation = harness.action(jobId, "cancel");
    await cleanupInvoked;
    expect(harness.native.cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("active");
    resolveCleanup();
    await cancellation;
    expect(harness.native.cancelVideoDownload).toHaveBeenCalledWith(jobId);
    expect(harness.native.cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("cancelled");
    expect(harness.native.importDownloadedVideo).not.toHaveBeenCalled();
  });

  it("retries a failed download with the same job ID", async () => {
    const harness = makeHarness();
    const jobId = harness.start();
    await harness.manager.handleProgress({ jobId, stage: "failed", progress: null, error: "Network failed." });
    await harness.action(jobId, "retry");
    expect(harness.native.startVideoDownload).toHaveBeenCalledTimes(2);
    expect(harness.native.startVideoDownload).toHaveBeenLastCalledWith({ jobId, inspectionId: inspection.inspectionId, quality: 1080 });
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("active");
  });

  it("retries a failed library registration without downloading or importing again", async () => {
    const registerLocalMedia = jest.fn().mockRejectedValueOnce(new Error("Pouch write failed.")).mockResolvedValue(undefined);
    const harness = makeHarness({ registerLocalMedia });
    const jobId = harness.start();
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("failed");
    await harness.action(jobId, "retry");
    expect(harness.native.startVideoDownload).toHaveBeenCalledTimes(1);
    expect(harness.native.importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(harness.deps.createLocalMedia).toHaveBeenCalledTimes(1);
    expect(registerLocalMedia).toHaveBeenCalledTimes(2);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
  });

  it("reconciles an uncertain local registration before cancelling and preserves the committed asset", async () => {
    let rejectRegistration!: (error: Error) => void;
    let markRegistrationStarted!: () => void;
    const registrationStarted = new Promise<void>((resolve) => { markRegistrationStarted = resolve; });
    const registerLocalMedia = jest.fn(() => {
      markRegistrationStarted();
      return new Promise<void>((_resolve, reject) => { rejectRegistration = reject; });
    });
    const reconcileAsset = jest.fn(async () => media);
    const harness = makeHarness({ registerLocalMedia, removeUnregisteredLocalMedia: reconcileAsset });
    const jobId = harness.start();
    const pipeline = harness.manager.handleProgress(completion(jobId));
    await registrationStarted;

    const cancellation = harness.action(jobId, "cancel");
    rejectRegistration(new Error("Pouch write acknowledgement was lost."));
    await Promise.all([pipeline, cancellation]);

    expect(reconcileAsset).toHaveBeenCalledWith(expect.objectContaining({ id: media.id }), asset.assetId, expect.objectContaining({ churchId: "church-a" }));
    expect(harness.transfers.get(`video-download-${jobId}`)).toMatchObject({ status: "cancelled", detail: expect.stringContaining("Local video remains") });
    expect(harness.native.cleanupVideoDownload).toHaveBeenCalledWith(jobId);
  });

  it("reconciles a failed registration before dismissing and does not discard its persisted media reference", async () => {
    const registerLocalMedia = jest.fn().mockRejectedValue(new Error("Confirmation failed after write."));
    const reconcileAsset = jest.fn(async () => media);
    const harness = makeHarness({ registerLocalMedia, removeUnregisteredLocalMedia: reconcileAsset });
    const jobId = harness.start();
    await harness.manager.handleProgress(completion(jobId));
    await harness.action(jobId, "dismiss");

    expect(reconcileAsset).toHaveBeenCalledWith(expect.objectContaining({ id: media.id }), asset.assetId, expect.objectContaining({ churchId: "church-a" }));
    expect(harness.native.cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(harness.transfers.has(`video-download-${jobId}`)).toBe(false);
  });

  it("ignores duplicate completion events while one import operation is still settling", async () => {
    let resolveCreatedMedia!: (value: MediaType) => void;
    let markCreateStarted!: () => void;
    const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
    const pendingMedia = new Promise<MediaType>((resolve) => { resolveCreatedMedia = resolve; });
    const createLocalMedia = jest.fn(() => {
      markCreateStarted();
      return pendingMedia;
    });
    const harness = makeHarness({ createLocalMedia });
    const jobId = harness.start();
    const firstCompletion = harness.manager.handleProgress(completion(jobId));
    await createStarted;
    await harness.manager.handleProgress(completion(jobId));
    resolveCreatedMedia(media);
    await firstCompletion;
    expect(createLocalMedia).toHaveBeenCalledTimes(1);
    expect(harness.native.importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(harness.deps.registerLocalMedia).toHaveBeenCalledTimes(1);
  });

  it("keeps successful local import and Media registration when cloud upload fails, then retries only cloud", async () => {
    const uploadToCloud = jest.fn().mockRejectedValueOnce(new Error("Mux is unavailable.")).mockResolvedValue(muxResult);
    const harness = makeHarness({ uploadToCloud });
    const jobId = harness.start("cloud");
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("failed");
    await harness.action(jobId, "retry");
    expect(harness.native.startVideoDownload).toHaveBeenCalledTimes(1);
    expect(harness.native.importDownloadedVideo).toHaveBeenCalledTimes(1);
    expect(harness.deps.createLocalMedia).toHaveBeenCalledTimes(1);
    expect(harness.deps.registerLocalMedia).toHaveBeenCalledTimes(1);
    expect(uploadToCloud).toHaveBeenCalledTimes(2);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
  });

  it("adopts a successful Mux result on retry when cloud media registration fails", async () => {
    const registerCloudMedia = jest.fn().mockRejectedValueOnce(new Error("Cloud media record write failed.")).mockResolvedValue(undefined);
    const uploadToCloud = jest.fn(async () => muxResult);
    const harness = makeHarness({ registerCloudMedia, uploadToCloud });
    const jobId = harness.start("cloud");
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("failed");
    await harness.action(jobId, "retry");
    expect(uploadToCloud).toHaveBeenCalledTimes(1);
    expect(registerCloudMedia).toHaveBeenCalledTimes(2);
    expect(harness.deps.notifyCloudStorageChanged).toHaveBeenCalledTimes(1);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
  });

  it("does not cancel or delete a successful Mux asset while its Media Library reference is saving", async () => {
    let resolveRegistration!: () => void;
    let markRegistrationStarted!: () => void;
    const registrationStarted = new Promise<void>((resolve) => { markRegistrationStarted = resolve; });
    const registerCloudMedia = jest.fn(() => {
      markRegistrationStarted();
      return new Promise<void>((resolve) => { resolveRegistration = resolve; });
    });
    const cancelMuxUpload = jest.fn(async () => undefined);
    const uploadToCloud = jest.fn(async (_jobId, _fileName, _options, callbacks) => {
      callbacks.setCancelUpload?.(cancelMuxUpload);
      return muxResult;
    });
    const harness = makeHarness({ registerCloudMedia, uploadToCloud });
    const jobId = harness.start("cloud");
    const pipeline = harness.manager.handleProgress(completion(jobId));
    await registrationStarted;

    const cancellation = harness.action(jobId, "cancel");
    expect(cancelMuxUpload).not.toHaveBeenCalled();
    resolveRegistration();
    await Promise.all([pipeline, cancellation]);

    expect(cancelMuxUpload).not.toHaveBeenCalled();
    expect(registerCloudMedia).toHaveBeenCalledTimes(1);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
  });

  it("keeps a successful Mux result retryable if cloud registration fails after cancellation", async () => {
    let rejectRegistration!: (error: Error) => void;
    let markRegistrationStarted!: () => void;
    const registrationStarted = new Promise<void>((resolve) => { markRegistrationStarted = resolve; });
    const registerCloudMedia = jest.fn()
      .mockImplementationOnce(() => {
        markRegistrationStarted();
        return new Promise<void>((_resolve, reject) => { rejectRegistration = reject; });
      })
      .mockResolvedValue(undefined);
    const cancelMuxUpload = jest.fn(async () => undefined);
    const uploadToCloud = jest.fn(async (_jobId, _fileName, _options, callbacks) => {
      callbacks.setCancelUpload?.(cancelMuxUpload);
      return muxResult;
    });
    const harness = makeHarness({ registerCloudMedia, uploadToCloud });
    const jobId = harness.start("cloud");
    const pipeline = harness.manager.handleProgress(completion(jobId));
    await registrationStarted;
    const cancellation = harness.action(jobId, "cancel");
    rejectRegistration(new Error("Cloud record acknowledgement was lost."));
    await Promise.all([pipeline, cancellation]);

    expect(cancelMuxUpload).not.toHaveBeenCalled();
    expect(harness.transfers.get(`video-download-${jobId}`)).toMatchObject({
      status: "failed",
      actions: expect.arrayContaining([expect.objectContaining({ key: "retry" })]),
    });
    await harness.action(jobId, "retry");
    expect(uploadToCloud).toHaveBeenCalledTimes(1);
    expect(registerCloudMedia).toHaveBeenCalledTimes(2);
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
  });

  it("never registers a late completion into the church selected after the job started", async () => {
    let currentChurch = "church-a";
    const isOwnerCurrent = jest.fn((owner: DesktopVideoDownloadOwner) => currentChurch === owner.churchId);
    const harness = makeHarness({ isOwnerCurrent });
    const jobId = harness.start();
    currentChurch = "church-b";
    harness.manager.handleChurchChange(currentChurch);
    await harness.action(jobId, "cancel");
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.deps.registerLocalMedia).not.toHaveBeenCalled();
    expect(harness.deps.registerCloudMedia).not.toHaveBeenCalled();
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("failed");
  });

  it("uses a registered View action and preserves the exact imported Media identity", async () => {
    const harness = makeHarness();
    const jobId = harness.start();
    await harness.manager.handleProgress(completion(jobId));
    await harness.action(jobId, "view");
    expect(harness.deps.viewMedia).toHaveBeenCalledWith(expect.objectContaining({ id: media.id }), expect.objectContaining({ controllerProfileId: "presentation", folderId: "folder-one", routePath: "/controller" }));
  });

  it("keeps cleanup retry available after the media item is safely registered", async () => {
    const harness = makeHarness();
    const cleanupVideoDownload = harness.native.cleanupVideoDownload;
    cleanupVideoDownload.mockRejectedValueOnce(new Error("File is in use.")).mockResolvedValue(undefined);
    const jobId = harness.start();
    await harness.manager.handleProgress(completion(jobId));
    expect(harness.transfers.get(`video-download-${jobId}`)).toMatchObject({
      status: "complete",
      actions: expect.arrayContaining([expect.objectContaining({ key: "retry-cleanup" })]),
    });
    await harness.action(jobId, "retry-cleanup");
    expect(harness.transfers.get(`video-download-${jobId}`)?.status).toBe("complete");
    expect(cleanupVideoDownload).toHaveBeenCalledTimes(2);
    expect(harness.deps.registerLocalMedia).toHaveBeenCalledTimes(1);
  });

  it("cleans an unregistered permanent asset before dismissing an import failure", async () => {
    const registerLocalMedia = jest.fn().mockRejectedValue(new Error("Media is not initialized."));
    const harness = makeHarness({ registerLocalMedia });
    const jobId = harness.start();
    await harness.manager.handleProgress(completion(jobId));
    await harness.action(jobId, "dismiss");
    expect(harness.deps.removeUnregisteredLocalMedia).toHaveBeenCalledWith(expect.objectContaining({ id: media.id, folderId: "folder-one" }), asset.assetId, expect.objectContaining({ churchId: "church-a" }));
    expect(harness.native.cleanupVideoDownload).toHaveBeenCalledWith(jobId);
    expect(harness.transfers.has(`video-download-${jobId}`)).toBe(false);
    expect(harness.handlers.has(`video-download-${jobId}:retry`)).toBe(false);
  });
});
