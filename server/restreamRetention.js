export const RESTREAM_MESSAGE_RETENTION_DAYS = 90;
export const RESTREAM_MESSAGE_RETENTION_MS =
  RESTREAM_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const RESTREAM_MESSAGE_TTL_FIELD = "expiresAt";
export const RESTREAM_MESSAGE_CANONICAL_TIMESTAMP_FIELD = "messageTimestamp";

export const RESTREAM_CONNECT_STATE_TTL_MS = 10 * 60 * 1000;
export const RESTREAM_TEMPORARY_TTL_FIELD = "ttlExpireAt";

const toTimestampMs = (value, { unixSeconds = false } = {}) => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  if (value && typeof value.toMillis === "function") {
    const timestamp = value.toMillis();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return unixSeconds && Math.abs(value) < 1e12
      ? Math.round(value * 1000)
      : Math.round(value);
  }

  if (typeof value !== "string" || !value.trim()) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return unixSeconds && Math.abs(numeric) < 1e12
      ? Math.round(numeric * 1000)
      : Math.round(numeric);
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Select a message timestamp without inventing one for legacy records. Posted
 * time is authoritative when present; receipt/creation time is an explicit
 * fallback for records whose provider timestamp was not stored.
 */
export const getRestreamMessageTimestampMs = ({
  postedAt,
  receivedAt,
  createdAt,
  updatedAt,
} = {}) =>
  toTimestampMs(postedAt, { unixSeconds: true }) ??
  toTimestampMs(receivedAt) ??
  toTimestampMs(createdAt) ??
  toTimestampMs(updatedAt);

export const getRestreamMessageCanonicalTimestampMs = ({
  messageTimestamp,
  postedAt,
  receivedAt,
  createdAt,
  updatedAt,
  now = Date.now(),
  fallbackToNow = true,
} = {}) =>
  toTimestampMs(messageTimestamp) ??
  getRestreamMessageTimestampMs({
    postedAt,
    receivedAt,
    createdAt,
    updatedAt,
  }) ??
  (fallbackToNow ? now : undefined);

export const getRestreamMessageExpirationDate = ({
  messageTimestamp,
  postedAt,
  receivedAt,
  createdAt,
  updatedAt,
  now = Date.now(),
  fallbackToNow = true,
} = {}) => {
  const timestampMs = getRestreamMessageCanonicalTimestampMs({
    messageTimestamp,
    postedAt,
    receivedAt,
    createdAt,
    updatedAt,
    now,
    fallbackToNow,
  });

  return Number.isFinite(timestampMs)
    ? new Date(timestampMs + RESTREAM_MESSAGE_RETENTION_MS)
    : undefined;
};

export const getRestreamMessageExpirationTimestampMs = ({
  expiresAt,
  messageTimestamp,
  postedAt,
  receivedAt,
  createdAt,
  updatedAt,
} = {}) => {
  const storedExpirationMs = toTimestampMs(expiresAt);
  if (Number.isFinite(storedExpirationMs)) return storedExpirationMs;

  return getRestreamMessageExpirationDate({
    messageTimestamp,
    postedAt,
    receivedAt,
    createdAt,
    updatedAt,
    fallbackToNow: false,
  })?.getTime();
};

export const getRestreamTemporaryTtlDate = (expiresAtMs) => {
  const timestamp = Number(expiresAtMs);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
};
