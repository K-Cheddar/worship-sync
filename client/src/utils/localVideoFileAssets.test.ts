import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import { encodeLocalAssetThumbnailBlob, openLocalAssetDb } from "./localImageAssets";
import {
  createLocalVideoFileThumbnail,
  deleteLocalVideoFile,
  getLocalVideoFile,
  getOrCreateLocalVideoFileThumbnail,
  getVideoThumbnailSeekTimes,
  saveLocalVideoFile,
  subscribeLocalVideoFileChanges,
} from "./localVideoFileAssets";
import {
  getLocalImageThumbnail,
  saveLocalImageThumbnail,
  saveLocalVideoThumbnail,
} from "./localImageAssets";

jest.mock("./localImageAssets", () => ({
  ...jest.requireActual("./localImageAssets"),
  encodeLocalAssetThumbnailBlob: jest.fn(),
}));

const mockedEncodeThumbnail = jest.mocked(encodeLocalAssetThumbnailBlob);

const deleteAssetDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("worshipsync-local-assets");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Database deletion was blocked."));
  });

const storedVideo = (id: string) => ({
  id,
  workspaceId: "church-1",
  blob: new Blob(["video"], { type: "video/mp4" }),
  fileName: `${id}.mp4`,
  contentType: "video/mp4",
  size: 5,
  width: 1920,
  height: 1080,
  duration: 12,
  createdAt: "2026-08-17T00:00:00.000Z",
});

const storedThumbnail = (id: string) => ({
  id,
  blob: new Blob(["thumb"], { type: "image/webp" }),
  width: 160,
  height: 90,
  createdAt: "2026-08-17T00:00:00.000Z",
});

type VideoCaptureMockOptions = {
  duration?: number;
  neverLoad?: boolean;
  neverSeek?: boolean;
  errorOnSource?: boolean;
  colorAtTime?: (time: number) => [number, number, number];
};

let restoreVideoCaptureMocks: (() => void) | undefined;
let frameTimesPassedToEncoder: number[] = [];

const installVideoCaptureMocks = (options: VideoCaptureMockOptions = {}) => {
  const currentTimes = new WeakMap<HTMLMediaElement, number>();
  const frameTimesByCanvas = new WeakMap<HTMLCanvasElement, number>();
  const mediaSourceAssignmentOrder: string[] = [];
  const propertyDescriptors: Array<
    [object, PropertyKey, PropertyDescriptor | undefined]
  > = [];
  const setProperty = (
    target: object,
    key: PropertyKey,
    descriptor: PropertyDescriptor,
  ) => {
    propertyDescriptors.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
  };
  const originalSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "src",
  );
  const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: jest.fn(() => "blob:local-video-test"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
  setProperty(HTMLMediaElement.prototype, "readyState", {
    get: () => (options.neverLoad ? 0 : HTMLMediaElement.HAVE_CURRENT_DATA),
  });
  setProperty(HTMLMediaElement.prototype, "crossOrigin", {
    get: () => "",
    set: (value: string) => mediaSourceAssignmentOrder.push(`crossOrigin:${value}`),
  });
  setProperty(HTMLVideoElement.prototype, "videoWidth", { get: () => 1920 });
  setProperty(HTMLVideoElement.prototype, "videoHeight", { get: () => 1080 });
  setProperty(HTMLVideoElement.prototype, "duration", {
    get: () => options.duration ?? 12,
  });
  setProperty(HTMLMediaElement.prototype, "currentTime", {
    get(this: HTMLMediaElement) {
      return currentTimes.get(this) ?? 0;
    },
    set(this: HTMLMediaElement, value: number) {
      currentTimes.set(this, value);
      if (!options.neverSeek) this.dispatchEvent(new Event("seeked"));
    },
  });
  setProperty(HTMLMediaElement.prototype, "error", {
    get: () => options.errorOnSource
      ? { code: 4, message: "No supported local decoder." }
      : null,
  });
  setProperty(HTMLMediaElement.prototype, "src", {
    get(this: HTMLMediaElement) {
      return originalSrcDescriptor?.get?.call(this) ?? this.getAttribute("src") ?? "";
    },
    set(this: HTMLMediaElement, value: string) {
      mediaSourceAssignmentOrder.push("src");
      if (originalSrcDescriptor?.set) originalSrcDescriptor.set.call(this, value);
      else this.setAttribute("src", value);
      if (options.errorOnSource) this.dispatchEvent(new Event("error"));
    },
  });
  const canPlayType = jest
    .spyOn(HTMLMediaElement.prototype, "canPlayType")
    .mockReturnValue("");
  const load = jest
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => undefined);
  const getContext = jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement) {
      const context = {
        drawImage: (source: CanvasImageSource) => {
          const element = source as HTMLVideoElement | HTMLCanvasElement;
          const time =
            element.tagName === "VIDEO"
              ? (element as HTMLVideoElement).currentTime
              : element.tagName === "CANVAS"
                ? frameTimesByCanvas.get(element as HTMLCanvasElement) ?? 0
                : 0;
          frameTimesByCanvas.set(this, time);
          Object.defineProperty(this, "frameTime", {
            configurable: true,
            value: time,
          });
        },
        getImageData: () => {
          const time = frameTimesByCanvas.get(this) ?? 0;
          const [red, green, blue] = options.colorAtTime?.(time) ?? [100, 140, 180];
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          for (let index = 0; index < data.length; index += 4) {
            data[index] = red;
            data[index + 1] = green;
            data[index + 2] = blue;
            data[index + 3] = 255;
          }
          return { data } as ImageData;
        },
      };
      return context as unknown as CanvasRenderingContext2D;
    } as never);
  restoreVideoCaptureMocks = () => {
    canPlayType.mockRestore();
    load.mockRestore();
    getContext.mockRestore();
    for (const [target, key, descriptor] of propertyDescriptors.reverse()) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectUrlDescriptor) {
      Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrlDescriptor);
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    restoreVideoCaptureMocks = undefined;
  };
  frameTimesPassedToEncoder = [];
  return { canPlayType, load, mediaSourceAssignmentOrder };
};

describe("localVideoFileAssets thumbnails", () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  beforeEach(async () => {
    restoreVideoCaptureMocks?.();
    delete window.electronAPI;
    mockedEncodeThumbnail.mockReset();
    mockedEncodeThumbnail.mockResolvedValue({
      blob: new Blob(["encoded thumbnail"], { type: "image/webp" }),
      width: 160,
      height: 90,
    });
    mockedEncodeThumbnail.mockImplementation(async (source) => {
      frameTimesPassedToEncoder.push(
        (source as HTMLCanvasElement & { frameTime?: number }).frameTime ?? 0,
      );
      return {
        blob: new Blob(["encoded thumbnail"], { type: "image/webp" }),
        width: 160,
        height: 90,
      };
    });
    await deleteAssetDatabase();
  });

  afterEach(() => {
    restoreVideoCaptureMocks?.();
    jest.useRealTimers();
    if (originalCreateImageBitmap) {
      globalThis.createImageBitmap = originalCreateImageBitmap;
    } else {
      Object.defineProperty(globalThis, "createImageBitmap", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    }
  });

  afterAll(() => deleteAssetDatabase());

  it("keeps a saved still beside the local video", async () => {
    await saveLocalVideoFile(storedVideo("local_video_1"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_1"));

    await expect(getLocalVideoFile("local_video_1")).resolves.toEqual(
      expect.objectContaining({ id: "local_video_1" }),
    );
    await expect(getLocalImageThumbnail("local_video_1")).resolves.toEqual(
      expect.objectContaining({
        id: "local_video_1",
        width: 160,
        height: 90,
      }),
    );
  });

  it("preserves and reuses an unprovenanced thumbnail without guessing its origin", async () => {
    installVideoCaptureMocks();
    const video = storedVideo("local_video_legacy_thumbnail");
    const legacyThumbnail = storedThumbnail(video.id);
    await saveLocalVideoFile(video);
    await saveLocalImageThumbnail(legacyThumbnail);

    await expect(getOrCreateLocalVideoFileThumbnail(video.id)).resolves.toEqual(
      legacyThumbnail,
    );

    expect(mockedEncodeThumbnail).not.toHaveBeenCalled();
  });

  it("prefers a valid source thumbnail over a black opening frame and keys it by the video asset id", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    globalThis.createImageBitmap = jest.fn(async () => bitmap) as typeof createImageBitmap;
    const createElement = jest.spyOn(document, "createElement");
    const sourceThumbnail = new Blob(["source image"], { type: "image/jpeg" });

    await saveLocalVideoFile(storedVideo("local_video_download_source"), {
      thumbnailBlob: sourceThumbnail,
    });
    const saved = await getOrCreateLocalVideoFileThumbnail(
      "local_video_download_source",
    );

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(sourceThumbnail);
    expect(mockedEncodeThumbnail).toHaveBeenCalledWith(bitmap, 1280, 720);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "video")).toHaveLength(0);
    expect(saved).toMatchObject({
      id: "local_video_download_source",
      width: 160,
      height: 90,
      videoThumbnail: { source: "supplied" },
    });
    await expect(getLocalImageThumbnail("local_video_download_source")).resolves.toEqual(saved);
    createElement.mockRestore();
  });

  it("finishes saving a downloaded video while its thumbnail is still being prepared", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    let resolveBitmap: ((value: ImageBitmap) => void) | undefined;
    let markBitmapRequested: (() => void) | undefined;
    const bitmapRequested = new Promise<void>((resolve) => {
      markBitmapRequested = resolve;
    });
    globalThis.createImageBitmap = jest.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
      markBitmapRequested?.();
    })) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_nonblocking_thumb");

    await saveLocalVideoFile(video, {
      thumbnailBlob: new Blob(["source image"], { type: "image/jpeg" }),
      deferThumbnail: true,
    });
    await expect(getLocalVideoFile(video.id)).resolves.toMatchObject({ id: video.id });
    expect(mockedEncodeThumbnail).not.toHaveBeenCalled();

    const thumbnailPromise = getOrCreateLocalVideoFileThumbnail(video.id);
    await bitmapRequested;
    expect(mockedEncodeThumbnail).not.toHaveBeenCalled();
    resolveBitmap?.(bitmap);
    await expect(thumbnailPromise).resolves.toMatchObject({ id: video.id, width: 160 });
    expect(mockedEncodeThumbnail).toHaveBeenCalledWith(bitmap, 1280, 720);
  });

  it("does not recreate a thumbnail when the video is deleted during generation", async () => {
    const bitmap = { width: 1280, height: 720, close: jest.fn() } as unknown as ImageBitmap;
    let resolveBitmap: ((value: ImageBitmap) => void) | undefined;
    let markBitmapRequested: (() => void) | undefined;
    const bitmapRequested = new Promise<void>((resolve) => {
      markBitmapRequested = resolve;
    });
    globalThis.createImageBitmap = jest.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
      markBitmapRequested?.();
    })) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_deleted_during_thumb");
    const sourceThumbnail = new Blob(["source image"], { type: "image/jpeg" });

    await saveLocalVideoFile(video, { thumbnailBlob: sourceThumbnail, deferThumbnail: true });
    const thumbnailPromise = getOrCreateLocalVideoFileThumbnail(video.id);
    await bitmapRequested;
    await deleteLocalVideoFile(video.id);
    resolveBitmap?.(bitmap);

    await expect(thumbnailPromise).resolves.toBeUndefined();
    await expect(getLocalVideoFile(video.id)).resolves.toBeUndefined();
    await expect(getLocalImageThumbnail(video.id)).resolves.toBeUndefined();
  });

  it("uses the existing video frame fallback when no source thumbnail is available", async () => {
    installVideoCaptureMocks();
    const createElement = jest.spyOn(document, "createElement");
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:local-video");
    URL.revokeObjectURL = jest.fn();
    try {
      const video = storedVideo("local_video_download_fallback");
      await saveLocalVideoFile(video);
      await expect(getLocalVideoFile(video.id)).resolves.toMatchObject({ id: video.id });
      const thumbnail = await getOrCreateLocalVideoFileThumbnail(video.id);

      expect(thumbnail).toMatchObject({
        id: video.id,
        videoThumbnail: {
          source: "generated",
          generatorVersion: 2,
        },
      });
      expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "video")).toHaveLength(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-video");
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      createElement.mockRestore();
    }
  });

  it.each([
    ["MOV with QuickTime MIME", "video/quicktime", "welcome.mov"],
    ["standard MP4", "video/mp4", "welcome.mp4"],
  ])("extracts a thumbnail for %s even when canPlayType is empty", async (_label, contentType, fileName) => {
    const mocks = installVideoCaptureMocks();
    const video = {
      ...storedVideo(`local_video_${fileName}`),
      fileName,
      contentType,
      blob: new Blob(["video bytes"], { type: contentType }),
    };

    const thumbnail = await createLocalVideoFileThumbnail(video);

    expect(thumbnail).toMatchObject({
      id: video.id,
      videoThumbnail: { source: "generated", generatorVersion: 2 },
    });
    expect(mocks.canPlayType).not.toHaveBeenCalled();
    expect(mocks.mediaSourceAssignmentOrder.slice(0, 2)).toEqual([
      "crossOrigin:anonymous",
      "src",
    ]);
  });

  it("skips a black introduction and encodes the strongest later frame", async () => {
    installVideoCaptureMocks({
      colorAtTime: (time) =>
        time < 2 ? [0, 0, 0] : time < 4 ? [45, 55, 65] : [180, 190, 200],
    });
    const video = storedVideo("local_video_black_intro");

    const thumbnail = await createLocalVideoFileThumbnail(video);

    expect(getVideoThumbnailSeekTimes(12)).toEqual([1.2, 3, 6]);
    expect(thumbnail).toMatchObject({ id: video.id });
    expect(frameTimesPassedToEncoder).toEqual([6]);
  });

  it("keeps a valid fallback for an intentionally dark video", async () => {
    installVideoCaptureMocks({ colorAtTime: () => [5, 5, 5] });

    const thumbnail = await createLocalVideoFileThumbnail(
      storedVideo("local_video_intentionally_dark"),
    );

    expect(thumbnail).toMatchObject({
      videoThumbnail: { source: "generated", generatorVersion: 2 },
    });
    expect(frameTimesPassedToEncoder).toEqual([0]);
  });

  it("keeps an undecodable local video and cools down repeat extraction", async () => {
    installVideoCaptureMocks({ errorOnSource: true });
    const createElement = jest.spyOn(document, "createElement");
    const video = storedVideo("local_video_unsupported_decoder");
    await saveLocalVideoFile(video);

    await expect(getOrCreateLocalVideoFileThumbnail(video.id)).resolves.toBeUndefined();
    await expect(getOrCreateLocalVideoFileThumbnail(video.id)).resolves.toBeUndefined();

    await expect(getLocalVideoFile(video.id)).resolves.toMatchObject({ id: video.id });
    expect(createElement.mock.calls.filter(([tag]) => String(tag).toLowerCase() === "video")).toHaveLength(1);
    createElement.mockRestore();
  });

  it("refreshes a previously generated thumbnail when its generator version is stale", async () => {
    installVideoCaptureMocks({
      colorAtTime: (time) => (time < 2 ? [0, 0, 0] : [150, 170, 190]),
    });
    const video = storedVideo("local_video_old_generated_black");
    await saveLocalVideoFile(video);
    await saveLocalImageThumbnail({
      ...storedThumbnail(video.id),
      videoThumbnail: {
        source: "generated",
        contentRevision: `${video.createdAt}:${video.size}`,
        generatorVersion: 1,
      },
    });

    const refreshed = await getOrCreateLocalVideoFileThumbnail(video.id);

    expect(refreshed).toMatchObject({
      videoThumbnail: { source: "generated", generatorVersion: 2 },
    });
    expect(frameTimesPassedToEncoder).toEqual([3]);
  });

  it("times out a stalled decode and releases its object URL and media source", async () => {
    const mocks = installVideoCaptureMocks({ neverLoad: true });
    jest.useFakeTimers();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:stalled-video");
    URL.revokeObjectURL = jest.fn();
    const pending = createLocalVideoFileThumbnail(
      storedVideo("local_video_stalled_decode"),
    );
    const result = pending.then(
      () => {
        throw new Error("Expected thumbnail extraction to time out");
      },
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(8_001);
    expect(await result).toMatchObject({
      name: "LocalVideoThumbnailError",
      stage: "metadata-load",
    });

    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:stalled-video");
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    jest.useRealTimers();
  });

  it("deduplicates simultaneous component requests for one asset revision", async () => {
    installVideoCaptureMocks();
    const video = storedVideo("local_video_duplicate_requests");
    await saveLocalVideoFile(video);
    let markEncodingStarted!: () => void;
    const encodingStarted = new Promise<void>((resolve) => {
      markEncodingStarted = resolve;
    });
    let finishEncoding!: (value: {
      blob: Blob;
      width: number;
      height: number;
    }) => void;
    mockedEncodeThumbnail.mockImplementation(async () => {
        markEncodingStarted();
        return new Promise((resolve) => {
          finishEncoding = resolve;
        });
      });

    const first = getOrCreateLocalVideoFileThumbnail(video.id);
    const second = getOrCreateLocalVideoFileThumbnail(video.id);
    await encodingStarted;
    expect(mockedEncodeThumbnail).toHaveBeenCalledTimes(1);
    finishEncoding({
      blob: new Blob(["encoded"], { type: "image/webp" }),
      width: 160,
      height: 90,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: video.id }),
      expect.objectContaining({ id: video.id }),
    ]);
  });

  it("falls back to a video frame when a supplied download poster cannot be decoded", async () => {
    installVideoCaptureMocks();
    globalThis.createImageBitmap = jest.fn().mockRejectedValue(new Error("unsupported source image")) as typeof createImageBitmap;
    await saveLocalVideoFile(storedVideo("local_video_download_bad_thumb"), {
      thumbnailBlob: new Blob(["bad image"], { type: "image/png" }),
    });
    const thumbnail = await getOrCreateLocalVideoFileThumbnail("local_video_download_bad_thumb");

    await expect(getLocalVideoFile("local_video_download_bad_thumb")).resolves.toMatchObject({
      id: "local_video_download_bad_thumb",
    });
    expect(thumbnail).toMatchObject({
      videoThumbnail: { source: "generated", generatorVersion: 2 },
    });
  });

  it("retries source thumbnail persistence under one stable asset key", async () => {
    const bitmap = { width: 640, height: 360, close: jest.fn() } as unknown as ImageBitmap;
    globalThis.createImageBitmap = jest.fn(async () => bitmap) as typeof createImageBitmap;
    const video = storedVideo("local_video_download_retry");
    const thumbnailBlob = new Blob(["source image"], { type: "image/webp" });

    await saveLocalVideoFile(video, { thumbnailBlob });
    await saveLocalVideoFile(video, { thumbnailBlob });
    await getOrCreateLocalVideoFileThumbnail(video.id);

    const db = await openLocalAssetDb();
    try {
      const count = await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction("imageThumbnails", "readonly");
        const request = transaction.objectStore("imageThumbnails").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("uses byte IPC for a downloaded conversion in Electron", async () => {
    const importLocalAssetBytes = jest.fn().mockResolvedValue({
      assetId: "local_video_converted",
      contentType: "video/mp4",
      url: "worshipsync-media://asset/local_video_converted",
    });
    window.electronAPI = {
      importLocalAssetBytes,
    } as unknown as NonNullable<typeof window.electronAPI>;

    const file = new File(["video"], "local_video_converted.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new ArrayBuffer(5),
    });

    await saveLocalVideoFile(
      {
        ...storedVideo("local_video_converted"),
        blob: file,
      },
      { importBytes: true },
    );

    expect(importLocalAssetBytes).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.objectContaining({
        assetId: "local_video_converted",
        contentType: "video/mp4",
      }),
    );
    await expect(
      getLocalVideoFile("local_video_converted"),
    ).resolves.toEqual(expect.objectContaining({ blob: undefined }));
  });

  it("reuses a stored still instead of decoding the original again", async () => {
    await saveLocalVideoFile(storedVideo("local_video_cached"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_cached"));
    const createElement = jest.spyOn(document, "createElement");

    await expect(
      getOrCreateLocalVideoFileThumbnail("local_video_cached"),
    ).resolves.toEqual(
      expect.objectContaining({ id: "local_video_cached", width: 160 }),
    );
    expect(
      createElement.mock.calls.filter(
        ([tagName]) => String(tagName).toLowerCase() === "video",
      ),
    ).toHaveLength(0);
    createElement.mockRestore();
  });

  it("removes the still when the local video is deleted", async () => {
    await saveLocalVideoFile(storedVideo("local_video_deleted"));
    await saveLocalImageThumbnail(storedThumbnail("local_video_deleted"));
    await deleteLocalVideoFile("local_video_deleted");

    await expect(
      getLocalVideoFile("local_video_deleted"),
    ).resolves.toBeUndefined();
    await expect(
      getLocalImageThumbnail("local_video_deleted"),
    ).resolves.toBeUndefined();
  });

  it("rejects an older thumbnail after the same playback ID adopts replacement content", async () => {
    const video = { ...storedVideo("stable-video"), contentHash: "a".repeat(64) };
    await saveLocalVideoFile(video);
    const oldThumbnail = {
      ...storedThumbnail(video.id),
      videoThumbnail: {
        source: "generated" as const,
        contentRevision: "a".repeat(64),
        generatorVersion: 2,
      },
    };
    await saveLocalImageThumbnail(oldThumbnail);
    await saveLocalVideoFile({ ...video, contentHash: "b".repeat(64) });
    await expect(saveLocalVideoThumbnail(storedThumbnail(video.id), video.contentHash)).resolves.toBe(false);
    await expect(getLocalImageThumbnail(video.id)).resolves.toBeUndefined();
    await expect(saveLocalVideoThumbnail(storedThumbnail(video.id), "b".repeat(64))).resolves.toBe(true);
  });

  it("fans native committed changes out through the existing renderer event", () => {
    let notify!: (id: string) => void;
    const subscribe = jest.fn((listener: (id: string) => void) => { notify = listener; return jest.fn(); });
    window.electronAPI = { onLocalVideoAssetChanged: subscribe } as unknown as typeof window.electronAPI;
    const first = jest.fn(); const second = jest.fn();
    const stopFirst = subscribeLocalVideoFileChanges(first);
    const stopSecond = subscribeLocalVideoFileChanges(second);
    notify("stable");
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith("stable"); expect(second).toHaveBeenCalledWith("stable");
    stopFirst(); stopSecond();
  });
});
