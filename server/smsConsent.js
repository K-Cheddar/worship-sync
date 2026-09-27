import crypto from "node:crypto";
import { createSmsProviderForConfig } from "./smsProvider.js";

export const SMS_CONSENT_VERSION = "2026-09-23-church-scoped";

export const SMS_CONSENT_CODE_TTL_MS = 10 * 60 * 1000;
export const SMS_CONSENT_CANCELLATION_TTL_MS = SMS_CONSENT_CODE_TTL_MS;
export const SMS_CONSENT_MAX_ATTEMPTS = 5;

export const SMS_CONSENT_TEXT =
  "I agree to receive SMS messages from my church through WorshipSync about volunteer availability, scheduling, assignments, and related reminders. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to use WorshipSync.";

/**
 * Normalize a U.S. phone number to E.164 without accepting arbitrary digit
 * strings. The server remains the authority for validation and normalization.
 */
export const normalizeUsPhoneNumber = (value = "") => {
  const input = String(value || "").trim();
  if (!input || !/^\+?[\d\s().-]+$/.test(input)) return null;

  const digits = input.replace(/\D/g, "");
  const nationalNumber =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;

  if (!/^\d{10}$/.test(nationalNumber)) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nationalNumber)) return null;

  return `+1${nationalNumber}`;
};

const normalizeChurchId = (value) => String(value || "").trim();

/**
 * Consent is deliberately scoped to the church that will send the message.
 * Phone numbers are addresses, not identities, so the same normalized number
 * may have independent consent records in multiple churches.
 */
export const smsConsentKeyForChurchPhone = (churchId, phoneNumber) => {
  const normalizedChurchId = normalizeChurchId(churchId);
  const normalizedPhoneNumber = normalizeUsPhoneNumber(phoneNumber);
  if (!normalizedChurchId || !normalizedPhoneNumber) return null;
  return `${normalizedChurchId}:${normalizedPhoneNumber}`;
};

export const smsConsentIdForChurchPhone = (churchId, phoneNumber) => {
  const key = smsConsentKeyForChurchPhone(churchId, phoneNumber);
  if (!key) return null;
  return `smsConsent_${crypto.createHash("sha256").update(key).digest("hex")}`;
};

/** Legacy phone-global IDs are retained only for migration/audit inspection. */
export const smsConsentIdForLegacyPhone = (phoneNumber) => {
  const normalizedPhoneNumber = normalizeUsPhoneNumber(phoneNumber);
  if (!normalizedPhoneNumber) return null;
  return `smsConsent_${crypto
    .createHash("sha256")
    .update(normalizedPhoneNumber)
    .digest("hex")}`;
};

export const parseSmsConsentBody = (body = {}) => {
  const phoneNumber = normalizeUsPhoneNumber(body.phoneNumber);
  if (!phoneNumber) {
    return {
      ok: false,
      errorMessage: "Enter a valid 10-digit U.S. phone number.",
    };
  }

  if (body.consent !== true) {
    return {
      ok: false,
      errorMessage: "Check the box to agree to receive SMS messages.",
    };
  }

  const challengeId = String(body.challengeId || "").trim();
  const cancellationToken = String(body.cancellationToken || "").trim();
  if (
    Boolean(challengeId) !== Boolean(cancellationToken) ||
    (challengeId && !/^[a-f\d]{32}$/i.test(challengeId)) ||
    (cancellationToken && !/^[A-Za-z\d_-]{43}$/.test(cancellationToken))
  ) {
    return {
      ok: false,
      errorMessage: "Could not start SMS verification. Please try again.",
    };
  }

  return {
    ok: true,
    phoneNumber,
    ...(challengeId ? { challengeId, cancellationToken } : {}),
  };
};

export const parseSmsConsentVerificationBody = (body = {}) => {
  const phoneNumber = normalizeUsPhoneNumber(body.phoneNumber);
  const code = String(body.code || "").trim();
  const challengeId = String(body.challengeId || "").trim();
  if (
    !phoneNumber ||
    !/^\d{6}$/.test(code) ||
    (challengeId && !/^[a-f\d]{32}$/i.test(challengeId))
  ) {
    return { ok: false, errorMessage: "Enter the verification code we sent you." };
  }
  return { ok: true, phoneNumber, code, ...(challengeId ? { challengeId } : {}) };
};

export const parseSmsConsentCancellationBody = (body = {}) => {
  const phoneNumber = normalizeUsPhoneNumber(body.phoneNumber);
  const challengeId = String(body.challengeId || "").trim();
  const cancellationToken = String(body.cancellationToken || "").trim();
  if (
    !phoneNumber ||
    !/^[a-f\d]{32}$/i.test(challengeId) ||
    !/^[A-Za-z\d_-]{43}$/.test(cancellationToken)
  ) {
    return { ok: false, errorMessage: "Could not confirm SMS signup cancellation." };
  }
  return { ok: true, phoneNumber, challengeId, cancellationToken };
};

const hashCode = (code, salt) =>
  crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

const hashSmsConsentCancellationCapability = ({
  churchId,
  phoneNumber,
  challengeId,
  cancellationToken,
}) => {
  const normalizedChurchId = String(churchId || "").trim();
  const normalizedPhoneNumber = normalizeUsPhoneNumber(phoneNumber) || "";
  return crypto
    .createHash("sha256")
    .update(`sms-consent-cancel:${normalizedChurchId}:${normalizedPhoneNumber}:${challengeId}:${cancellationToken}`)
    .digest("hex");
};

export const matchesSmsConsentCancellationCapability = ({
  churchId,
  phoneNumber,
  challengeId,
  cancellationToken,
  storedHash,
  expiresAt,
  now = Date.now(),
}) => {
  const expirationTime = new Date(expiresAt || "").getTime();
  if (!Number.isFinite(expirationTime) || expirationTime <= now) return false;
  if (typeof storedHash !== "string" || !/^[a-f\d]{64}$/i.test(storedHash)) {
    return false;
  }
  const expected = Buffer.from(
    hashSmsConsentCancellationCapability({
      churchId,
      phoneNumber,
      challengeId,
      cancellationToken,
    }),
    "hex",
  );
  const actual = Buffer.from(storedHash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

export const createSmsConsentChallenge = ({
  churchId = "",
  phoneNumber = "",
  challengeId: suppliedChallengeId,
  cancellationToken: suppliedCancellationToken,
  now = Date.now(),
  randomCode = () => crypto.randomInt(100000, 1000000).toString(),
  randomSalt = () => crypto.randomBytes(16).toString("hex"),
  randomChallengeId = () => crypto.randomBytes(16).toString("hex"),
  randomCancellationToken = () => crypto.randomBytes(32).toString("base64url"),
} = {}) => {
  const code = randomCode();
  const salt = randomSalt();
  const challengeId = suppliedChallengeId || randomChallengeId();
  const cancellationToken = suppliedCancellationToken || randomCancellationToken();
  const expiresAt = new Date(now + SMS_CONSENT_CODE_TTL_MS).toISOString();
  return {
    code,
    codeHash: hashCode(code, salt),
    codeSalt: salt,
    challengeId,
    cancellationToken,
    cancellationTokenHash: hashSmsConsentCancellationCapability({
      churchId,
      phoneNumber,
      challengeId,
      cancellationToken,
    }),
    expiresAt,
  };
};

export const verifySmsConsentCode = ({ record, code, now = Date.now() }) => {
  if (
    !record ||
    !["pending", "opted_in"].includes(record.status) ||
    record.status === "opted_out" ||
    record.optedOutAt ||
    !record.verificationCodeHash
  ) {
    return { ok: false, reason: "unavailable" };
  }
  if (!record.verificationExpiresAt || new Date(record.verificationExpiresAt).getTime() <= now) {
    return { ok: false, reason: "expired" };
  }
  if ((record.verificationAttempts || 0) >= SMS_CONSENT_MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }
  if (hashCode(code, record.verificationCodeSalt) !== record.verificationCodeHash) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
};

let smsConsentSender = null;

export const setSmsConsentSenderForServerTests = (sender) => {
  smsConsentSender = typeof sender === "function" ? sender : null;
};

export const sendSmsConsentVerificationCode = async ({
  phoneNumber,
  code,
  challengeId,
  config,
} = {}) => {
  if (smsConsentSender) {
    return smsConsentSender({ phoneNumber, code, challengeId });
  }

  const provider = createSmsProviderForConfig({
    config: {
      ...config,
      provider: "twilio",
      messagingServiceId:
        config?.messagingServiceId || process.env.TWILIO_MESSAGING_SERVICE_SID,
      senderPhoneNumber:
        config?.senderPhoneNumber ||
        process.env.TWILIO_SMS_FROM_NUMBER ||
        process.env.TWILIO_FROM_NUMBER ||
        process.env.TWILIO_PHONE_NUMBER,
    },
  });
  await provider.sendMessage({
    to: phoneNumber,
    body: `Your WorshipSync verification code is ${code}. It expires in 10 minutes.`,
  });
  return { provider: "twilio", method: "sms_otp" };
};
