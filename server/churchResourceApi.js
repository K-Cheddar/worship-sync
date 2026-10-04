import {
  ChurchResourceInputError,
  buildChurchResourceKey,
  createChurchResourceStorage,
} from "./churchResourceService.js";
import { findChurchResourceServicePlanReferences } from "./churchResourceReferences.js";
import { isR2NotFoundError } from "./storage/r2ObjectStorage.js";
import { randomUUID } from "node:crypto";

const MAX_NAME_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 80;
const MAX_EXTERNAL_URL_LENGTH = 4_000;

const httpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeShortText = (value, maxLength) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const normalizeTags = (value) => {
  if (!Array.isArray(value)) return undefined;
  const tags = [
    ...new Set(
      value
        .map((tag) => normalizeShortText(tag, MAX_TAG_LENGTH))
        .filter(Boolean),
    ),
  ].slice(0, MAX_TAGS);
  return tags.length ? tags : undefined;
};

const normalizeExternalSource = (external) => {
  if (!external || typeof external !== "object") return null;
  const url = normalizeShortText(external.url, MAX_EXTERNAL_URL_LENGTH);
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (!url || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  const text = (key, maxLength = 300) => normalizeShortText(external[key], maxLength);
  return {
    url,
    ...(text("provider", 80) ? { provider: text("provider", 80) } : {}),
    ...(text("mimeType", 180) ? { mimeType: text("mimeType", 180) } : {}),
    ...(text("fileName", 180) ? { fileName: text("fileName", 180) } : {}),
    ...(text("mediaType", 40) ? { mediaType: text("mediaType", 40) } : {}),
    ...(text("providerResourceId", 300) ? { providerResourceId: text("providerResourceId", 300) } : {}),
    ...(text("lastResolvedAt", 60) ? { lastResolvedAt: text("lastResolvedAt", 60) } : {}),
  };
};

const normalizeResourceRecord = (resource) => {
  if (!resource || typeof resource !== "object") return null;
  const id = normalizeShortText(resource.id, 160);
  const churchId = normalizeShortText(resource.churchId, 240);
  const storage = resource.storage;
  const name = normalizeShortText(resource.name, MAX_NAME_LENGTH);
  const sourceType = resource.sourceType || (storage ? "upload" : "external");
  if (!id || !churchId || !name || !["upload", "external"].includes(sourceType)) return null;
  let normalizedSource;
  if (sourceType === "upload") {
    if (!storage || typeof storage !== "object" || resource.external) return null;
    const fileName = normalizeShortText(storage.fileName, 180);
    const key = normalizeShortText(storage.key, 500);
    const contentType = normalizeShortText(storage.contentType, 180);
    const sizeBytes = Number(storage.sizeBytes);
    if (!fileName || !key || !contentType || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;
    normalizedSource = {
      sourceType: "upload",
      storage: {
        key,
        fileName,
        contentType,
        sizeBytes,
        uploadedAt: normalizeShortText(storage.uploadedAt, 60),
      },
    };
  } else {
    if (storage || !resource.external) return null;
    const external = normalizeExternalSource(resource.external);
    if (!external) return null;
    normalizedSource = { sourceType: "external", external };
  }
  return {
    id,
    churchId,
    name,
    ...(normalizeShortText(resource.description, MAX_DESCRIPTION_LENGTH)
      ? { description: normalizeShortText(resource.description, MAX_DESCRIPTION_LENGTH) }
      : {}),
    kind:
      resource.kind === "audio" || resource.kind === "other"
        ? resource.kind
        : "document",
    ...normalizedSource,
    ...(Array.isArray(resource.tags) && normalizeTags(resource.tags)
      ? { tags: normalizeTags(resource.tags) }
      : {}),
    ...(normalizeShortText(resource.folderId, 160)
      ? { folderId: normalizeShortText(resource.folderId, 160) }
      : {}),
    access: { scope: "church" },
    createdAt: normalizeShortText(resource.createdAt, 60),
    createdBy: normalizeShortText(resource.createdBy, 240),
    updatedAt: normalizeShortText(resource.updatedAt, 60),
    updatedBy: normalizeShortText(resource.updatedBy, 240),
    ...(normalizeShortText(resource.contentVersion, 160)
      ? { contentVersion: normalizeShortText(resource.contentVersion, 160) }
      : {}),
    ...(resource.contentIndex && typeof resource.contentIndex === "object" &&
      ["pending", "processing", "ready", "unsupported", "failed", "stale"].includes(resource.contentIndex.status)
      ? { contentIndex: {
          status: resource.contentIndex.status,
          ...(normalizeShortText(resource.contentIndex.version, 160) ? { version: normalizeShortText(resource.contentIndex.version, 160) } : {}),
          ...(normalizeShortText(resource.contentIndex.indexedAt, 60) ? { indexedAt: normalizeShortText(resource.contentIndex.indexedAt, 60) } : {}),
          ...(normalizeShortText(resource.contentIndex.sourceModifiedAt, 60) ? { sourceModifiedAt: normalizeShortText(resource.contentIndex.sourceModifiedAt, 60) } : {}),
          ...(Number.isSafeInteger(resource.contentIndex.textLength) && resource.contentIndex.textLength >= 0 ? { textLength: resource.contentIndex.textLength } : {}),
          ...(Number.isSafeInteger(resource.contentIndex.chunkCount) && resource.contentIndex.chunkCount >= 0 ? { chunkCount: resource.contentIndex.chunkCount } : {}),
          ...(normalizeShortText(resource.contentIndex.extractor, 80) ? { extractor: normalizeShortText(resource.contentIndex.extractor, 80) } : {}),
          ...(normalizeShortText(resource.contentIndex.error, 300) ? { error: normalizeShortText(resource.contentIndex.error, 300) } : {}),
        } }
      : {}),
    ...(resource.deletionStatus === "deleting"
      ? {
          deletionStatus: "deleting",
          ...(normalizeShortText(resource.deletionRequestedAt, 60)
            ? { deletionRequestedAt: normalizeShortText(resource.deletionRequestedAt, 60) }
            : {}),
          ...(normalizeShortText(resource.deletionStorageDeletedAt, 60)
            ? { deletionStorageDeletedAt: normalizeShortText(resource.deletionStorageDeletedAt, 60) }
            : {}),
          ...(normalizeShortText(resource.deletionError, 300)
            ? { deletionError: normalizeShortText(resource.deletionError, 300) }
            : {}),
        }
      : {}),
  };
};

const requireChurchSession = (req) => {
  const requestedChurchId = String(req.params.churchId || "").trim();
  if (!requestedChurchId || req.appSession?.churchId !== requestedChurchId) {
    throw httpError(403, "That church is not available.");
  }
  return requestedChurchId;
};

const requireResourceId = (req) => {
  const resourceId = decodeURIComponent(String(req.params.resourceId || "")).trim();
  if (!resourceId) throw httpError(400, "Resource ID is required.");
  return resourceId;
};

const errorResponse = (res, error, fallback) => {
  const statusCode =
    Number.isInteger(error?.statusCode) && error.statusCode >= 400
      ? error.statusCode
      : 500;
  if (statusCode >= 500) console.error(fallback, error);
  const message = statusCode < 500 ? error.message : fallback;
  const payload = {
    success: false,
    error: message,
    errorMessage: message,
  };
  if (error?.code === "CHURCH_STORAGE_QUOTA_EXCEEDED") {
    payload.code = error.code;
    payload.quota = error.provider;
  } else if (error?.code) {
    payload.code = error.code;
  }
  if (Number.isSafeInteger(error?.referenceCount)) {
    payload.references = { count: error.referenceCount };
  }
  return res.status(statusCode).json(payload);
};

const resourceInputFromBody = (body) =>
  body?.resourceUpload || body?.upload || body?.resource || body;

const buildResourceRecord = ({
  churchId,
  storage,
  body,
  actorId,
  now,
}) => {
  const name =
    normalizeShortText(body?.name, MAX_NAME_LENGTH) || storage.fileName;
  if (!name) throw new ChurchResourceInputError("Resource name is required.");
  return normalizeResourceRecord({
    id: storage.id,
    churchId,
    name,
    description: normalizeShortText(body?.description, MAX_DESCRIPTION_LENGTH),
    kind: storage.kind,
    storage: {
      key: buildChurchResourceKey({ churchId, resourceId: storage.id }),
      fileName: storage.fileName,
      contentType: storage.contentType,
      sizeBytes: storage.sizeBytes,
      uploadedAt: storage.uploadedAt,
    },
    tags: normalizeTags(body?.tags),
    folderId: normalizeShortText(body?.folderId, 160),
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });
};

export const createChurchResourceHandlers = ({
  COLLECTIONS,
  getDoc,
  queryDocs,
  setDoc,
  deleteDoc,
  nowIso,
  storage,
  storageFactory = () => createChurchResourceStorage({ env: process.env }),
  findResourceReferences = ({ churchId, resourceId }) =>
    findChurchResourceServicePlanReferences({
      queryDocs,
      servicePlansCollection: COLLECTIONS.servicePlans,
      churchId,
      resourceId,
    }),
  quota,
  externalResourceService,
}) => {
  const getStorage = () => storage || storageFactory();

  const findResource = async (churchId, resourceId, { includeDeleting = false } = {}) => {
    const resource = normalizeResourceRecord(
      await getDoc(COLLECTIONS.churchResources, resourceId),
    );
    if (
      !resource ||
      resource.churchId !== churchId ||
      (!includeDeleting && resource.deletionStatus === "deleting")
    ) {
      throw httpError(404, "Resource not found.");
    }
    return resource;
  };

  const persistDeletionState = async (resource, patch) => {
    const next = normalizeResourceRecord({
      ...resource,
      ...patch,
      updatedAt: patch.updatedAt || nowIso(),
    });
    await setDoc(COLLECTIONS.churchResources, resource.id, next, {
      merge: false,
    });
    return next;
  };

  const persistUploadedResource = async ({
    req,
    churchId,
    storageResult,
    resourceStorage,
    cleanupOnPersistFailure = false,
  }) => {
    const now = nowIso();
    let resource;
    try {
      resource = buildResourceRecord({
        churchId,
        storage: storageResult,
        body: req.body,
        actorId: req.appSession.userId || req.appSession.actorId || "operator",
        now,
      });
      if (!resource) throw httpError(500, "Could not save this resource.");
      await setDoc(COLLECTIONS.churchResources, resource.id, resource, {
        merge: false,
      });
      return resource;
    } catch (error) {
      if (cleanupOnPersistFailure) {
        try {
          await resourceStorage.remove({
            churchId,
            resource: resource || {
              id: storageResult.id,
              storage: { key: buildChurchResourceKey({ churchId, resourceId: storageResult.id }) },
            },
          });
        } catch (cleanupError) {
          console.error("Error cleaning resource after metadata failure:", cleanupError);
        }
      }
      throw error;
    }
  };

  return {
    async list(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const docs = await queryDocs(
          COLLECTIONS.churchResources,
          [{ field: "churchId", value: churchId }],
          { limit: 5000 },
        );
        const resources = docs
          .map(normalizeResourceRecord)
          .filter(
            (resource) =>
              resource?.churchId === churchId &&
              resource.deletionStatus !== "deleting",
          )
          .sort((left, right) => {
            const updated = String(right.updatedAt || "").localeCompare(
              String(left.updatedAt || ""),
            );
            return updated || left.name.localeCompare(right.name);
          });
        return res.json({ success: true, resources });
      } catch (error) {
        return errorResponse(res, error, "Could not load church resources.");
      }
    },

    async storageQuota(req, res) {
      try {
        const churchId = requireChurchSession(req);
        if (!quota) throw httpError(503, "Church storage usage is unavailable.");
        return res.json({ success: true, quotas: await quota.getUsage(churchId) });
      } catch (error) {
        return errorResponse(res, error, "Could not load church storage usage.");
      }
    },

    async get(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resource = await findResource(churchId, requireResourceId(req));
        return res.json({ success: true, resource });
      } catch (error) {
        return errorResponse(res, error, "Could not load this resource.");
      }
    },

    async createExternal(req, res) {
      try {
        const churchId = requireChurchSession(req);
        if (!externalResourceService?.resolveRateLimited) throw httpError(503, "External resource links are unavailable.");
        const inputUrl = normalizeShortText(req.body?.url, MAX_EXTERNAL_URL_LENGTH);
        if (!inputUrl) throw httpError(400, "A resource URL is required.");
        const resolved = await externalResourceService.resolveRateLimited(
          inputUrl,
          req.appSession.actorId || req.ip || "unknown",
        );
        const external = normalizeExternalSource({
          url: resolved.originalUrl || resolved.externalUrl || inputUrl,
          provider: resolved.provider,
          mimeType: resolved.mimeType,
          fileName: resolved.filename,
          mediaType: resolved.mediaType,
          providerResourceId: resolved.mediaId,
          lastResolvedAt: nowIso(),
        });
        if (!external) throw httpError(400, "That resource URL is not valid.");
        const now = nowIso();
        const name = normalizeShortText(req.body?.name, MAX_NAME_LENGTH) ||
          normalizeShortText(resolved.title, MAX_NAME_LENGTH) ||
          normalizeShortText(resolved.filename, MAX_NAME_LENGTH) ||
          normalizeShortText(resolved.provider, MAX_NAME_LENGTH) || "External resource";
        const mediaType = String(resolved.mediaType || "").toLowerCase();
        const resource = normalizeResourceRecord({
          id: `churchResource_${randomUUID()}`,
          churchId,
          name,
          description: normalizeShortText(req.body?.description, MAX_DESCRIPTION_LENGTH),
          kind: ["document", "audio"].includes(mediaType) ? mediaType : "other",
          sourceType: "external",
          external,
          createdAt: now,
          createdBy: req.appSession.userId || req.appSession.actorId || "operator",
          updatedAt: now,
          updatedBy: req.appSession.userId || req.appSession.actorId || "operator",
        });
        if (!resource) throw httpError(400, "That resource could not be saved.");
        await setDoc(COLLECTIONS.churchResources, resource.id, resource, { merge: false });
        return res.json({ success: true, resource });
      } catch (error) {
        return errorResponse(res, error, "Could not add this external resource.");
      }
    },

    async createUpload(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const result = await getStorage().createUpload({
          churchId,
          upload: req.body,
        });
        if (quota) await quota.reserve({
          churchId,
          provider: "r2Bytes",
          amount: result.resourceUpload.sizeBytes,
          operationId: `resource:${result.resourceUpload.id}`,
        });
        return res.json(result);
      } catch (error) {
        return errorResponse(res, error, "Could not prepare this upload.");
      }
    },

    async completeUpload(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resourceId = requireResourceId(req);
        const existing = await getDoc(COLLECTIONS.churchResources, resourceId);
        if (existing?.churchId && existing.churchId !== churchId) {
          throw httpError(404, "Resource not found.");
        }
        if (existing) {
          const resource = normalizeResourceRecord(existing);
          if (resource) {
            if (resource.sourceType === "upload") await quota?.commitR2({
              churchId,
              reservationId: `resource:${resourceId}`,
              assetId: `resource:${resourceId}`,
              actualAmount: resource.storage.sizeBytes,
            });
            return res.json({ success: true, resource });
          }
        }
        const upload = resourceInputFromBody(req.body);
        const resourceStorage = getStorage();
        const storageResult = await resourceStorage.completeUpload({
          churchId,
          upload: { ...upload, id: resourceId },
          beforePromote: ({ sizeBytes }) => quota?.reserve({
            churchId,
            provider: "r2Bytes",
            amount: sizeBytes,
            operationId: `resource:${resourceId}`,
          }),
        });
        const reservationId = `resource:${resourceId}`;
        let resource;
        try {
          resource = await persistUploadedResource({
            req: { ...req, body: req.body?.metadata || req.body },
            churchId,
            storageResult,
            resourceStorage,
            cleanupOnPersistFailure: true,
          });
        } catch (error) {
          await quota?.cancel({ churchId, reservationId });
          throw error;
        }
        await quota?.commitR2({
          churchId,
          reservationId,
          assetId: `resource:${resourceId}`,
          actualAmount: storageResult.sizeBytes,
        });
        return res.json({ success: true, resource });
      } catch (error) {
        return errorResponse(res, error, "Could not complete this upload.");
      }
    },

    async uploadFromApp(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resourceStorage = getStorage();
        const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
        const resourceId = `churchResource_${randomUUID()}`;
        const reservationId = `resource:${resourceId}`;
        await quota?.reserve({ churchId, provider: "r2Bytes", amount: bytes.byteLength, operationId: reservationId });
        let storageResult;
        try {
          storageResult = await resourceStorage.uploadFromServer({
            churchId,
            resourceId,
            upload: {
              fileName: req.query.fileName,
              contentType: req.get("content-type"),
            },
            body: bytes,
          });
        } catch (error) {
          await quota?.cancel({ churchId, reservationId });
          throw error;
        }
        let resource;
        try {
          resource = await persistUploadedResource({
            req: {
              ...req,
              body: {
                name: req.get("x-resource-name"),
                description: req.get("x-resource-description"),
              },
            },
            churchId,
            storageResult,
            resourceStorage,
            cleanupOnPersistFailure: true,
          });
        } catch (error) {
          if (storageResult) {
            try { await resourceStorage.remove({ churchId, resource: storageResult }); } catch {}
          }
          await quota?.cancel({ churchId, reservationId });
          throw error;
        }
        await quota?.commitR2({
          churchId,
          reservationId,
          assetId: `resource:${resourceId}`,
          actualAmount: storageResult.sizeBytes,
        });
        return res.json({ success: true, resource });
      } catch (error) {
        return errorResponse(res, error, "Could not upload this file.");
      }
    },

    async createUrl(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resource = await findResource(churchId, requireResourceId(req));
        if (resource.sourceType === "external") throw httpError(400, "External resources use their original link.");
        const result = await getStorage().createReadUrl({
          churchId,
          resource,
          disposition: req.query.disposition,
        });
        return res.json(result);
      } catch (error) {
        return errorResponse(res, error, "Could not open this resource.");
      }
    },

    async update(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resource = await findResource(churchId, requireResourceId(req));
        const name = normalizeShortText(req.body?.name, MAX_NAME_LENGTH);
        if (!name) throw httpError(400, "Resource name is required.");
        const now = nowIso();
        const next = {
          ...resource,
          name,
          ...(typeof req.body?.description === "string"
            ? {
                description: normalizeShortText(
                  req.body.description,
                  MAX_DESCRIPTION_LENGTH,
                ),
              }
            : {}),
          ...(Array.isArray(req.body?.tags)
            ? { tags: normalizeTags(req.body.tags) }
            : {}),
          ...(typeof req.body?.folderId === "string"
            ? { folderId: normalizeShortText(req.body.folderId, 160) }
            : {}),
          updatedAt: now,
          updatedBy:
            req.appSession.userId || req.appSession.actorId || "operator",
        };
        const normalized = normalizeResourceRecord(next);
        await setDoc(COLLECTIONS.churchResources, resource.id, normalized, {
          merge: false,
        });
        return res.json({ success: true, resource: normalized });
      } catch (error) {
        return errorResponse(res, error, "Could not update this resource.");
      }
    },

    async remove(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resourceId = requireResourceId(req);
        const stored = await getDoc(COLLECTIONS.churchResources, resourceId);
        if (!stored) return res.json({ success: true });
        let resource = await findResource(churchId, resourceId, {
          includeDeleting: true,
        });

        if (resource.deletionStatus !== "deleting") {
          const references = await findResourceReferences({ churchId, resourceId });
          if (references.length) {
            const conflict = httpError(
              409,
              `This resource is used by ${references.length} Service Plan${references.length === 1 ? "" : "s"}. Remove it from the plan${references.length === 1 ? "" : "s"} before deleting it.`,
            );
            conflict.referenceCount = references.length;
            throw conflict;
          }
          resource = await persistDeletionState(resource, {
            deletionStatus: "deleting",
            deletionRequestedAt: nowIso(),
            deletionError: null,
            ...(resource.sourceType === "upload" ? { deletionStorageDeletedAt: null } : {}),
          });
        }

        try {
          if (resource.sourceType === "upload") await getStorage().remove({ churchId, resource });
        } catch (error) {
          if (!isR2NotFoundError(error)) {
            try {
              await persistDeletionState(resource, {
                deletionError: String(error?.message || "Storage deletion failed").slice(0, 300),
              });
            } catch (stateError) {
              console.error("Could not record church resource deletion failure:", stateError);
            }
            throw error;
          }
        }

        if (resource.sourceType === "upload") await quota?.releaseR2({
          churchId,
          reservationId: `delete-resource:${resourceId}`,
          assetId: `resource:${resourceId}`,
          fallbackPreviousAmount: resource.storage.sizeBytes,
        });

        resource = await persistDeletionState(resource, {
          ...(resource.sourceType === "upload" ? { deletionStorageDeletedAt: nowIso() } : {}),
          deletionError: null,
        });
        try {
          await deleteDoc(COLLECTIONS.churchResources, resourceId);
        } catch (error) {
          try {
            await persistDeletionState(resource, {
              deletionError: String(error?.message || "Metadata deletion failed").slice(0, 300),
            });
          } catch (stateError) {
            console.error("Could not record church resource metadata deletion failure:", stateError);
          }
          throw error;
        }
        return res.json({ success: true });
      } catch (error) {
        return errorResponse(res, error, "Could not delete this resource.");
      }
    },
  };
};

export { normalizeResourceRecord };
