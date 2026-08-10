import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

export const SONG_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const SUPPORTED_MP3_CONTENT_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/x-mpeg",
]);

export class SongAudioInputError extends Error {}
export class SongAudioStorageNotConfiguredError extends Error {}

const requireNonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new SongAudioInputError(`${label} is required.`);
  }
  return value.trim();
};

const normalizeFileName = (value) => {
  const fileName = requireNonEmptyString(value, "File name")
    .replace(/[\\/\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (!fileName.toLowerCase().endsWith(".mp3")) {
    throw new SongAudioInputError("Only MP3 files can be attached to a song.");
  }

  return fileName;
};

const normalizeContentType = (value) => {
  const contentType = requireNonEmptyString(
    value,
    "Content type",
  ).toLowerCase();
  if (!SUPPORTED_MP3_CONTENT_TYPES.has(contentType)) {
    throw new SongAudioInputError("Only MP3 audio can be attached to a song.");
  }
  return "audio/mpeg";
};

const readMaxBytes = (env) => {
  const configured = Number(env.SONG_AUDIO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : SONG_AUDIO_MAX_BYTES;
};

export const validateSongAudioUpload = (input, env = process.env) => {
  const fileName = normalizeFileName(input?.fileName);
  const contentType = normalizeContentType(input?.contentType);
  const sizeBytes = Number(input?.sizeBytes);
  const maxBytes = readMaxBytes(env);

  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new SongAudioInputError("File size must be a positive whole number.");
  }
  if (sizeBytes > maxBytes) {
    throw new SongAudioInputError(
      `MP3 files must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`,
    );
  }

  return { fileName, contentType, sizeBytes };
};

const pathSegment = (value, label) =>
  encodeURIComponent(requireNonEmptyString(value, label));

export const buildSongAudioObjectKey = ({ churchId, songId, audioId }) =>
  `churches/${pathSegment(churchId, "Church ID")}/songs/${pathSegment(songId, "Song ID")}/${pathSegment(audioId, "Audio ID")}.mp3`;

export const buildPendingSongAudioObjectKey = ({ churchId, songId, audioId }) =>
  `pending/churches/${pathSegment(churchId, "Church ID")}/songs/${pathSegment(songId, "Song ID")}/${pathSegment(audioId, "Audio ID")}.mp3`;

/** Kept for backward compatibility with songs uploaded before unique audio IDs. */
export const SONG_AUDIO_REFERENCE_ID = "reference";

export const isSongAudioKeyForScope = ({ key, churchId, songId, audioId }) =>
  key === buildSongAudioObjectKey({ churchId, songId, audioId });

const resolveFinalSongAudioTarget = ({
  churchId,
  songId,
  newAudioId,
  previousAudio,
}) => {
  if (previousAudio == null) {
    return {
      id: newAudioId,
      key: buildSongAudioObjectKey({
        churchId,
        songId,
        audioId: newAudioId,
      }),
    };
  }

  const id = requireNonEmptyString(previousAudio.id, "Previous audio ID");
  const key = requireNonEmptyString(previousAudio.key, "Previous storage key");
  if (!isSongAudioKeyForScope({ key, churchId, songId, audioId: id })) {
    throw new SongAudioInputError(
      "That previous audio file does not belong to this song.",
    );
  }

  // A song has one final R2 attachment slot. Replacements overwrite that
  // validated key so a failed client-side cleanup cannot leave final objects
  // accumulating under the song prefix.
  return { id, key };
};

export const getSongAudioStorageConfig = (env = process.env) => {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new SongAudioStorageNotConfiguredError(
      "Song audio storage is not configured.",
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

const contentDisposition = (fileName, disposition) => {
  const fallbackName = fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const encodedName = encodeURIComponent(fileName);
  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
};

// R2 requires a leading slash, and the key portion of x-amz-copy-source must
// be URL-encoded. This also preserves literal sequences such as "%20" in our
// encoded path segments instead of letting R2 interpret them as spaces.
export const buildSongAudioCopySource = (bucket, key) =>
  `/${requireNonEmptyString(bucket, "Bucket")}/${encodeURIComponent(requireNonEmptyString(key, "Storage key"))}`;

/**
 * Private R2 storage for original song MP3s. The returned metadata is safe to
 * persist in a PouchDB song document; signed URLs are intentionally transient.
 */
export const createSongAudioStorage = ({
  env = process.env,
  s3Client,
  signUrl = getSignedUrl,
} = {}) => {
  const config = getSongAudioStorageConfig(env);
  const client =
    s3Client ||
    new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      // Path-style hosts are `{accountId}.r2.cloudflarestorage.com`, which
      // Electron CSP can allowlist as `https://*.r2.cloudflarestorage.com`.
      // Virtual-hosted URLs nest the bucket as a second subdomain and do not
      // match that single-level wildcard.
      forcePathStyle: true,
      credentials: config.credentials,
    });

  const createUpload = async ({ churchId, songId, upload }) => {
    const { fileName, contentType, sizeBytes } = validateSongAudioUpload(
      upload,
      env,
    );
    const id = randomUUID();
    const key = buildPendingSongAudioObjectKey({
      churchId,
      songId,
      audioId: id,
    });
    const uploadUrl = await signUrl(
      client,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        // Content-Length becomes a SigV4 signed header. R2 rejects a PUT whose
        // actual body length differs from the validated upload intent.
        ContentLength: sizeBytes,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );

    return {
      audio: { id, key, fileName, contentType, sizeBytes },
      uploadUrl,
      expiresAt: new Date(
        Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  };

  const completeUpload = async ({
    churchId,
    songId,
    audio,
    previousAudio,
  }) => {
    const id = requireNonEmptyString(audio?.id, "Audio ID");
    const pendingKey = requireNonEmptyString(audio?.key, "Storage key");
    const fileName = normalizeFileName(audio?.fileName);
    const expectedSizeBytes = Number(audio?.sizeBytes);
    if (!Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1) {
      throw new SongAudioInputError(
        "File size must be a positive whole number.",
      );
    }
    const expectedPendingKey = buildPendingSongAudioObjectKey({
      churchId,
      songId,
      audioId: id,
    });
    if (pendingKey !== expectedPendingKey) {
      throw new SongAudioInputError(
        "That audio file does not belong to this song.",
      );
    }

    let sizeBytes;
    let contentType;
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: pendingKey }),
      );
      sizeBytes = Number(head.ContentLength);
      contentType = normalizeContentType(head.ContentType);
      const maxBytes = readMaxBytes(env);
      if (
        !Number.isSafeInteger(sizeBytes) ||
        sizeBytes < 1 ||
        sizeBytes > maxBytes ||
        sizeBytes !== expectedSizeBytes
      ) {
        throw new SongAudioInputError(
          "The uploaded MP3 is missing, has an unexpected size, or exceeds the size limit.",
        );
      }
    } catch (error) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: pendingKey }),
        );
      } catch (cleanupError) {
        console.error(
          "Error cleaning rejected song audio upload:",
          cleanupError,
        );
      }
      throw error;
    }

    const target = resolveFinalSongAudioTarget({
      churchId,
      songId,
      newAudioId: id,
      previousAudio,
    });
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: buildSongAudioCopySource(config.bucket, pendingKey),
        Key: target.key,
        ContentType: contentType,
        MetadataDirective: "REPLACE",
      }),
    );
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: pendingKey }),
      );
    } catch (cleanupError) {
      console.error("Error cleaning completed song audio upload:", cleanupError);
    }

    return {
      id: target.id,
      key: target.key,
      fileName,
      contentType,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
    };
  };

  /**
   * Packaged Electron renderers load from file://, which cannot be added to an
   * R2 CORS policy. Keep this authenticated fallback bounded to one MP3.
   */
  const uploadFromServer = async ({
    churchId,
    songId,
    upload,
    body,
    previousAudio,
  }) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || []);
    const { fileName, contentType, sizeBytes } = validateSongAudioUpload(
      { ...upload, sizeBytes: bytes.byteLength },
      env,
    );
    const id = randomUUID();
    const target = resolveFinalSongAudioTarget({
      churchId,
      songId,
      newAudioId: id,
      previousAudio,
    });
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: target.key,
        ContentType: contentType,
        Body: bytes,
      }),
    );
    return {
      id: target.id,
      key: target.key,
      fileName,
      contentType,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
    };
  };

  const createReadUrl = async ({ churchId, songId, audio, disposition }) => {
    const id = requireNonEmptyString(audio?.id, "Audio ID");
    const key = requireNonEmptyString(audio?.key, "Storage key");
    const fileName = normalizeFileName(audio?.fileName);
    if (!isSongAudioKeyForScope({ key, churchId, songId, audioId: id })) {
      throw new SongAudioInputError(
        "That audio file does not belong to this song.",
      );
    }
    const responseDisposition =
      disposition === "attachment" ? "attachment" : "inline";
    const url = await signUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ResponseContentType: "audio/mpeg",
        ResponseContentDisposition: contentDisposition(
          fileName,
          responseDisposition,
        ),
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

  const remove = async ({ churchId, songId, audio }) => {
    const id = requireNonEmptyString(audio?.id, "Audio ID");
    const key = requireNonEmptyString(audio?.key, "Storage key");
    if (!isSongAudioKeyForScope({ key, churchId, songId, audioId: id })) {
      throw new SongAudioInputError(
        "That audio file does not belong to this song.",
      );
    }
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  };

  return {
    createUpload,
    completeUpload,
    uploadFromServer,
    createReadUrl,
    remove,
  };
};
