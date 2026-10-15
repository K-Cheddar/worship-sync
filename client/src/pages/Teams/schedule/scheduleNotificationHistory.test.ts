import type { NotificationIntent } from "../../../api/authTypes";
import {
  isPersistedScheduleId,
  mergeScheduleNotificationIntents,
  scheduleNotificationHistoryScope,
} from "./scheduleNotificationHistory";

describe("schedule notification history scope", () => {
  it("allows persisted schedules and excludes virtual schedules", () => {
    expect(isPersistedScheduleId("schedule-1")).toBe(true);
    expect(isPersistedScheduleId("virtual:team:2026-11-01:2026-11-30")).toBe(false);
    expect(isPersistedScheduleId("local-schedule-new")).toBe(false);
    expect(scheduleNotificationHistoryScope("church-1", "schedule-1", true)).toBe(
      JSON.stringify(["church-1", "schedule-1"]),
    );
    expect(scheduleNotificationHistoryScope("church-1", "virtual:team:period", true)).toBe("");
    expect(scheduleNotificationHistoryScope("church-1", "schedule-1", false)).toBe("");
  });
});

const intent = (intentId: string, status = "preview") => ({
  intentId,
  status,
} as NotificationIntent);

describe("mergeScheduleNotificationIntents", () => {
  it("refreshes matching rows without duplicating them or dropping older loaded pages", () => {
    const merged = mergeScheduleNotificationIntents(
      [intent("new", "preview"), intent("old-page")],
      [intent("new", "sent"), intent("latest")],
    );

    expect(merged.map(({ intentId }) => intentId)).toEqual(["new", "latest", "old-page"]);
    expect(merged[0].status).toBe("sent");
  });
});
