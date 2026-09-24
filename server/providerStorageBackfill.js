import {
  getCloudinaryAssetBytes,
  getMuxStoredMinutes,
} from "./churchStorageQuota.js";

const providerKey = (provider, assetId) => `${provider}:${assetId}`;
const nonEmpty = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const mediaProviderReference = (media) => {
  const recordedProvider = media?.providerStorage?.provider;
  if (media?.type === "image" && (recordedProvider === "cloudinary" || media?.source === "cloudinary" || media?.localImage?.cloudUrl)) {
    return {
      provider: "cloudinaryBytes",
      assetId: nonEmpty(media?.providerStorage?.publicId) ||
        nonEmpty(media?.publicId) || nonEmpty(media?.localImage?.cloudMediaId),
      mediaId: nonEmpty(media?.id),
    };
  }
  if (media?.type === "video" && (recordedProvider === "mux" || media?.source === "mux" || media?.muxAssetId || media?.localVideoFile?.cloudMediaId)) {
    return {
      provider: "muxMinutes",
      assetId: nonEmpty(media?.providerStorage?.assetId) ||
        nonEmpty(media?.muxAssetId) || nonEmpty(media?.localVideoFile?.cloudMediaId),
      mediaId: nonEmpty(media?.id),
    };
  }
  return null;
};

const findCloudinaryChurchMetadata = (asset) => {
  const context = asset?.context?.custom || asset?.context || {};
  if (typeof context === "string") {
    const match = context.match(/(?:^|\|)worshipsync_church_id=([^|]+)/);
    return match?.[1] || "";
  }
  return nonEmpty(context.worshipsync_church_id);
};

const muxChurchFromPassthrough = (passthrough) => {
  const match = nonEmpty(passthrough).match(/^worship-sync:church:([^:]+):/);
  return match?.[1] || "";
};

const muxAssetChurchId = (asset) =>
  nonEmpty(asset?.meta?.creator_id) || muxChurchFromPassthrough(asset?.passthrough);

const muxAssetIsTemporary = (asset) =>
  nonEmpty(asset?.meta?.external_id).startsWith("temporary:");

export const createProviderStorageBackfill = ({
  listChurches,
  readMediaLibrary,
  cloudinaryClient,
  muxClient,
  storageQuota,
}) => {
  const run = async ({ dryRun = false } = {}) => {
    const churches = await listChurches();
    if (!dryRun) {
      for (const church of churches) {
        const churchId = nonEmpty(church.id || church.churchId);
        if (churchId) await storageQuota.markProviderUsageNotReady({ churchId });
      }
    }
    const reports = [];
    const references = new Map();
    const knownChurchIds = new Set(
      churches.map((church) => nonEmpty(church.id || church.churchId)).filter(Boolean),
    );
    const reportFor = (churchId) => {
      const existing = reports.find((report) => report.churchId === churchId);
      if (existing) return existing;
      const report = {
        churchId,
        cloudinaryBytes: 0,
        muxMinutes: 0,
        processedAssets: 0,
        issues: [],
      };
      reports.push(report);
      return report;
    };
    const addReference = (churchId, reference) => {
      if (!reference?.assetId) return false;
      const key = providerKey(reference.provider, reference.assetId);
      const entry = references.get(key) || {
        provider: reference.provider,
        assetId: reference.assetId,
        churchIds: new Set(),
        mediaIds: new Set(),
        ledgerChurchIds: new Set(),
      };
      entry.churchIds.add(churchId);
      if (reference.mediaId) entry.mediaIds.add(reference.mediaId);
      references.set(key, entry);
      return true;
    };

    for (const church of churches) {
      const churchId = nonEmpty(church.id || church.churchId);
      const report = {
        churchId,
        cloudinaryBytes: 0,
        muxMinutes: 0,
        processedAssets: 0,
        issues: [],
      };
      reports.push(report);
      if (!churchId) {
        report.issues.push({ type: "unowned", reason: "Church record has no ID." });
        continue;
      }
      let mediaLibrary;
      try {
        mediaLibrary = await readMediaLibrary(churchId);
      } catch (error) {
        report.issues.push({
          type: "unowned",
          reason: `Could not read the church media library: ${error.message}`,
        });
        continue;
      }
      for (const media of Array.isArray(mediaLibrary?.list) ? mediaLibrary.list : []) {
        const reference = mediaProviderReference(media);
        if (!reference?.assetId) {
          if (
            media?.source === "cloudinary" ||
            media?.source === "mux" ||
            media?.localImage?.cloudUrl ||
            media?.localVideoFile?.cloudUrl ||
            media?.localVideoFile?.cloudMediaId
          ) {
            report.issues.push({
              type: "unowned",
              mediaId: nonEmpty(media?.id),
              reason: "Media entry is missing its provider asset identity.",
            });
          }
          continue;
        }
        addReference(churchId, reference);
      }
    }

    for (const church of churches) {
      const churchId = nonEmpty(church.id || church.churchId);
      if (!churchId || typeof storageQuota.listProviderUploads !== "function") continue;
      const report = reportFor(churchId);
      try {
        for (const tracked of await storageQuota.listProviderUploads({ churchId })) {
          if (
            tracked?.provider !== "mux" ||
            tracked?.temporary ||
            !tracked?.uploadId
          ) continue;
          const upload = await muxClient.video.uploads.retrieve(tracked.uploadId);
          if (upload.asset_id) {
            addReference(churchId, {
              provider: "muxMinutes",
              assetId: upload.asset_id,
              mediaId: nonEmpty(tracked.mediaId),
            });
          }
          if (!dryRun) {
            await storageQuota.recordProviderUpload?.({
              churchId,
              provider: "mux",
              uploadId: tracked.uploadId,
              mediaId: nonEmpty(tracked.mediaId) || undefined,
              temporary: false,
              status: upload.status,
              assetId: upload.asset_id,
            });
          }
        }
      } catch (error) {
        report.issues.push({
          type: "unowned",
          reason: `Could not reconcile tracked Mux uploads: ${error.message}`,
        });
      }
    }

    if (typeof muxClient?.video?.assets?.list !== "function") {
      for (const report of reports) {
        report.issues.push({
          type: "unowned",
          reason: "Mux asset enumeration is unavailable; provider storage cannot be reconciled comprehensively.",
        });
      }
    } else {
      try {
        for await (const asset of muxClient.video.assets.list()) {
          if (muxAssetIsTemporary(asset)) continue;
          const churchId = muxAssetChurchId(asset);
          if (!churchId || !asset?.id) continue;
          if (!knownChurchIds.has(churchId)) {
            reportFor(churchId).issues.push({
              type: "unowned",
              provider: "muxMinutes",
              assetId: asset.id,
              reason: "Mux ownership metadata names a church that is not present in the church registry.",
            });
            continue;
          }
          addReference(churchId, {
            provider: "muxMinutes",
            assetId: asset.id,
            mediaId: nonEmpty(asset?.meta?.external_id),
          });
        }
      } catch (error) {
        for (const report of reports) {
          report.issues.push({
            type: "unowned",
            reason: `Could not enumerate Mux assets: ${error.message}`,
          });
        }
      }
    }

    for (const church of churches) {
      const churchId = nonEmpty(church.id || church.churchId);
      if (!churchId) continue;
      try {
        for (const owned of await storageQuota.listProviderAssets({ churchId })) {
          const key = providerKey(owned.provider, owned.assetId);
          const entry = references.get(key) || {
            provider: owned.provider,
            assetId: owned.assetId,
            churchIds: new Set(),
            mediaIds: new Set(),
            ledgerChurchIds: new Set(),
          };
          entry.ledgerChurchIds.add(owned.churchId);
          references.set(key, entry);
        }
      } catch (error) {
        const report = reports.find((row) => row.churchId === churchId);
        report?.issues.push({
          type: "unowned",
          reason: `Could not read current provider ownership: ${error.message}`,
        });
      }
    }

    for (const entry of references.values()) {
      const allChurchIds = new Set([...entry.churchIds, ...entry.ledgerChurchIds]);
      if (allChurchIds.size !== 1) {
        const issue = {
          type: "ambiguous",
          provider: entry.provider,
          assetId: entry.assetId,
          churchIds: [...allChurchIds].sort(),
          mediaIds: [...entry.mediaIds].sort(),
          reason: "The same provider asset is referenced by or assigned to multiple churches.",
        };
        for (const churchId of allChurchIds) {
          reports.find((row) => row.churchId === churchId)?.issues.push(issue);
        }
        continue;
      }
      const [churchId] = allChurchIds;
      const report = reports.find((row) => row.churchId === churchId);
      if (!report) continue;
      try {
        let amount;
        if (entry.provider === "cloudinaryBytes") {
          const asset = await cloudinaryClient.api.resource(entry.assetId, {
            resource_type: "image",
          });
          const metadataChurchId = findCloudinaryChurchMetadata(asset);
          const pathBelongsToChurch =
            String(asset.public_id || "").startsWith(`worship-sync/canva/${encodeURIComponent(churchId)}/`) ||
            String(asset.public_id || "").startsWith(`worship-sync/churches/${encodeURIComponent(churchId)}/media/`) ||
            String(asset.folder || "") === `worship-sync/canva/${encodeURIComponent(churchId)}` ||
            String(asset.folder || "") === `worship-sync/churches/${encodeURIComponent(churchId)}/media`;
          if (metadataChurchId && metadataChurchId !== churchId) {
            throw Object.assign(new Error("Cloudinary ownership metadata names another church."), { ambiguous: true });
          }
          const existingOwner = await storageQuota.getProviderAssetOwner({
            provider: entry.provider,
            assetId: entry.assetId,
          });
          if (existingOwner && existingOwner.churchId !== churchId) {
            throw Object.assign(new Error("The quota ledger assigns this image to another church."), { ambiguous: true });
          }
          if (
            !metadataChurchId &&
            !pathBelongsToChurch &&
            !entry.churchIds.has(churchId) &&
            existingOwner?.churchId !== churchId
          ) {
            throw Object.assign(new Error("Cloudinary image has no verifiable church owner."), { ambiguous: true });
          }
          amount = getCloudinaryAssetBytes(asset);
          if (!amount) throw new Error("Cloudinary did not report a positive stored byte size.");
          if (!dryRun && !metadataChurchId) {
            await cloudinaryClient.uploader.add_context(
              `worshipsync_church_id=${churchId}`,
              [entry.assetId],
              { resource_type: "image" },
            );
          }
          report.cloudinaryBytes += amount;
        } else if (entry.provider === "muxMinutes") {
          const asset = await muxClient.video.assets.retrieve(entry.assetId);
          const existingOwner = await storageQuota.getProviderAssetOwner({
            provider: entry.provider,
            assetId: entry.assetId,
          });
          const metadataChurchId = nonEmpty(asset.meta?.creator_id);
          const passthrough = nonEmpty(asset.passthrough);
          if (
            (metadataChurchId && metadataChurchId !== churchId) ||
            (existingOwner && existingOwner.churchId !== churchId) ||
            (passthrough && !passthrough.startsWith(`worship-sync:church:${churchId}:`))
          ) {
            throw Object.assign(new Error("Mux ownership metadata names another church."), { ambiguous: true });
          }
          amount = getMuxStoredMinutes(asset);
          if (!amount) throw new Error("Mux did not report a positive stored duration.");
          if (!dryRun && !passthrough) {
            await muxClient.video.assets.update(entry.assetId, {
              passthrough: `worship-sync:church:${churchId}:backfill:${entry.assetId}`,
            });
          }
          report.muxMinutes += amount;
        } else {
          throw Object.assign(new Error("Unknown provider usage record."), { ambiguous: true });
        }
        if (!dryRun) {
          await storageQuota.recordProviderAsset({
            churchId,
            provider: entry.provider,
            assetId: entry.assetId,
            amount,
          });
        }
        report.processedAssets += 1;
      } catch (error) {
        report.issues.push({
          type: error?.ambiguous ? "ambiguous" : "unowned",
          provider: entry.provider,
          assetId: entry.assetId,
          mediaIds: [...entry.mediaIds].sort(),
          reason: error?.message || "Could not reconcile provider asset.",
        });
      }
    }

    for (const report of reports) {
      if (!dryRun && report.issues.length === 0) {
        await storageQuota.markProviderUsageReady({ churchId: report.churchId });
        report.ready = true;
      } else {
        report.ready = false;
      }
    }
    return {
      dryRun,
      complete: reports.every((report) => report.ready === true),
      churches: reports,
    };
  };

  return { run };
};
