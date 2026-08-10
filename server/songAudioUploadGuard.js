const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_UPLOADS_PER_HOUR = 20;
const DEFAULT_UPLOAD_BYTES_PER_DAY = 1024 * 1024 * 1024;

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const requestedUploadBytes = (req) => {
  const bodySize = Number(req.body?.sizeBytes);
  if (Number.isSafeInteger(bodySize) && bodySize > 0) return bodySize;

  const contentLength = Number(req.get?.("content-length"));
  return Number.isSafeInteger(contentLength) && contentLength > 0
    ? contentLength
    : 0;
};

const consumeWindow = ({ records, key, now, windowMs, amount, limit }) => {
  const current = records.get(key);
  const record =
    current && now - current.startedAt < windowMs
      ? current
      : { startedAt: now, used: 0 };

  if (record.used + amount > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((record.startedAt + windowMs - now) / 1000),
      ),
    };
  }

  record.used += amount;
  records.set(key, record);
  return { allowed: true, retryAfterSeconds: 0 };
};

/**
 * Bounds accidental or abusive upload cost per server process. R2 lifecycle
 * rules provide the durable backstop for abandoned pending uploads.
 */
export const createSongAudioUploadGuard = ({
  env = process.env,
  now = Date.now,
} = {}) => {
  const uploadsPerHour = positiveInteger(
    env.SONG_AUDIO_UPLOADS_PER_HOUR,
    DEFAULT_UPLOADS_PER_HOUR,
  );
  const churchBytesPerDay = positiveInteger(
    env.SONG_AUDIO_UPLOAD_BYTES_PER_DAY,
    DEFAULT_UPLOAD_BYTES_PER_DAY,
  );
  const userRecords = new Map();
  const churchRecords = new Map();
  let lastPruneAt = 0;

  return (req, res, next) => {
    const currentTime = now();
    if (currentTime - lastPruneAt >= HOUR_MS) {
      for (const [key, record] of userRecords) {
        if (currentTime - record.startedAt >= HOUR_MS) userRecords.delete(key);
      }
      for (const [key, record] of churchRecords) {
        if (currentTime - record.startedAt >= DAY_MS) churchRecords.delete(key);
      }
      lastPruneAt = currentTime;
    }

    const churchId = req.appSession?.churchId || req.params?.churchId || "unknown";
    const userId = req.appSession?.userId || req.ip || "unknown";
    const userResult = consumeWindow({
      records: userRecords,
      key: `${churchId}:${userId}`,
      now: currentTime,
      windowMs: HOUR_MS,
      amount: 1,
      limit: uploadsPerHour,
    });
    if (!userResult.allowed) {
      res.set("Retry-After", String(userResult.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many MP3 uploads. Wait a little while, then try again.",
      });
    }

    const byteResult = consumeWindow({
      records: churchRecords,
      key: churchId,
      now: currentTime,
      windowMs: DAY_MS,
      amount: requestedUploadBytes(req),
      limit: churchBytesPerDay,
    });
    if (!byteResult.allowed) {
      res.set("Retry-After", String(byteResult.retryAfterSeconds));
      return res.status(429).json({
        error: "This church has reached its daily MP3 upload limit. Try again later.",
      });
    }

    return next();
  };
};

export const songAudioUploadGuardDefaults = {
  uploadsPerHour: DEFAULT_UPLOADS_PER_HOUR,
  uploadBytesPerDay: DEFAULT_UPLOAD_BYTES_PER_DAY,
};
