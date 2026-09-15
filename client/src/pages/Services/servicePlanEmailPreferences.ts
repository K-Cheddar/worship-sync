const RECENT_RECIPIENTS_KEY = "servicePlanEmailRecentRecipients";
const LAST_MESSAGE_KEY = "servicePlanEmailLastMessage";
const MAX_RECENT_RECIPIENTS = 20;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const canUseStorage = () => typeof window !== "undefined" && window.localStorage;

export const readRecentServicePlanEmailRecipients = (): string[] => {
  if (!canUseStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_RECIPIENTS_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .filter((value): value is string => typeof value === "string")
          .map(normalizeEmail)
          .filter(Boolean),
      ),
    ).slice(0, MAX_RECENT_RECIPIENTS);
  } catch {
    return [];
  }
};

export const rememberServicePlanEmailRecipients = (recipients: string[]) => {
  if (!canUseStorage()) return;
  const recent = recipients
    .map(normalizeEmail)
    .filter(Boolean);
  const merged = Array.from(new Set([...recent, ...readRecentServicePlanEmailRecipients()]));
  try {
    window.localStorage.setItem(
      RECENT_RECIPIENTS_KEY,
      JSON.stringify(merged.slice(0, MAX_RECENT_RECIPIENTS)),
    );
  } catch {
    // Local preferences are optional and must not affect sending.
  }
};

export const readLastServicePlanEmailMessage = (): string | null => {
  if (!canUseStorage()) return null;
  try {
    const message = window.localStorage.getItem(LAST_MESSAGE_KEY)?.trim();
    return message || null;
  } catch {
    return null;
  }
};

export const rememberLastServicePlanEmailMessage = (message: string) => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LAST_MESSAGE_KEY, message.trim());
  } catch {
    // Local preferences are optional and must not affect sending.
  }
};

export const servicePlanEmailPreferenceKeys = {
  recentRecipients: RECENT_RECIPIENTS_KEY,
  lastMessage: LAST_MESSAGE_KEY,
};
