import mediaImageFormats from "../shared/mediaImageFormats.json" with { type: "json" };
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

test("cancels only a church-owned Mux upload and returns an asset created during the race", async () => {
  let cancelled = 0;
  let upload = {
    id: "upload-1",
    status: "waiting",
    new_asset_settings: { meta: { creator_id: "church-a", external_id: "media-1" } },
  };
  const service = createProviderStorageService({
    storageQuota: createQuota(),
    getMuxClient: () => ({ video: { uploads: {
      retrieve: async () => upload,
      cancel: async () => {
        cancelled += 1;
        upload = { ...upload, status: "asset_created", asset_id: "asset-1" };
      },
    } } }),
  });
  const result = await service.cancelMuxUpload({ churchId: "church-a", uploadId: "upload-1" });
  assert.deepEqual(result, { cancelled: false, assetId: "asset-1" });
  assert.equal(cancelled, 1);
  await assert.rejects(
    service.cancelMuxUpload({ churchId: "church-b", uploadId: "upload-1" }),
    (error) => error.statusCode === 403,
  );
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

const createCloudinaryCommitService = (asset) =>
  createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async () => asset },
      uploader: { add_context: async () => {} },
    },
    storageQuota: createQuota(),
  });

test("Cloudinary commit accepts legacy public ID and folder ownership metadata", async () => {
  const service = createCloudinaryCommitService({
    public_id: "worship-sync/churches/church-1/media/image-1",
    folder: "worship-sync/churches/church-1/media",
    bytes: 123,
  });
  const result = await service.commitCloudinaryImage({
    churchId: "church-1",
    publicId: "worship-sync/churches/church-1/media/image-1",
  });
  assert.equal(result.churchId, "church-1");
});

test("Cloudinary commit accepts dynamic-folder asset_folder ownership metadata", async () => {
  const service = createCloudinaryCommitService({
    public_id: "image-1",
    asset_folder: "worship-sync/churches/church-1/media",
    bytes: 123,
  });
  const result = await service.commitCloudinaryImage({
    churchId: "church-1",
    publicId: "image-1",
  });
  assert.equal(result.churchId, "church-1");
});

test("Cloudinary ownership rejects another or similarly named church folder", async () => {
  for (const asset of [
    {
      public_id: "image-1",
      asset_folder: "worship-sync/churches/church-2/media",
      bytes: 123,
    },
    {
      public_id: "worship-sync/churches/church-10/media/image-1",
      folder: "worship-sync/churches/church-10/media",
      bytes: 123,
    },
  ]) {
    const service = createCloudinaryCommitService(asset);
    await assert.rejects(
      service.commitCloudinaryImage({ churchId: "church-1", publicId: "image-1" }),
      (error) => error.statusCode === 403,
    );
  }
});

for (const folderMode of ["dynamic", "fixed"]) {
  test(`Cloudinary ${folderMode} upload intent signs only server-owned fields`, async () => {
    let signedParams;
    let signedSecret;
    let recorded;
    let configCalls = 0;
    const service = createProviderStorageService({
      cloudinaryApiSecret: "server-secret",
      cloudinaryClient: {
        config: () => ({ api_key: "public-key" }),
        api: { config: async (options) => {
          configCalls += 1;
          assert.deepEqual(options, { settings: true });
          return { settings: { folder_mode: folderMode } };
        } },
        utils: { api_sign_request: (params, secret) => {
          signedParams = params;
          signedSecret = secret;
          return "server-signature";
        } },
      },
      storageQuota: createQuota({ recordUpload: async (value) => { recorded = value; } }),
    });
    const intent = await service.createCloudinaryImageUpload({
      churchId: "church-1",
      mediaId: "media-1",
    });
    const folder = "worship-sync/churches/church-1/media";
    const expected = folderMode === "dynamic"
      ? intent.fields.public_id
      : `${folder}/${intent.fields.public_id}`;
    assert.match(intent.uploadId, /^[0-9a-f-]{36}$/i);
    assert.equal(intent.publicId, expected);
    assert.equal(intent.uploadUrl, "https://api.cloudinary.com/v1_1/portable-media/image/upload");
    assert.equal(signedSecret, "server-secret");
    assert.deepEqual(signedParams, {
      timestamp: Number(intent.fields.timestamp),
      public_id: intent.fields.public_id,
      overwrite: false,
      allowed_formats: "avif,bmp,gif,heic,jpg,jxl,png,svg,tiff,webp,ico",
      ...(folderMode === "dynamic" ? { asset_folder: folder } : { folder }),
    });
    assert.equal(intent.fields.allowed_formats, signedParams.allowed_formats);
    assert.ok(signedParams.allowed_formats.split(",").includes("avif"));
    for (const { cloudinaryFormat } of mediaImageFormats) {
      assert.ok(signedParams.allowed_formats.split(",").includes(cloudinaryFormat));
    }
    for (const unsupported of ["pdf", "psd", "ai", "glb"]) {
      assert.equal(signedParams.allowed_formats.split(",").includes(unsupported), false);
    }
    assert.equal("api_secret" in intent.fields, false);
    assert.equal(intent.fields.api_key, "public-key");
    assert.equal("upload_preset" in intent.fields, false);
    assert.equal("folder" in intent.fields, folderMode === "fixed");
    assert.equal("asset_folder" in intent.fields, folderMode === "dynamic");
    assert.deepEqual(recorded, {
      churchId: "church-1",
      provider: "cloudinary",
      uploadId: intent.uploadId,
      mediaId: "media-1",
      assetId: intent.publicId,
      folderMode,
      status: "waiting",
    });
    await service.createCloudinaryImageUpload({ churchId: "church-1", mediaId: "media-2" });
    assert.equal(configCalls, 1);
  });
}

test("Cloudinary signed intent rejects unavailable folder configuration", async () => {
  let recorded = false;
  const service = createProviderStorageService({
    cloudinaryApiSecret: "server-secret",
    cloudinaryClient: {
      config: () => ({ api_key: "public-key" }),
      api: { config: async () => ({ settings: {} }) },
      utils: { api_sign_request: () => "signature" },
    },
    storageQuota: {
      ...createQuota({ recordUpload: async () => { recorded = true; } }),
      assertProviderUsageReady: async () => {},
    },
  });
  await assert.rejects(
    service.createCloudinaryImageUpload({ churchId: "church-1", mediaId: "media-1" }),
    (error) => error.code === "CLOUDINARY_CONFIGURATION_UNAVAILABLE" && error.statusCode === 503,
  );
  assert.equal(recorded, false);
});

test("Cloudinary signed intent checks provider usage readiness before reading provider configuration", async () => {
  let configCalls = 0;
  let recorded = false;
  const service = createProviderStorageService({
    cloudinaryApiSecret: "server-secret",
    cloudinaryClient: {
      config: () => ({ api_key: "public-key" }),
      api: { config: async () => { configCalls += 1; return { settings: { folder_mode: "dynamic" } }; } },
      utils: { api_sign_request: () => "signature" },
    },
    storageQuota: {
      ...createQuota({ recordUpload: async () => { recorded = true; } }),
      assertProviderUsageReady: async () => {
        const error = new Error("Provider storage usage must be reconciled first.");
        error.statusCode = 503;
        error.code = "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED";
        throw error;
      },
    },
  });
  await assert.rejects(
    service.createCloudinaryImageUpload({ churchId: "church-1", mediaId: "media-1" }),
    (error) => error.code === "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED",
  );
  assert.equal(configCalls, 0);
  assert.equal(recorded, false);
});

test("signed Cloudinary commit requires the recorded church and exact intended public ID", async () => {
  let resourceCalls = 0;
  const service = createProviderStorageService({
    cloudinaryClient: { api: { resource: async () => { resourceCalls += 1; } } },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({
        churchId: "church-1", assetId: "image-1", folderMode: "dynamic", status: "waiting",
      }),
      transitionProviderUpload: async ({ status }) => ({
        upload: { churchId: "church-1", assetId: "image-1", status }, transitioned: true,
      }),
    },
  });
  await assert.rejects(
    service.commitCloudinaryImage({ churchId: "church-2", uploadId: "upload-1", publicId: "image-1" }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    service.commitCloudinaryImage({ churchId: "church-1", uploadId: "upload-1", publicId: "other-image" }),
    (error) => error.statusCode === 403,
  );
  assert.equal(resourceCalls, 0);
});

test("Cloudinary commit stops when cancellation wins the atomic claim", async () => {
  let providerCalls = 0;
  const service = createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async () => { providerCalls += 1; } },
      uploader: { add_context: async () => { providerCalls += 1; } },
    },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({
        churchId: "church-1", assetId: "image-1", folderMode: "dynamic", status: "waiting",
      }),
      transitionProviderUpload: async () => ({
        upload: { churchId: "church-1", assetId: "image-1", status: "cancelling" },
        transitioned: false,
      }),
    },
  });

  await assert.rejects(
    service.commitCloudinaryImage({ churchId: "church-1", uploadId: "upload-1", publicId: "image-1" }),
    (error) => error.statusCode === 409 && error.code === "CLOUDINARY_UPLOAD_NOT_COMMITTABLE",
  );
  assert.equal(providerCalls, 0);
});

test("signed Cloudinary commit treats misplaced provider results as integration errors", async () => {
  const service = createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async () => ({
        public_id: "image-1", asset_folder: "branding/church-1", bytes: 123,
      }) },
      uploader: { add_context: async () => {} },
    },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({
        churchId: "church-1", assetId: "image-1", folderMode: "dynamic", status: "waiting",
      }),
      transitionProviderUpload: async ({ status }) => ({
        upload: { churchId: "church-1", assetId: "image-1", status }, transitioned: true,
      }),
    },
  });
  await assert.rejects(
    service.commitCloudinaryImage({ churchId: "church-1", uploadId: "upload-1", publicId: "image-1" }),
    (error) => error.code === "CLOUDINARY_MEDIA_FOLDER_MISMATCH" && error.statusCode >= 500,
  );
});

test("signed Cloudinary commit validates the fixed-folder final public ID", async () => {
  const expectedPublicId = "worship-sync/churches/church-1/media/worship-sync-image-1";
  const service = createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async () => ({
        public_id: expectedPublicId,
        folder: "worship-sync/churches/church-1/media",
        bytes: 123,
      }) },
      uploader: { add_context: async () => {} },
    },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({
        churchId: "church-1", assetId: expectedPublicId, folderMode: "fixed", status: "waiting",
      }),
      transitionProviderUpload: async ({ status }) => ({
        upload: { churchId: "church-1", assetId: expectedPublicId, status }, transitioned: true,
      }),
    },
  });
  const result = await service.commitCloudinaryImage({
    churchId: "church-1", uploadId: "intent-1", publicId: expectedPublicId,
  });
  assert.equal(result.publicId, expectedPublicId);
});

test("signed Media commits reject Canva, profile, branding, and temporary-conversion assets", async () => {
  for (const assetFolder of [
    "worship-sync/canva/church-1",
    "member-profiles/church-1",
    "branding/church-1",
    "temporary-conversions/church-1",
  ]) {
    const service = createProviderStorageService({
      cloudinaryClient: {
        api: { resource: async () => ({ public_id: "image-1", asset_folder: assetFolder, bytes: 123 }) },
        uploader: { add_context: async () => {} },
      },
      storageQuota: {
        ...createQuota(),
        getProviderUpload: async () => ({ churchId: "church-1", assetId: "image-1", folderMode: "dynamic", status: "waiting" }),
        transitionProviderUpload: async ({ status }) => ({
          upload: { churchId: "church-1", assetId: "image-1", status }, transitioned: true,
        }),
      },
    });
    await assert.rejects(
      service.commitCloudinaryImage({ churchId: "church-1", uploadId: "intent-1", publicId: "image-1" }),
      (error) => error.code === "CLOUDINARY_MEDIA_FOLDER_MISMATCH",
    );
  }
});

test("signed Cloudinary commit rejects an unknown intent", async () => {
  const service = createProviderStorageService({
    storageQuota: { ...createQuota(), getProviderUpload: async () => null },
  });
  await assert.rejects(
    service.commitCloudinaryImage({ churchId: "church-1", uploadId: "unknown", publicId: "image-1" }),
    (error) => error.statusCode === 404 && error.code === "CLOUDINARY_UPLOAD_NOT_FOUND",
  );
});

test("Cloudinary cancellation destroys only the exact uncommitted intent asset", async () => {
  let destroyed = [];
  let ledgerStatus = "waiting";
  const service = createProviderStorageService({
    cloudinaryClient: {
      api: { resource: async (publicId) => ({ public_id: publicId, bytes: 100 }) },
      uploader: { destroy: async (publicId) => {
        destroyed.push(publicId);
        return { result: "ok" };
      } },
    },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({ churchId: "church-1", assetId: "image-1", status: ledgerStatus }),
      transitionProviderUpload: async ({ status }) => {
        ledgerStatus = status;
        return { upload: { churchId: "church-1", assetId: "image-1", status }, transitioned: true };
      },
    },
  });
  await assert.rejects(
    service.cancelCloudinaryUpload({ churchId: "church-2", uploadId: "upload-1" }),
    (error) => error.statusCode === 403,
  );
  assert.deepEqual(destroyed, []);
  const result = await service.cancelCloudinaryUpload({ churchId: "church-1", uploadId: "upload-1" });
  assert.deepEqual(result, { cancelled: true });
  assert.deepEqual(destroyed, ["image-1"]);
});

test("Cloudinary cancellation never deletes an already committed intent", async () => {
  let destroyed = 0;
  const service = createProviderStorageService({
    cloudinaryClient: { uploader: { destroy: async () => { destroyed += 1; } } },
    storageQuota: {
      ...createQuota(),
      getProviderUpload: async () => ({ churchId: "church-1", assetId: "image-1", status: "committed" }),
    },
  });
  assert.deepEqual(
    await service.cancelCloudinaryUpload({ churchId: "church-1", uploadId: "intent-1" }),
    { cancelled: false, committed: true },
  );
  assert.equal(destroyed, 0);
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
