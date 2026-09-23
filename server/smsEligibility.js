import { normalizeUsPhoneNumber } from "./phoneNumber.js";

export const SMS_MEMBER_ELIGIBILITY_STATUSES = [
  "no_mobile",
  "consent_needed",
  "enabled",
  "opted_out",
];

const normalizeMemberPhoneNumber = (value) => {
  try {
    return normalizeUsPhoneNumber(value);
  } catch {
    return "";
  }
};

const isOptedOutConsent = (consent) =>
  consent?.status === "opted_out" ||
  Boolean(consent?.optedOutAt) ||
  consent?.optedOut === true;

/**
 * SMS communication eligibility is deliberately separate from email/account
 * notification eligibility. A phone number is a communication address, not an
 * identity, so shared numbers receive the same phone-level consent decision.
 */
export const resolveSmsMemberEligibility = (member, consent) => {
  const phoneNumber = normalizeMemberPhoneNumber(member?.phoneNumber);
  if (!phoneNumber) {
    return { status: "no_mobile", eligible: false, phoneNumber: "" };
  }
  if (isOptedOutConsent(consent)) {
    return { status: "opted_out", eligible: false, phoneNumber };
  }
  if (consent?.status !== "opted_in") {
    return { status: "consent_needed", eligible: false, phoneNumber };
  }
  return { status: "enabled", eligible: true, phoneNumber };
};

export const canSmsMember = (member, consent) =>
  resolveSmsMemberEligibility(member, consent).eligible;

