import "core-js/stable/structured-clone";
import "fake-indexeddb/auto";
import type { DBItem } from "../types";
import {
  claimLocalImageUploadJob,
  cleanupLocalImagesForDeletedItem,
  cleanupOrphanedLocalImages,
  deleteLocalImage,
  deleteLocalImageUploadJob,
  enqueueLocalImageUploadJobAtomically,
  getLocalImage,
  getLocalImageThumbnail,
  getLocalImageUploadJob,
  listLocalImageUploadJobs,
  listLocalImagesForWorkspace,
  putLocalImageUploadJob,
  releaseLocalImageUploadJobLease,
  renewLocalImageUploadJobLease,
  retryLocalImageUploadJobAtomically,
  saveLocalImage,
  saveLocalImageThumbnail,
  updateLeasedLocalImageUploadJob,
  type LocalImageUploadJob,
} from "./localImageAssets";

const deleteAssetDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("worshipsync-local-assets");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Database deletion was blocked."));
  });

const storedImage = (id: string) => ({
  id,
  workspaceId: "church-1",
  blob: new Blob([id], { type: "image/png" }),
  fileName: `${id}.png`,
  contentType: "image/png",
  size: id.length,
  width: 100,
  height: 100,
  createdAt: "2020-01-01T00:00:00.000Z",
});

const itemWithAsset = (itemId: string, assetId: string): DBItem => ({
  _id: itemId,
  _rev: "1-test",
  name: itemId,
  type: "free",
  selectedArrangement: 0,
  arrangements: [],
  slides: [
    {
      id: `${itemId}-slide`,
      name: "Section 1",
      type: "Section",
      boxes: [
        {
          id: `${itemId}-box`,
          width: 100,
          height: 100,
          background: `local-image://${assetId}`,
          mediaInfo: {
            path: "",
            createdAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
            format: "png",
            height: 100,
            width: 100,
            name: `${assetId}.png`,
            publicId: assetId,
            type: "image",
            id: assetId,
            background: `local-image://${assetId}`,
            thumbnail: `local-image://${assetId}`,
            source: "local",
            localImage: {
              id: assetId,
              ownerDeviceId: "device-1",
              ownerLabel: "Booth PC",
              fileName: `${assetId}.png`,
              contentType: "image/png",
              storagePolicy: "local-only",
            },
          },
        },
      ],
    },
  ],
  shouldSendTo: { projector: true, monitor: true, stream: true },
});

describe("localImageAssets IndexedDB lifecycle", () => {
  beforeEach(async () => {
    delete window.electronAPI;
    await deleteAssetDatabase();
  });
  afterAll(() => deleteAssetDatabase());

  it("keeps only metadata in IndexedDB when Electron owns the original", async () => {
    const importLocalAsset = jest.fn().mockResolvedValue({
      assetId: "native",
      url: "worshipsync-media://asset/native?v=hash",
    });
    const deleteLocalAsset = jest.fn().mockResolvedValue(true);
    window.electronAPI = {
      importLocalAsset,
      deleteLocalAsset,
    } as unknown as NonNullable<typeof window.electronAPI>;
    const file = new File(["native-image"], "native.png", {
      type: "image/png",
    });

    await saveLocalImage({
      ...storedImage("native"),
      blob: file,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    });

    expect(importLocalAsset).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ assetId: "native", kind: "image" }),
    );
    await expect(listLocalImagesForWorkspace("church-1")).resolves.toEqual([
      expect.objectContaining({ id: "native", blob: undefined }),
    ]);
    await deleteLocalImage("native");
    expect(deleteLocalAsset).toHaveBeenCalledWith("native");
  });

  it("persists image bytes and upload jobs across independent opens", async () => {
    await saveLocalImage(storedImage("asset-1"));
    await saveLocalImageThumbnail({
      id: "asset-1",
      blob: new Blob(["small"], { type: "image/webp" }),
      width: 160,
      height: 90,
      createdAt: "2026-08-12T00:00:00.000Z",
    });
    const job: LocalImageUploadJob = {
      id: "asset-1",
      assetId: "asset-1",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "media-1",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    };
    await putLocalImageUploadJob(job);

    await expect(getLocalImage("asset-1")).resolves.toEqual(
      expect.objectContaining({ id: "asset-1", workspaceId: "church-1" }),
    );
    await expect(getLocalImageThumbnail("asset-1")).resolves.toEqual(
      expect.objectContaining({ id: "asset-1", width: 160, height: 90 }),
    );
    await expect(getLocalImageUploadJob("asset-1")).resolves.toEqual(job);
    await expect(listLocalImageUploadJobs("church-1")).resolves.toEqual([job]);

    await deleteLocalImageUploadJob("asset-1");
    await expect(getLocalImageUploadJob("asset-1")).resolves.toBeUndefined();
    await expect(getLocalImage("asset-1")).resolves.toBeDefined();
  });

  it("allows only one controller tab to claim an upload job", async () => {
    const job: LocalImageUploadJob = {
      id: "claimed-asset",
      assetId: "claimed-asset",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "media-1",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await putLocalImageUploadJob(job);

    const claims = await Promise.all([
      claimLocalImageUploadJob({
        assetId: job.assetId,
        leaseOwnerId: "tab-1",
        now: 10_000,
        leaseDurationMs: 5_000,
      }),
      claimLocalImageUploadJob({
        assetId: job.assetId,
        leaseOwnerId: "tab-2",
        now: 10_000,
        leaseDurationMs: 5_000,
      }),
    ]);

    const winners = claims.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.leaseOwnerId).toBeDefined();
    const winningOwner = winners[0]?.leaseOwnerId ?? "";
    const losingOwner = winningOwner === "tab-1" ? "tab-2" : "tab-1";
    await expect(
      renewLocalImageUploadJobLease({
        assetId: job.assetId,
        leaseOwnerId: losingOwner,
        now: 11_000,
        leaseDurationMs: 5_000,
      }),
    ).resolves.toBe(false);
    await expect(
      renewLocalImageUploadJobLease({
        assetId: job.assetId,
        leaseOwnerId: winningOwner,
        now: 11_000,
        leaseDurationMs: 5_000,
      }),
    ).resolves.toBe(true);
    await expect(
      releaseLocalImageUploadJobLease(job.assetId, winningOwner),
    ).resolves.toBe(true);
    await expect(
      claimLocalImageUploadJob({
        assetId: job.assetId,
        leaseOwnerId: losingOwner,
        now: 11_001,
        leaseDurationMs: 5_000,
      }),
    ).resolves.toEqual(expect.objectContaining({ leaseOwnerId: losingOwner }));
  });

  it("does not overwrite an active lease when the same asset is enqueued again", async () => {
    const leased: LocalImageUploadJob = {
      id: "leased-enqueue",
      assetId: "leased-enqueue",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "media-existing",
      status: "uploading",
      attemptCount: 1,
      nextAttemptAt: 0,
      leaseOwnerId: "tab-1",
      leaseExpiresAt: 20_000,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await putLocalImageUploadJob(leased);

    await expect(
      enqueueLocalImageUploadJobAtomically(
        {
          ...leased,
          itemId: "item-2",
          mediaId: "media-new",
          status: "pending",
          attemptCount: 0,
          leaseOwnerId: undefined,
          leaseExpiresAt: undefined,
        },
        10_000,
      ),
    ).resolves.toEqual(leased);
    await expect(getLocalImageUploadJob(leased.assetId)).resolves.toEqual(
      leased,
    );
  });

  it("preserves uploaded cloud media across enqueue and retry", async () => {
    const uploaded: LocalImageUploadJob = {
      id: "uploaded-enqueue",
      assetId: "uploaded-enqueue",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "media-existing",
      status: "uploaded",
      attemptCount: 1,
      nextAttemptAt: 50_000,
      cloudMedia: {
        id: "media-existing",
        type: "image",
        background: "https://res.cloudinary.com/example/image.png",
      } as LocalImageUploadJob["cloudMedia"],
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await putLocalImageUploadJob(uploaded);

    const enqueued = await enqueueLocalImageUploadJobAtomically(
      {
        ...uploaded,
        itemId: "item-2",
        mediaId: "media-new",
        status: "pending",
        attemptCount: 0,
        cloudMedia: undefined,
      },
      10_000,
    );
    const retried = await retryLocalImageUploadJobAtomically(
      uploaded.assetId,
      11_000,
    );

    expect(enqueued).toEqual(
      expect.objectContaining({
        itemId: "item-2",
        mediaId: "media-existing",
        status: "uploaded",
        cloudMedia: uploaded.cloudMedia,
      }),
    );
    expect(retried).toEqual(
      expect.objectContaining({
        status: "uploaded",
        cloudMedia: uploaded.cloudMedia,
      }),
    );
  });

  it("updates status without rolling back the latest owned lease", async () => {
    const job: LocalImageUploadJob = {
      id: "lease-status",
      assetId: "lease-status",
      itemId: "item-1",
      workspaceId: "church-1",
      uploadPreset: "preset",
      mediaId: "media-1",
      status: "uploading",
      attemptCount: 1,
      nextAttemptAt: 0,
      leaseOwnerId: "tab-1",
      leaseExpiresAt: 15_000,
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await putLocalImageUploadJob(job);
    await renewLocalImageUploadJobLease({
      assetId: job.assetId,
      leaseOwnerId: "tab-1",
      now: 12_000,
      leaseDurationMs: 10_000,
    });

    await expect(
      updateLeasedLocalImageUploadJob({
        assetId: job.assetId,
        leaseOwnerId: "tab-1",
        patch: { status: "uploaded" },
        now: 13_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "uploaded",
        leaseOwnerId: "tab-1",
        leaseExpiresAt: 23_000,
      }),
    );
    await expect(
      updateLeasedLocalImageUploadJob({
        assetId: job.assetId,
        leaseOwnerId: "tab-2",
        patch: { status: "failed" },
        now: 14_000,
        leaseDurationMs: 10_000,
      }),
    ).resolves.toBeUndefined();
    await expect(getLocalImageUploadJob(job.assetId)).resolves.toEqual(
      expect.objectContaining({ status: "uploaded", leaseExpiresAt: 23_000 }),
    );
  });

  it("sweeps only old unreferenced assets in the active workspace", async () => {
    await saveLocalImage(storedImage("referenced"));
    await saveLocalImage(storedImage("orphaned"));
    await saveLocalImageThumbnail({
      id: "orphaned",
      blob: new Blob(["small"], { type: "image/webp" }),
      width: 160,
      height: 90,
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const db = {
      allDocs: jest.fn().mockResolvedValue({
        rows: [{ doc: itemWithAsset("item-1", "referenced") }],
      }),
    } as unknown as PouchDB.Database;

    await expect(
      cleanupOrphanedLocalImages({ db, workspaceId: "church-1" }),
    ).resolves.toBe(1);
    await expect(getLocalImage("referenced")).resolves.toBeDefined();
    await expect(getLocalImage("orphaned")).resolves.toBeUndefined();
    await expect(getLocalImageThumbnail("orphaned")).resolves.toBeUndefined();
  });

  it("keeps shared bytes when deleting one referencing item", async () => {
    await saveLocalImage(storedImage("shared"));
    await saveLocalImage(storedImage("only-deleted"));
    const deleted = itemWithAsset("deleted", "only-deleted");
    deleted.slides.push(itemWithAsset("deleted-2", "shared").slides[0]);
    const db = {
      allDocs: jest.fn().mockResolvedValue({
        rows: [{ doc: itemWithAsset("remaining", "shared") }],
      }),
    } as unknown as PouchDB.Database;
    const beforeDelete = jest.fn().mockResolvedValue(undefined);

    await expect(
      cleanupLocalImagesForDeletedItem({ db, item: deleted, beforeDelete }),
    ).resolves.toBe(1);
    expect(beforeDelete).toHaveBeenCalledTimes(1);
    expect(beforeDelete).toHaveBeenCalledWith("only-deleted");
    await expect(getLocalImage("shared")).resolves.toBeDefined();
    await expect(getLocalImage("only-deleted")).resolves.toBeUndefined();
  });
});
