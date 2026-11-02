import { existsSync } from "node:fs";
import { join } from "node:path";

export type VideoToolPaths = {
  ytDlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
};

export const resolveVideoToolPaths = ({
  platform,
  arch,
  isPackaged,
  resourcesPath,
  appPath,
}: {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): VideoToolPaths | null => {
  if (platform !== "win32" || arch !== "x64") return null;
  const baseDirectory = isPackaged
    ? join(resourcesPath, "buildResources", "video-tools", "win32-x64")
    : join(appPath, "buildResources", "video-tools", "win32-x64");
  const paths = {
    ytDlpPath: join(baseDirectory, "yt-dlp.exe"),
    ffmpegPath: join(baseDirectory, "ffmpeg.exe"),
    ffprobePath: join(baseDirectory, "ffprobe.exe"),
  };
  return Object.values(paths).every(existsSync) ? paths : null;
};
