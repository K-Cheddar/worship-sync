import assert from "node:assert/strict";
import test from "node:test";
import { ChurchStorageQuotaError } from "./churchStorageQuota.js";
import { createProviderStorageService } from "./providerStorageService.js";

const createQuota = ({ owner = null, record = async () => {}, remove = async () => {}, recordUpload = async () => {} } = {}) => ({
  assertProviderUsageReady: async () => {},
  getProviderAssetOwner: async () => owner,
  recordProviderAsset: record,
  removeProviderAsset: remove,
  recordProviderUpload: recordUpload,
});

test("normal Mux uploads carry church ownership and media identity metadata", async () => {
  let settings;
  let tracked;
  const service = createProviderStorageService({
    storageQuota: createQuota({ recordUpload: async (value) => { tracked = value; } }),
    getMuxClient: () => ({
      video: { uploads: { create: async (value) => { settings = value; return { id: "upload-1", url: "https://upload" }; } } },
    }),
  });
  await service.createMuxUpload({ churchId: "church-a", mediaId: "media-1", title: "Service opener" });
  assert.equal(settings.new_asset_settings.meta.creator_id, "church-a");
  assert.equal(settings.new_asset_settings.meta.external_id, "media-1");
  assert.equal(settings.new_asset_settings.meta.title, "Service opener");
  assert.deepEqual(tracked, {
    churchId: "church-a",
    provider: "mux",
    uploadId: "upload-1",
    mediaId: "media-1",
    temporary: false,
    status: "waiting",
    assetId: undefined,
  });
});

test("unreconciled churches are rejected before a permanent Mux upload is created", async () => {
  let created = false;
  const service = createProviderStorageService({
    storageQuota: {
      ...createQuota(),
      assertProviderUsageReady: async () => {
        const error = new Error("Provider storage usage must be reconciled first.");
        error.statusCode = 503;
        error.code = "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED";
        throw error;
      },
    },
    getMuxClient: () => ({
      video: { uploads: { create: async () => { created = true; } } },
    }),
  });
  await assert.rejects(
    service.createMuxUpload({ churchId: "church-a", mediaId: "media-1" }),
    (error) => error.code === "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED",
  );
  assert.equal(created, false);
});

test("temporary Mux conversion uploads are identifiable and excluded from permanent quota", async () => {
  let settings;
  let records = 0;
  const service = createProviderStorageService({
    storageQuota: createQuota({ record: async () => { records += 1; } }),
    getMuxClient: () => ({
      video: {
        uploads: { create: async (value) => { settings = value; return { id: "upload-temp", url: "https://upload" }; } },
        assets: { retrieve: async () => ({
          id: "asset-temp", status: "ready", duration: 80,
          meta: { creator_id: "church-a", external_id: "temporary:task" },
        }) },
      },
    }),
  });
  await service.createMuxUpload({ churchId: "church-a", temporary: true });
  assert.match(settings.new_asset_settings.meta.external_id, /^temporary:/);
  const asset = await service.getMuxAsset({ churchId: "church-a", assetId: "asset-temp" });
  assert.equal(asset.temporary, true);
  assert.equal(records, 0);
});

test("Mux quota denial removes a newly processed asset", async () => {
  let deleted = 0;
  const quotaError = new ChurchStorageQuotaError("muxMinutes", 400);
  const service = createProviderStorageService({
    storageQuota: createQuota({ record: async () => { throw quotaError; } }),
    getMuxClient: () => ({
      video: { assets: {
        retrieve: async () => ({ id: "asset-1", status: "ready", duration: 60, meta: { creator_id: "church-a" } }),
        delete: async () => { deleted += 1; },
      } },
    }),
  });
  await assert.rejects(service.getMuxAsset({ churchId: "church-a", assetId: "asset-1" }), quotaError);
  assert.equal(deleted, 1);
});

test("Cloudinary permanent commit uses actual bytes and quota denial destroys the new image", async () => {
  let destroyed = 0;
  let recorded;
  const cloudinaryClient = {
    api: { resource: async () => ({ public_id: "worship-sync/churches/church-a/media/image-1", asset_id: "asset-1", bytes: 1234 }) },
    uploader: {
      add_context: async () => {},
      destroy: async () => { destroyed += 1; return { result: "ok" }; },
    },
  };
  const service = createProviderStorageService({
    cloudinaryClient,
    storageQuota: createQuota({ record: async (value) => { recorded = value; throw new ChurchStorageQuotaError("cloudinaryBytes", 500 * 1024 ** 2); } }),
  });
  await assert.rejects(service.commitCloudinaryImage({ churchId: "church-a", publicId: "worship-sync/churches/church-a/media/image-1" }));
  assert.equal(recorded.amount, 1234);
  assert.equal(destroyed, 1);
});

test("provider deletion failure does not release quota", async () => {
  let removed = 0;
  const service = createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async () => ({ public_id: "worship-sync/canva/church-a/design-1", bytes: 200 }) },
      uploader: { destroy: async () => ({ result: "error" }) },
    },
    storageQuota: createQuota({
      owner: { churchId: "church-a" },
      remove: async () => { removed += 1; },
    }),
  });
  await assert.rejects(service.deleteCloudinaryImage({ churchId: "church-a", publicId: "worship-sync/canva/church-a/design-1" }));
  assert.equal(removed, 0);
});

test("Mux usage is released only after provider deletion succeeds", async () => {
  let removed = 0;
  let failDelete = true;
  const service = createProviderStorageService({
    getMuxClient: () => ({
      video: { assets: {
        retrieve: async () => ({ id: "mux-asset", meta: { creator_id: "church-a" } }),
        delete: async () => {
          if (failDelete) throw new Error("Mux unavailable");
        },
      } },
    }),
    storageQuota: createQuota({
      owner: { churchId: "church-a" },
      remove: async () => { removed += 1; },
    }),
  });
  await assert.rejects(service.deleteMuxAsset({ churchId: "church-a", assetId: "mux-asset" }));
  assert.equal(removed, 0);
  failDelete = false;
  await service.deleteMuxAsset({ churchId: "church-a", assetId: "mux-asset" });
  assert.equal(removed, 1);
});
