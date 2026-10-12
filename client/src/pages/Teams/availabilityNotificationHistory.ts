import { getNotificationIntents, getTeamIntakeSmsAttempts } from "../../api/auth";
import type { NotificationIntent, SmsDeliveryAttempt } from "../../api/authTypes";

export type AvailabilityNotificationHistory = {
  intents: NotificationIntent[];
  attempts: SmsDeliveryAttempt[];
};

/** Loads the complete history needed to keep old requests out of a new send. */
export const loadAvailabilityNotificationHistory = async (
  churchId: string,
  formId: string,
): Promise<AvailabilityNotificationHistory> => {
  const loadIntents = async () => {
    const intents: NotificationIntent[] = [];
    let cursor = "";
    do {
      const page = await getNotificationIntents(churchId, {
        formId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!page.success || !Array.isArray(page.intents)) {
        throw new Error("Could not load complete form message history.");
      }
      intents.push(...page.intents);
      cursor = page.nextCursor || "";
    } while (cursor);
    return intents;
  };

  const [intents, attemptsResponse] = await Promise.all([
    loadIntents(),
    getTeamIntakeSmsAttempts(churchId, formId),
  ]);
  if (!attemptsResponse.success || !Array.isArray(attemptsResponse.attempts)) {
    throw new Error("Could not load complete SMS delivery history.");
  }
  return { intents, attempts: attemptsResponse.attempts };
};
