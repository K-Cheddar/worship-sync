import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type VideoDownloadPreferences = {
  saveOutsideWorshipSync: boolean;
  uploadToCloud: boolean;
  lastDirectory?: string;
};

export const DEFAULT_VIDEO_DOWNLOAD_PREFERENCES: VideoDownloadPreferences = {
  saveOutsideWorshipSync: false,
  uploadToCloud: false,
};

const normalizePreferences = (value: unknown): VideoDownloadPreferences => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_VIDEO_DOWNLOAD_PREFERENCES };
  }
  const parsed = value as Partial<VideoDownloadPreferences>;
  return {
    saveOutsideWorshipSync: parsed.saveOutsideWorshipSync === true,
    uploadToCloud: parsed.uploadToCloud === true,
    ...(typeof parsed.lastDirectory === "string" && parsed.lastDirectory.trim()
      ? { lastDirectory: parsed.lastDirectory }
      : {}),
  };
};

export class VideoDownloadPreferencesStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async get(): Promise<VideoDownloadPreferences> {
    try {
      return normalizePreferences(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Video download preferences could not be read.", error);
      }
      return { ...DEFAULT_VIDEO_DOWNLOAD_PREFERENCES };
    }
  }

  update(
    patch: Partial<VideoDownloadPreferences>,
  ): Promise<VideoDownloadPreferences> {
    const operation = this.queue.then(async () => {
      const current = await this.get();
      const next = normalizePreferences({ ...current, ...patch });
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, JSON.stringify(next), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporaryPath, this.filePath);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      return next;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
