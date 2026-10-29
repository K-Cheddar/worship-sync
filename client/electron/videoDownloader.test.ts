import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { VideoDownloader, type VideoDownloadEvent } from "./videoDownloader";

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

const finishChild = (child: FakeChild, stdout: string, code = 0, stderr = "") => {
  child.stdout.end(stdout);
  child.stderr.end(stderr);
  setTimeout(() => child.emit("close", code, null), 0);
};

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
  let stallDownload = false;
  let failNextDownload = false;
  let processOptions: Array<{ shell?: boolean }>;
  let processArguments: string[][];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "worshipsync-downloader-test-"));
    downloadCount = 0;
    currentDownload = undefined;
    stallDownload = false;
    failNextDownload = false;
    processOptions = [];
    processArguments = [];
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
      } else if (args.includes("--dump-single-json")) {
        finishChild(child, JSON.stringify({
          title: "Test Sermon",
          duration: 30,
          formats: [
            { ext: "mp4", vcodec: "avc1.640028", acodec: "none", height: 1080 },
            { ext: "m4a", vcodec: "none", acodec: "mp4a.40.2" },
          ],
        }));
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
      ytDlpPath: "yt-dlp.exe",
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
      spawnProcess,
      proxyFactory: () => ({ url: "http://127.0.0.1:12345", start: async () => undefined, stop: async () => undefined }),
    });
  });

  afterEach(async () => {
    await downloader.shutdown();
    rmSync(root, { recursive: true, force: true });
  });

  const inspect = async () => downloader.inspect("https://youtu.be/video123");
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
    expect(metadata).toMatchObject({ title: "Test Sermon", duration: 30, heights: [1080], defaultQuality: 1080 });
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
    const selector = downloadArgs[downloadArgs.indexOf("--format") + 1];
    expect(selector.indexOf("b[height=1080]")).toBeLessThan(selector.indexOf("bv[height<=1080]"));
    expect(selector.indexOf("bv[height<=1080]")).toBeLessThan(selector.lastIndexOf("b[height<=1080]"));
    await expect(downloader.startDownload({ jobId, inspectionId: metadata.inspectionId, quality: 1080 }))
      .rejects.toThrow(/already finished/);
    await downloader.cleanup(jobId);
    expect(() => downloader.getCompletedFile(jobId)).toThrow(/no longer available/);
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
    expect(downloader.cancelDownload(jobId)).toBe(true);
    await cancelled;
    expect(() => downloader.getCompletedFile(jobId)).toThrow(/no longer available/);
    expect(existsSync(join(root, "downloads", jobId))).toBe(false);
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
});
