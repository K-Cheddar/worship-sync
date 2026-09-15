import test from "node:test";
import assert from "node:assert/strict";
import {
  getRestreamMessageCanonicalTimestampMs,
  getRestreamMessageExpirationDate,
  getRestreamMessageTimestampMs,
  getRestreamTemporaryTtlDate,
  RESTREAM_MESSAGE_RETENTION_DAYS,
  RESTREAM_MESSAGE_RETENTION_MS,
} from "./restreamRetention.js";

test("Restream retention uses provider posted time and the shared 90-day policy", () => {
  const postedAt = 1_700_000_000_000;
  const expiresAt = getRestreamMessageExpirationDate({ postedAt });

  assert.equal(RESTREAM_MESSAGE_RETENTION_DAYS, 90);
  assert.equal(expiresAt.getTime(), postedAt + RESTREAM_MESSAGE_RETENTION_MS);
});

test("legacy Restream timestamp selection falls back to receipt time", () => {
  const receivedAt = 1_700_000_123_000;

  assert.equal(
    getRestreamMessageTimestampMs({ receivedAt }),
    receivedAt,
  );
  assert.equal(
    getRestreamMessageExpirationDate({
      receivedAt,
      fallbackToNow: false,
    }).getTime(),
    receivedAt + RESTREAM_MESSAGE_RETENTION_MS,
  );
  assert.equal(
    getRestreamMessageExpirationDate({ fallbackToNow: false }),
    undefined,
  );
  assert.equal(
    getRestreamMessageCanonicalTimestampMs({
      receivedAt,
      fallbackToNow: false,
    }),
    receivedAt,
  );
});

test("temporary Restream TTL values are Firestore-native dates", () => {
  const expiresAt = 1_700_000_600_000;
  assert.equal(getRestreamTemporaryTtlDate(expiresAt).getTime(), expiresAt);
  assert.equal(getRestreamTemporaryTtlDate("not-a-date"), undefined);
});
