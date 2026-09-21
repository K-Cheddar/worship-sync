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
 * Apply the same process-local attempt and byte quota to both browser upload
 * intents and the Electron/server upload fallback. R2 lifecycle cleanup still
 * handles pending objects abandoned after an accepted intent.
 */
export const createChurchResourceUploadGuard = ({
  env = process.env,
  now = Date.now,
} = {}) => {
  const uploadsPerHour = positiveInteger(
    env.CHURCH_RESOURCE_UPLOADS_PER_HOUR,
    DEFAULT_UPLOADS_PER_HOUR,
  );
  const uploadBytesPerDay = positiveInteger(
    env.CHURCH_RESOURCE_UPLOAD_BYTES_PER_DAY,
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
    const attempt = consumeWindow({
      records: userRecords,
      key: `${churchId}:${userId}`,
      now: currentTime,
      windowMs: HOUR_MS,
      amount: 1,
      limit: uploadsPerHour,
    });
    if (!attempt.allowed) {
      res.set("Retry-After", String(attempt.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many church resource uploads. Wait a little while, then try again.",
      });
    }

    const bytes = consumeWindow({
      records: churchRecords,
      key: churchId,
      now: currentTime,
      windowMs: DAY_MS,
      amount: requestedUploadBytes(req),
      limit: uploadBytesPerDay,
    });
    if (!bytes.allowed) {
      res.set("Retry-After", String(bytes.retryAfterSeconds));
      return res.status(429).json({
        error: "This church has reached its daily resource upload limit. Try again later.",
      });
    }

    return next();
  };
};

export const churchResourceUploadGuardDefaults = {
  uploadsPerHour: DEFAULT_UPLOADS_PER_HOUR,
  uploadBytesPerDay: DEFAULT_UPLOAD_BYTES_PER_DAY,
};
