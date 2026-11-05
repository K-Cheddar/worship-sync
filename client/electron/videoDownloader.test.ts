import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { VideoDownloader, type VideoDownloadEvent } from "./videoDownloader";
import { logVideoFailure } from "./videoDownloaderErrors";
import type { SafeHttpLookupAll } from "./safeHttp";

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough };

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
          finishChild(child, `WSYNC_PROGRESS:100:200:200\nWSYNC_FILE:${file}\nWSYNC_PROCESSING:started\n`);
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
      lookupAll: (...args) => uploadLookup(...args),
      proxyFactory: () => ({ url: "http://127.0.0.1:12345", start: async () => undefined, stop: async () => undefined }),
    });
  });

  afterEach(async () => {
    await downloader.shutdown();
    rmSync(root, { recursive: true, force: true });
  });

  const inspect = async () => downloader.inspect("https://youtu.be/S9EUEdnJQDA");
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
});
