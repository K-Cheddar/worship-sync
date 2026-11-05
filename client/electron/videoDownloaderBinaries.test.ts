import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVideoToolPaths } from "./videoDownloaderBinaries";

describe("video tool path resolution", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "worshipsync-video-tools-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("resolves tools outside ASAR from packaged resources", () => {
    const directory = join(root, "buildResources", "video-tools", "win32-x64");
    mkdirSync(directory, { recursive: true });
    for (const name of ["yt-dlp.exe", "deno.exe", "ffmpeg.exe", "ffprobe.exe"]) writeFileSync(join(directory, name), "test");
    expect(resolveVideoToolPaths({
      platform: "win32", arch: "x64", isPackaged: true, resourcesPath: root, appPath: "unused",
    })).toEqual({
      ytDlpPath: join(directory, "yt-dlp.exe"),
      denoPath: join(directory, "deno.exe"),
      ffmpegPath: join(directory, "ffmpeg.exe"),
      ffprobePath: join(directory, "ffprobe.exe"),
    });
  });

  it("keeps the supported downloader entry point visible so missing binaries can be reported", () => {
    const paths = resolveVideoToolPaths({
      platform: "win32", arch: "x64", isPackaged: true, resourcesPath: root, appPath: "unused",
    });
    expect(paths).toEqual({
      ytDlpPath: join(root, "buildResources", "video-tools", "win32-x64", "yt-dlp.exe"),
      denoPath: join(root, "buildResources", "video-tools", "win32-x64", "deno.exe"),
      ffmpegPath: join(root, "buildResources", "video-tools", "win32-x64", "ffmpeg.exe"),
      ffprobePath: join(root, "buildResources", "video-tools", "win32-x64", "ffprobe.exe"),
    });
  });

  it("keeps the downloader disabled for unsupported platform and architecture", () => {
    expect(resolveVideoToolPaths({
      platform: "darwin", arch: "arm64", isPackaged: true, resourcesPath: root, appPath: root,
    })).toBeNull();
  });
});
