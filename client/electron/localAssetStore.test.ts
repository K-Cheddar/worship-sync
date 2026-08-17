import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  truncateSync,
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

    expect(resolved?.descriptor).toEqual(imported);
    expect(readFileSync(resolved!.path, "utf8")).toBe("image-one");
    expect(buildLocalAssetProtocolUrl(imported)).toContain(
      imported.contentHash,
    );
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
