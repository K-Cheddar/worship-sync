import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createWriteStream, existsSync, type Stats } from "node:fs";
import {
  mkdir,
  lstat,
  open,
  copyFile,
  readFile,
  realpath,
  rename,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { IMAGE_CONTENT_TYPE_EXTENSIONS } from "../src/utils/mediaFileTypes";

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

export type LocalAssetMetadata = Omit<LocalAssetImport, "sourcePath">;

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
  storageMode: "managed" | "linked";
  storedFileName?: string;
  createdAt: string;
  updatedAt: string;
};

type LocalAssetFileIdentity = {
  device: string;
  inode: string;
  size: number;
  modifiedAt: number;
};

type LocalAssetRecord = LocalAssetDescriptor & {
  /** Present only in the device-local index; never returned to renderer or synced. */
  sourcePath?: string;
  sourceIdentity?: LocalAssetFileIdentity;
};

type LocalAssetIndex = {
  version: 2;
  assets: Record<string, LocalAssetRecord>;
};

const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  ...IMAGE_CONTENT_TYPE_EXTENSIONS,
  "video/3gpp": ".3gp",
  "video/3gpp2": ".3g2",
  "video/mpeg": ".mpeg",
  "video/mp2t": ".ts",
  "video/mp4": ".mp4",
  "video/ogg": ".ogv",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-flv": ".flv",
  "video/x-m4v": ".m4v",
  "video/x-matroska": ".mkv",
  "video/x-ms-wmv": ".wmv",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
};
const CONTENT_TYPE_KINDS: Readonly<Record<string, LocalAssetKind>> = {
  ...Object.fromEntries(
    Object.keys(IMAGE_CONTENT_TYPE_EXTENSIONS).map((contentType) => [
      contentType,
      "image",
    ]),
  ),
  "video/3gpp": "video",
  "video/3gpp2": "video",
  "video/mpeg": "video",
  "video/mp2t": "video",
  "video/mp4": "video",
  "video/ogg": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "video/x-flv": "video",
  "video/x-m4v": "video",
  "video/x-matroska": "video",
  "video/x-ms-wmv": "video",
  "video/x-msvideo": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "application/pdf": "pdf",
};

const EMPTY_INDEX: LocalAssetIndex = { version: 2, assets: {} };
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

const fileIdentityOf = (value: Stats): LocalAssetFileIdentity => ({
  device: String(value.dev),
  inode: String(value.ino),
  size: value.size,
  modifiedAt: value.mtimeMs,
});

const sameFileIdentity = (
  left: LocalAssetFileIdentity | undefined,
  right: LocalAssetFileIdentity,
) => Boolean(
  left && left.device === right.device && left.inode === right.inode &&
  left.size === right.size && left.modifiedAt === right.modifiedAt,
);

const publicDescriptor = (record: LocalAssetRecord): LocalAssetDescriptor => {
  const { sourcePath: _sourcePath, sourceIdentity: _sourceIdentity, ...descriptor } = record;
  return descriptor;
};

const hashOpenFile = async (handle: Awaited<ReturnType<typeof open>>) => {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({ autoClose: false })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
};

const validateStoredDescriptor = (
  assetId: string,
  value: unknown,
): LocalAssetRecord => {
  if (!ASSET_ID_PATTERN.test(assetId) || !value || typeof value !== "object") {
    throw new Error("The local asset index contains an invalid asset.");
  }
  const descriptor = value as Partial<LocalAssetRecord>;
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
    (descriptor.storageMode ?? "managed") === "managed" &&
      descriptor.storedFileName !== `${descriptor.contentHash}${extension}` ||
    descriptor.storageMode !== undefined &&
      descriptor.storageMode !== "managed" &&
      descriptor.storageMode !== "linked" ||
    descriptor.storageMode === "linked" &&
      (typeof descriptor.sourcePath !== "string" ||
        !isAbsolute(descriptor.sourcePath) ||
        typeof descriptor.sourceIdentity !== "object" ||
        !descriptor.sourceIdentity) ||
    (descriptor.storageMode ?? "managed") === "managed" &&
      (descriptor.sourcePath !== undefined ||
        descriptor.sourceIdentity !== undefined) ||
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
  if (descriptor.storageMode === "linked") {
    const identity = descriptor.sourceIdentity as LocalAssetFileIdentity;
    if (
      typeof identity.device !== "string" ||
      typeof identity.inode !== "string" ||
      !Number.isFinite(identity.size) ||
      !Number.isFinite(identity.modifiedAt) ||
        identity.size !== descriptor.size ||
      descriptor.storedFileName !== undefined
    ) {
      throw new Error("The local asset index contains unsafe linked-file metadata.");
    }
  } else if (
    typeof descriptor.storedFileName !== "string" ||
    !/^[a-f0-9]{64}\.[a-z0-9]{2,4}$/.test(descriptor.storedFileName)
  ) {
    throw new Error("The local asset index contains an invalid managed asset path.");
  }
  return {
    ...descriptor,
    contentType,
    storageMode: descriptor.storageMode ?? "managed",
  } as LocalAssetRecord;
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
        this.index = { version: 2, assets: {} };
      }
    }
  }

  private async readIndex(path: string): Promise<LocalAssetIndex> {
    const parsed = JSON.parse(
      await readFile(path, "utf8"),
    ) as Partial<LocalAssetIndex>;
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
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
    return { version: 2, assets };
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
            storageMode: "managed",
            storedFileName,
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
          };
          const previousIndex = this.index;
          this.index = {
            version: 2,
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

  private async readLinkedFile(input: LocalAssetImport) {
    const extension = this.validateImport(input);
    if (input.kind !== "video") {
      throw new Error("Only local video files can be linked.");
    }
    const selectedStat = await lstat(input.sourcePath);
    if (!isRegularFile(selectedStat) || selectedStat.size <= 0) {
      throw new Error("Choose a local video file that is not empty or a shortcut.");
    }
    if (selectedStat.size > MAX_LOCAL_ASSET_BYTES_BY_KIND.video) {
      throw new Error("This video file is too large to use locally.");
    }
    const sourcePath = await realpath(input.sourcePath);
    const canonicalStat = await lstat(sourcePath);
    if (
      !isRegularFile(canonicalStat) ||
      canonicalStat.dev !== selectedStat.dev ||
      canonicalStat.ino !== selectedStat.ino
    ) {
      throw new Error("The selected video changed before it could be linked.");
    }
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const sourceHandle = await open(sourcePath, fsConstants.O_RDONLY | noFollow);
    try {
      const openedStat = await sourceHandle.stat();
      if (
        !isRegularFile(openedStat) ||
        openedStat.dev !== canonicalStat.dev ||
        openedStat.ino !== canonicalStat.ino ||
        openedStat.size !== canonicalStat.size ||
        openedStat.mtimeMs !== canonicalStat.mtimeMs
      ) {
        throw new Error("The selected video changed before it could be linked.");
      }
      const contentHash = await hashOpenFile(sourceHandle);
      const finalStat = await sourceHandle.stat();
      if (!sameFileIdentity(fileIdentityOf(openedStat), fileIdentityOf(finalStat))) {
        throw new Error("The selected video changed while it was being linked.");
      }
      return {
        sourcePath,
        sourceIdentity: fileIdentityOf(finalStat),
        extension,
        contentHash,
        size: finalStat.size,
      };
    } finally {
      await sourceHandle.close().catch(() => undefined);
    }
  }

  async linkFile(input: LocalAssetImport): Promise<LocalAssetDescriptor> {
    return this.enqueue(async () => {
      await this.ready;
      if (!ASSET_ID_PATTERN.test(input.assetId)) {
        throw new Error("The local asset identifier is invalid.");
      }
      const existing = this.index.assets[input.assetId];
      if (existing) {
        if (existing.storageMode === "linked" && existing.sourcePath === input.sourcePath) {
          const available = await this.get(input.assetId);
          if (available) return available;
        }
        throw new Error("This local video is already registered. Relink it from Media Library.");
      }
      const linked = await this.readLinkedFile(input);
      const now = new Date().toISOString();
      const record: LocalAssetRecord = {
        assetId: input.assetId,
        workspaceId: input.workspaceId,
        kind: input.kind,
        fileName: input.fileName,
        contentType: input.contentType.toLowerCase(),
        size: linked.size,
        width: input.width,
        height: input.height,
        contentHash: linked.contentHash,
        storageMode: "linked",
        sourcePath: linked.sourcePath,
        sourceIdentity: linked.sourceIdentity,
        createdAt: now,
        updatedAt: now,
      };
      const previousIndex = this.index;
      this.index = { version: 2, assets: { ...this.index.assets, [input.assetId]: record } };
      try {
        await this.persistIndex();
      } catch (error) {
        this.index = previousIndex;
        throw error;
      }
      return publicDescriptor(record);
    });
  }

  async relinkFile(
    assetId: string,
    input: Omit<LocalAssetImport, "assetId">,
  ): Promise<LocalAssetDescriptor> {
    return this.enqueue(async () => {
      await this.ready;
      if (!ASSET_ID_PATTERN.test(assetId)) {
        throw new Error("The local asset identifier is invalid.");
      }
      const previous = this.index.assets[assetId];
      if (!previous || previous.storageMode !== "linked") {
        throw new Error("Only a linked local video can be relinked.");
      }
      const linked = await this.readLinkedFile({ ...input, assetId });
      const now = new Date().toISOString();
      const record: LocalAssetRecord = {
        ...previous,
        workspaceId: input.workspaceId ?? previous.workspaceId,
        kind: input.kind,
        fileName: input.fileName,
        contentType: input.contentType.toLowerCase(),
        size: linked.size,
        width: input.width,
        height: input.height,
        contentHash: linked.contentHash,
        storageMode: "linked",
        storedFileName: undefined,
        sourcePath: linked.sourcePath,
        sourceIdentity: linked.sourceIdentity,
        updatedAt: now,
      };
      const previousIndex = this.index;
      this.index = { version: 2, assets: { ...this.index.assets, [assetId]: record } };
      try {
        await this.persistIndex();
      } catch (error) {
        this.index = previousIndex;
        throw error;
      }
      return publicDescriptor(record);
    });
  }

  /** Import bytes that do not have a native renderer file path, such as a downloaded conversion. */
  async importBytes(
    input: LocalAssetMetadata,
    data: Uint8Array,
  ): Promise<LocalAssetDescriptor> {
    await this.ready;
    const extension = this.validateImport({
      ...input,
      sourcePath: "byte-import",
    });
    if (data.byteLength <= 0) {
      throw new Error("Choose a local file that is not empty.");
    }
    if (data.byteLength > MAX_LOCAL_ASSET_BYTES_BY_KIND[input.kind]) {
      throw new Error(`This ${input.kind} file is too large to keep offline.`);
    }
    const fileSystem = await statfs(this.assetDirectory);
    const availableBytes =
      Number(fileSystem.bavail) * Number(fileSystem.bsize);
    if (
      Number.isFinite(availableBytes) &&
      availableBytes < data.byteLength + MINIMUM_FREE_BYTES_AFTER_IMPORT
    ) {
      throw new Error(
        "This device does not have enough free space to keep that file offline.",
      );
    }

    const temporaryPath = join(
      this.assetDirectory,
      `.byte-import-${randomUUID()}${extension}`,
    );
    try {
      await writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
      return await this.importFile({ ...input, sourcePath: temporaryPath });
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  async get(assetId: string): Promise<LocalAssetDescriptor | undefined> {
    await this.ready;
    if (!ASSET_ID_PATTERN.test(assetId)) return undefined;
    const record = this.index.assets[assetId];
    if (!record) return undefined;
    try {
      if (record.storageMode === "linked") {
        if (!record.sourcePath || !record.sourceIdentity) return undefined;
        const linkedStat = await lstat(record.sourcePath);
        if (
          !isRegularFile(linkedStat) ||
          !sameFileIdentity(record.sourceIdentity, fileIdentityOf(linkedStat))
        ) return undefined;
        return publicDescriptor(record);
      }
      if (!record.storedFileName) return undefined;
      const storedStat = await lstat(this.getStoredPath(record.storedFileName));
      return isRegularFile(storedStat) && storedStat.size === record.size
        ? publicDescriptor(record)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Return registered metadata even when its backing linked file is unavailable. */
  async getRegisteredDescriptor(assetId: string): Promise<LocalAssetDescriptor | undefined> {
    await this.ready;
    if (!ASSET_ID_PATTERN.test(assetId)) return undefined;
    const record = this.index.assets[assetId];
    return record ? publicDescriptor(record) : undefined;
  }

  /** Open a registered asset without following a path that changed after lookup. */
  async openForRead(assetId: string): Promise<
    | {
        descriptor: LocalAssetDescriptor;
        handle: Awaited<ReturnType<typeof open>>;
      }
    | undefined
  > {
    await this.ready;
    if (!ASSET_ID_PATTERN.test(assetId)) return undefined;
    const record = this.index.assets[assetId];
    if (!record) return undefined;
    const path = record.storageMode === "linked"
      ? record.sourcePath
      : record.storedFileName
        ? this.getStoredPath(record.storedFileName)
        : undefined;
    if (!path) return undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const pathStat = await lstat(path);
      if (!isRegularFile(pathStat)) return undefined;
      if (record.storageMode === "linked" &&
        !sameFileIdentity(record.sourceIdentity, fileIdentityOf(pathStat))) return undefined;
      if (record.storageMode === "managed" && pathStat.size !== record.size) return undefined;
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      handle = await open(path, fsConstants.O_RDONLY | noFollow);
      const openedStat = await handle.stat();
      if (
        !isRegularFile(openedStat) ||
        !sameFileIdentity(fileIdentityOf(pathStat), fileIdentityOf(openedStat)) ||
        (record.storageMode === "linked" &&
          !sameFileIdentity(record.sourceIdentity, fileIdentityOf(openedStat))) ||
        (record.storageMode === "managed" && openedStat.size !== record.size)
      ) {
        await handle.close();
        return undefined;
      }
      return { descriptor: publicDescriptor(record), handle };
    } catch {
      await handle?.close().catch(() => undefined);
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
    if (!descriptor) return undefined;
    const record = this.index.assets[assetId];
    if (!record) return undefined;
    return {
      descriptor,
      path: record.storageMode === "linked"
        ? record.sourcePath!
        : this.getStoredPath(record.storedFileName!),
    };
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
      this.index = { version: 2, assets };
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
