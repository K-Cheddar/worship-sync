import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLocalAssetProtocolUrl,
  LocalAssetStore,
  MAX_LOCAL_ASSET_BYTES_BY_KIND,
} from "./localAssetStore";

describe("LocalAssetStore", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "worshipsync-local-assets-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("imports without loading the whole file and survives a new store instance", async () => {
    const source = join(root, "selected.png");
    writeFileSync(source, "image-one");
    const storeRoot = join(root, "managed");
    const store = new LocalAssetStore(storeRoot);

    const imported = await store.importFile({
      assetId: "local_image_1",
      workspaceId: "church-1",
      kind: "image",
      sourcePath: source,
      fileName: "selected.png",
      contentType: "image/png",
      width: 1920,
      height: 1080,
    });
    const reopened = new LocalAssetStore(storeRoot);
    const resolved = await reopened.resolvePath("local_image_1");
    const opened = await reopened.openForRead("local_image_1");

    expect(resolved?.descriptor).toEqual(imported);
    expect(readFileSync(resolved!.path, "utf8")).toBe("image-one");
    expect(await opened?.handle.readFile("utf8")).toBe("image-one");
    await opened?.handle.close();
    expect(buildLocalAssetProtocolUrl(imported)).toContain(
      imported.contentHash,
    );
  });

  it("does not follow a replacement symlink in managed storage", async () => {
    const source = join(root, "selected.png");
    const outside = join(root, "outside-secret.png");
    writeFileSync(source, "image-one");
    writeFileSync(outside, "image-one");
    const store = new LocalAssetStore(join(root, "managed"));
    const imported = await store.importFile({
      assetId: "local_image_symlink",
      kind: "image",
      sourcePath: source,
      fileName: "selected.png",
      contentType: "image/png",
    });
    const storedPath = join(root, "managed", "files", imported.storedFileName!);
    unlinkSync(storedPath);
    try {
      symlinkSync(outside, storedPath, "file");
    } catch (error) {
      // Creating symbolic links can require extra Windows privileges.
      if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      throw error;
    }

    await expect(store.get("local_image_symlink")).resolves.toBeUndefined();
    await expect(store.openForRead("local_image_symlink")).resolves.toBeUndefined();
    expect(readFileSync(outside, "utf8")).toBe("image-one");
  });

  it.each([
    ["camera.mov", "video/quicktime"],
    ["camera.mkv", "video/x-matroska"],
    ["camera.avi", "video/x-msvideo"],
    ["camera.m4v", "video/x-m4v"],
  ])("stores the supported video type %s", async (fileName, contentType) => {
    const source = join(root, fileName);
    writeFileSync(source, "video-bytes");
    const store = new LocalAssetStore(join(root, "managed"));

    const imported = await store.importFile({
      assetId: "video-asset",
      kind: "video",
      sourcePath: source,
      fileName,
      contentType,
    });

    await expect(store.resolvePath("video-asset")).resolves.toEqual(
      expect.objectContaining({
        descriptor: expect.objectContaining({ contentType }),
      }),
    );
    expect(imported.storedFileName).toMatch(/^[a-f0-9]{64}\.\w+$/);
  });

  it("stores AVIF images in the Electron-backed asset store", async () => {
    const source = join(root, "design.avif");
    writeFileSync(source, "avif-bytes");
    const store = new LocalAssetStore(join(root, "managed"));

    const imported = await store.importFile({
      assetId: "avif-asset",
      kind: "image",
      sourcePath: source,
      fileName: "design.avif",
      contentType: "image/avif",
    });

    expect(imported.contentType).toBe("image/avif");
    await expect(store.resolvePath("avif-asset")).resolves.toEqual(
      expect.objectContaining({
        descriptor: expect.objectContaining({ contentType: "image/avif" }),
      }),
    );
  });

  it("imports downloaded conversion bytes into managed storage", async () => {
    const store = new LocalAssetStore(join(root, "managed"));
    const bytes = new Uint8Array([0, 1, 2, 3]);

    const imported = await store.importBytes(
      {
        assetId: "converted-video",
        workspaceId: "church-1",
        kind: "video",
        fileName: "camera.mp4",
        contentType: "video/mp4",
      },
      bytes,
    );
    const resolved = await store.resolvePath("converted-video");

    expect(imported.size).toBe(bytes.byteLength);
    expect(readFileSync(resolved!.path)).toEqual(Buffer.from(bytes));
  });

  it("deduplicates identical bytes and removes them after the final reference", async () => {
    const source = join(root, "shared.png");
    writeFileSync(source, "shared-image");
    const store = new LocalAssetStore(join(root, "managed"));
    const first = await store.importFile({
      assetId: "first",
      kind: "image",
      sourcePath: source,
      fileName: "first.png",
      contentType: "image/png",
    });
    const second = await store.importFile({
      assetId: "second",
      kind: "image",
      sourcePath: source,
      fileName: "second.png",
      contentType: "image/png",
    });

    expect(second.storedFileName).toBe(first.storedFileName);
    await expect(store.delete("first")).resolves.toBe(true);
    await expect(store.resolvePath("second")).resolves.toBeDefined();
    await expect(store.delete("second")).resolves.toBe(true);
    await expect(store.resolvePath("second")).resolves.toBeUndefined();
  });

  it("relinks an asset atomically to new bytes and changes its protocol revision", async () => {
    const source = join(root, "replacement.png");
    writeFileSync(source, "before");
    const store = new LocalAssetStore(join(root, "managed"));
    const original = await store.importFile({
      assetId: "relinked",
      kind: "image",
      sourcePath: source,
      fileName: "before.png",
      contentType: "image/png",
    });
    writeFileSync(source, "after");
    const replacement = await store.importFile({
      assetId: "relinked",
      kind: "image",
      sourcePath: source,
      fileName: "after.png",
      contentType: "image/png",
    });

    expect(replacement.contentHash).not.toBe(original.contentHash);
    expect(buildLocalAssetProtocolUrl(replacement)).not.toBe(
      buildLocalAssetProtocolUrl(original),
    );
    const resolved = await store.resolvePath("relinked");
    expect(readFileSync(resolved!.path, "utf8")).toBe("after");
  });

  it("links a selected video without making a managed copy and never deletes the source", async () => {
    const source = join(root, "original.mp4");
    writeFileSync(source, "linked-video-bytes");
    const managed = join(root, "managed");
    const store = new LocalAssetStore(managed);
    const linked = await store.linkFile({
      assetId: "linked-video",
      workspaceId: "church-1",
      kind: "video",
      sourcePath: source,
      fileName: "original.mp4",
      contentType: "video/mp4",
      width: 1920,
      height: 1080,
    });

    expect(linked.storageMode).toBe("linked");
    expect(linked).not.toHaveProperty("sourcePath");
    expect(linked).not.toHaveProperty("storedFileName");
    expect(readFileSync(source, "utf8")).toBe("linked-video-bytes");
    expect(readdirSync(join(managed, "files"))).toEqual([]);
    await expect(store.resolvePath("linked-video")).resolves.toEqual({
      descriptor: linked,
      path: source,
    });

    await expect(store.delete("linked-video")).resolves.toBe(true);
    expect(readFileSync(source, "utf8")).toBe("linked-video-bytes");
  });

  it("marks a linked asset unavailable when its path is replaced, then relinks the same identity", async () => {
    const source = join(root, "original.mp4");
    const replacement = join(root, "replacement.mp4");
    writeFileSync(source, "original-content");
    writeFileSync(replacement, "replacement-content");
    const store = new LocalAssetStore(join(root, "managed"));
    const original = await store.linkFile({
      assetId: "linked-video",
      kind: "video",
      sourcePath: source,
      fileName: "original.mp4",
      contentType: "video/mp4",
    });
    await rm(source);
    writeFileSync(source, "replacement-content");

    await expect(store.get("linked-video")).resolves.toBeUndefined();
    const relinked = await store.relinkFile("linked-video", {
      kind: "video",
      sourcePath: replacement,
      fileName: "replacement.mp4",
      contentType: "video/mp4",
      width: 1280,
      height: 720,
    });

    expect(relinked.assetId).toBe(original.assetId);
    expect(relinked.contentHash).not.toBe(original.contentHash);
    expect(buildLocalAssetProtocolUrl(relinked)).not.toBe(
      buildLocalAssetProtocolUrl(original),
    );
    await expect(store.resolvePath("linked-video")).resolves.toMatchObject({
      path: replacement,
      descriptor: { storageMode: "linked", fileName: "replacement.mp4" },
    });
  });

  it("migrates the existing version 1 managed asset index", async () => {
    const source = join(root, "legacy.png");
    writeFileSync(source, "legacy-image");
    const storeRoot = join(root, "managed");
    const store = new LocalAssetStore(storeRoot);
    const legacy = await store.importFile({
      assetId: "legacy",
      kind: "image",
      sourcePath: source,
      fileName: "legacy.png",
      contentType: "image/png",
    });
    const indexPath = join(storeRoot, "index.json");
    const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
    parsed.version = 1;
    delete parsed.assets.legacy.storageMode;
    writeFileSync(indexPath, JSON.stringify(parsed));

    const reopened = new LocalAssetStore(storeRoot);
    await expect(reopened.get("legacy")).resolves.toMatchObject({
      assetId: legacy.assetId,
      storageMode: "managed",
    });
  });

  it("recovers metadata from the index backup", async () => {
    const source = join(root, "recover.png");
    writeFileSync(source, "recoverable");
    const storeRoot = join(root, "managed");
    const store = new LocalAssetStore(storeRoot);
    await store.importFile({
      assetId: "recoverable",
      kind: "image",
      sourcePath: source,
      fileName: "recover.png",
      contentType: "image/png",
    });
    writeFileSync(join(storeRoot, "index.json"), "not-json");
    const warning = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const recovered = new LocalAssetStore(storeRoot);

    await expect(recovered.resolvePath("recoverable")).resolves.toBeDefined();
    warning.mockRestore();
  });

  it("rejects unsupported content types and invalid identifiers", async () => {
    const source = join(root, "unsafe.exe");
    writeFileSync(source, "unsafe");
    const store = new LocalAssetStore(join(root, "managed"));

    await expect(
      store.importFile({
        assetId: "../escape",
        kind: "image",
        sourcePath: source,
        fileName: "unsafe.exe",
        contentType: "application/x-msdownload",
      }),
    ).rejects.toThrow();
  });

  it("rejects an import above the media-kind size limit before copying it", async () => {
    const source = join(root, "oversized.png");
    writeFileSync(source, "image");
    truncateSync(source, MAX_LOCAL_ASSET_BYTES_BY_KIND.image + 1);
    const store = new LocalAssetStore(join(root, "managed"));

    await expect(
      store.importFile({
        assetId: "oversized",
        kind: "image",
        sourcePath: source,
        fileName: "oversized.png",
        contentType: "image/png",
      }),
    ).rejects.toThrow("too large to keep offline");
  });

  it("rejects a stored filename that escapes the managed directory", async () => {
    const storeRoot = join(root, "managed");
    mkdirSync(join(storeRoot, "files"), { recursive: true });
    const outsidePath = join(root, "outside-secret.txt");
    writeFileSync(outsidePath, "do-not-read-or-delete");
    writeFileSync(
      join(storeRoot, "index.json"),
      JSON.stringify({
        version: 1,
        assets: {
          escaped: {
            assetId: "escaped",
            kind: "image",
            fileName: "photo.png",
            contentType: "image/png",
            size: 10,
            contentHash: "a".repeat(64),
            storedFileName: "../outside-secret.txt",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      }),
    );
    const warning = jest.spyOn(console, "warn").mockImplementation();
    const store = new LocalAssetStore(storeRoot);

    await expect(store.get("escaped")).resolves.toBeUndefined();
    await expect(store.resolvePath("escaped")).resolves.toBeUndefined();
    await expect(store.delete("escaped")).resolves.toBe(false);
    expect(readFileSync(outsidePath, "utf8")).toBe("do-not-read-or-delete");
    warning.mockRestore();
  });
});
