import { randomUUID } from "node:crypto";
import {
  buildR2CopySource,
  createR2ObjectStorage,
} from "./storage/r2ObjectStorage.js";

export const SONG_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
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

// R2 requires a leading slash, and the key portion of x-amz-copy-source must
// be URL-encoded. This also preserves literal sequences such as "%20" in our
// encoded path segments instead of letting R2 interpret them as spaces.
export const buildSongAudioCopySource = (bucket, key) =>
  buildR2CopySource(
    requireNonEmptyString(bucket, "Bucket"),
    requireNonEmptyString(key, "Storage key"),
  );

/**
 * Private R2 storage for original song MP3s. The returned metadata is safe to
 * persist in a PouchDB song document; signed URLs are intentionally transient.
 */
export const createSongAudioStorage = ({
  env = process.env,
  s3Client,
  signUrl,
} = {}) => {
  const config = getSongAudioStorageConfig(env);
  const objectStorage = createR2ObjectStorage({
    env,
    bucket: config.bucket,
    s3Client,
    ...(signUrl ? { signUrl } : {}),
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
    const { uploadUrl, expiresAt } = await objectStorage.createSignedUpload({
      key,
      contentType,
      sizeBytes,
    });

    return {
      audio: { id, key, fileName, contentType, sizeBytes },
      uploadUrl,
      expiresAt,
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
      const head = await objectStorage.head({ key: pendingKey });
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
        await objectStorage.delete({ key: pendingKey });
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
    await objectStorage.copy({
      sourceKey: pendingKey,
      targetKey: target.key,
      contentType,
    });
    try {
      await objectStorage.delete({ key: pendingKey });
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
    await objectStorage.put({
      key: target.key,
      contentType,
      body: bytes,
    });
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
    return objectStorage.createSignedRead({
      key,
      contentType: "audio/mpeg",
      fileName,
      disposition: responseDisposition,
    });
  };

  const remove = async ({ churchId, songId, audio }) => {
    const id = requireNonEmptyString(audio?.id, "Audio ID");
    const key = requireNonEmptyString(audio?.key, "Storage key");
    if (!isSongAudioKeyForScope({ key, churchId, songId, audioId: id })) {
      throw new SongAudioInputError(
        "That audio file does not belong to this song.",
      );
    }
    await objectStorage.delete({ key });
  };

  return {
    createUpload,
    completeUpload,
    uploadFromServer,
    createReadUrl,
    remove,
  };
};
