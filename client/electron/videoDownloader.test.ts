import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { parseYtDlpProgressLine, VideoDownloader, type VideoDownloadEvent } from "./videoDownloader";
import { logVideoFailure } from "./videoDownloaderErrors";
import type { SafeHttpLookupAll } from "./safeHttp";

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough };

class FakeMuxRequest extends Writable {
  readonly chunks: Buffer[] = [];
  timeoutCallback?: () => void;
  resetOnDestroyWithoutError = false;
  readonly setTimeout = jest.fn((_milliseconds: number, callback: () => void) => {
    this.timeoutCallback = callback;
    return this;
  });

  constructor(private readonly responseStatus: number, private readonly autoRespond: boolean) {
    super({ autoDestroy: false });
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  _final(callback: (error?: Error | null) => void) {
    callback();
    if (this.autoRespond) setTimeout(() => this.respond(), 0);
  }

  override destroy(error?: Error | null) {
    if (!error && this.resetOnDestroyWithoutError && !this.destroyed) {
      this.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    }
    return super.destroy(error);
  }

  respond() {
    const response = new PassThrough() as PassThrough & { statusCode: number };
    response.statusCode = this.responseStatus;
    this.emit("response", response);
    response.end();
    this.destroy();
  }

  expire() {
    this.timeoutCallback?.();
  }
}

const fakeChild = (): FakeChild => {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = jest.fn(() => {
    setTimeout(() => child.emit("close", null, "SIGKILL"), 0);
    return true;
  });
  return child;
};

const finishChild = (child: FakeChild, stdout: string | Buffer, code = 0, stderr: string | Buffer = "") => {
  child.stdout.end(stdout);
  child.stderr.end(stderr);
  setTimeout(() => child.emit("close", code, null), 0);
};

const finishChildWithChunks = (
  child: FakeChild,
  stdoutChunks: string[],
  stderrChunks: string[],
  code = 0,
) => {
  stdoutChunks.forEach((chunk) => child.stdout.write(chunk));
  stderrChunks.forEach((chunk) => child.stderr.write(chunk));
  child.stdout.end();
  child.stderr.end();
  setTimeout(() => child.emit("close", code, null), 0);
};

type TestInspectionPolicy = {
  command: "yt-dlp";
  stdoutLimitBytes: number;
  stderrLimitBytes: number;
  stdoutOverflowCategory: "inspection-output-limit";
};

const runInspectionCommand = (
  downloader: VideoDownloader,
  binary: string,
  timeoutMs: number,
  policy: TestInspectionPolicy,
) => (downloader as unknown as {
  runCommand: (binary: string, args: string[], timeoutMs: number, policy: TestInspectionPolicy) => Promise<string>;
}).runCommand(binary, ["--print", "%(.{title,duration})j"], timeoutMs, policy);

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the fake video tool.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("VideoDownloader job lifecycle", () => {
  let root: string;
  let downloader: VideoDownloader;
  let downloadCount: number;
  let currentDownload: FakeChild | undefined;
  let currentInspection: FakeChild | undefined;
  let stallDownload = false;
  let stallInspection = false;
  let ignoreInspectionTermination = false;
  let failNextDownload = false;
  let inspectionStdout: string | Buffer | undefined;
  let inspectionStderr: string | Buffer;
  let inspectionExitCode = 0;
  let inspectionProcessError: Error | undefined;
  let processOptions: Array<{ shell?: boolean }>;
  let processArguments: string[][];
  let uploadLookup: SafeHttpLookupAll;
  let downloadStdout: string | undefined;
  let downloadOutputChunks: { stdout: string[]; stderr: string[] } | undefined;
  let muxResponseStatus: number;
  let muxAutoRespond: boolean;
  let muxResetOnDestroyWithoutError: boolean;
  let muxRequests: FakeMuxRequest[];
  let muxRequestUrls: string[];
  let muxRequestOptions: Array<{ headers?: Record<string, string>; lookup?: (...args: any[]) => void }>;
  let beforeMuxRequest: (() => void) | undefined;
  let muxRequestFailure: Error | undefined;
  let nativeTools: { ytDlpPath: string; denoPath: string; ffmpegPath: string; ffprobePath: string };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "worshipsync-downloader-test-"));
    const toolsDirectory = join(root, "tools");
    mkdirSync(toolsDirectory, { recursive: true });
    nativeTools = {
      ytDlpPath: join(toolsDirectory, "yt-dlp.exe"),
      denoPath: join(toolsDirectory, "deno.exe"),
      ffmpegPath: join(toolsDirectory, "ffmpeg.exe"),
      ffprobePath: join(toolsDirectory, "ffprobe.exe"),
    };
    Object.values(nativeTools).forEach((path) => writeFileSync(path, "test tool"));
    downloadCount = 0;
    currentDownload = undefined;
    currentInspection = undefined;
    stallDownload = false;
    stallInspection = false;
    ignoreInspectionTermination = false;
    failNextDownload = false;
    inspectionStdout = undefined;
    inspectionStderr = "";
    inspectionExitCode = 0;
    inspectionProcessError = undefined;
    processOptions = [];
    processArguments = [];
    downloadStdout = undefined;
    downloadOutputChunks = undefined;
    muxResponseStatus = 200;
    muxAutoRespond = true;
    muxResetOnDestroyWithoutError = false;
    muxRequests = [];
    muxRequestUrls = [];
    muxRequestOptions = [];
    beforeMuxRequest = undefined;
    muxRequestFailure = undefined;
    uploadLookup = async () => [{ address: "8.8.8.8", family: 4 }];
    const spawnProcess = ((binary: string, args: string[], options: { shell?: boolean }) => {
      processOptions.push(options);
      processArguments.push(args);
      const child = fakeChild();
      if (binary.endsWith("ffprobe.exe")) {
        const audio = args.includes("a:0");
        finishChild(child, audio ? "aac\n" : JSON.stringify({
          streams: [{ codec_name: "h264", width: 1920, height: 1080 }],
          format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "30" },
        }));
      } else if (args.includes("%(.{title,duration})j")) {
        currentInspection = child;
        const outputPath = args[args.indexOf("--output") + 1];
        if (args.includes("--output")) writeFileSync(`${outputPath}.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        if (ignoreInspectionTermination) child.kill = jest.fn(() => true);
        const compactProjection = [
          JSON.stringify({ title: "Test Sermon", duration: 30 }),
          JSON.stringify([
            { ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080 },
            { ext: "m4a", vcodec: "none", acodec: "mp4a.40.2" },
            { ext: "mp4", vcodec: "avc1.4d401f", acodec: "mp4a.40.2", height: 720 },
            { ext: "mp4", vcodec: "vp9", acodec: "mp4a.40.2", height: 1440 },
          ]),
        ].join("\n");
        if (inspectionProcessError) {
          setTimeout(() => child.emit("error", inspectionProcessError), 0);
        } else if (!stallInspection) {
          finishChild(child, inspectionStdout ?? compactProjection, inspectionExitCode, inspectionStderr);
        }
      } else {
        currentDownload = child;
        downloadCount += 1;
        if (!stallDownload && !failNextDownload) {
          const outputIndex = args.indexOf("--output") + 1;
          const file = args[outputIndex].replace("%(ext)s", "mp4");
          mkdirSync(join(root, "downloads"), { recursive: true });
          writeFileSync(file, "fake-mp4");
          if (downloadOutputChunks) {
            finishChildWithChunks(child, downloadOutputChunks.stdout, downloadOutputChunks.stderr);
          } else {
            finishChild(child, downloadStdout ?? `WSYNC_PROGRESS:100:200:200\nWSYNC_FILE:${file}\nWSYNC_PROCESSING:started\n`);
          }
        } else if (!stallDownload) {
          failNextDownload = false;
          finishChild(child, "network error", 1, "network failure");
        }
      }
      return child;
    }) as unknown as typeof import("node:child_process").spawn;
    downloader = new VideoDownloader({
      rootDirectory: join(root, "downloads"),
      ...nativeTools,
      spawnProcess,
      requestMux: ((url: string, options: { headers?: Record<string, string>; lookup?: (...args: any[]) => void }) => {
        const request = new FakeMuxRequest(muxResponseStatus, muxAutoRespond);
        request.resetOnDestroyWithoutError = muxResetOnDestroyWithoutError;
        if (muxRequestFailure) {
          const failure = muxRequestFailure;
          muxRequestFailure = undefined;
          process.nextTick(() => request.destroy(failure));
        }
        beforeMuxRequest?.();
        beforeMuxRequest = undefined;
        muxRequestUrls.push(url);
        muxRequestOptions.push(options);
        muxRequests.push(request);
        return request;
      }) as unknown as typeof import("node:https").request,
      lookupAll: (...args) => uploadLookup(...args),
      proxyFactory: () => ({ url: "http://127.0.0.1:12345", start: async () => undefined, stop: async () => undefined }),
    });
  });

  afterEach(async () => {
    await downloader.shutdown();
    rmSync(root, { recursive: true, force: true });
  });

  const inspect = async () => downloader.inspect("https://youtu.be/S9EUEdnJQDA");
  const downloadFixture = async (jobId: string) => {
    const metadata = await inspect();
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const completed = waitForStage(events, "complete");
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await completed;
    return { metadata, events, path: downloader.getCompletedFile(jobId).path };
  };
  const waitForStage = (events: VideoDownloadEvent[], stage: VideoDownloadEvent["stage"]) =>
    new Promise<VideoDownloadEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Missing ${stage} event`)), 3000);
      const found = events.find((event) => event.stage === stage);
      if (found) { clearTimeout(timeout); resolve(found); return; }
      const listener = (event: VideoDownloadEvent) => {
        if (event.stage !== stage) return;
        clearTimeout(timeout);
        downloader.removeListener("progress", listener);
        resolve(event);
      };
      downloader.on("progress", listener);
    });

  it("inspects compatible qualities, reports progress, and completes only after MP4 validation", async () => {
    const metadata = await inspect();
    expect(metadata).toMatchObject({
      title: "Test Sermon",
      videoUrl: "https://www.youtube.com/watch?v=S9EUEdnJQDA",
      duration: 30,
      heights: [1080, 720],
      defaultQuality: 1080,
    });
    expect(metadata.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    const inspectionArgs = processArguments.find((args) => args.includes("--print"))!;
    expect(inspectionArgs).toContain("%(.{title,duration})j");
    expect(inspectionArgs).toContain("%(formats.:.{ext,vcodec,acodec,height})j");
    expect(inspectionArgs).toContain("--no-simulate");
    expect(inspectionArgs).toContain("--write-thumbnail");
    expect(inspectionArgs).toContain("--no-playlist");
    expect(inspectionArgs).toContain("--proxy");
    expect(inspectionArgs.at(-1)).toBe("https://www.youtube.com/watch?v=S9EUEdnJQDA");
    expect(inspectionArgs).not.toContain("--dump-single-json");
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const completed = waitForStage(events, "complete");
    const jobId = "12345678-1234-4123-8123-123456789abc";
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    const event = await completed;
    expect(event.result).toEqual({ width: 1920, height: 1080, duration: 30, size: 8 });
    expect(events.some((progress) => progress.stage === "downloading" && progress.progress === 50)).toBe(true);
    expect(events.some((progress) => progress.stage === "processing")).toBe(true);
    expect(existsSync(downloader.getCompletedFile(jobId).path)).toBe(true);
    expect(processOptions.every((options) => options.shell === false)).toBe(true);
    const downloadArgs = processArguments.find((args) => args.includes("--format"))!;
    expect(downloadArgs).toContain("--progress");
    expect(downloadArgs).toContain("--js-runtimes");
    expect(downloadArgs).toContain(`deno:${nativeTools.denoPath}`);
    const selector = downloadArgs[downloadArgs.indexOf("--format") + 1];
    expect(selector.indexOf("b[height=1080]")).toBeLessThan(selector.indexOf("bv[height<=1080]"));
    expect(selector.indexOf("bv[height<=1080]")).toBeLessThan(selector.lastIndexOf("b[height<=1080]"));
    await expect(downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 }))
      .rejects.toThrow(/already finished/);
    await downloader.cleanup(jobId);
    expect(() => downloader.getCompletedFile(jobId)).toThrow(/no longer available/);
  });

  it("rejects malformed inspection projections with a bounded inspection-data error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    inspectionStdout = "{not-json}\n[]\n";
    try {
      await expect(inspect()).rejects.toThrow(/video details could not be read/i);
      expect(warn).toHaveBeenCalledWith("[VideoDownloader] operation failed", expect.objectContaining({
        stage: "inspection",
        category: "inspection-data",
        diagnostics: expect.stringContaining("projectionLines=2"),
      }));
    } finally {
      warn.mockRestore();
    }
  });

  it("allows inspection to be retried after malformed metadata", async () => {
    inspectionStdout = "{not-json}\n[]\n";
    await expect(inspect()).rejects.toThrow(/video details could not be read/i);

    inspectionStdout = undefined;
    await expect(inspect()).resolves.toMatchObject({
      title: "Test Sermon",
      heights: [1080, 720],
      defaultQuality: 1080,
    });
  });

  it("does not retain stdout after overflow and terminates the child once", async () => {
    inspectionStdout = Buffer.alloc(32, 0x78);
    const run = runInspectionCommand(downloader, nativeTools.ytDlpPath, 1000, {
      command: "yt-dlp",
      stdoutLimitBytes: 16,
      stderrLimitBytes: 16,
      stdoutOverflowCategory: "inspection-output-limit",
    });
    await expect(run).rejects.toMatchObject({ category: "inspection-output-limit" });
    expect(currentInspection?.kill).toHaveBeenCalledTimes(1);
    expect(currentInspection?.stdout.listenerCount("data")).toBe(0);
  });

  it("bounds stderr independently and retains only its diagnostic tail", async () => {
    inspectionStderr = "diagnostic-".repeat(100);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = runInspectionCommand(downloader, nativeTools.ytDlpPath, 1000, {
      command: "yt-dlp",
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 64,
      stdoutOverflowCategory: "inspection-output-limit",
    });
    await expect(run).rejects.toMatchObject({ category: "stderr-output-limit" });
    expect(currentInspection?.kill).toHaveBeenCalledTimes(1);
    try {
      const error = await run.catch((value: unknown) => value);
      logVideoFailure(error, "inspection");
      expect(warn).toHaveBeenCalledWith("[VideoDownloader] operation failed", expect.objectContaining({
        category: "stderr-output-limit",
      }));
      const payload = warn.mock.calls[0][1] as { diagnostics: string };
      expect(payload.diagnostics.length).toBeLessThanOrEqual(1200);
    } finally {
      warn.mockRestore();
    }
  });

  it("classifies native command timeouts, extraction failures, and execution failures", async () => {
    stallInspection = true;
    const policy = {
      command: "yt-dlp" as const,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024,
      stdoutOverflowCategory: "inspection-output-limit" as const,
    };
    await expect(runInspectionCommand(downloader, nativeTools.ytDlpPath, 10, policy))
      .rejects.toMatchObject({ category: "command-timeout" });
    expect(currentInspection?.kill).toHaveBeenCalledTimes(1);

    stallInspection = false;
    inspectionExitCode = 1;
    inspectionStderr = "The extractor could not process this synthetic response.";
    await expect(runInspectionCommand(downloader, nativeTools.ytDlpPath, 1000, policy))
      .rejects.toMatchObject({ category: "yt-dlp-extraction-failure" });

    inspectionProcessError = Object.assign(new Error("native process failure"), { code: "EIO" });
    await expect(runInspectionCommand(downloader, nativeTools.ytDlpPath, 1000, policy))
      .rejects.toMatchObject({ category: "native-process-failure" });
  });

  it("settles and removes stream listeners if a terminated child never closes", async () => {
    stallInspection = true;
    ignoreInspectionTermination = true;
    jest.useFakeTimers();
    try {
      const policy = {
        command: "yt-dlp" as const,
        stdoutLimitBytes: 1024,
        stderrLimitBytes: 1024,
        stdoutOverflowCategory: "inspection-output-limit" as const,
      };
      const command = runInspectionCommand(downloader, nativeTools.ytDlpPath, 10, policy);
      const result = command.then(() => undefined, (error: unknown) => error);
      await jest.advanceTimersByTimeAsync(5010);
      expect(await result).toMatchObject({ category: "command-timeout" });
      expect(currentInspection?.kill).toHaveBeenCalledTimes(1);
      expect(currentInspection?.stdout.listenerCount("data")).toBe(0);
      expect(currentInspection?.stderr.listenerCount("data")).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels the subprocess and cleans partial output", async () => {
    stallDownload = true;
    const metadata = await inspect();
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const cancelled = waitForStage(events, "cancelled");
    const jobId = "22345678-1234-4123-8123-123456789abc";
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: "best" });
    await waitFor(() => Boolean(currentDownload));
    await expect(downloader.cancelDownload(jobId)).resolves.toBe(true);
    await cancelled;
    expect(() => downloader.getCompletedFile(jobId)).toThrow(/no longer available/);
    expect(existsSync(join(root, "downloads", jobId))).toBe(false);
  });

  it("reports a missing packaged JavaScript runtime as a native dependency failure", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable = new VideoDownloader({
      rootDirectory: join(root, "missing-dependency-downloads"),
      ...nativeTools,
      denoPath: join(root, "tools", "missing-deno.exe"),
      spawnProcess: jest.fn() as unknown as typeof import("node:child_process").spawn,
      proxyFactory: () => ({ url: "http://127.0.0.1:12345", start: async () => undefined, stop: async () => undefined }),
    });
    try {
      await expect(unavailable.inspect("https://youtu.be/S9EUEdnJQDA"))
        .rejects.toThrow(/required desktop video tool is missing/i);
      expect(warn).toHaveBeenCalledWith("[VideoDownloader] operation failed", expect.objectContaining({
        stage: "inspection",
        category: "native-dependency",
      }));
    } finally {
      await unavailable.shutdown();
      warn.mockRestore();
    }
  });

  it("allows a failed job to retry with the same id and then complete", async () => {
    failNextDownload = true;
    const metadata = await inspect();
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const failed = waitForStage(events, "failed");
    const jobId = "32345678-1234-4123-8123-123456789abc";
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await failed;
    const completed = waitForStage(events, "complete");
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await completed;
    expect(downloadCount).toBe(2);
    expect(existsSync(downloader.getCompletedFile(jobId).path)).toBe(true);
  });

  it("waits for an in-flight Mux source read to settle before cleaning its job directory", async () => {
    const metadata = await inspect();
    const jobId = "42345678-1234-4123-8123-123456789abc";
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await waitFor(() => events.some((event) => event.stage === "complete"));

    let resolveLookup!: (addresses: Array<{ address: string; family: 4 }>) => void;
    let markLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => { markLookupStarted = resolve; });
    const pendingLookup = new Promise<Array<{ address: string; family: 4 }>>((resolve) => { resolveLookup = resolve; });
    uploadLookup = async () => {
      markLookupStarted();
      return pendingLookup;
    };
    const upload = downloader.uploadToMux(jobId, "https://upload.mux.com/one").then(
      () => undefined,
      (error: unknown) => error,
    );
    await lookupStarted;
    const cleanup = downloader.cleanup(jobId);
    await Promise.resolve();
    expect(existsSync(join(root, "downloads", jobId))).toBe(true);

    resolveLookup([{ address: "8.8.8.8", family: 4 }]);
    expect(await upload).toEqual(expect.objectContaining({ message: "Upload cancelled." }));
    await cleanup;
    expect(existsSync(join(root, "downloads", jobId))).toBe(false);
  });

  it.each([
    "https://storage.googleapis.com/video-storage/upload?Signature=legacy-signed-value",
    "https://upload.mux.com/upload-id?token=current-signed-value",
    "https://region-1.uploads.mux.com/upload-id?token=current-signed-value",
  ])("streams a downloaded temporary file to a real Mux Direct Upload host (%s)", async (url) => {
    const jobId = "52345678-1234-4123-8123-123456789abc";
    const { events } = await downloadFixture(jobId);

    await downloader.uploadToMux(jobId, url);

    expect(muxRequestUrls).toEqual([url]);
    expect(muxRequestOptions[0]).toMatchObject({
      method: "PUT",
      headers: { "content-length": "8", "content-type": "video/mp4" },
    });
    expect(Buffer.concat(muxRequests[0].chunks).toString()).toBe("fake-mp4");
    expect(events.some((event) => event.stage === "uploading" && event.progress === 0)).toBe(true);
    expect(events.some((event) => event.stage === "uploading" && event.progress === 99 && event.totalBytes === 8)).toBe(true);
  });

  it("fails promptly when the local source shrinks after its declared size is read", async () => {
    const jobId = "59345678-1234-4123-8123-123456789abc";
    const { path } = await downloadFixture(jobId);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    beforeMuxRequest = () => writeFileSync(path, "x");
    muxAutoRespond = false;
    muxResetOnDestroyWithoutError = true;

    try {
      await expect(downloader.uploadToMux(jobId, "https://upload.mux.com/truncated"))
        .rejects.toThrow("The local video could not be read");
      expect(muxRequests[0].destroyed).toBe(true);
      expect(warn.mock.calls).toContainEqual([
        "[VideoDownloader] Mux upload failed",
        expect.objectContaining({
          stage: "file-read",
          category: "file-read-failed",
          operation: "read-upload-source",
        }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects a deceptive Mux hostname before opening an HTTP request and logs only safe diagnostics", async () => {
    const jobId = "62345678-1234-4123-8123-123456789abc";
    await downloadFixture(jobId);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const signedUrl = "https://uploads.mux.com.attacker.example/upload?Signature=must-not-be-logged";

    try {
      await expect(downloader.uploadToMux(jobId, signedUrl)).rejects.toThrow("The cloud upload address is invalid.");
      expect(muxRequests).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith("[VideoDownloader] Mux upload URL rejected", {
        category: "host-not-allowed",
        hostname: "uploads.mux.com.attacker.example",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("must-not-be-logged");
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects an allowed upload host when DNS resolves to a private IP", async () => {
    const jobId = "72345678-1234-4123-8123-123456789abc";
    await downloadFixture(jobId);
    uploadLookup = async () => [{ address: "10.0.0.12", family: 4 }];
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(downloader.uploadToMux(jobId, "https://upload.mux.com/upload?signature=private-dns"))
        .rejects.toThrow("The cloud upload address is invalid.");
      expect(muxRequests).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith("[VideoDownloader] Mux upload URL rejected", {
        category: "unsafe-address",
        hostname: "upload.mux.com",
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-dns");
    } finally {
      warn.mockRestore();
    }
  });

  it("reports HTTP rejection, timeout, and transport failure without exposing request URLs", async () => {
    const jobId = "82345678-1234-4123-8123-123456789abc";
    await downloadFixture(jobId);
    const url = "https://upload.mux.com/upload?Signature=do-not-expose";

    muxResponseStatus = 403;
    await expect(downloader.uploadToMux(jobId, url)).rejects.toThrow("HTTP 403");

    muxResponseStatus = 200;
    muxAutoRespond = false;
    const timeoutUpload = downloader.uploadToMux(jobId, url);
    await waitFor(() => muxRequests.length === 2 && muxRequests[1].writableFinished);
    muxRequests[1].expire();
    await expect(timeoutUpload).rejects.toThrow(/timed out/i);

    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const transportUpload = downloader.uploadToMux(jobId, url);
    await waitFor(() => muxRequests.length === 3 && muxRequests[2].writableFinished);
    muxRequests[2].destroy(Object.assign(new Error(`ECONNRESET ${url}`), { code: "ECONNRESET" }));
    await expect(transportUpload).rejects.toThrow(/connection failed/i);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("do-not-expose");
    expect(JSON.stringify(warn.mock.calls)).toContain("ECONNRESET");
    warn.mockRestore();
  });

  it("treats an early HTTP request failure as transport failure, not source truncation", async () => {
    const jobId = "88345678-1234-4123-8123-123456789abc";
    await downloadFixture(jobId);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    muxRequestFailure = Object.assign(new Error("connection closed before response"), { code: "ECONNRESET" });
    muxAutoRespond = false;

    try {
      await expect(downloader.uploadToMux(jobId, "https://upload.mux.com/early-close"))
        .rejects.toThrow("upload connection failed");
      expect(warn.mock.calls).toContainEqual([
        "[VideoDownloader] Mux upload failed",
        expect.objectContaining({ stage: "http-transport", category: "transport-failed" }),
      ]);
      expect(warn.mock.calls).not.toContainEqual([
        "[VideoDownloader] Mux upload failed",
        expect.objectContaining({ stage: "file-read", category: "file-read-failed" }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("logs structured file-read errors without paths, signed URLs, or credentials", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const signedUrl = "https://upload.mux.com/upload?token=secret-signature";
    const failure = Object.assign(new Error(
      `Unexpected read failure at C:\\Users\\Alice\\Sermon.mp4 /Users/alice/Sermon.mp4 /home/alice/Sermon.mp4 ${signedUrl} authorization=private-key`,
    ), { code: "EIO" });
    const fakeHandle = {
      createReadStream: () => {
        const source = new PassThrough();
        setTimeout(() => source.emit("error", failure), 0);
        return source as unknown as import("node:fs").ReadStream;
      },
      close: jest.fn(async () => undefined),
    };

    try {
      await expect(downloader.uploadLocalAssetToMux(
        "a3345678-1234-4123-8123-123456789abc",
        fakeHandle as unknown as Awaited<ReturnType<typeof open>>,
        8,
        signedUrl,
      )).rejects.toThrow("The local video could not be read");
      const payload = JSON.stringify(warn.mock.calls);
      expect(payload).toContain('"operation":"read-upload-source"');
      expect(payload).toContain('"code":"EIO"');
      expect(payload).not.toContain("C:\\\\Users\\\\Alice");
      expect(payload).not.toContain("/Users/alice");
      expect(payload).not.toContain("/home/alice");
      expect(payload).not.toContain("secret-signature");
      expect(payload).not.toContain("private-key");
      expect(payload).not.toContain("Unexpected read failure");
    } finally {
      warn.mockRestore();
    }
  });

  it("cancels the native HTTP upload and closes its stream", async () => {
    const jobId = "92345678-1234-4123-8123-123456789abc";
    await downloadFixture(jobId);
    muxAutoRespond = false;
    const upload = downloader.uploadToMux(jobId, "https://upload.mux.com/upload");
    await waitFor(() => muxRequests.length === 1 && muxRequests[0].writableFinished);

    await expect(downloader.cancelDownload(jobId)).resolves.toBe(true);
    await expect(upload).rejects.toThrow("Upload cancelled.");
    expect(muxRequests[0].destroyed).toBe(true);
  });

  it("uses the same native PUT implementation for registered local assets", async () => {
    const jobId = "a2345678-1234-4123-8123-123456789abc";
    const { path } = await downloadFixture("b2345678-1234-4123-8123-123456789abc");
    const handle = await open(path, "r");

    await downloader.uploadLocalAssetToMux(jobId, handle, 8, "https://storage.googleapis.com/video-storage/linked-upload");

    expect(muxRequestUrls).toEqual(["https://storage.googleapis.com/video-storage/linked-upload"]);
    expect(Buffer.concat(muxRequests[0].chunks).toString()).toBe("fake-mp4");
  });

  it("reports modern progress templates with separate audio and video stream metrics", async () => {
    const jobId = "c2345678-1234-4123-8123-123456789abc";
    const outputPath = join(root, "downloads", jobId, "video.mp4");
    downloadStdout = [
      "WSYNC_PROGRESS:137:avc1.640028:NA:2097152:4194304:NA:524288:4",
      "WSYNC_PROGRESS:140:NA:mp4a.40.2:1048576:2097152:NA:262144:4",
      `WSYNC_FILE:${outputPath}`,
    ].join("\n");
    const metadata = await inspect();
    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const completed = waitForStage(events, "complete");

    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await completed;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "downloading", streamId: "137", progress: 50, totalBytes: 4194304 }),
      expect.objectContaining({ stage: "downloading", streamId: "140", streamLabel: "Audio", progress: 50, totalBytes: 2097152 }),
    ]));
  });

  it("parses captured yt-dlp output across fragmented Windows lines and completes through processing", async () => {
    const metadata = await inspect();
    const jobId = "d2345678-1234-4123-8123-123456789abc";
    const outputPath = join(root, "downloads", jobId, "video.mp4");
    mkdirSync(join(root, "downloads", jobId), { recursive: true });
    writeFileSync(outputPath, "fake-mp4");

    // Captured from the pinned Windows yt-dlp 2026.10.26 executable against
    // local HTTP fixtures; source URLs and destination paths have been removed.
    const videoProgress = "WSYNC_PROGRESS:137:avc1.640028:none:784914:2097152:NA:262012.01993290862:5";
    const audioProgress = "WSYNC_PROGRESS:140:none:mp4a.40.2:261120:524288:NA:261823.13826157174:1";
    const unknownTotalProgress = "WSYNC_PROGRESS:unknown:avc1.640028:none:523096:NA:NA:131028.5718746678:NA";
    downloadOutputChunks = {
      stdout: [
        videoProgress.slice(0, 17),
        videoProgress.slice(17, 51),
        `${videoProgress.slice(51)}\r`,
        `\n${audioProgress}\r\n${unknownTotalProgress}\r`,
        `\nWSYNC_FILE:${outputPath}\r\n`,
      ],
      stderr: ["WSYNC_PROCESS", "ING:started\r", "\nWSYNC_PROCESSING:finished"],
    };

    const events: VideoDownloadEvent[] = [];
    downloader.on("progress", (event) => events.push(event));
    const completed = waitForStage(events, "complete");

    await downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 });
    await completed;

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "downloading",
        streamId: "137",
        streamLabel: "Video",
        progress: 37,
        downloadedBytes: 784914,
        totalBytes: 2097152,
        speedBytesPerSecond: 262012.01993290862,
        etaSeconds: 5,
      }),
      expect.objectContaining({
        stage: "downloading",
        streamId: "140",
        streamLabel: "Audio",
        progress: 50,
        downloadedBytes: 261120,
        totalBytes: 524288,
        speedBytesPerSecond: 261823.13826157174,
        etaSeconds: 1,
      }),
      expect.objectContaining({
        stage: "downloading",
        streamId: "unknown",
        progress: null,
        downloadedBytes: 523096,
        totalBytes: undefined,
        speedBytesPerSecond: 131028.5718746678,
        etaSeconds: undefined,
      }),
      expect.objectContaining({ stage: "processing" }),
      expect.objectContaining({ stage: "complete", progress: 100 }),
    ]));
  });

  it("uses yt-dlp estimated totals and leaves genuinely unknown totals indeterminate", () => {
    expect(parseYtDlpProgressLine("WSYNC_PROGRESS:137:avc1:NA:1048576:NA:2097152:524288:2")).toEqual({
      streamId: "137",
      streamLabel: "Video",
      downloadedBytes: 1048576,
      totalBytes: 2097152,
      speedBytesPerSecond: 524288,
      etaSeconds: 2,
    });
    expect(parseYtDlpProgressLine("WSYNC_PROGRESS:140:NA:mp4a:1048576:NA:NA:262144:4")).toEqual({
      streamId: "140",
      streamLabel: "Audio",
      downloadedBytes: 1048576,
      totalBytes: undefined,
      speedBytesPerSecond: 262144,
      etaSeconds: 4,
    });
  });
});
