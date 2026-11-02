import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "buildResources", "video-tools", "win32-x64");
const cache = join(root, ".cache", "video-tools");
const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe";
const YTDLP_SHA256 = "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d";
const YTDLP_LICENSE_URL = "https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/LICENSE";
const YTDLP_THIRD_PARTY_LICENSE_URL = "https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/THIRD_PARTY_LICENSES.txt";
const FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip";
const FFMPEG_SHA256 = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec";
const FFMPEG_EXE_SHA256 = "1326dde4c84ff1f96fe6b8916c5bed29e163e9b5dccf995f6f3db069d143ec5e";
const FFPROBE_EXE_SHA256 = "b49ccc7c6547b141ad5a2f6ec69cc04323d7133d7704d70b331b904c63eecb07";
const FFMPEG_GPL_LICENSE_URL = "https://raw.githubusercontent.com/FFmpeg/FFmpeg/38b88335f9/COPYING.GPLv3";
const MAX_FFMPEG_ARCHIVE_BYTES = 180 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;

const runPowerShell = (source) => new Promise((resolvePromise, reject) => {
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errorText = "";
  child.stderr.on("data", (chunk) => { errorText += chunk.toString("utf8"); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(errorText || "Could not extract the pinned FFmpeg package.")));
});

const downloadVerified = async (url, expectedHash, destination, maxBytes) => {
  const existing = await readFile(destination).catch(() => null);
  if (existing && sha256(existing) === expectedHash) return existing;
  const response = await fetch(url, { redirect: "follow" });
  const finalUrl = new URL(response.url);
  if (!response.ok || !["github.com", "release-assets.githubusercontent.com", "www.gyan.dev"].includes(finalUrl.hostname)) {
    throw new Error(`Pinned tool download failed (${response.status || "invalid response"}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes || sha256(bytes) !== expectedHash) {
    throw new Error("Pinned video tool checksum validation failed.");
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { mode: 0o600 });
  return bytes;
};

const copyMatchingFile = async (directory, matcher, destination) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    if (entry.isFile() && matcher.test(entry.name)) {
      await copyFile(candidate, join(output, destination));
      return true;
    }
    if (entry.isDirectory()) {
      if (await copyMatchingFile(candidate, matcher, destination)) return true;
    }
  }
  return false;
};

export const prepareVideoTools = async (platform = process.platform, arch = process.arch) => {
  await mkdir(output, { recursive: true });
  if (platform !== "win32" || arch !== "x64") return;
  const staging = await mkdtemp(join(tmpdir(), "worshipsync-video-tools-"));
  try {
    const ytDlpPath = join(output, "yt-dlp.exe");
    const ffmpegPath = join(output, "ffmpeg.exe");
    const ffprobePath = join(output, "ffprobe.exe");
    const [ytDlpBytes, ffmpegBytes, ffprobeBytes] = await Promise.all([
      readFile(ytDlpPath).catch(() => null),
      readFile(ffmpegPath).catch(() => null),
      readFile(ffprobePath).catch(() => null),
    ]);
    const licensePath = join(output, "yt-dlp-THIRD_PARTY_LICENSES.txt");
    const ytDlpLicensePath = join(output, "yt-dlp-LICENSE.txt");
    const ffmpegLicensePath = join(output, "FFmpeg-COPYING.GPLv3.txt");
    if (
      ytDlpBytes && sha256(ytDlpBytes) === YTDLP_SHA256 &&
      ffmpegBytes && sha256(ffmpegBytes) === FFMPEG_EXE_SHA256 &&
      ffprobeBytes && sha256(ffprobeBytes) === FFPROBE_EXE_SHA256 &&
      await readFile(licensePath).then(() => true).catch(() => false) &&
      await readFile(ytDlpLicensePath).then(() => true).catch(() => false) &&
      await readFile(ffmpegLicensePath).then(() => true).catch(() => false) &&
      await readFile(join(output, "THIRD_PARTY_NOTICES.txt")).then(() => true).catch(() => false)
    ) return;

    const ytDlpDownload = join(staging, "yt-dlp.exe");
    await downloadVerified(YTDLP_URL, YTDLP_SHA256, ytDlpDownload, 30 * 1024 * 1024);
    await copyFile(ytDlpDownload, ytDlpPath);

    const archivePath = join(cache, "ffmpeg.zip");
    await mkdir(cache, { recursive: true });
    await downloadVerified(FFMPEG_URL, FFMPEG_SHA256, archivePath, MAX_FFMPEG_ARCHIVE_BYTES);
    const extracted = join(staging, "ffmpeg");
    await mkdir(extracted, { recursive: true });
    await runPowerShell(`Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(extracted)} -Force`);
    if (
      !(await copyMatchingFile(extracted, /^ffmpeg\.exe$/i, "ffmpeg.exe")) ||
      !(await copyMatchingFile(extracted, /^ffprobe\.exe$/i, "ffprobe.exe"))
    ) {
      throw new Error("The pinned FFmpeg package did not contain ffmpeg.exe and ffprobe.exe.");
    }
    const [installedFfmpeg, installedFfprobe] = await Promise.all([
      readFile(ffmpegPath),
      readFile(ffprobePath),
    ]);
    if (
      sha256(installedFfmpeg) !== FFMPEG_EXE_SHA256 ||
      sha256(installedFfprobe) !== FFPROBE_EXE_SHA256
    ) {
      throw new Error("An extracted FFmpeg executable failed its pinned checksum validation.");
    }
    const writeLicense = async (url, destination) => {
      if (await readFile(destination).then(() => true).catch(() => false)) return;
      const response = await fetch(url);
      if (!response.ok || new URL(response.url).hostname !== "raw.githubusercontent.com") throw new Error("Could not retrieve pinned video tool license text.");
      const text = await response.text();
      if (!text || text.length > 256 * 1024) throw new Error("A pinned video tool license file is invalid.");
      await writeFile(destination, text, "utf8");
    };
    await writeLicense(YTDLP_LICENSE_URL, ytDlpLicensePath);
    await writeLicense(YTDLP_THIRD_PARTY_LICENSE_URL, licensePath);
    await writeLicense(FFMPEG_GPL_LICENSE_URL, ffmpegLicensePath);
    const notices = [
      "WorshipSync desktop video tool notices",
      "",
      "yt-dlp 2026.10.26 Windows x64 standalone executable (GPLv3+ combined binary).",
      "Source and matching release: https://github.com/yt-dlp/yt-dlp/tree/2026.10.26",
      "Third-party license notices are in yt-dlp-THIRD_PARTY_LICENSES.txt.",
      "",
      "FFmpeg 8.1.2 Essentials Windows x64 static build (GPLv3).",
      "Build distribution and corresponding source: https://www.gyan.dev/ffmpeg/builds/",
      "Upstream source revision: https://github.com/FFmpeg/FFmpeg/commit/38b88335f9",
      "The FFmpeg distribution archive SHA-256 is db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec.",
      "",
      "yt-dlp's license and bundled third-party license texts are included beside the binaries.",
      "FFmpeg's GPLv3 license text and source revision are included beside the binaries. The Gyan static distribution is GPLv3; maintainers must keep the matching source/build materials available with releases as required by the applicable license terms.",
      "WorshipSync invokes these command-line programs as separate processes.",
    ].join("\n");
    await writeFile(join(output, "THIRD_PARTY_NOTICES.txt"), notices, "utf8");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareVideoTools().catch((error) => {
    console.error(error instanceof Error ? error.message : "Video tools could not be prepared.");
    process.exitCode = 1;
  });
}
