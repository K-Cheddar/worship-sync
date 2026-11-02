import { randomUUID } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, statfs } from "node:fs/promises";
import { type ClientRequest } from "node:http";
import { request as requestHttps } from "node:https";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { VideoDownloadProxy } from "./videoDownloadProxy";
import { validateSafeHttpUrl, type SafeHttpLookupAll } from "./safeHttp";
import {
  getCompatibleVideoQualities,
  validateSupportedVideoUrl,
  type YtDlpFormat,
} from "./videoDownloaderSecurity";

export type VideoDownloadEvent = {
  jobId: string;
  stage: "preparing" | "downloading" | "processing" | "uploading" | "complete" | "failed" | "cancelled";
  progress: number | null;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
  result?: { width: number; height: number; duration: number; size: number };
};

export type VideoInspection = {
  inspectionId: string;
  title: string;
  thumbnail: string;
  duration: number;
  heights: number[];
  defaultQuality: number | "best";
};

type InspectionRecord = {
  url: string;
  title: string;
  duration: number;
  heights: number[];
  createdAt: number;
};

type RunningChild = { child: ChildProcess; cancelled: boolean };
type DownloadRecord = {
  directory: string;
  filePath?: string;
  inspectionId: string;
  quality: number | "best";
  child?: RunningChild;
  uploadRequest?: ClientRequest;
  uploadStream?: ReadStream;
  downloadTask?: Promise<void>;
  uploadTask?: Promise<void>;
  uploadCancelled?: boolean;
  cleanupTask?: Promise<void>;
  status: "active" | "complete" | "failed" | "cancelled";
};

const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024 * 1024;
const MINIMUM_FREE_BYTES = 128 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const MUX_UPLOAD_HOSTS = ["storage.googleapis.com", "upload.mux.com", "uploads.mux.com"];

const isWithin = (base: string, candidate: string) => {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

const parseNumber = (value: string | undefined) => {
  if (!value || value === "NA" || value === "None") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const isCancelled = (record: DownloadRecord) => record.status === "cancelled";

const bytesFromLine = (line: string) => {
  const match = line.match(/^WSYNC_PROGRESS:([^:]+):([^:]+):([^:]+)$/);
  if (!match) return null;
  const downloadedBytes = parseNumber(match[1]);
  const totalBytes = parseNumber(match[2]) ?? parseNumber(match[3]);
  return { downloadedBytes, totalBytes };
};

const friendlyDownloadError = (stderr: string) => {
  if (/unsupported url|unsupported url scheme|no suitable extractor/i.test(stderr)) {
    return "This video source is not supported.";
  }
  if (/private video|video unavailable|not available|has been removed|http error 404/i.test(stderr)) {
    return "This video is unavailable or cannot be accessed without an account.";
  }
  if (/timed out|temporary failure|connection|network|unable to download/i.test(stderr)) {
    return "The video could not be downloaded because of a network problem. Check your connection and retry.";
  }
  if (/no space left|disk full|not enough space|winerror\s*112|enospc/i.test(stderr)) {
    return "This computer does not have enough free storage for the video.";
  }
  return "The video could not be downloaded. Check the link and try again.";
};

export class VideoDownloader extends EventEmitter {
  private readonly inspections = new Map<string, InspectionRecord>();
  private readonly jobs = new Map<string, DownloadRecord>();
  private activeJobId: string | null = null;
  private activeInspections = 0;
  private readonly ready: Promise<void>;

  constructor(
    private readonly options: {
      rootDirectory: string;
      ytDlpPath: string;
      ffmpegPath: string;
      ffprobePath: string;
      spawnProcess?: typeof spawn;
      requestMux?: typeof requestHttps;
      lookupAll?: SafeHttpLookupAll;
      proxyFactory?: () => Pick<VideoDownloadProxy, "url" | "start" | "stop">;
    },
  ) {
    super();
    this.ready = this.initialize();
  }

  private async initialize() {
    await mkdir(this.options.rootDirectory, { recursive: true });
    const entries = await readdir(this.options.rootDirectory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && (UUID_PATTERN.test(entry.name) || /^inspect-[0-9a-f-]{36}$/i.test(entry.name)))
      .map((entry) => rm(join(this.options.rootDirectory, entry.name), { recursive: true, force: true })));
  }

  private emitProgress(event: VideoDownloadEvent) {
    this.emit("progress", event);
  }

  private createProxy() {
    return this.options.proxyFactory?.() ?? new VideoDownloadProxy();
  }

  private pruneInspections() {
    const now = Date.now();
    for (const [id, record] of this.inspections) {
      if (now - record.createdAt > 60 * 60 * 1000) this.inspections.delete(id);
    }
  }

  async inspect(rawUrl: unknown): Promise<VideoInspection> {
    await this.ready;
    const url = validateSupportedVideoUrl(rawUrl);
    if (this.activeInspections >= 2) throw new Error("Video details are already being checked. Try again in a moment.");
    this.activeInspections += 1;
    this.pruneInspections();
    while (this.inspections.size >= 20) {
      const oldest = this.inspections.keys().next().value as string | undefined;
      if (!oldest) break;
      this.inspections.delete(oldest);
    }
    const inspectionId = randomUUID();
    const directory = join(this.options.rootDirectory, `inspect-${inspectionId}`);
    const proxy = this.createProxy();
    try {
      await mkdir(directory, { recursive: true });
      await proxy.start();
      const args = [
        "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--ies", "youtube",
        "--no-warnings", "--no-cache-dir", "--no-progress", "--dump-single-json",
        "--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg",
        "--max-filesize", "2M",
        "--ffmpeg-location", this.options.ffmpegPath,
        "--proxy", proxy.url,
        "--output", join(directory, "preview"),
        url,
      ];
      let stdout: string;
      try {
        stdout = await this.runCommand(this.options.ytDlpPath, args, 60_000);
      } catch (error) {
        throw new Error(friendlyDownloadError(error instanceof Error ? error.message : ""));
      }
      let info: {
        title?: unknown; duration?: unknown; formats?: YtDlpFormat[];
        _type?: string; entries?: unknown[];
      };
      try {
        info = JSON.parse(stdout) as typeof info;
      } catch {
        throw new Error("Could not read video details from this link. Check the link and retry.");
      }
      if (info._type === "playlist" || Array.isArray(info.entries)) {
        throw new Error("Choose a single YouTube video. Playlists are not supported.");
      }
      if (typeof info.title !== "string" || !info.title.trim()) {
        throw new Error("Could not read the video title from this link.");
      }
      const duration = Number(info.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 6 * 60 * 60) {
        throw new Error("Live videos and videos longer than 6 hours are not supported.");
      }
      const heights = getCompatibleVideoQualities(Array.isArray(info.formats) ? info.formats : []);
      const thumbnailName = (await readdir(directory)).find((name) => /\.(jpg|jpeg|png|webp)$/i.test(name));
      let thumbnail = "";
      if (thumbnailName) {
        const thumbnailPath = join(directory, thumbnailName);
        const thumbnailStat = await stat(thumbnailPath);
        if (thumbnailStat.size > 0 && thumbnailStat.size <= 2 * 1024 * 1024) {
          const bytes = await readFile(thumbnailPath);
          const mime = thumbnailName.endsWith(".png") ? "image/png" : "image/jpeg";
          thumbnail = `data:${mime};base64,${bytes.toString("base64")}`;
        }
      }
      const title = info.title.trim().slice(0, 300);
      this.inspections.set(inspectionId, { url, title, duration, heights, createdAt: Date.now() });
      return {
        inspectionId,
        title,
        thumbnail,
        duration,
        heights,
        defaultQuality: heights.includes(1080) ? 1080 : heights[0],
      };
    } finally {
      try {
        await proxy.stop().catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      } finally {
        this.activeInspections -= 1;
      }
    }
  }

  private runCommand(binary: string, args: string[], timeoutMs: number) {
    const spawnProcess = this.options.spawnProcess ?? spawn;
    return new Promise<string>((resolveOutput, reject) => {
      const child = spawnProcess(binary, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let outputSize = 0;
      const timer = setTimeout(() => this.terminate(child), timeoutMs);
      const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > MAX_COMMAND_OUTPUT_BYTES) {
          this.terminate(child);
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout?.on("data", collect("stdout"));
      child.stderr?.on("data", collect("stderr"));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(error.message));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && outputSize <= MAX_COMMAND_OUTPUT_BYTES) resolveOutput(stdout);
        else reject(new Error(stderr || "Video tool failed."));
      });
    });
  }

  async startDownload(input: { inspectionId: unknown; quality: unknown; jobId?: unknown }) {
    await this.ready;
    const inspectionId = typeof input.inspectionId === "string" ? input.inspectionId : "";
    const inspection = this.inspections.get(inspectionId);
    if (!inspection) throw new Error("Inspect the video link again before downloading.");
    const quality = input.quality === "best" ? "best" : Number(input.quality);
    if (quality !== "best" && (!Number.isInteger(quality) || !inspection.heights.includes(quality))) {
      throw new Error("Choose one of the available video resolutions.");
    }
    const jobId = input.jobId === undefined ? randomUUID() : input.jobId;
    if (typeof jobId !== "string" || !UUID_PATTERN.test(jobId)) throw new Error("The download job is invalid.");
    if (this.activeJobId) throw new Error("Another video download is already running.");
    const previous = this.jobs.get(jobId);
    if (previous?.status === "complete") throw new Error("This video has already finished downloading.");
    const directory = join(this.options.rootDirectory, jobId);
    if (!isWithin(this.options.rootDirectory, directory)) throw new Error("The download destination is invalid.");
    this.activeJobId = jobId;
    const record: DownloadRecord = { directory, inspectionId, quality, status: "active" };
    this.jobs.set(jobId, record);
    try {
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      this.emitProgress({ jobId, stage: "preparing", progress: 0 });
      const downloadTask = this.runDownload(jobId, record, inspection).catch(() => undefined);
      record.downloadTask = downloadTask;
      void downloadTask.finally(() => {
        if (record.downloadTask === downloadTask) record.downloadTask = undefined;
      });
    } catch (error) {
      this.jobs.delete(jobId);
      if (this.activeJobId === jobId) this.activeJobId = null;
      throw error;
    }
    return { jobId };
  }

  private async runDownload(jobId: string, record: DownloadRecord, inspection: InspectionRecord) {
    const proxy = this.createProxy();
    try {
      await proxy.start();
      if (isCancelled(record)) throw new Error("Download cancelled.");
      const fsInfo = await statfs(record.directory);
      if (Number(fsInfo.bavail) * Number(fsInfo.bsize) < MINIMUM_FREE_BYTES) {
        throw new Error("This computer does not have enough free storage for the video.");
      }
      if (isCancelled(record)) throw new Error("Download cancelled.");
      const quality = record.quality;
      const requestedHeight = quality === "best" ? Math.max(...inspection.heights) : quality;
      const heightConstraint = `[height<=${requestedHeight}]`;
      const format = [
        `b[height=${requestedHeight}][ext=mp4][vcodec^=avc1][acodec^=mp4a]`,
        `bv${heightConstraint}[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]`,
        `b${heightConstraint}[ext=mp4][vcodec^=avc1][acodec^=mp4a]`,
      ].join("/");
      const args = [
        "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--ies", "youtube",
        "--no-warnings", "--no-cache-dir", "--newline", "--downloader", "native",
        "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3",
        "--file-access-retries", "2", "--extractor-retries", "2",
        "--max-filesize", `${Math.floor(MAX_DOWNLOAD_BYTES / (1024 * 1024))}M`,
        "--format", format, "--merge-output-format", "mp4",
        "--ffmpeg-location", this.options.ffmpegPath,
        "--proxy", proxy.url,
        "--progress-template", "download:WSYNC_PROGRESS:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s",
        "--progress-template", "postprocess:WSYNC_PROCESSING:%(progress.status)s",
        "--print", "after_move:WSYNC_FILE:%(filepath)s",
        "--output", join(record.directory, "video.%(ext)s"),
        inspection.url,
      ];
      this.emitProgress({ jobId, stage: "downloading", progress: null });
      const stdout = await this.runDownloadCommand(jobId, record, args);
      const finalLine = stdout.split(/\r?\n/).find((line) => line.startsWith("WSYNC_FILE:"));
      if (!finalLine) throw new Error("The downloaded video file was not found.");
      const filePath = resolve(finalLine.slice("WSYNC_FILE:".length));
      if (!isWithin(record.directory, filePath)) throw new Error("The video output path is invalid.");
      const fileStat = await stat(filePath);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_DOWNLOAD_BYTES) {
        throw new Error("The downloaded video is empty or exceeds the 12 GB limit.");
      }
      const probe = await this.runCommand(this.options.ffprobePath, [
        "-v", "error", "-select_streams", "v:0", "-show_entries",
        "format=format_name,duration:stream=codec_name,width,height", "-of", "json", filePath,
      ], 30_000);
      const probeData = JSON.parse(probe) as {
        streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
        format?: { format_name?: string; duration?: string };
      };
      const video = probeData.streams?.[0];
      const duration = Number(probeData.format?.duration);
      const audioCodec = await this.runCommand(this.options.ffprobePath, [
        "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", filePath,
      ], 30_000).then((value) => value.trim()).catch(() => "");
      if (
        !video || video.codec_name !== "h264" || audioCodec !== "aac" ||
        !probeData.format?.format_name?.includes("mp4") ||
        !Number.isFinite(duration) || duration <= 0
      ) {
        throw new Error("This source could not produce a browser-compatible H.264/AAC MP4 without conversion.");
      }
      record.filePath = filePath;
      record.status = "complete";
      this.emitProgress({
        jobId,
        stage: "complete",
        progress: 100,
        result: { width: video.width ?? 0, height: video.height ?? 0, duration, size: fileStat.size },
      });
    } catch (error) {
      const cancelled = record.child?.cancelled || record.status === "cancelled";
      record.status = cancelled ? "cancelled" : "failed";
      await rm(record.directory, { recursive: true, force: true });
      const message = cancelled ? "Download cancelled." : error instanceof Error && /not enough free storage|without conversion|12 GB|Playlists are not supported|unavailable|compatible/i.test(error.message)
        ? error.message
        : friendlyDownloadError(error instanceof Error ? error.message : "");
      this.emitProgress({ jobId, stage: cancelled ? "cancelled" : "failed", progress: null, error: message });
    } finally {
      await proxy.stop();
      if (this.activeJobId === jobId) this.activeJobId = null;
      record.child = undefined;
    }
  }

  private runDownloadCommand(jobId: string, record: DownloadRecord, args: string[]) {
    if (record.status === "cancelled") return Promise.reject(new Error("Download cancelled."));
    const spawnProcess = this.options.spawnProcess ?? spawn;
    return new Promise<string>((resolveOutput, reject) => {
      const child = spawnProcess(this.options.ytDlpPath, args, { windowsHide: true, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      const running = { child, cancelled: false };
      record.child = running;
      let stdout = "";
      let stderrTail = "";
      let outputSize = 0;
      let stdoutPending = "";
      let stderrPending = "";
      let sizeExceeded = false;
      let outputExceeded = false;
      const handleProgressLine = (line: string) => {
        const bytes = bytesFromLine(line.trim());
        if (bytes) {
          if ((bytes.downloadedBytes ?? 0) > MAX_DOWNLOAD_BYTES || (bytes.totalBytes ?? 0) > MAX_DOWNLOAD_BYTES) {
            sizeExceeded = true;
            this.terminate(child);
            return;
          }
          const progress = bytes.downloadedBytes !== undefined && bytes.totalBytes
            ? Math.min(99, Math.round((bytes.downloadedBytes / bytes.totalBytes) * 100)) : null;
          this.emitProgress({ jobId, stage: "downloading", progress, ...bytes });
        } else if (line.startsWith("WSYNC_PROCESSING:")) {
          this.emitProgress({ jobId, stage: "processing", progress: null });
        } else if (/\[Merger\]|Merging formats|Fixing.*container/i.test(line)) {
          this.emitProgress({ jobId, stage: "processing", progress: null });
        }
      };
      const collect = (target: "stdout" | "stderr") => (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (target === "stdout") {
          outputSize += chunk.length;
          if (outputSize <= MAX_COMMAND_OUTPUT_BYTES) stdout += text;
          else if (!outputExceeded) {
            outputExceeded = true;
            this.terminate(child);
          }
        } else {
          stderrTail = `${stderrTail}${text}`.slice(-16_384);
        }
        const pending = target === "stdout" ? stdoutPending : stderrPending;
        const lines = `${pending}${text}`.split(/\r?\n/);
        const nextPending = lines.pop() ?? "";
        if (target === "stdout") stdoutPending = nextPending;
        else stderrPending = nextPending;
        lines.forEach(handleProgressLine);
      };
      child.stdout?.on("data", collect("stdout"));
      child.stderr?.on("data", collect("stderr"));
      child.once("error", (error) => reject(new Error(error.message)));
      child.once("close", (code) => {
        if (stdoutPending) handleProgressLine(stdoutPending);
        if (stderrPending) handleProgressLine(stderrPending);
        record.child = undefined;
        if (running.cancelled) reject(new Error("Download cancelled."));
        else if (sizeExceeded) reject(new Error("The downloaded video exceeds the 12 GB limit."));
        else if (outputExceeded) reject(new Error("Video download output exceeded its limit."));
        else if (code === 0 && outputSize <= MAX_COMMAND_OUTPUT_BYTES) resolveOutput(stdout);
        else reject(new Error(stderrTail || "Video download failed."));
      });
    });
  }

  private terminate(child: ChildProcess) {
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
      killer.unref();
    } else if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    } else child.kill();
  }

  async cancelDownload(jobId: string) {
    const record = this.jobs.get(jobId);
    if (!record) return false;
    const downloadActive = record.status === "active";
    if (downloadActive) record.status = "cancelled";
    if (record.uploadTask) record.uploadCancelled = true;
    if (record.child) {
      record.child.cancelled = true;
      this.terminate(record.child.child);
    }
    if (record.uploadRequest) {
      record.uploadCancelled = true;
      record.uploadStream?.destroy();
      record.uploadRequest.destroy(new Error("Upload cancelled."));
    }
    const wasActive = Boolean(downloadActive || record.uploadTask || record.uploadRequest);
    await Promise.allSettled([record.downloadTask, record.uploadTask].filter(Boolean) as Promise<void>[]);
    return wasActive;
  }

  getCompletedFile(jobId: string) {
    const record = this.jobs.get(jobId);
    if (!record || record.status !== "complete" || !record.filePath) {
      throw new Error("The completed video is no longer available.");
    }
    return { path: record.filePath, directory: record.directory };
  }

  async uploadToMux(jobId: string, rawUploadUrl: unknown) {
    const record = this.jobs.get(jobId);
    const filePath = record?.filePath;
    if (!record || record.status !== "complete" || !filePath) throw new Error("The downloaded video is not ready to upload.");
    if (record.uploadTask) throw new Error("A cloud upload is already running for this video.");
    record.uploadCancelled = false;
    const uploadTask = this.performMuxUpload(jobId, record, filePath, rawUploadUrl);
    record.uploadTask = uploadTask;
    try {
      await uploadTask;
    } finally {
      if (record.uploadTask === uploadTask) record.uploadTask = undefined;
    }
  }

  private async performMuxUpload(jobId: string, record: DownloadRecord, filePath: string, rawUploadUrl: unknown) {
    if (typeof rawUploadUrl !== "string" || rawUploadUrl.length > 8192) throw new Error("The cloud upload could not be started.");
    let uploadUrl: URL;
    try { uploadUrl = new URL(rawUploadUrl); }
    catch { throw new Error("The cloud upload could not be started."); }
    if (uploadUrl.protocol !== "https:" || !MUX_UPLOAD_HOSTS.includes(uploadUrl.hostname) || uploadUrl.username || uploadUrl.password || (uploadUrl.port && uploadUrl.port !== "443")) {
      throw new Error("The cloud upload address is invalid.");
    }
    const validatedUpload = await validateSafeHttpUrl(uploadUrl.toString(), this.options.lookupAll);
    if (record.uploadCancelled || this.jobs.get(jobId) !== record) throw new Error("Upload cancelled.");
    const size = (await stat(filePath)).size;
    if (record.uploadCancelled || this.jobs.get(jobId) !== record) throw new Error("Upload cancelled.");
    this.emitProgress({ jobId, stage: "uploading", progress: 0, downloadedBytes: 0, totalBytes: size });
    const uploadStream = createReadStream(filePath);
    record.uploadStream = uploadStream;
    const request = (this.options.requestMux ?? requestHttps)(validatedUpload.url, {
      method: "PUT",
      headers: { "content-length": String(size), "content-type": "video/mp4" },
      timeout: 60 * 60 * 1000,
      lookup: (_hostname, options, callback) => {
        const address = validatedUpload.address;
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
    });
    record.uploadRequest = request;
    request.setTimeout(60 * 60 * 1000, () => request.destroy(new Error("Cloud video upload timed out.")));
    let uploaded = 0;
    uploadStream.on("data", (chunk: Buffer) => {
      uploaded += chunk.length;
      this.emitProgress({ jobId, stage: "uploading", progress: Math.min(99, Math.round(uploaded / size * 100)), downloadedBytes: uploaded, totalBytes: size });
    });
    return new Promise<void>((resolveUpload, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        record.uploadRequest = undefined;
        record.uploadStream = undefined;
        if (error) reject(record.uploadCancelled ? new Error("Upload cancelled.") : error);
        else resolveUpload();
      };
      request.once("response", (response) => {
        response.resume();
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) finish();
        else finish(new Error("The video could not be uploaded to cloud storage."));
      });
      request.once("error", (error) => finish(error));
      uploadStream.once("error", (error) => finish(error));
      uploadStream.pipe(request);
    });
  }

  async cleanup(jobId: string) {
    const record = this.jobs.get(jobId);
    if (!record) return;
    if (record.cleanupTask) return record.cleanupTask;
    const cleanupTask = (async () => {
      await this.cancelDownload(jobId);
      await Promise.allSettled([record.downloadTask, record.uploadTask].filter(Boolean) as Promise<void>[]);
      if (this.jobs.get(jobId) !== record) return;
      await rm(record.directory, { recursive: true, force: true });
      this.jobs.delete(jobId);
      this.inspections.delete(record.inspectionId);
    })();
    record.cleanupTask = cleanupTask;
    try {
      await cleanupTask;
    } finally {
      if (record.cleanupTask === cleanupTask) record.cleanupTask = undefined;
    }
  }

  async shutdown() {
    const records = [...this.jobs.entries()];
    for (const [jobId, record] of records) {
      await this.cancelDownload(jobId);
      await Promise.allSettled([record.downloadTask, record.uploadTask].filter(Boolean) as Promise<void>[]);
      await rm(record.directory, { recursive: true, force: true }).catch(() => undefined);
    }
    this.jobs.clear();
    this.inspections.clear();
  }
}
