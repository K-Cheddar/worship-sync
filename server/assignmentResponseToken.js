import crypto from "node:crypto";

/**
 * Single-purpose signed links for answering a schedule assignment from email.
 *
 * Volunteers frequently have **no account** — that is the whole reason the
 * roster and the account list are separate — so "click accept in the app"
 * cannot be the only path. A link in the email has to work on its own, which
 * means it carries its own authority.
 *
 * Deliberate limits on that authority:
 * - **One slot, one member.** The payload names the church, schedule,
 *   occurrence, cell, and member. A token cannot be repointed at a different
 *   slot, and it grants nothing except answering that one assignment.
 * - **No session, no read access.** Presenting a valid token answers an
 *   assignment. It does not sign anyone in, and it does not expose the roster,
 *   the schedule, or anyone else's answer.
 * - **Expires.** A link forwarded or left in an inbox for a year should not
 *   still act on someone's behalf.
 *
 * The response itself is *not* in the token: it is chosen at the link, so
 * accept and decline are one token rather than two, and a leaked "declined"
 * URL cannot be replayed to force a specific answer.
 */

/** Wide enough to cover reminders and a late schedule change, short enough that a stale inbox link stops working. */
export const ASSIGNMENT_TOKEN_TTL_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * The token names a **person and a schedule**, not a single slot.
 *
 * One link per slot was the first shape, and it was wrong twice over: an email
 * covering four services needed four links, and the page it opened could not
 * say *which* service it was asking about — the reader saw a bare "Can you
 * serve?" with no way to tell. Scoping to (member, schedule) lets one link show
 * everything they were asked and answer any or all of it.
 *
 * The authority is no wider in practice: a slot token already let the holder
 * answer for themselves, and every slot here belongs to that same person on
 * that same schedule. It still grants nothing else — no session, no roster, no
 * other member's answers.
 */
const FIELDS = ["churchId", "scheduleId", "memberId"];

const encode = (value) => Buffer.from(String(value ?? "")).toString("base64url");
const decode = (value) => Buffer.from(String(value ?? ""), "base64url").toString();

/**
 * Canonical string to sign. Field values are encoded, so a value containing the
 * separator cannot shift the boundaries and impersonate a different payload.
 */
const canonical = (payload, expiresAt) =>
  [...FIELDS.map((field) => encode(payload?.[field])), String(expiresAt)].join(
    ".",
  );

const sign = (secret, message) =>
  crypto.createHmac("sha256", secret).update(message).digest("base64url");

/**
 * @param {string} secret
 * @param {{churchId: string, scheduleId: string, occurrenceId: string, cellKey: string, memberId: string}} payload
 * @param {number} expiresAtMs
 * @returns {string}
 */
export const createAssignmentResponseToken = (
  secret,
  payload,
  expiresAtMs,
) => {
  const body = canonical(payload, expiresAtMs);
  return `${body}.${sign(secret, body)}`;
};

/**
 * Verify and decode. Returns `{ valid: false, reason }` rather than throwing so
 * the caller can tell an expired link ("ask for a new one") from a malformed
 * one ("this link is wrong"), which are different things to tell a reader.
 *
 * @returns {{ valid: true, payload: object, expiresAt: number } | { valid: false, reason: "malformed" | "signature" | "expired" }}
 */
export const readAssignmentResponseToken = (secret, token, nowMs = Date.now()) => {
  const parts = String(token || "").split(".");
  if (parts.length !== FIELDS.length + 2) {
    return { valid: false, reason: "malformed" };
  }
  const signature = parts[parts.length - 1];
  const body = parts.slice(0, -1).join(".");
  const expected = sign(secret, body);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return { valid: false, reason: "signature" };
  }

  const expiresAt = Number(parts[FIELDS.length]);
  if (!Number.isFinite(expiresAt)) {
    return { valid: false, reason: "malformed" };
  }
  // Expiry is checked only after the signature verifies, so an attacker cannot
  // learn anything by editing the timestamp.
  if (expiresAt <= nowMs) return { valid: false, reason: "expired" };

  const payload = {};
  FIELDS.forEach((field, index) => {
    payload[field] = decode(parts[index]);
  });
  if (FIELDS.some((field) => !payload[field])) {
    return { valid: false, reason: "malformed" };
  }
  return { valid: true, payload, expiresAt };
};
