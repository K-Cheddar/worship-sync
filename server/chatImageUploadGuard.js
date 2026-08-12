const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_UPLOADS_PER_HOUR = 12;
const DEFAULT_UPLOAD_BYTES_PER_DAY = 250 * 1024 * 1024;
const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const requestedBytes = (req, fallbackBytes) => {
  const bodySize = Number(req.body?.sizeBytes);
  if (Number.isSafeInteger(bodySize) && bodySize > 0) return bodySize;
  const contentLength = Number(req.get?.("content-length"));
  return Number.isSafeInteger(contentLength) && contentLength > 0
    ? contentLength
    : fallbackBytes;
};

const consume = ({ records, key, currentTime, windowMs, amount, limit }) => {
  const existing = records.get(key);
  const record =
    existing && currentTime - existing.startedAt < windowMs
      ? existing
      : { startedAt: currentTime, used: 0 };
  if (record.used + amount > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((record.startedAt + windowMs - currentTime) / 1000),
      ),
    };
  }
  record.used += amount;
  records.set(key, record);
  return { allowed: true, retryAfterSeconds: 0 };
};

export const createChatImageUploadGuard = ({
  env = process.env,
  now = Date.now,
} = {}) => {
  const uploadLimit = positiveInteger(
    env.CHAT_IMAGE_UPLOADS_PER_HOUR,
    DEFAULT_UPLOADS_PER_HOUR,
  );
  const byteLimit = positiveInteger(
    env.CHAT_IMAGE_UPLOAD_BYTES_PER_DAY,
    DEFAULT_UPLOAD_BYTES_PER_DAY,
  );
  const maxUploadBytes = positiveInteger(
    env.CHAT_IMAGE_MAX_BYTES,
    DEFAULT_UPLOAD_MAX_BYTES,
  );
  const actorRecords = new Map();
  const churchRecords = new Map();
  let lastPruneAt = 0;

  return (req, res, next) => {
    const currentTime = now();
    if (currentTime - lastPruneAt >= HOUR_MS) {
      for (const [key, record] of actorRecords) {
        if (currentTime - record.startedAt >= HOUR_MS) actorRecords.delete(key);
      }
      for (const [key, record] of churchRecords) {
        if (currentTime - record.startedAt >= DAY_MS)
          churchRecords.delete(key);
      }
      lastPruneAt = currentTime;
    }

    const churchId = req.appSession?.churchId || req.params?.churchId || "unknown";
    const actorId = req.appSession?.actorId || req.ip || "unknown";
    const actorResult = consume({
      records: actorRecords,
      key: `${churchId}:${actorId}`,
      currentTime,
      windowMs: HOUR_MS,
      amount: 1,
      limit: uploadLimit,
    });
    if (!actorResult.allowed) {
      res.set("Retry-After", String(actorResult.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many photo uploads. Wait a little while, then try again.",
      });
    }

    const byteResult = consume({
      records: churchRecords,
      key: churchId,
      currentTime,
      windowMs: DAY_MS,
      // A chunked proxy upload may omit Content-Length. Charge the maximum
      // accepted object size so an unknown length can never bypass the quota.
      amount: requestedBytes(req, maxUploadBytes),
      limit: byteLimit,
    });
    if (!byteResult.allowed) {
      res.set("Retry-After", String(byteResult.retryAfterSeconds));
      return res.status(429).json({
        error: "This church has reached its daily photo upload limit. Try again later.",
      });
    }
    return next();
  };
};

export const createChatImageFinalizeGuard = () => {
  const activeFinalizations = new Set();

  return (req, res, next) => {
    const uploadId = String(req.body?.imageUpload?.id || "").trim();
    if (!uploadId) return next();

    const churchId = req.appSession?.churchId || req.params?.churchId || "unknown";
    const actorId = req.appSession?.actorId || req.ip || "unknown";
    const key = `${churchId}:${actorId}:${uploadId}`;
    if (activeFinalizations.has(key)) {
      return res.status(409).json({
        error:
          "That photo is already being processed. Wait for it to finish, then try again.",
      });
    }

    activeFinalizations.add(key);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeFinalizations.delete(key);
    };
    res.locals = res.locals || {};
    res.locals.releaseChatImageFinalize = release;
    res.once("finish", release);

    try {
      return next();
    } catch (error) {
      release();
      throw error;
    }
  };
};

export const chatImageUploadGuardDefaults = {
  uploadsPerHour: DEFAULT_UPLOADS_PER_HOUR,
  uploadBytesPerDay: DEFAULT_UPLOAD_BYTES_PER_DAY,
};
