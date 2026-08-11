import type { NotificationCategory } from "../api/authTypes";
import {
  NOTIFICATION_CATEGORY_COPY,
  orderNotificationCategories,
} from "./notificationCategories";

describe("orderNotificationCategories", () => {
  it("renders in a stable order regardless of what the server sends", () => {
    expect(
      orderNotificationCategories([
        "intakeSubmissions",
        "scheduleReminders",
        "scheduleAssignments",
      ]),
    ).toEqual([
      "scheduleAssignments",
      "scheduleReminders",
      "intakeSubmissions",
    ]);
  });

  it("offers a schedule-only volunteer just their own categories", () => {
    expect(
      orderNotificationCategories(["scheduleAssignments", "scheduleReminders"]),
    ).toEqual(["scheduleAssignments", "scheduleReminders"]);
  });

  it("drops a category this client has no copy for", () => {
    // The server owns the catalog, so a newer category can arrive before the
    // client knows how to describe it. Rendering a switch with no label would
    // be worse than omitting it until the client catches up.
    expect(
      orderNotificationCategories([
        "scheduleAssignments",
        "somethingNewer" as NotificationCategory,
      ]),
    ).toEqual(["scheduleAssignments"]);
  });

  it("returns nothing for a missing or empty list", () => {
    expect(orderNotificationCategories(undefined)).toEqual([]);
    expect(orderNotificationCategories([])).toEqual([]);
  });

  it("has reader-facing copy for every category it can render", () => {
    const rendered = orderNotificationCategories([
      "scheduleAssignments",
      "scheduleReminders",
      "scheduleResponses",
      "intakeSubmissions",
    ]);

    const missing = rendered.filter((category) => {
      const copy = NOTIFICATION_CATEGORY_COPY[category];
      return !copy?.label || !copy?.description || !copy?.ariaLabel;
    });
    expect(missing).toEqual([]);
  });
});
