import assert from "node:assert/strict";
import test from "node:test";
import {
  CHURCH_STORAGE_QUOTA_DEFAULTS,
  CHURCH_STORAGE_QUOTA_RESERVATION_RETENTION_MS,
  ChurchStorageQuotaError,
  createChurchStorageQuotaService,
  getCloudinaryAssetBytes,
  getMuxStoredMinutes,
  normalizeChurchStorageQuotas,
  sumR2ChurchMetadataUsage,
} from "./churchStorageQuota.js";

class MemoryFirestore {
  collections = new Map();
  queryReads = [];
  transactionQueue = Promise.resolve();

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const docs = this.collections.get(name);
    const makeRef = (id) => ({
      id,
      get: async () => snapshot(docs, id),
      _docs: docs,
    });
    return {
      doc: (id) => makeRef(id),
      where: (field, operator, value) => ({
        _query: true,
        docs,
        filters: [[field, operator, value]],
        where(nextField, nextOperator, nextValue) {
          return { ...this, filters: [...this.filters, [nextField, nextOperator, nextValue]] };
        },
      }),
      _docs: docs,
    };
  }

  runTransaction(callback) {
    const execute = async () => callback({
      get: async (ref) => {
        if (ref._query) {
          this.queryReads.push(ref.filters);
          return {
            docs: [...ref.docs.entries()]
              .filter(([, data]) => ref.filters.every(([field, operator, value]) => {
                if (operator === "==") return data[field] === value;
                if (operator === "<=") return data[field] <= value;
                return false;
              }))
              .map(([id]) => ({ id, ref: { id, _docs: ref.docs }, data: () => ref.docs.get(id) })),
          };
        }
        return snapshot(ref._docs, ref.id);
      },
      set: (ref, value, options = {}) => {
        const current = ref._docs.get(ref.id) || {};
        ref._docs.set(ref.id, options.merge ? { ...current, ...value } : { ...value });
      },
      delete: (ref) => ref._docs.delete(ref.id),
    });
    const result = this.transactionQueue.then(execute);
    this.transactionQueue = result.catch(() => {});
    return result;
  }
}

const snapshot = (docs, id) => ({
  exists: docs.has(id),
  data: () => docs.get(id),
});

const createQuota = ({
  limits = { r2Bytes: 10, cloudinaryBytes: 10, muxMinutes: 10 },
  church = { storageQuotas: limits },
  initialUsage = 0,
  providerQuotaEnforcementEnabled = () => true,
} = {}) => {
  const firestore = new MemoryFirestore();
  let currentTime = 1_000;
  const service = createChurchStorageQuotaService({
    getFirestore: () => firestore,
    getChurch: async () => church,
    loadR2Usage: async () => initialUsage,
    providerQuotaEnforcementEnabled,
    now: () => currentTime,
    reservationTtlMs: 100,
  });
  return { firestore, service, advanceTime: (milliseconds) => { currentTime += milliseconds; } };
};

test("central quota defaults stay separate and church overrides apply", async () => {
  assert.deepEqual(CHURCH_STORAGE_QUOTA_DEFAULTS, {
    r2Bytes: 2 * 1024 ** 3,
    cloudinaryBytes: 500 * 1024 ** 2,
    muxMinutes: 1_000,
  });
  assert.deepEqual(normalizeChurchStorageQuotas({ r2Bytes: 7 }), {
    r2Bytes: 7,
    cloudinaryBytes: 500 * 1024 ** 2,
    muxMinutes: 1_000,
  });
  assert.deepEqual(normalizeChurchStorageQuotas({ muxMinutes: 2_000 }), {
    r2Bytes: 2 * 1024 ** 3,
    cloudinaryBytes: 500 * 1024 ** 2,
    muxMinutes: 2_000,
  });
  const { service } = createQuota({ limits: { r2Bytes: 7, cloudinaryBytes: 6, muxMinutes: 5 } });
  await service.reserve({ churchId: "church-a", amount: 7, operationId: "at-limit" });
  await assert.rejects(
    service.reserve({ churchId: "church-a", amount: 1, operationId: "over-limit" }),
    (error) =>
      error instanceof ChurchStorageQuotaError &&
      error.provider === "r2Bytes" &&
      /7 bytes file storage limit/.test(error.message),
  );
  await service.reserve({ churchId: "church-b", amount: 7, operationId: "separate-church" });
});

test("normal churches resolve current defaults even when a quota ledger has stale cached limits", async () => {
  const { service, firestore } = createQuota({ church: {} });
  firestore.collection("churchStorageQuotas")._docs.set("normal-church", {
    r2Initialized: true,
    limits: {
      r2Bytes: 1024 ** 3,
      cloudinaryBytes: 500 * 1024 ** 2,
      muxMinutes: 400,
    },
  });

  assert.deepEqual(await service.getUsage("normal-church"), {
    r2: { used: 0, limit: 2 * 1024 ** 3, unit: "bytes" },
    cloudinary: { used: 0, limit: 500 * 1024 ** 2, unit: "bytes" },
    mux: { used: 0, limit: 1_000, unit: "minutes" },
  });
});

test("partial church overrides inherit all unspecified current defaults", async () => {
  const eliathah = createQuota({ church: { storageQuotas: { muxMinutes: 2_000 } } });
  assert.deepEqual(await eliathah.service.getUsage("eliathah"), {
    r2: { used: 0, limit: 2 * 1024 ** 3, unit: "bytes" },
    cloudinary: { used: 0, limit: 500 * 1024 ** 2, unit: "bytes" },
    mux: { used: 0, limit: 2_000, unit: "minutes" },
  });

  const demo = createQuota({ church: { storageQuotas: { r2Bytes: 500 * 1024 ** 2 } } });
  assert.deepEqual(await demo.service.getUsage("demo"), {
    r2: { used: 0, limit: 500 * 1024 ** 2, unit: "bytes" },
    cloudinary: { used: 0, limit: 500 * 1024 ** 2, unit: "bytes" },
    mux: { used: 0, limit: 1_000, unit: "minutes" },
  });
});

test("lowering a quota preserves recorded provider usage and rejects new permanent storage", async () => {
  const church = { storageQuotas: { cloudinaryBytes: 100 } };
  const { service } = createQuota({
    church,
    limits: { r2Bytes: 10, cloudinaryBytes: 100, muxMinutes: 10 },
  });
  await service.markProviderUsageReady({ churchId: "church-a" });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "existing-image", amount: 80,
  });

  church.storageQuotas.cloudinaryBytes = 50;
  assert.deepEqual(await service.getUsage("church-a"), {
    r2: { used: 0, limit: 2 * 1024 ** 3, unit: "bytes" },
    cloudinary: { used: 80, limit: 50, unit: "bytes" },
    mux: { used: 0, limit: 1_000, unit: "minutes" },
  });
  await assert.rejects(
    service.recordProviderAsset({
      churchId: "church-a", provider: "cloudinaryBytes", assetId: "new-image", amount: 1,
    }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );
  assert.equal((await service.getUsage("church-a")).cloudinary.used, 80);
});

test("concurrent R2 admissions cannot both exceed the church limit", async () => {
  const { service } = createQuota();
  const results = await Promise.allSettled([
    service.reserve({ churchId: "church-a", amount: 7, operationId: "upload-a" }),
    service.reserve({ churchId: "church-a", amount: 7, operationId: "upload-b" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("concurrent replacements cannot both subtract the same song attachment", async () => {
  const { service } = createQuota();
  await service.reserve({
    churchId: "church-a", amount: 8, operationId: "first-replacement", lockId: "song:song-a",
  });
  await assert.rejects(
    service.reserve({
      churchId: "church-a", amount: 6, replaceAmount: 8,
      operationId: "second-replacement", lockId: "song:song-a",
    }),
    (error) => error.code === "CHURCH_STORAGE_MUTATION_IN_PROGRESS",
  );
});

test("song replacement reserves and commits only its size delta", async () => {
  const { service } = createQuota();
  const first = await service.reserve({ churchId: "church-a", amount: 8, operationId: "song-upload:first" });
  await service.commitR2({ churchId: "church-a", reservationId: first.id, assetId: "song-audio:audio-old", actualAmount: 8 });
  const replacement = await service.reserve({
    churchId: "church-a", amount: 6, replaceAmount: 8, operationId: "song-upload:replacement",
  });
  await service.commitR2({
    churchId: "church-a", reservationId: replacement.id, assetId: "song-audio:audio-new",
    previousAssetId: "song-audio:audio-old", actualAmount: 6, fallbackPreviousAmount: 8,
  });
  assert.equal((await service.getUsage("church-a")).r2.used, 6);
  await service.releaseR2({
    churchId: "church-a", reservationId: "delete:old-audio", assetId: "song-audio:audio-old",
    fallbackPreviousAmount: 8,
  });
  assert.equal((await service.getUsage("church-a")).r2.used, 6);
  await service.releaseR2({
    churchId: "church-a", reservationId: "delete:new-audio", assetId: "song-audio:audio-new",
    fallbackPreviousAmount: 6,
  });
  assert.equal((await service.getUsage("church-a")).r2.used, 0);
});

test("a committed song replacement can be retried with the same reservation", async () => {
  const { service } = createQuota();
  const reservation = await service.reserve({ churchId: "church-a", amount: 4, operationId: "same-upload" });
  const commit = {
    churchId: "church-a", reservationId: reservation.id, assetId: "song-audio:audio-1", actualAmount: 4,
  };
  await service.commitR2(commit);
  await service.reserve({ churchId: "church-a", amount: 4, operationId: "same-upload" });
  await service.commitR2(commit);
  assert.equal((await service.getUsage("church-a")).r2.used, 4);
});

test("deleting an asset releases R2 usage once", async () => {
  const { service } = createQuota();
  const reservation = await service.reserve({ churchId: "church-a", amount: 4, operationId: "resource:file-a" });
  await service.commitR2({ churchId: "church-a", reservationId: reservation.id, assetId: "resource:file-a", actualAmount: 4 });
  const deletion = {
    churchId: "church-a", reservationId: "delete:file-a", assetId: "resource:file-a", fallbackPreviousAmount: 4,
  };
  await service.releaseR2(deletion);
  await service.releaseR2(deletion);
  assert.equal((await service.getUsage("church-a")).r2.used, 0);
});

test("cancelled and expired pending uploads stop reserving quota", async () => {
  const { service, advanceTime } = createQuota();
  const cancelled = await service.reserve({ churchId: "church-a", amount: 7, operationId: "failed-upload" });
  await service.cancel({ churchId: "church-a", reservationId: cancelled.id });
  await service.reserve({ churchId: "church-a", amount: 7, operationId: "next-upload" });
  advanceTime(101);
  await service.reserve({ churchId: "church-a", amount: 7, operationId: "after-expiry" });
});

test("reservation cleanup queries only expired pending rows for the church", async () => {
  const { service, firestore } = createQuota();
  const reservations = firestore.collection("churchStorageQuotaReservations")._docs;
  reservations.set("committed-history", {
    churchId: "church-a",
    provider: "r2Bytes",
    status: "committed",
    expiresAt: 0,
  });
  reservations.set("expired-pending", {
    churchId: "church-a",
    provider: "r2Bytes",
    status: "pending",
    delta: 2,
    expiresAt: 999,
  });

  await service.reserve({ churchId: "church-a", amount: 2, operationId: "next-upload" });

  assert.deepEqual(firestore.queryReads.at(-1), [
    ["churchId", "==", "church-a"],
    ["status", "==", "pending"],
    ["expiresAt", "<=", 1_000],
  ]);
  assert.equal(reservations.has("committed-history"), true);
  assert.equal(reservations.has("expired-pending"), false);
});

test("committed reservation records receive a bounded retention TTL", async () => {
  const { service, firestore } = createQuota();
  const reservation = await service.reserve({
    churchId: "church-a",
    amount: 2,
    operationId: "retained-upload",
  });
  await service.commitR2({
    churchId: "church-a",
    reservationId: reservation.id,
    assetId: "resource:retained",
    actualAmount: 2,
  });

  const committed = [...firestore.collection("churchStorageQuotaReservations")._docs.values()]
    .find((row) => row.status === "committed");
  assert.ok(committed);
  assert.equal(committed.ttlExpireAt.getTime(), 1_000 + CHURCH_STORAGE_QUOTA_RESERVATION_RETENTION_MS);
});

test("R2 reconciliation sums persisted resource and song metadata", async () => {
  const resources = [
    { storage: { sizeBytes: 5 } },
    { storage: { sizeBytes: 7 } },
  ];
  const songs = [{ songAudio: { sizeBytes: 11 } }, { songAudio: { sizeBytes: 13 } }];
  assert.equal(sumR2ChurchMetadataUsage({ resources, songs }), 36);
  const { service } = createQuota({ initialUsage: 36 });
  assert.equal((await service.reconcileR2Usage("church-a")).r2.used, 36);
});

test("R2 usage includes only unexpired chat images and their thumbnails", () => {
  const now = 1_000;
  assert.equal(sumR2ChurchMetadataUsage({
    resources: [{ storage: { sizeBytes: 100 } }],
    songs: [{ songAudio: { sizeBytes: 200 } }],
    now,
    chatMessages: [
      { attachment: { type: "image", sizeBytes: 10, thumbnailSizeBytes: 5, expiresAt: now + 1 } },
      { attachment: { type: "image", sizeBytes: 30, thumbnailSizeBytes: 10, expiresAt: now } },
      { attachment: { type: "image", sizeBytes: 40, thumbnailSizeBytes: 10 } },
      {
        deletedAt: new Date(now),
        attachmentCleanupPending: true,
        attachment: { type: "image", sizeBytes: 20, thumbnailSizeBytes: 5, expiresAt: now + 1 },
      },
      {
        deletedAt: new Date(now),
        attachmentCleanupPending: false,
        attachment: { type: "image", sizeBytes: 50, thumbnailSizeBytes: 5, expiresAt: now + 1 },
      },
    ],
  }), 340);
});

test("chat image full and thumbnail bytes reserve, commit, and release through the church ledger", async () => {
  const { service } = createQuota({
    limits: { r2Bytes: 100, cloudinaryBytes: 500, muxMinutes: 1_000 },
    initialUsage: 0,
  });
  await service.reserve({
    churchId: "church-a", provider: "r2Bytes", amount: 75, operationId: "chat-image:one",
  });
  await assert.rejects(
    service.reserve({
      churchId: "church-a", provider: "r2Bytes", amount: 30, operationId: "chat-image:two",
    }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );
  await service.commitR2({
    churchId: "church-a", reservationId: "chat-image:one", assetId: "chat-image:one", actualAmount: 75,
  });
  assert.equal((await service.getUsage("church-a")).r2.used, 75);
  assert.equal((await service.getUsage("church-b")).r2.used, 0);
  await service.releaseR2({
    churchId: "church-a", reservationId: "chat-image-remove:one", assetId: "chat-image:one",
  });
  await service.releaseR2({
    churchId: "church-a", reservationId: "chat-image-remove:one", assetId: "chat-image:one",
  });
  assert.equal((await service.getUsage("church-a")).r2.used, 0);
});

test("Cloudinary bytes and Mux stored duration accounting ignore temporary assets", async () => {
  assert.equal(getCloudinaryAssetBytes({ bytes: 1234 }), 1234);
  assert.equal(getCloudinaryAssetBytes({ byte_size: 4321 }), 4321);
  assert.equal(getMuxStoredMinutes({ duration: 90 }), 1.5);
  const { service } = createQuota({ limits: { r2Bytes: 10, cloudinaryBytes: 5, muxMinutes: 3 } });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "temporary-image", amount: 100, temporary: true,
  });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "muxMinutes", assetId: "temporary-video", amount: 8, temporary: true,
  });
  assert.deepEqual(await service.getUsage("church-a"), {
    r2: { used: 0, limit: 10, unit: "bytes" },
    cloudinary: { used: 0, limit: 5, unit: "bytes" },
    mux: { used: 0, limit: 3, unit: "minutes" },
  });
  await service.markProviderUsageReady({ churchId: "church-a" });
  await assert.rejects(
    service.recordProviderAsset({ churchId: "church-a", provider: "cloudinaryBytes", assetId: "image", amount: 6 }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );
  await service.recordProviderAsset({ churchId: "church-a", provider: "muxMinutes", assetId: "video", amount: 2.5 });
  assert.equal((await service.getUsage("church-a")).mux.used, 2.5);
  assert.equal(await service.removeProviderAssetByIdentity({
    provider: "muxMinutes",
    assetId: "video",
  }), "church-a");
  assert.equal((await service.getUsage("church-a")).mux.used, 0);
});

test("provider replacement admission uses the old asset as credit and deletion releases it after commit", async () => {
  const { service } = createQuota();
  await service.markProviderUsageReady({ churchId: "church-a" });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "old-image", amount: 8,
  });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "new-image", amount: 7,
    replaceAssetIds: ["old-image"],
  });
  assert.equal((await service.getUsage("church-a")).cloudinary.used, 15);
  await service.removeProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "old-image",
  });
  assert.equal((await service.getUsage("church-a")).cloudinary.used, 7);
});

test("smaller provider replacement credit is not shared with unrelated admissions", async () => {
  const { service } = createQuota({
    limits: { r2Bytes: 10, cloudinaryBytes: 10, muxMinutes: 10 },
  });
  await service.markProviderUsageReady({ churchId: "church-a" });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "old-image", amount: 8,
  });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "other-image", amount: 2,
  });

  const replacement = await service.reserve({
    churchId: "church-a",
    provider: "cloudinaryBytes",
    amount: 1,
    replaceAmount: 8,
    operationId: "replacement-image",
  });
  await assert.rejects(
    service.reserve({
      churchId: "church-a",
      provider: "cloudinaryBytes",
      amount: 1,
      operationId: "unrelated-image",
    }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );

  await service.cancel({ churchId: "church-a", reservationId: replacement.id });
  await assert.rejects(
    service.reserve({
      churchId: "church-a",
      provider: "cloudinaryBytes",
      amount: 1,
      operationId: "after-failed-replacement",
    }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );
});

test("provider admissions are atomic across concurrent assets", async () => {
  const { service } = createQuota();
  await service.markProviderUsageReady({ churchId: "church-a" });
  const results = await Promise.allSettled([
    service.recordProviderAsset({ churchId: "church-a", provider: "muxMinutes", assetId: "mux-a", amount: 6 }),
    service.recordProviderAsset({ churchId: "church-a", provider: "muxMinutes", assetId: "mux-b", amount: 6 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("existing provider usage is reconciled before quota enforcement is enabled", async () => {
  let enforce = false;
  const { service } = createQuota({
    providerQuotaEnforcementEnabled: () => enforce,
  });
  await service.recordProviderAsset({
    churchId: "church-a", provider: "cloudinaryBytes", assetId: "existing-image", amount: 8,
  });
  enforce = true;
  await assert.rejects(
    service.recordProviderAsset({
      churchId: "church-a", provider: "cloudinaryBytes", assetId: "new-image", amount: 1,
    }),
    (error) => error.code === "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED",
  );
  await service.markProviderUsageReady({ churchId: "church-a" });
  await assert.rejects(
    service.recordProviderAsset({
      churchId: "church-a", provider: "cloudinaryBytes", assetId: "over-limit-image", amount: 3,
    }),
    (error) => error.code === "CHURCH_STORAGE_QUOTA_EXCEEDED",
  );
});
