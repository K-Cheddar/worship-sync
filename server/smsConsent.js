export const SMS_CONSENT_VERSION = "2026-09-20";

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
