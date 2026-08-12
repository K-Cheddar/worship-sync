import type { NotificationCategory } from "../api/authTypes";

/**
 * Reader-facing copy for each notification category.
 *
 * Which categories a person is *offered* comes from the server
 * (`AuthBootstrap.notificationCategories`) — only the wording lives here. That
 * split matters: adding a category or changing who sees it is a server change,
 * and a client that hardcoded the list would silently hide new switches from
 * anyone on an older build.
 *
 * Labels are written from the reader's side ("when I am scheduled"), not the
 * system's ("assignment created"), and each says plainly what arrives.
 */

export type NotificationCategoryCopy = {
  label: string;
  description: string;
  /** Used for the switch's accessible name. */
  ariaLabel: string;
};

export const NOTIFICATION_CATEGORY_COPY: Record<
  NotificationCategory,
  NotificationCategoryCopy
> = {
  scheduleAssignments: {
    label: "When I am scheduled",
    description:
      "Email me when I am added to a schedule, or my slot changes.",
    ariaLabel: "Email me when I am scheduled",
  },
  scheduleReminders: {
    label: "Reminders before I serve",
    description: "Email me a reminder ahead of a service I am on.",
    ariaLabel: "Email me reminders before I serve",
  },
  scheduleResponses: {
    label: "Responses from my team",
    description:
      "Email me when someone accepts, declines, or marks time off on a date they are scheduled.",
    ariaLabel: "Email me when someone responds to a schedule",
  },
  intakeSubmissions: {
    label: "New intake submissions",
    description: "Email me when someone submits a team availability form.",
    ariaLabel: "Email me about new intake submissions",
  },
};

/**
 * Keep the rendered order stable and sensible regardless of what order the
 * server sends: your own schedule first, then what you get as a leader.
 */
const DISPLAY_ORDER: NotificationCategory[] = [
  "scheduleAssignments",
  "scheduleReminders",
  "scheduleResponses",
  "intakeSubmissions",
];

export const orderNotificationCategories = (
  categories: NotificationCategory[] | undefined,
): NotificationCategory[] => {
  const offered = new Set(categories || []);
  return DISPLAY_ORDER.filter(
    (category) => offered.has(category) && NOTIFICATION_CATEGORY_COPY[category],
  );
};
