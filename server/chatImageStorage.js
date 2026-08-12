import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";
import sharp from "sharp";

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_PIXELS = 40_000_000;
export const CHAT_IMAGE_FULL_MAX_WIDTH = 2048;
export const CHAT_IMAGE_THUMBNAIL_MAX_WIDTH = 480;

const SIGNED_URL_TTL_SECONDS = 15 * 60;
const IMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export class ChatImageInputError extends Error {
  statusCode = 400;
}

export class ChatImageStorageNotConfiguredError extends Error {
  statusCode = 503;
}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ChatImageInputError(`${label} is required.`);
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
  return fileName || "photo";
};

const readMaxBytes = (env) => {
  const configured = Number(env.CHAT_IMAGE_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : CHAT_IMAGE_MAX_BYTES;
};

export const validateChatImageUpload = (input, env = process.env) => {
  const fileName = normalizeFileName(input?.fileName);
  const contentType = requireNonEmptyString(
    input?.contentType,
    "Image type",
  ).toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
    throw new ChatImageInputError("Choose a JPEG, PNG, or WebP image.");
  }
  const sizeBytes = Number(input?.sizeBytes);
  const maxBytes = readMaxBytes(env);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new ChatImageInputError("Image size must be a positive whole number.");
  }
  if (sizeBytes > maxBytes) {
    throw new ChatImageInputError(
      `Images must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`,
    );
  }
  const id = input?.id == null ? undefined : String(input.id).trim();
  if (id != null && !IMAGE_ID_PATTERN.test(id)) {
    throw new ChatImageInputError("That image upload is not valid. Try again.");
  }
  return { id, fileName, contentType, sizeBytes };
};

const actorPath = (actorId) =>
  crypto.createHash("sha256").update(String(actorId)).digest("hex").slice(0, 32);

const messagePath = ({ churchId, actorId, clientMessageId }) =>
  crypto
    .createHash("sha256")
    .update(
      `${requireNonEmptyString(churchId, "Church ID")}:${requireNonEmptyString(actorId, "Actor ID")}:${requireNonEmptyString(clientMessageId, "Client message ID")}`,
    )
    .digest("hex")
    .slice(0, 32);

export const buildPendingChatImageKey = ({ churchId, actorId, imageId }) =>
  `pending/chat/churches/${pathSegment(churchId, "Church ID")}/${actorPath(requireNonEmptyString(actorId, "Actor ID"))}/${pathSegment(imageId, "Image ID")}/source`;

export const buildChatImageKey = ({ churchId, imageId, variant }) => {
  const suffix = variant === "thumbnail" ? "thumbnail.webp" : "image.webp";
  return `chat/churches/${pathSegment(churchId, "Church ID")}/${pathSegment(imageId, "Image ID")}/${suffix}`;
};

export const isChatImageKeyForScope = ({ key, churchId, imageId, variant }) =>
  key === buildChatImageKey({ churchId, imageId, variant });

const getStorageConfig = (env) => {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new ChatImageStorageNotConfiguredError(
      "Photo sharing is not configured yet. Send a text message instead.",
    );
  }
  return {
    bucket,
    endpoint:
      env.R2_ENDPOINT?.trim() ||
      `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  };
};

const isNotFoundError = (error) =>
  error?.name === "NotFound" ||
  error?.name === "NoSuchKey" ||
  error?.$metadata?.httpStatusCode === 404;

const numberMetadata = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export const processChatImageBuffer = async ({
  bytes,
  expectedContentType,
}) => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let metadata;
  try {
    metadata = await sharp(buffer, {
      animated: false,
      failOn: "warning",
      limitInputPixels: CHAT_IMAGE_MAX_PIXELS,
    }).metadata();
  } catch {
    throw new ChatImageInputError(
      "That image could not be read. Choose another image and try again.",
    );
  }

  const expectedFormat = SUPPORTED_IMAGE_TYPES.get(expectedContentType);
  if (!metadata.format || metadata.format !== expectedFormat) {
    throw new ChatImageInputError(
      "The image contents do not match the selected file type.",
    );
  }
  if ((metadata.pages || 1) > 1) {
    throw new ChatImageInputError("Animated images are not supported yet.");
  }
  if (!metadata.width || !metadata.height) {
    throw new ChatImageInputError("That image does not have valid dimensions.");
  }
  if (metadata.width * metadata.height > CHAT_IMAGE_MAX_PIXELS) {
    throw new ChatImageInputError("That image is too large to process safely.");
  }

  const source = sharp(buffer, {
    animated: false,
    failOn: "warning",
    limitInputPixels: CHAT_IMAGE_MAX_PIXELS,
  }).rotate();
  const [full, thumbnail] = await Promise.all([
    source
      .clone()
      .resize({
        width: CHAT_IMAGE_FULL_MAX_WIDTH,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer(),
    source
      .clone()
      .resize({
        width: CHAT_IMAGE_THUMBNAIL_MAX_WIDTH,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality: 76, effort: 4 })
      .toBuffer(),
  ]);
  const [fullMetadata, thumbnailMetadata] = await Promise.all([
    sharp(full).metadata(),
    sharp(thumbnail).metadata(),
  ]);

  return {
    full,
    thumbnail,
    width: fullMetadata.width,
    height: fullMetadata.height,
    thumbnailWidth: thumbnailMetadata.width,
    thumbnailHeight: thumbnailMetadata.height,
  };
};

const bodyToBuffer = async (body) => {
  if (!body) throw new ChatImageInputError("The uploaded image was empty.");
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export const createChatImageStorage = ({
  env = process.env,
  s3Client,
  signUrl = getSignedUrl,
  randomId = crypto.randomUUID,
} = {}) => {
  const config = getStorageConfig(env);
  const client =
    s3Client ||
    new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: config.credentials,
    });

  const attachmentFromHeads = ({
    churchId,
    imageId,
    messageKey,
    fullHead,
    thumbnailHead,
  }) => {
    const metadata = fullHead.Metadata || {};
    if (metadata.messagekey !== messageKey) {
      throw new ChatImageInputError(
        "That photo belongs to a different message. Add it again and retry.",
      );
    }
    const width = numberMetadata(metadata.width);
    const height = numberMetadata(metadata.height);
    const thumbnailWidth = numberMetadata(metadata.thumbnailwidth);
    const thumbnailHeight = numberMetadata(metadata.thumbnailheight);
    if (!width || !height || !thumbnailWidth || !thumbnailHeight) return null;
    return {
      type: "image",
      id: imageId,
      key: buildChatImageKey({ churchId, imageId, variant: "full" }),
      thumbnailKey: buildChatImageKey({
        churchId,
        imageId,
        variant: "thumbnail",
      }),
      contentType: "image/webp",
      sizeBytes: Number(fullHead.ContentLength) || 0,
      thumbnailSizeBytes: Number(thumbnailHead.ContentLength) || 0,
      width,
      height,
      thumbnailWidth,
      thumbnailHeight,
    };
  };

  const readExistingAttachment = async ({ churchId, imageId, messageKey }) => {
    try {
      const [fullHead, thumbnailHead] = await Promise.all([
        client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: buildChatImageKey({ churchId, imageId, variant: "full" }),
          }),
        ),
        client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: buildChatImageKey({
              churchId,
              imageId,
              variant: "thumbnail",
            }),
          }),
        ),
      ]);
      return attachmentFromHeads({
        churchId,
        imageId,
        messageKey,
        fullHead,
        thumbnailHead,
      });
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  };

  const createUpload = async ({ churchId, actorId, upload }) => {
    const validated = validateChatImageUpload(upload, env);
    const id = randomId();
    const imageUpload = { ...validated, id };
    const uploadUrl = await signUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: buildPendingChatImageKey({ churchId, actorId, imageId: id }),
        ContentType: validated.contentType,
        ContentLength: validated.sizeBytes,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return {
      imageUpload,
      uploadUrl,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  };

  const createUploadFromBuffer = async ({
    churchId,
    actorId,
    upload,
    body,
  }) => {
    if (!Buffer.isBuffer(body)) {
      throw new ChatImageInputError("Choose a JPEG, PNG, or WebP image.");
    }
    const bytes = body;
    const validated = validateChatImageUpload(
      { ...upload, sizeBytes: bytes.byteLength },
      env,
    );
    const id = randomId();
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: buildPendingChatImageKey({ churchId, actorId, imageId: id }),
        Body: bytes,
        ContentType: validated.contentType,
        ContentLength: bytes.byteLength,
      }),
    );
    return { imageUpload: { ...validated, id } };
  };

  const completeUpload = async ({
    churchId,
    actorId,
    clientMessageId,
    upload,
  }) => {
    const validated = validateChatImageUpload(upload, env);
    const imageId = validated.id;
    const messageKey = messagePath({ churchId, actorId, clientMessageId });
    const existing = await readExistingAttachment({
      churchId,
      imageId,
      messageKey,
    });
    if (existing) return existing;

    const pendingKey = buildPendingChatImageKey({
      churchId,
      actorId,
      imageId,
    });
    const pendingHead = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: pendingKey }),
    );
    if (
      Number(pendingHead.ContentLength) !== validated.sizeBytes ||
      String(pendingHead.ContentType || "").toLowerCase() !==
        validated.contentType
    ) {
      throw new ChatImageInputError(
        "The uploaded image did not match the requested upload.",
      );
    }
    const uploaded = await client.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: pendingKey }),
    );
    const source = await bodyToBuffer(uploaded.Body);
    if (source.byteLength !== validated.sizeBytes) {
      throw new ChatImageInputError("The uploaded image was incomplete.");
    }
    const processed = await processChatImageBuffer({
      bytes: source,
      expectedContentType: validated.contentType,
    });
    const fullKey = buildChatImageKey({
      churchId,
      imageId,
      variant: "full",
    });
    const thumbnailKey = buildChatImageKey({
      churchId,
      imageId,
      variant: "thumbnail",
    });
    const metadata = {
      width: String(processed.width),
      height: String(processed.height),
      thumbnailwidth: String(processed.thumbnailWidth),
      thumbnailheight: String(processed.thumbnailHeight),
      messagekey: messageKey,
    };
    await Promise.all([
      client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: fullKey,
          Body: processed.full,
          ContentType: "image/webp",
          ContentLength: processed.full.byteLength,
          ContentDisposition: 'inline; filename="chat-photo.webp"',
          CacheControl: "private, max-age=604800",
          Metadata: metadata,
        }),
      ),
      client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: thumbnailKey,
          Body: processed.thumbnail,
          ContentType: "image/webp",
          ContentLength: processed.thumbnail.byteLength,
          ContentDisposition: 'inline; filename="chat-photo-thumbnail.webp"',
          CacheControl: "private, max-age=604800",
        }),
      ),
    ]);
    await client
      .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: pendingKey }))
      .catch((error) =>
        console.error("Error cleaning completed chat image upload:", error),
      );
    return {
      type: "image",
      id: imageId,
      key: fullKey,
      thumbnailKey,
      contentType: "image/webp",
      sizeBytes: processed.full.byteLength,
      thumbnailSizeBytes: processed.thumbnail.byteLength,
      width: processed.width,
      height: processed.height,
      thumbnailWidth: processed.thumbnailWidth,
      thumbnailHeight: processed.thumbnailHeight,
    };
  };

  const getDownloadUrl = async ({ churchId, attachment, variant }) => {
    const imageId = String(attachment?.id || "");
    if (!IMAGE_ID_PATTERN.test(imageId)) {
      throw new ChatImageInputError("That chat image is not available.");
    }
    const thumbnail = variant === "thumbnail";
    const key = thumbnail ? attachment?.thumbnailKey : attachment?.key;
    if (
      !isChatImageKeyForScope({
        key,
        churchId,
        imageId,
        variant: thumbnail ? "thumbnail" : "full",
      })
    ) {
      throw new ChatImageInputError("That chat image is not available.");
    }
    const url = await signUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentType: "image/webp",
        ResponseContentDisposition: 'inline; filename="chat-photo.webp"',
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  };

  const deleteAttachment = async ({ churchId, attachment }) => {
    const imageId = String(attachment?.id || "");
    if (!IMAGE_ID_PATTERN.test(imageId)) return;
    const keys = [
      { key: attachment?.key, variant: "full" },
      { key: attachment?.thumbnailKey, variant: "thumbnail" },
    ].filter(({ key, variant }) =>
      isChatImageKeyForScope({ key, churchId, imageId, variant }),
    );
    await Promise.all(
      keys.map(({ key }) =>
        client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        ),
      ),
    );
  };

  return {
    createUpload,
    createUploadFromBuffer,
    completeUpload,
    getDownloadUrl,
    deleteAttachment,
  };
};
