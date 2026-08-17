import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, type Stats } from "node:fs";
import {
  mkdir,
  lstat,
  open,
  copyFile,
  readFile,
  rename,
  stat,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type LocalAssetKind = "image" | "video" | "audio" | "pdf";

export type LocalAssetImport = {
  assetId: string;
  workspaceId?: string;
  kind: LocalAssetKind;
  sourcePath: string;
  fileName: string;
  contentType: string;
  width?: number;
  height?: number;
};

export type LocalAssetDescriptor = {
  assetId: string;
  workspaceId?: string;
  kind: LocalAssetKind;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  contentHash: string;
  storedFileName: string;
  createdAt: string;
  updatedAt: string;
};

type LocalAssetIndex = {
  version: 1;
  assets: Record<string, LocalAssetDescriptor>;
};

const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
};
const CONTENT_TYPE_KINDS: Readonly<Record<string, LocalAssetKind>> = {
  "image/gif": "image",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "application/pdf": "pdf",
};

const EMPTY_INDEX: LocalAssetIndex = { version: 1, assets: {} };
const MINIMUM_FREE_BYTES_AFTER_IMPORT = 128 * 1024 * 1024;
export const MAX_LOCAL_ASSET_BYTES_BY_KIND: Readonly<
  Record<LocalAssetKind, number>
> = {
  image: 100 * 1024 * 1024,
  video: 20 * 1024 * 1024 * 1024,
  audio: 2 * 1024 * 1024 * 1024,
  pdf: 500 * 1024 * 1024,
};

const isRegularFile = (value: Stats): boolean =>
  value.isFile() && !value.isSymbolicLink();

const validateStoredDescriptor = (
  assetId: string,
  value: unknown,
): LocalAssetDescriptor => {
  if (!ASSET_ID_PATTERN.test(assetId) || !value || typeof value !== "object") {
    throw new Error("The local asset index contains an invalid asset.");
  }
  const descriptor = value as Partial<LocalAssetDescriptor>;
  const contentType = descriptor.contentType?.toLowerCase();
  const extension = contentType
    ? CONTENT_TYPE_EXTENSIONS[contentType]
    : undefined;
  if (
    descriptor.assetId !== assetId ||
    !extension ||
    CONTENT_TYPE_KINDS[contentType!] !== descriptor.kind ||
    typeof descriptor.contentHash !== "string" ||
    !CONTENT_HASH_PATTERN.test(descriptor.contentHash) ||
    descriptor.storedFileName !== `${descriptor.contentHash}${extension}` ||
    typeof descriptor.fileName !== "string" ||
    !descriptor.fileName.trim() ||
    typeof descriptor.size !== "number" ||
    !Number.isFinite(descriptor.size) ||
    descriptor.size <= 0 ||
    typeof descriptor.createdAt !== "string" ||
    typeof descriptor.updatedAt !== "string"
  ) {
    throw new Error("The local asset index contains unsafe metadata.");
  }
  return { ...descriptor, contentType } as LocalAssetDescriptor;
};

export class LocalAssetStore {
  private readonly assetDirectory: string;
  private readonly indexPath: string;
  private readonly indexBackupPath: string;
  private index: LocalAssetIndex = EMPTY_INDEX;
  private ready: Promise<void>;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDirectory: string) {
    this.assetDirectory = join(rootDirectory, "files");
    this.indexPath = join(rootDirectory, "index.json");
    this.indexBackupPath = join(rootDirectory, "index.backup.json");
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    await mkdir(this.assetDirectory, { recursive: true });
    try {
      this.index = await this.readIndex(this.indexPath);
    } catch (error) {
      try {
        this.index = await this.readIndex(this.indexBackupPath);
        console.warn("Recovered the local asset index from its backup.", error);
      } catch (backupError) {
        const primaryMissing =
          (error as NodeJS.ErrnoException).code === "ENOENT";
        const backupMissing =
          (backupError as NodeJS.ErrnoException).code === "ENOENT";
        if (!primaryMissing || !backupMissing) {
          console.warn(
            "Local asset indexes could not be read; starting empty.",
            error,
            backupError,
          );
        }
        this.index = { version: 1, assets: {} };
      }
    }
  }

  private async readIndex(path: string): Promise<LocalAssetIndex> {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<LocalAssetIndex>;
    if (
      parsed.version !== 1 ||
      !parsed.assets ||
      typeof parsed.assets !== "object"
    ) {
      throw new Error("The local asset index has an unsupported format.");
    }
    const assets = Object.fromEntries(
      Object.entries(parsed.assets).map(([assetId, descriptor]) => [
        assetId,
        validateStoredDescriptor(assetId, descriptor),
      ]),
    );
    return { version: 1, assets };
  }

  private getStoredPath(storedFileName: string): string {
    if (!/^[a-f0-9]{64}\.[a-z0-9]{2,4}$/.test(storedFileName)) {
      throw new Error("The local asset path is invalid.");
    }
    return join(this.assetDirectory, storedFileName);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async persistIndex(): Promise<void> {
    const temporaryPath = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(this.index), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.indexPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    await copyFile(this.indexPath, this.indexBackupPath).catch((error) => {
      console.warn("The local asset index backup could not be updated.", error);
    });
  }

  private validateImport(input: LocalAssetImport): string {
    if (!ASSET_ID_PATTERN.test(input.assetId)) {
      throw new Error("The local asset identifier is invalid.");
    }
    const extension = CONTENT_TYPE_EXTENSIONS[input.contentType.toLowerCase()];
    if (!extension) throw new Error("This local file type is not supported.");
    if (CONTENT_TYPE_KINDS[input.contentType.toLowerCase()] !== input.kind) {
      throw new Error("The local file type does not match its media kind.");
    }
    if (!input.fileName.trim())
      throw new Error("The local file name is missing.");
    if (input.fileName.length > 512)
      throw new Error("The local file name is too long.");
    return extension;
  }

  async importFile(input: LocalAssetImport): Promise<LocalAssetDescriptor> {
    return this.enqueue(async () => {
      await this.ready;
      const extension = this.validateImport(input);
      const pathStat = await lstat(input.sourcePath);
      if (!isRegularFile(pathStat) || pathStat.size <= 0) {
        throw new Error("Choose a local file that is not empty.");
      }
      const sourceHandle = await open(input.sourcePath, "r");
      let sourceStat: Stats;
      try {
        sourceStat = await sourceHandle.stat();
        if (
          !isRegularFile(sourceStat) ||
          sourceStat.dev !== pathStat.dev ||
          sourceStat.ino !== pathStat.ino
        ) {
          throw new Error(
            "The selected local file changed before it could be imported.",
          );
        }
        if (sourceStat.size > MAX_LOCAL_ASSET_BYTES_BY_KIND[input.kind]) {
          throw new Error(
            `This ${input.kind} file is too large to keep offline.`,
          );
        }
        const fileSystem = await statfs(this.assetDirectory);
        const availableBytes =
          Number(fileSystem.bavail) * Number(fileSystem.bsize);
        if (
          Number.isFinite(availableBytes) &&
          availableBytes < sourceStat.size + MINIMUM_FREE_BYTES_AFTER_IMPORT
        ) {
          throw new Error(
            "This device does not have enough free space to keep that file offline.",
          );
        }

        const temporaryPath = join(
          this.assetDirectory,
          `.import-${randomUUID()}${extension}`,
        );
        const hash = createHash("sha256");
        const hashingStream = new Transform({
          transform(chunk, _encoding, callback) {
            hash.update(chunk);
            callback(null, chunk);
          },
        });

        try {
          await pipeline(
            sourceHandle.createReadStream({ autoClose: false }),
            hashingStream,
            createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
          );
          const contentHash = hash.digest("hex");
          const storedFileName = `${contentHash}${extension}`;
          const storedPath = this.getStoredPath(storedFileName);
          if (existsSync(storedPath)) {
            await unlink(temporaryPath);
          } else {
            await rename(temporaryPath, storedPath);
          }

          const now = new Date().toISOString();
          const previous = this.index.assets[input.assetId];
          const descriptor: LocalAssetDescriptor = {
            assetId: input.assetId,
            workspaceId: input.workspaceId,
            kind: input.kind,
            fileName: input.fileName,
            contentType: input.contentType.toLowerCase(),
            size: sourceStat.size,
            width: input.width,
            height: input.height,
            contentHash,
            storedFileName,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
          };
          const previousIndex = this.index;
          this.index = {
            version: 1,
            assets: { ...this.index.assets, [input.assetId]: descriptor },
          };
          try {
            await this.persistIndex();
          } catch (error) {
            this.index = previousIndex;
            await this.removeUnreferencedFile(storedFileName);
            throw error;
          }
          await this.removeUnreferencedFile(previous?.storedFileName);
          return descriptor;
        } catch (error) {
          await unlink(temporaryPath).catch(() => undefined);
          throw error;
        }
      } finally {
        await sourceHandle.close().catch(() => undefined);
      }
    });
  }

  async get(assetId: string): Promise<LocalAssetDescriptor | undefined> {
    await this.ready;
    if (!ASSET_ID_PATTERN.test(assetId)) return undefined;
    const descriptor = this.index.assets[assetId];
    if (!descriptor) return undefined;
    try {
      const storedStat = await stat(
        this.getStoredPath(descriptor.storedFileName),
      );
      return isRegularFile(storedStat) ? descriptor : undefined;
    } catch {
      return undefined;
    }
  }

  async resolvePath(assetId: string): Promise<
    | {
        descriptor: LocalAssetDescriptor;
        path: string;
      }
    | undefined
  > {
    const descriptor = await this.get(assetId);
    return descriptor
      ? {
          descriptor,
          path: this.getStoredPath(descriptor.storedFileName),
        }
      : undefined;
  }

  async delete(assetId: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.ready;
      if (!ASSET_ID_PATTERN.test(assetId)) return false;
      const previous = this.index.assets[assetId];
      if (!previous) return false;
      const assets = { ...this.index.assets };
      delete assets[assetId];
      const previousIndex = this.index;
      this.index = { version: 1, assets };
      try {
        await this.persistIndex();
      } catch (error) {
        this.index = previousIndex;
        throw error;
      }
      await this.removeUnreferencedFile(previous.storedFileName);
      return true;
    });
  }

  private async removeUnreferencedFile(
    storedFileName: string | undefined,
  ): Promise<void> {
    if (!storedFileName) return;
    let storedPath: string;
    try {
      storedPath = this.getStoredPath(storedFileName);
    } catch {
      return;
    }
    const isReferenced = Object.values(this.index.assets).some(
      (asset) => asset.storedFileName === storedFileName,
    );
    if (!isReferenced) {
      await unlink(storedPath).catch(() => undefined);
    }
  }
}

export const buildLocalAssetProtocolUrl = (
  descriptor: Pick<LocalAssetDescriptor, "assetId" | "contentHash">,
): string =>
  `worshipsync-media://asset/${encodeURIComponent(descriptor.assetId)}?v=${descriptor.contentHash}`;
