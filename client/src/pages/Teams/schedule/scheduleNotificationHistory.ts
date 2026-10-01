import type { NotificationIntent } from "../../../api/authTypes";

/** Prefer refreshed copies while retaining older pages already loaded by the operator. */
export const mergeScheduleNotificationIntents = (
  current: NotificationIntent[],
  incoming: NotificationIntent[],
) => {
  const byId = new Map<string, NotificationIntent>();
  incoming.forEach((intent) => byId.set(intent.intentId, intent));
  current.forEach((intent) => {
    if (!byId.has(intent.intentId)) byId.set(intent.intentId, intent);
  });
  return [...byId.values()];
};
