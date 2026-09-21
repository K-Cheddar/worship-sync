import {
  ChurchResourceInputError,
  buildChurchResourceKey,
  createChurchResourceStorage,
} from "./churchResourceService.js";

const MAX_NAME_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 80;

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

const normalizeResourceRecord = (resource) => {
  if (!resource || typeof resource !== "object") return null;
  const id = normalizeShortText(resource.id, 160);
  const churchId = normalizeShortText(resource.churchId, 240);
  const storage = resource.storage;
  if (!id || !churchId || !storage || typeof storage !== "object") return null;
  const name = normalizeShortText(resource.name, MAX_NAME_LENGTH);
  const fileName = normalizeShortText(storage.fileName, 180);
  const key = normalizeShortText(storage.key, 500);
  const contentType = normalizeShortText(storage.contentType, 180);
  const sizeBytes = Number(storage.sizeBytes);
  if (!name || !fileName || !key || !contentType || !Number.isSafeInteger(sizeBytes)) {
    return null;
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
    storage: {
      key,
      fileName,
      contentType,
      sizeBytes,
      uploadedAt: normalizeShortText(storage.uploadedAt, 60),
    },
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
  return res.status(statusCode).json({
    success: false,
    error: message,
    errorMessage: message,
  });
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
}) => {
  const getStorage = () => storage || storageFactory();

  const findResource = async (churchId, resourceId) => {
    const resource = normalizeResourceRecord(
      await getDoc(COLLECTIONS.churchResources, resourceId),
    );
    if (!resource || resource.churchId !== churchId) {
      throw httpError(404, "Resource not found.");
    }
    return resource;
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
          .filter((resource) => resource?.churchId === churchId)
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

    async get(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const resource = await findResource(churchId, requireResourceId(req));
        return res.json({ success: true, resource });
      } catch (error) {
        return errorResponse(res, error, "Could not load this resource.");
      }
    },

    async createUpload(req, res) {
      try {
        const churchId = requireChurchSession(req);
        const result = await getStorage().createUpload({
          churchId,
          upload: req.body,
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
          if (resource) return res.json({ success: true, resource });
        }
        const upload = resourceInputFromBody(req.body);
        const resourceStorage = getStorage();
        const storageResult = await resourceStorage.completeUpload({
          churchId,
          upload: { ...upload, id: resourceId },
        });
        const resource = await persistUploadedResource({
          req: { ...req, body: req.body?.metadata || req.body },
          churchId,
          storageResult,
          resourceStorage,
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
        const storageResult = await resourceStorage.uploadFromServer({
          churchId,
          upload: {
            fileName: req.query.fileName,
            contentType: req.get("content-type"),
          },
          body: req.body,
        });
        const resource = await persistUploadedResource({
          req,
          churchId,
          storageResult,
          resourceStorage,
          cleanupOnPersistFailure: true,
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
        const resource = await findResource(churchId, resourceId);
        await getStorage().remove({ churchId, resource });
        await deleteDoc(COLLECTIONS.churchResources, resourceId);
        return res.json({ success: true });
      } catch (error) {
        return errorResponse(res, error, "Could not delete this resource.");
      }
    },
  };
};

export { normalizeResourceRecord };
