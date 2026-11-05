import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAssetStore } from "./localAssetStore";
import {
  finalizeExternalVideo,
  normalizeExternalVideoFileName,
} from "./externalVideoFinalization";

describe("external video finalization", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "worshipsync-external-video-"));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it("normalizes filenames for Windows and adds an extension once", () => {
    expect(normalizeExternalVideoFileName('  Sunday: "Hope"/Intro.  ')).toBe(
      "Sunday Hope Intro.mp4",
    );
    expect(normalizeExternalVideoFileName("Sermon.MP4")).toBe("Sermon.MP4");
    expect(normalizeExternalVideoFileName("   ")).toBe("Downloaded video.mp4");
  });

  it("finalizes to a linked asset without a managed duplicate and does not overwrite conflicts", async () => {
    const sourcePath = join(root, "temporary.mp4");
    const destinationDirectory = join(root, "external");
    const managedRoot = join(root, "managed");
    await mkdir(destinationDirectory);
    await writeFile(sourcePath, "complete-video-content");
    await writeFile(join(destinationDirectory, "Sunday.mp4"), "keep-existing-file");
    const store = new LocalAssetStore(managedRoot);

    const result = await finalizeExternalVideo({
      sourcePath,
      sourceDirectory: root,
      destinationDirectory,
      displayName: "Sunday",
      assetId: "local_video_download_job-1",
      workspaceId: "church-1",
      width: 1920,
      height: 1080,
      store,
    });

    expect(result.fileName).toBe("Sunday (2).mp4");
    expect(result.asset.storageMode).toBe("linked");
    expect(result.asset.fileName).toBe("Sunday (2).mp4");
    const resolved = await store.resolvePath(result.asset.assetId);
    expect(await readFile(resolved!.path)).toEqual(await readFile(sourcePath));
    expect(await readFile(join(destinationDirectory, "Sunday.mp4"), "utf8")).toBe("keep-existing-file");
    expect(await readdir(join(managedRoot, "files"))).toEqual([]);
    expect((await readdir(destinationDirectory)).some((name) => name.endsWith(".partial"))).toBe(false);

    const retried = await finalizeExternalVideo({
      sourcePath,
      destinationDirectory,
      displayName: "Sunday",
      assetId: "local_video_download_job-1",
      workspaceId: "church-1",
      width: 1920,
      height: 1080,
      store,
    });
    expect(retried.asset.assetId).toBe(result.asset.assetId);
    expect((await readdir(destinationDirectory)).sort()).toEqual(["Sunday (2).mp4", "Sunday.mp4"]);
  });

  it("keeps a finalized external file when local registry persistence fails and reuses it on retry", async () => {
    const sourcePath = join(root, "temporary.mp4");
    const destinationDirectory = join(root, "external");
    const managedRoot = join(root, "managed");
    await mkdir(destinationDirectory);
    await writeFile(sourcePath, "complete-video-content");
    const store = new LocalAssetStore(managedRoot);
    const internalStore = store as unknown as { persistIndex: () => Promise<void> };
    const persistIndex = jest.spyOn(internalStore, "persistIndex").mockRejectedValueOnce(new Error("disk full"));
    const args = {
      sourcePath,
      sourceDirectory: root,
      destinationDirectory,
      displayName: "Sunday",
      assetId: "local_video_download_job-2",
      workspaceId: "church-1",
      width: 1920,
      height: 1080,
      store,
    };

    await expect(finalizeExternalVideo(args)).rejects.toThrow("disk full");
    expect(await readFile(join(destinationDirectory, "Sunday.mp4"), "utf8")).toBe("complete-video-content");

    persistIndex.mockRestore();
    const retry = await finalizeExternalVideo(args);
    expect(retry.fileName).toBe("Sunday.mp4");
    expect(await readdir(destinationDirectory)).toEqual(["Sunday.mp4"]);
  });

  it("does not create a duplicate when an earlier linked registration is now unavailable", async () => {
    const sourcePath = join(root, "temporary.mp4");
    const destinationDirectory = join(root, "external");
    const store = new LocalAssetStore(join(root, "managed"));
    await mkdir(destinationDirectory);
    await writeFile(sourcePath, "complete-video-content");
    const linkedPath = join(destinationDirectory, "Sunday.mp4");
    await writeFile(linkedPath, "complete-video-content");
    await store.linkFile({
      assetId: "local_video_download_job-3",
      workspaceId: "church-1",
      kind: "video",
      sourcePath: linkedPath,
      fileName: "Sunday.mp4",
      contentType: "video/mp4",
    });
    await unlink(linkedPath);
    const filesBeforeRetry = await readdir(destinationDirectory);

    await expect(finalizeExternalVideo({
      sourcePath,
      sourceDirectory: root,
      destinationDirectory,
      displayName: "Sunday",
      assetId: "local_video_download_job-3",
      workspaceId: "church-1",
      width: 1920,
      height: 1080,
      store,
    })).rejects.toThrow("already linked");
    expect(await readdir(destinationDirectory)).toEqual(filesBeforeRetry);
  });
});
