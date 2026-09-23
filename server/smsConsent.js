import crypto from "node:crypto";

export const SMS_CONSENT_VERSION = "2026-09-20";

export const SMS_CONSENT_CODE_TTL_MS = 10 * 60 * 1000;
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

  return { ok: true, phoneNumber };
};

export const parseSmsConsentVerificationBody = (body = {}) => {
  const phoneNumber = normalizeUsPhoneNumber(body.phoneNumber);
  const code = String(body.code || "").trim();
  if (!phoneNumber || !/^\d{6}$/.test(code)) {
    return { ok: false, errorMessage: "Enter the verification code we sent you." };
  }
  return { ok: true, phoneNumber, code };
};

const hashCode = (code, salt) =>
  crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");

export const createSmsConsentChallenge = ({
  now = Date.now(),
  randomCode = () => crypto.randomInt(100000, 1000000).toString(),
  randomSalt = () => crypto.randomBytes(16).toString("hex"),
} = {}) => {
  const code = randomCode();
  const salt = randomSalt();
  return {
    code,
    codeHash: hashCode(code, salt),
    codeSalt: salt,
    expiresAt: new Date(now + SMS_CONSENT_CODE_TTL_MS).toISOString(),
  };
};

export const verifySmsConsentCode = ({ record, code, now = Date.now() }) => {
  if (
    !record ||
    !["pending", "opted_in"].includes(record.status) ||
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

export const sendSmsConsentVerificationCode = async ({ phoneNumber, code }) => {
  if (smsConsentSender) {
    return smsConsentSender({ phoneNumber, code });
  }

  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(
    process.env.TWILIO_SMS_FROM_NUMBER ||
      process.env.TWILIO_FROM_NUMBER ||
      process.env.TWILIO_PHONE_NUMBER ||
      "",
  ).trim();
  const messagingServiceSid = String(
    process.env.TWILIO_MESSAGING_SERVICE_SID || "",
  ).trim();
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
    const error = new Error("SMS verification is not configured on this server.");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: phoneNumber,
        ...(messagingServiceSid
          ? { MessagingServiceSid: messagingServiceSid }
          : { From: from }),
        Body: `Your WorshipSync verification code is ${code}. It expires in 10 minutes.`,
      }),
    },
  );
  if (!response.ok) {
    const error = new Error("The verification message could not be sent.");
    error.statusCode = response.status >= 500 ? 503 : 502;
    throw error;
  }
  return { provider: "twilio", method: "sms_otp" };
};
