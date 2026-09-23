export const CHURCH_MESSAGING_REGISTRATION_STATUSES = [
  "not_configured",
  "pending",
  "approved",
  "blocked",
];

export const normalizeChurchMessagingConfig = (value, churchId = "") => {
  if (!value || typeof value !== "object") return null;
  const normalizedChurchId = String(value.churchId || churchId || "").trim();
  if (!normalizedChurchId || value.provider !== "twilio") return null;
  const registrationStatus = CHURCH_MESSAGING_REGISTRATION_STATUSES.includes(
    value.registrationStatus,
  )
    ? value.registrationStatus
    : "not_configured";
  return {
    churchId: normalizedChurchId,
    provider: "twilio",
    ...(String(value.providerAccountId || "").trim()
      ? { providerAccountId: String(value.providerAccountId).trim() }
      : {}),
    ...(String(value.messagingServiceId || "").trim()
      ? { messagingServiceId: String(value.messagingServiceId).trim() }
      : {}),
    ...(String(value.senderPhoneNumber || "").trim()
      ? { senderPhoneNumber: String(value.senderPhoneNumber).trim() }
      : {}),
    registrationStatus,
    enabled: value.enabled === true,
    createdAt: String(value.createdAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim(),
  };
};

export const isChurchMessagingReady = (config) =>
  Boolean(
    config &&
      config.provider === "twilio" &&
      config.enabled === true &&
      config.registrationStatus === "approved",
  );

