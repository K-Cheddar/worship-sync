import { randomUUID } from "node:crypto";
import {
  createR2ObjectStorage,
  isR2NotFoundError,
  R2ObjectStorageNotConfiguredError,
} from "./storage/r2ObjectStorage.js";

export const CHURCH_RESOURCE_MAX_BYTES = 50 * 1024 * 1024;
export const CHURCH_RESOURCE_ID_PATTERN =
  /^churchResource_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESOURCE_TYPES = new Map([
  ["application/pdf", { extension: ".pdf", kind: "document" }],
  ["text/plain", { extension: ".txt", kind: "document" }],
  ["application/msword", { extension: ".doc", kind: "document" }],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { extension: ".docx", kind: "document" },
  ],
  ["application/vnd.ms-powerpoint", { extension: ".ppt", kind: "document" }],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    { extension: ".pptx", kind: "document" },
  ],
  ["application/vnd.ms-excel", { extension: ".xls", kind: "document" }],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { extension: ".xlsx", kind: "document" },
  ],
  ["audio/mpeg", { extension: ".mp3", kind: "audio" }],
]);

const CONTENT_TYPE_ALIASES = new Map([
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-mpeg", "audio/mpeg"],
]);

const EXTENSION_TYPES = new Map(
  [...RESOURCE_TYPES.entries()].map(([contentType, value]) => [
    value.extension,
    { contentType, kind: value.kind },
  ]),
);

export class ChurchResourceInputError extends Error {
  statusCode = 400;
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChurchResourceInputError(`${label} is required.`);
  }
  return value.trim();
};

const pathSegment = (value, label) =>
  encodeURIComponent(requireNonEmptyString(value, label));

const normalizeFileName = (value) => {
  const fileName = requireNonEmptyString(value, "File name")
    .replace(/[\\/\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!fileName) throw new ChurchResourceInputError("File name is required.");
  return fileName;
};

const extensionOf = (fileName) => {
  const match = /\.[^.]+$/.exec(fileName.toLowerCase());
  return match?.[0] || "";
};

const readMaxBytes = (env) => {
  const configured = Number(env.R2_RESOURCE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : CHURCH_RESOURCE_MAX_BYTES;
};

const normalizeId = (value) => {
  const id = requireNonEmptyString(value, "Resource ID");
  if (!CHURCH_RESOURCE_ID_PATTERN.test(id)) {
    throw new ChurchResourceInputError("That resource upload is not valid.");
  }
  return id;
};

const normalizeContentType = (value, fileName) => {
  const rawType = String(value || "").trim().toLowerCase();
  const canonicalType = CONTENT_TYPE_ALIASES.get(rawType) || rawType;
  if (RESOURCE_TYPES.has(canonicalType)) return canonicalType;

  // Chromium/Electron can report application/octet-stream or an empty type for
  // locally selected Office files. Extension inference is only a compatibility
  // fallback; unsupported extensions are still rejected.
  const inferred = EXTENSION_TYPES.get(extensionOf(fileName));
  if ((!canonicalType || canonicalType === "application/octet-stream") && inferred) {
    return inferred.contentType;
  }
  throw new ChurchResourceInputError(
    "That file type is not supported. Choose a PDF, text, Office, or MP3 file.",
  );
};

export const validateChurchResourceUpload = (input, env = process.env) => {
  const fileName = normalizeFileName(input?.fileName);
  const contentType = normalizeContentType(input?.contentType, fileName);
  const sizeBytes = Number(input?.sizeBytes);
  const maxBytes = readMaxBytes(env);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new ChurchResourceInputError(
      "File size must be a positive whole number.",
    );
  }
  if (sizeBytes > maxBytes) {
    throw new ChurchResourceInputError(
      `Files must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`,
    );
  }
  const id = input?.id == null ? undefined : normalizeId(String(input.id));
  const type = RESOURCE_TYPES.get(contentType);
  return {
    ...(id ? { id } : {}),
    fileName,
    contentType,
    sizeBytes,
    kind: type.kind,
  };
};

const resourceId = (value) => normalizeId(value);

export const buildPendingChurchResourceKey = ({ churchId, resourceId: id }) =>
  `pending/churches/${pathSegment(churchId, "Church ID")}/files/${pathSegment(
    resourceId(id),
    "Resource ID",
  )}/original`;

export const buildChurchResourceKey = ({ churchId, resourceId: id }) =>
  `churches/${pathSegment(churchId, "Church ID")}/files/${pathSegment(
    resourceId(id),
    "Resource ID",
  )}/original`;

export const isChurchResourceKeyForScope = ({
  key,
  churchId,
  resourceId: id,
  pending = false,
}) =>
  key ===
  (pending ? buildPendingChurchResourceKey : buildChurchResourceKey)({
    churchId,
    resourceId: id,
  });

const createResourceId = () => `churchResource_${randomUUID()}`;

const resourceStorageMetadata = ({ churchId, id, upload, uploadedAt }) => ({
  key: buildChurchResourceKey({ churchId, resourceId: id }),
  fileName: upload.fileName,
  contentType: upload.contentType,
  sizeBytes: upload.sizeBytes,
  uploadedAt,
});

export const createChurchResourceStorage = ({
  env = process.env,
  s3Client,
  signUrl,
  randomId = createResourceId,
  now = () => new Date().toISOString(),
} = {}) => {
  const resourcesBucket =
    typeof env.R2_RESOURCES_BUCKET === "string"
      ? env.R2_RESOURCES_BUCKET.trim()
      : "";
  if (!resourcesBucket) {
    // The low-level storage factory deliberately retains its SongAudio
    // R2_BUCKET fallback. Church resources are a separate trust boundary and
    // must never silently write into the audio bucket.
    throw new R2ObjectStorageNotConfiguredError(
      "Church resource storage is not configured. Set R2_RESOURCES_BUCKET.",
    );
  }
  const objectStorage = createR2ObjectStorage({
    env,
    bucket: resourcesBucket,
    s3Client,
    ...(signUrl ? { signUrl } : {}),
  });

  const createUpload = async ({ churchId, upload }) => {
    const validated = validateChurchResourceUpload(upload, env);
    const id = validated.id || randomId();
    const pendingKey = buildPendingChurchResourceKey({
      churchId,
      resourceId: id,
    });
    const signed = await objectStorage.createSignedUpload({
      key: pendingKey,
      contentType: validated.contentType,
      sizeBytes: validated.sizeBytes,
    });
    return {
      resourceUpload: { ...validated, id, key: pendingKey },
      ...signed,
    };
  };

  const completeUpload = async ({ churchId, upload }) => {
    const validated = validateChurchResourceUpload(upload, env);
    const id = normalizeId(validated.id);
    const pendingKey = requireNonEmptyString(upload?.key, "Storage key");
    const expectedPendingKey = buildPendingChurchResourceKey({
      churchId,
      resourceId: id,
    });
    if (pendingKey !== expectedPendingKey) {
      throw new ChurchResourceInputError(
        "That resource upload does not belong to this church.",
      );
    }

    const finalKey = buildChurchResourceKey({ churchId, resourceId: id });
    const validatedHeadSize = (head) => {
      const sizeBytes = Number(head.ContentLength);
      const headContentType = normalizeContentType(
        head.ContentType,
        validated.fileName,
      );
      const maxBytes = readMaxBytes(env);
      if (
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > maxBytes ||
        sizeBytes !== validated.sizeBytes ||
        headContentType !== validated.contentType
      ) {
        throw new ChurchResourceInputError(
          "The uploaded file is missing, has an unexpected type or size, or exceeds the size limit.",
        );
      }
      return sizeBytes;
    };

    let sizeBytes;
    try {
      sizeBytes = validatedHeadSize(await objectStorage.head({ key: pendingKey }));
    } catch (error) {
      // A client retry after a successful copy but a lost metadata response can
      // complete from the final object without duplicating the promotion.
      if (isR2NotFoundError(error)) {
        try {
          sizeBytes = validatedHeadSize(await objectStorage.head({ key: finalKey }));
          return {
            id,
            ...resourceStorageMetadata({
              churchId,
              id,
              upload: { ...validated, sizeBytes },
              uploadedAt: now(),
            }),
            kind: validated.kind,
          };
        } catch {
          // Fall through to the normal pending-object cleanup and original
          // error. The upload was not promoted and can be retried.
        }
      }
      try {
        await objectStorage.delete({ key: pendingKey });
      } catch (cleanupError) {
        console.error("Error cleaning rejected church resource upload:", cleanupError);
      }
      throw error;
    }

    await objectStorage.copy({
      sourceKey: pendingKey,
      targetKey: finalKey,
      contentType: validated.contentType,
    });
    try {
      await objectStorage.delete({ key: pendingKey });
    } catch (cleanupError) {
      console.error("Error cleaning completed church resource upload:", cleanupError);
    }
    return {
      id,
      ...resourceStorageMetadata({
        churchId,
        id,
        upload: { ...validated, sizeBytes },
        uploadedAt: now(),
      }),
      kind: validated.kind,
    };
  };

  const uploadFromServer = async ({ churchId, upload, body }) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
    const validated = validateChurchResourceUpload(
      { ...upload, sizeBytes: bytes.byteLength },
      env,
    );
    const id = randomId();
    const key = buildChurchResourceKey({ churchId, resourceId: id });
    await objectStorage.put({
      key,
      body: bytes,
      contentType: validated.contentType,
      sizeBytes: bytes.byteLength,
    });
    return {
      id,
      ...resourceStorageMetadata({
        churchId,
        id,
        upload: validated,
        uploadedAt: now(),
      }),
      kind: validated.kind,
    };
  };

  const createReadUrl = async ({ churchId, resource, disposition }) => {
    const id = normalizeId(resource?.id);
    const fileName = normalizeFileName(resource?.storage?.fileName);
    const key = buildChurchResourceKey({ churchId, resourceId: id });
    if (resource?.storage?.key && resource.storage.key !== key) {
      throw new ChurchResourceInputError("That resource is not available.");
    }
    const contentType = normalizeContentType(
      resource?.storage?.contentType,
      fileName,
    );
    return objectStorage.createSignedRead({
      key,
      contentType,
      fileName,
      disposition,
    });
  };

  const remove = async ({ churchId, resource }) => {
    const id = normalizeId(resource?.id);
    const key = buildChurchResourceKey({ churchId, resourceId: id });
    if (resource?.storage?.key && resource.storage.key !== key) {
      throw new ChurchResourceInputError("That resource is not available.");
    }
    await objectStorage.delete({ key });
  };

  return {
    bucket: objectStorage.bucket,
    createUpload,
    completeUpload,
    uploadFromServer,
    createReadUrl,
    remove,
  };
};

export const getChurchResourceMaxBytes = (env = process.env) =>
  readMaxBytes(env);
