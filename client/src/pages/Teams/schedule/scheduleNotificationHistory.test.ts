import type { NotificationIntent } from "../../../api/authTypes";
import { mergeScheduleNotificationIntents } from "./scheduleNotificationHistory";

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
