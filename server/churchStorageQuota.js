import { randomUUID } from "node:crypto";

export const CHURCH_STORAGE_QUOTA_DEFAULTS = Object.freeze({
  r2Bytes: 1024 ** 3,
  cloudinaryBytes: 500 * 1024 ** 2,
  muxMinutes: 400,
});

export class ChurchStorageQuotaError extends Error {
  constructor(provider, limit, statusCode = 413) {
    const formatBytes = (bytes) => {
      if (bytes % (1024 ** 3) === 0) return `${bytes / (1024 ** 3)} GB`;
      if (bytes % (1024 ** 2) === 0) return `${bytes / (1024 ** 2)} MB`;
      return `${bytes} byte${bytes === 1 ? "" : "s"}`;
    };
    const formatMinutes = (minutes) =>
      `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    const messages = {
      r2Bytes: `This church has reached its ${formatBytes(limit)} file storage limit.`,
      cloudinaryBytes: `This church has reached its ${formatBytes(limit)} image storage limit.`,
      muxMinutes: `This church has reached its ${formatMinutes(limit)} video storage limit.`,
    };
    super(messages[provider] || "This church has reached its storage limit.");
    this.name = "ChurchStorageQuotaError";
    this.code = "CHURCH_STORAGE_QUOTA_EXCEEDED";
    this.provider = provider;
    this.statusCode = statusCode;
  }
}
export class ChurchStorageMutationInProgressError extends Error {
  statusCode = 409;
  code = "CHURCH_STORAGE_MUTATION_IN_PROGRESS";

  constructor() {
    super("Another upload is updating this file. Wait for it to finish, then try again.");
    this.name = "ChurchStorageMutationInProgressError";
  }
}

const finiteNonNegative = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const finiteSigned = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeChurchStorageQuotas = (overrides = {}) => ({
  r2Bytes: positive(overrides.r2Bytes, CHURCH_STORAGE_QUOTA_DEFAULTS.r2Bytes),
  cloudinaryBytes: positive(
    overrides.cloudinaryBytes,
    CHURCH_STORAGE_QUOTA_DEFAULTS.cloudinaryBytes,
  ),
  muxMinutes: positive(overrides.muxMinutes, CHURCH_STORAGE_QUOTA_DEFAULTS.muxMinutes),
});

const positive = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getCloudinaryAssetBytes = (asset) =>
  finiteNonNegative(asset?.bytes ?? asset?.byte_size ?? asset?.sizeBytes);

export const getMuxStoredMinutes = (asset) => {
  const durationSeconds = finiteNonNegative(asset?.duration);
  return durationSeconds / 60;
};

export const sumR2ChurchMetadataUsage = ({ resources = [], songs = [] } = {}) =>
  resources.reduce(
    (total, resource) => total + finiteNonNegative(resource?.storage?.sizeBytes),
    0,
  ) +
  songs.reduce(
    (total, song) => total + finiteNonNegative(song?.songAudio?.sizeBytes),
    0,
  );

const quotaDocId = (churchId) => encodeURIComponent(String(churchId));
const operationDocId = (value) => encodeURIComponent(String(value));
const scopedDocId = (churchId, value) =>
  operationDocId(`${churchId}:${value}`);

/** Firestore-backed quota ledger. All admission, commit, and release changes
 * share a transaction on the church quota document, so app instances cannot
 * admit uploads against stale counters. Provider usage remains separate.
 */
export const createChurchStorageQuotaService = ({
  getFirestore,
  getChurch,
  loadR2Usage,
  now = () => Date.now(),
  reservationTtlMs = 60 * 60 * 1000,
}) => {
  const collection = "churchStorageQuotas";
  const reservationCollection = "churchStorageQuotaReservations";
  const operationCollection = "churchStorageQuotaOperations";
  const lockCollection = "churchStorageQuotaLocks";
  const providerAssetCollection = "churchStorageQuotaProviderAssets";

  const getRefs = (db, churchId) => ({
    quota: db.collection(collection).doc(quotaDocId(churchId)),
    reservations: db.collection(reservationCollection),
    operations: db.collection(operationCollection),
    locks: db.collection(lockCollection),
    providerAssets: db.collection(providerAssetCollection),
  });

  const ensureR2Baseline = async (churchId) => {
    const [metadataBytes, church] = await Promise.all([
      loadR2Usage ? loadR2Usage(churchId) : 0,
      getChurch ? getChurch(churchId) : null,
    ]);
    return { metadataBytes: finiteNonNegative(metadataBytes), church };
  };

  const getUsage = async (churchId) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    const { quota } = getRefs(db, churchId);
    const snapshot = await quota.get();
    const value = snapshot.exists ? snapshot.data() : {};
    const church = getChurch ? await getChurch(churchId) : null;
    let baseline;
    if (!value.r2Initialized) {
      baseline = await ensureR2Baseline(churchId);
    } else {
      baseline = { church };
    }
    return publicQuotaUsage(value, baseline);
  };

  const publicQuotaUsage = (value = {}, baseline) => {
    const quotas = normalizeChurchStorageQuotas(
      baseline?.church?.storageQuotas || value.limits,
    );
    return {
      r2: {
        used: Number.isFinite(baseline?.metadataBytes)
          ? baseline.metadataBytes
          : finiteNonNegative(value.r2Bytes),
        limit: quotas.r2Bytes,
        unit: "bytes",
      },
      cloudinary: {
        used: finiteNonNegative(value.cloudinaryBytes),
        limit: quotas.cloudinaryBytes,
        unit: "bytes",
      },
      mux: {
        used: finiteNonNegative(value.muxMinutes),
        limit: quotas.muxMinutes,
        unit: "minutes",
      },
    };
  };

  const reconcileR2Usage = async (churchId) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    const { metadataBytes, church } = await ensureR2Baseline(churchId);
    const { quota, reservations } = getRefs(db, churchId);
    await db.runTransaction(async (transaction) => {
      const [snapshot, reservationSnapshot] = await Promise.all([
        transaction.get(quota),
        transaction.get(reservations.where("churchId", "==", churchId)),
      ]);
      const current = snapshot.exists ? snapshot.data() : {};
      const rows = reservationSnapshot.docs
        .map((doc) => ({ ref: doc.ref, value: doc.data() }))
        .filter(({ value }) => value.status === "pending");
      const active = rows.filter(({ value }) => value.status === "pending" && value.expiresAt > now());
      if (active.length) {
        throw new Error("Church storage usage cannot be reconciled while uploads are pending.");
      }
      const expiredByProvider = Object.fromEntries(
        ["r2Bytes", "cloudinaryBytes", "muxMinutes"].map((provider) => [
          `reserved_${provider}`,
          rows.filter(({ value }) => value.provider === provider && value.status === "pending")
            .reduce((total, { value }) => total + Number(value.delta ?? value.amount ?? 0), 0),
        ]),
      );
      rows.filter(({ value }) => value.status === "pending").forEach(({ ref }) => transaction.delete(ref));
      transaction.set(
        quota,
        {
          ...current,
          ...Object.fromEntries(Object.entries(expiredByProvider).map(([field, amount]) => [
            field,
            finiteSigned(current[field]) - amount,
          ])),
          r2Bytes: metadataBytes,
          r2Initialized: true,
          ...(church?.storageQuotas
            ? { limits: normalizeChurchStorageQuotas(church.storageQuotas) }
            : {}),
          reconciledAt: now(),
        },
        { merge: true },
      );
    });
    return getUsage(churchId);
  };

  const reserve = async ({ churchId, provider = "r2Bytes", amount, operationId, replaceAmount = 0, lockId }) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    if (provider === "r2Bytes") {
      const { quota } = getRefs(db, churchId);
      const snapshot = await quota.get();
      const church = getChurch ? await getChurch(churchId) : null;
      const metadataBytes =
        snapshot.exists && snapshot.data()?.r2Initialized
          ? undefined
          : await loadR2Usage?.(churchId);
      return reserveTransaction({ db, churchId, provider, amount, operationId, replaceAmount, lockId, metadataBytes, church });
    }
    const church = getChurch ? await getChurch(churchId) : null;
    return reserveTransaction({ db, churchId, provider, amount, operationId, replaceAmount, lockId, church });
  };

  const reserveTransaction = async ({ db, churchId, provider, amount, operationId, replaceAmount, lockId, metadataBytes, church }) => {
    const numericAmount = finiteNonNegative(amount);
    const replacement = finiteNonNegative(replaceAmount);
    const { quota, reservations, locks } = getRefs(db, churchId);
    const reservationId = operationId || randomUUID();
    const reservation = reservations.doc(scopedDocId(churchId, reservationId));
    const lock = lockId ? locks.doc(scopedDocId(churchId, lockId)) : null;
    await db.runTransaction(async (transaction) => {
      const expiredQuery = reservations
        .where("churchId", "==", churchId);
      const [quotaSnapshot, reservationSnapshot, expiredSnapshot, lockSnapshot] = await Promise.all([
        transaction.get(quota),
        transaction.get(reservation),
        transaction.get(expiredQuery),
        ...(lock ? [transaction.get(lock)] : []),
      ]);
      const current = quotaSnapshot.exists ? quotaSnapshot.data() : {};
      const existingReservation = reservationSnapshot.exists ? reservationSnapshot.data() : null;
      if (existingReservation?.status === "pending" && existingReservation.expiresAt > now()) return;
      if (existingReservation?.status === "committed") return;
      const currentLock = lockSnapshot?.exists ? lockSnapshot.data() : null;
      if (
        currentLock?.expiresAt > now() &&
        currentLock.operationId !== reservationId
      ) {
        throw new ChurchStorageMutationInProgressError();
      }
      const usageField = provider;
      const reservedField = `reserved_${provider}`;
      const used = provider === "r2Bytes" && !current.r2Initialized
        ? finiteNonNegative(metadataBytes)
        : finiteNonNegative(current[usageField]);
      const expired = expiredSnapshot.docs
        .map((doc) => ({ ref: doc.ref, value: doc.data() }))
        .filter(({ value }) => value.status === "pending" && value.expiresAt <= now());
      const expiredForProvider = expired
        .filter(({ value }) => value.provider === provider)
        .reduce((total, { value }) => total + Number(value.delta ?? value.amount ?? 0), 0);
      const reserved = finiteSigned(current[reservedField]) - expiredForProvider;
      const expiredByProvider = Object.fromEntries(
        ["r2Bytes", "cloudinaryBytes", "muxMinutes"].map((key) => [
          `reserved_${key}`,
          expired
            .filter(({ value }) => value.provider === key)
            .reduce((total, { value }) => total + Number(value.delta ?? value.amount ?? 0), 0),
        ]),
      );
      const limits = normalizeChurchStorageQuotas(church?.storageQuotas || current.limits);
      const limit = limits[provider];
      const reservationDelta = numericAmount - replacement;
      if (used + reserved + reservationDelta > limit) {
        throw new ChurchStorageQuotaError(provider, limit);
      }
      transaction.set(quota, {
        [usageField]: used,
        [reservedField]: reserved + reservationDelta,
        ...Object.fromEntries(Object.entries(expiredByProvider).map(([field, amount]) => [
          field,
          finiteSigned(current[field]) - amount +
            (field === reservedField ? reservationDelta : 0),
        ])),
        ...(provider === "r2Bytes" ? { r2Initialized: true } : {}),
        limits,
      }, { merge: true });
      expired.forEach(({ ref }) => transaction.delete(ref));
      transaction.set(reservation, {
        churchId,
        provider,
        amount: numericAmount,
        delta: reservationDelta,
        replaceAmount: replacement,
        ...(lockId ? { lockId } : {}),
        status: "pending",
        expiresAt: now() + reservationTtlMs,
      });
      if (lock) {
        transaction.set(lock, {
          operationId: reservationId,
          expiresAt: now() + reservationTtlMs,
        });
      }
    });
    return { id: reservationId };
  };

  const finishReservation = async ({ churchId, reservationId, actualAmount, assetId, previousAssetId, remove = false, fallbackPreviousAmount = 0 }) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    const { quota, reservations, operations, locks } = getRefs(db, churchId);
    const reservation = reservations.doc(scopedDocId(churchId, reservationId));
    const op = operations.doc(scopedDocId(churchId,
      `${remove ? "remove" : "commit"}:${assetId}:${reservationId}`,
    ));
    const provider = "r2Bytes";
    const asset = operations.doc(scopedDocId(churchId, `asset:${provider}:${assetId}`));
    const previousAsset = previousAssetId
      ? operations.doc(scopedDocId(churchId, `asset:${provider}:${previousAssetId}`))
      : null;
    await db.runTransaction(async (transaction) => {
      const [quotaSnapshot, reservationSnapshot, operationSnapshot, assetSnapshot, previousAssetSnapshot] = await Promise.all([
        transaction.get(quota), transaction.get(reservation), transaction.get(op), transaction.get(asset),
        ...(previousAsset ? [transaction.get(previousAsset)] : [Promise.resolve(null)]),
      ]);
      const current = quotaSnapshot.exists ? quotaSnapshot.data() : {};
      const pending = reservationSnapshot.exists ? reservationSnapshot.data() : null;
      const lock = pending?.lockId
        ? locks.doc(scopedDocId(churchId, pending.lockId))
        : null;
      const lockSnapshot = lock ? await transaction.get(lock) : null;
      if (operationSnapshot.exists) {
        if (pending?.status === "pending") {
          const reservedField = `reserved_${pending.provider}`;
          transaction.set(quota, {
            [reservedField]: finiteSigned(current[reservedField]) - Number(pending.delta ?? pending.amount ?? 0),
          }, { merge: true });
          transaction.set(reservation, { ...pending, status: "committed", committedAt: now() });
          if (lockSnapshot?.data()?.operationId === reservationId) transaction.delete(lock);
        }
        return;
      }
      if (!remove && !pending && !assetSnapshot.exists) return;
      const oldSize = finiteNonNegative(
        previousAssetSnapshot?.exists
          ? previousAssetSnapshot.data().sizeBytes
          : assetSnapshot.exists && !previousAssetId
          ? assetSnapshot.data().sizeBytes
          : fallbackPreviousAmount,
      );
      const nextSize = remove ? 0 : finiteNonNegative(actualAmount);
      const reservedField = `reserved_${provider}`;
      const reserved = finiteSigned(current[reservedField]);
      transaction.set(quota, {
        r2Bytes: Math.max(0, finiteNonNegative(current.r2Bytes) + nextSize - oldSize),
        [reservedField]: reserved - Number(pending?.delta ?? pending?.amount ?? 0),
      }, { merge: true });
      if (remove) transaction.delete(asset);
      else transaction.set(asset, { provider, sizeBytes: nextSize, updatedAt: now() });
      if (previousAsset && !remove) {
        // Keep a zero-sized tombstone so deletion of the replaced R2 object
        // cannot release the quota now attributed to its successor.
        transaction.set(previousAsset, { provider, sizeBytes: 0, replaced: true, updatedAt: now() });
      }
      transaction.set(op, { completedAt: now() });
      if (pending) {
        transaction.set(reservation, { ...pending, status: "committed", committedAt: now() });
        if (lockSnapshot?.data()?.operationId === reservationId) transaction.delete(lock);
      }
    });
  };

  const cancel = async ({ churchId, reservationId }) => {
    const db = getFirestore?.();
    if (!db) return;
    const { quota, reservations, locks } = getRefs(db, churchId);
    const reservation = reservations.doc(scopedDocId(churchId, reservationId));
    await db.runTransaction(async (transaction) => {
      const [quotaSnapshot, reservationSnapshot] = await Promise.all([
        transaction.get(quota), transaction.get(reservation),
      ]);
      if (!reservationSnapshot.exists) return;
      const pending = reservationSnapshot.data();
      if (pending.status !== "pending") return;
      const current = quotaSnapshot.exists ? quotaSnapshot.data() : {};
      const lock = pending.lockId
        ? locks.doc(scopedDocId(churchId, pending.lockId))
        : null;
      const lockSnapshot = lock ? await transaction.get(lock) : null;
      transaction.set(quota, {
        [`reserved_${pending.provider}`]:
          finiteSigned(current[`reserved_${pending.provider}`]) -
          Number(pending.delta ?? pending.amount ?? 0),
      }, { merge: true });
      transaction.delete(reservation);
      if (lockSnapshot?.data()?.operationId === reservationId) transaction.delete(lock);
    });
  };

  const commitR2 = async (input) => {
    const db = getFirestore?.();
    const { quota } = getRefs(db, input.churchId);
    const snapshot = await quota.get();
    if (!snapshot.exists || !snapshot.data()?.r2Initialized) {
      await reconcileR2Usage(input.churchId);
    }
    return finishReservation({ ...input, assetId: input.assetId });
  };
  const releaseR2 = async (input) => {
    const db = getFirestore?.();
    const { quota } = getRefs(db, input.churchId);
    const snapshot = await quota.get();
    if (!snapshot.exists || !snapshot.data()?.r2Initialized) {
      await reconcileR2Usage(input.churchId);
    }
    return finishReservation({ ...input, remove: true });
  };

  const recordProviderAsset = async ({ churchId, provider, assetId, amount, temporary = false }) => {
    if (temporary) return getUsage(churchId);
    const reservationId = `provider:${provider}:${assetId}`;
    await reserve({ churchId, provider, amount, operationId: reservationId });
    const db = getFirestore?.();
    const { quota, reservations, operations, providerAssets } = getRefs(db, churchId);
    const reservation = reservations.doc(scopedDocId(churchId, reservationId));
    const asset = operations.doc(scopedDocId(churchId, `asset:${provider}:${assetId}`));
    const operation = operations.doc(scopedDocId(churchId, `provider-commit:${provider}:${assetId}`));
    const owner = providerAssets.doc(operationDocId(`${provider}:${assetId}`));
    await db.runTransaction(async (transaction) => {
      const [quotaSnapshot, reservationSnapshot, assetSnapshot, operationSnapshot, ownerSnapshot] = await Promise.all([
        transaction.get(quota), transaction.get(reservation), transaction.get(asset), transaction.get(operation), transaction.get(owner),
      ]);
      const current = quotaSnapshot.exists ? quotaSnapshot.data() : {};
      const pending = reservationSnapshot.exists ? reservationSnapshot.data() : {};
      if (operationSnapshot.exists) {
        if (reservationSnapshot.exists && pending.status === "pending") {
          transaction.set(quota, {
            [`reserved_${provider}`]: finiteSigned(current[`reserved_${provider}`]) - Number(pending.delta ?? pending.amount ?? 0),
          }, { merge: true });
          transaction.delete(reservation);
        }
        return;
      }
      if (ownerSnapshot.exists && ownerSnapshot.data().churchId !== churchId) {
        throw new Error("That provider asset is already assigned to another church.");
      }
      const field = provider;
      const reservedField = `reserved_${provider}`;
      const previous = finiteNonNegative(assetSnapshot.exists ? assetSnapshot.data().amount : 0);
      const actual = finiteNonNegative(amount);
      transaction.set(quota, {
        [field]: finiteNonNegative(current[field]) + actual - previous,
        [reservedField]: finiteSigned(current[reservedField]) - Number(pending.delta ?? pending.amount ?? 0),
      }, { merge: true });
      transaction.set(asset, { provider, amount: actual, updatedAt: now() });
      transaction.set(operation, { completedAt: now() });
      transaction.set(owner, { churchId, provider, assetId, amount: actual, updatedAt: now() });
      transaction.delete(reservation);
    });
    return getUsage(churchId);
  };

  const removeProviderAsset = async ({ churchId, provider, assetId }) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    const { quota, operations, providerAssets } = getRefs(db, churchId);
    const asset = operations.doc(scopedDocId(churchId, `asset:${provider}:${assetId}`));
    const operation = operations.doc(scopedDocId(churchId, `provider-remove:${provider}:${assetId}`));
    const owner = providerAssets.doc(operationDocId(`${provider}:${assetId}`));
    await db.runTransaction(async (transaction) => {
      const [quotaSnapshot, assetSnapshot, operationSnapshot, ownerSnapshot] = await Promise.all([
        transaction.get(quota), transaction.get(asset), transaction.get(operation), transaction.get(owner),
      ]);
      if (operationSnapshot.exists || !assetSnapshot.exists) return;
      const current = quotaSnapshot.exists ? quotaSnapshot.data() : {};
      const amount = finiteNonNegative(assetSnapshot.data().amount);
      transaction.set(quota, {
        [provider]: Math.max(0, finiteNonNegative(current[provider]) - amount),
      }, { merge: true });
      transaction.delete(asset);
      transaction.set(operation, { completedAt: now() });
      if (ownerSnapshot.exists && ownerSnapshot.data().churchId === churchId) transaction.delete(owner);
    });
    return getUsage(churchId);
  };

  const removeProviderAssetByIdentity = async ({ provider, assetId }) => {
    const db = getFirestore?.();
    if (!db) throw new Error("Church storage quota persistence is unavailable.");
    const ownerRef = db.collection(providerAssetCollection)
      .doc(operationDocId(`${provider}:${assetId}`));
    const owner = await ownerRef.get();
    if (!owner.exists) return null;
    const { churchId } = owner.data();
    await removeProviderAsset({ churchId, provider, assetId });
    return churchId;
  };

  return {
    getUsage,
    reconcileR2Usage,
    reserve,
    commitR2,
    releaseR2,
    cancel,
    recordProviderAsset,
    removeProviderAsset,
    removeProviderAssetByIdentity,
  };
};
