import type { NotificationIntent } from "../../../api/authTypes";

export const isPersistedScheduleId = (scheduleId: string) =>
  Boolean(scheduleId) &&
  !scheduleId.startsWith("virtual:") &&
  !scheduleId.startsWith("local-schedule-");

export const scheduleNotificationHistoryScope = (
  churchId: string,
  scheduleId: string,
  canEdit: boolean,
) => churchId && canEdit && isPersistedScheduleId(scheduleId)
  ? JSON.stringify([churchId, scheduleId])
  : "";

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
