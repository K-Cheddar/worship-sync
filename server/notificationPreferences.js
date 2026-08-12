/**
 * Per-category notification preferences.
 *
 * Preferences are per *category*, not per event: an event list grows with every
 * feature, and nobody wants a settings screen with twelve switches. Each stays
 * the tri-state "on" | "off" | "default" that intake notifications already use,
 * so the default for a category can change later without rewriting every
 * membership row.
 *
 * This module is pure. Recipient lookup, sending, and the delivery ledger live
 * elsewhere; getting the resolution rules wrong here would silently mute people
 * or spam them, so it is kept separate and unit-tested.
 */

const PREFERENCE_VALUES = new Set(["on", "off", "default"]);

/**
 * Audience decides who is *offered* a category, not whether it fires. A
 * volunteer has no use for "someone responded to a schedule"; an owner who is
 * not on any roster has no use for "you were scheduled".
 * @typedef {"member" | "owner"} NotificationAudience
 */

/**
 * The catalog. Adding an event does not add a row here — only a genuinely new
 * kind of interruption does.
 *
 * `defaultEnabled` is what "default" resolves to for someone in the audience.
 * All four start opted in: a volunteer who is never told they were scheduled is
 * the failure this whole system exists to prevent, and an unwanted email is
 * recoverable in one click while a missed service is not.
 */
export const NOTIFICATION_CATEGORIES = Object.freeze({
  /** You were added to, moved on, or removed from a schedule. */
  scheduleAssignments: Object.freeze({
    audience: "member",
    defaultEnabled: true,
  }),
  /** A nudge before a service you are on. */
  scheduleReminders: Object.freeze({
    audience: "member",
    defaultEnabled: true,
  }),
  /**
   * Someone accepted, declined, or blocked out a date they are scheduled for.
   *
   * Coalesced into a per-schedule digest (20 minutes, same window as intake).
   * This shipped once as a switch with no dispatch behind it — a preference
   * promising mail that never arrives is worse than a missing one, because the
   * owner believes they are covered and stops checking. `offered: false` is the
   * lever for that, and it is what any future category should use until its
   * emails exist.
   */
  scheduleResponses: Object.freeze({
    audience: "owner",
    defaultEnabled: true,
  }),
  /** Someone submitted a team availability form. */
  intakeSubmissions: Object.freeze({
    audience: "owner",
    defaultEnabled: true,
  }),
});

export const NOTIFICATION_CATEGORY_KEYS = Object.freeze(
  Object.keys(NOTIFICATION_CATEGORIES),
);

/**
 * Resolve a stored value to the tri-state. Unknown and missing both become
 * "default" so the default can be changed later without a migration.
 * @param {unknown} value
 * @returns {"on" | "off" | "default"}
 */
export const normalizeNotificationPreference = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return PREFERENCE_VALUES.has(normalized) ? normalized : "default";
};

/**
 * Every known category, normalized. Unknown keys in storage are dropped rather
 * than preserved — a retired category should stop being consulted, and keeping
 * it would leak back into the API response.
 * @param {Record<string, unknown> | null | undefined} stored
 * @returns {Record<string, "on" | "off" | "default">}
 */
export const normalizeNotificationPreferences = (stored) => {
  const result = {};
  for (const key of NOTIFICATION_CATEGORY_KEYS) {
    result[key] = normalizeNotificationPreference(stored?.[key]);
  }
  return result;
};

/**
 * Whether a category should fire for someone who holds this preference.
 *
 * Note the shape: an *unknown category is muted*. A typo'd category name must
 * not become an un-mutable notification — failing closed here means a bug
 * shows up as a missing email, which someone reports, rather than as mail
 * nobody can turn off.
 * @param {string} category
 * @param {unknown} preference
 * @returns {boolean}
 */
export const isNotificationEnabled = (category, preference) => {
  const config = NOTIFICATION_CATEGORIES[category];
  if (!config) return false;
  const normalized = normalizeNotificationPreference(preference);
  if (normalized === "on") return true;
  if (normalized === "off") return false;
  return config.defaultEnabled;
};

/**
 * True when someone can edit team data anywhere in the church — the same bar
 * `requireTeamsEditForTeam` applies, evaluated against stored permissions.
 * @param {{ role?: string, teamsPermission?: string, teamScopes?: Record<string, string> }} params
 */
export const isTeamEditorAnywhere = ({ role, teamsPermission, teamScopes }) => {
  if (role === "admin") return true;
  if (teamsPermission === "edit") return true;
  return Object.values(teamScopes || {}).some((scope) => scope === "edit");
};

/**
 * Which categories to *show* this person.
 *
 * Owner categories are gated on edit access — offering a volunteer "someone
 * responded to a schedule" implies mail they will never receive.
 *
 * Member categories are shown to **everyone signed in**, deliberately, and not
 * gated on currently being on a roster. Roster membership is a circumstance
 * that changes without warning: gating would make the switch appear the day an
 * admin adds you and vanish the day they remove you, and would mean nobody can
 * set a preference *before* their first assignment — which is precisely when it
 * matters. It also keeps this a pure permission check, so the session bootstrap
 * does not have to read the roster on every authentication.
 *
 * The cost of being generous is a switch that does nothing for someone never
 * scheduled. That is invisible; the reverse is a missing control.
 * @param {{ role?: string, teamsPermission?: string, teamScopes?: Record<string, string> }} params
 * @returns {string[]}
 */
export const visibleNotificationCategories = ({
  role,
  teamsPermission,
  teamScopes,
}) => {
  const isOwner = isTeamEditorAnywhere({ role, teamsPermission, teamScopes });
  return NOTIFICATION_CATEGORY_KEYS.filter((key) => {
    const config = NOTIFICATION_CATEGORIES[key];
    if (config.offered === false) return false;
    return config.audience !== "owner" || isOwner;
  });
};
