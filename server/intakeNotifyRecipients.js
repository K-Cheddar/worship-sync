/**
 * Pure logic for "who gets emailed when a team intake form is submitted."
 *
 * The recipient pool is *derived* from designated leads on the form's teams
 * (computed in authService against live roster/membership data) — this module
 * never stores a second list of people. Its job is the final filter/dedupe and
 * the digest coalescing decision, which are the easy-to-get-wrong parts.
 */

import {
  isNotificationEnabled,
  normalizeNotificationPreference,
} from "./notificationPreferences.js";

/**
 * Intake is one category in the shared catalog; the tri-state rules live there
 * so every category resolves identically. Re-exported under the original names
 * because this module's callers and tests predate the catalog.
 */
export const normalizeIntakeNotificationPreference = (value) =>
  normalizeNotificationPreference(value);

/**
 * Leads are notified unless they have explicitly turned it off. "default"
 * (and anything unrecognized) resolves to on, so new leads are opted in.
 * @param {unknown} preference
 * @returns {boolean}
 */
export const isIntakeNotificationEnabled = (preference) =>
  isNotificationEnabled("intakeSubmissions", preference);

/**
 * True when a member is designated as a lead on at least one of the form's
 * teams. An empty formTeamIds means the form covers every team.
 * @param {{ teamMemberships?: Record<string, { teamId?: string, isTeamLead?: boolean }>, formTeamIds?: string[] }} params
 * @returns {boolean}
 */
export const isTeamLeadForForm = ({
  teamMemberships,
  formTeamIds,
}) => {
  const memberships = teamMemberships || {};
  const teamIds = formTeamIds || [];
  return Object.values(memberships).some(
    (membership) =>
      membership?.isTeamLead === true &&
      (teamIds.length === 0 || teamIds.includes(membership.teamId)),
  );
};

/**
 * Existing permission rule used by schedule-response notifications.
 * @param {{ role?: string, teamsPermission?: string, teamScopes?: Record<string, string>, formTeamIds?: string[] }} params
 * @returns {boolean}
 */
export const isTeamEditorForForm = ({
  role,
  teamsPermission,
  teamScopes,
  formTeamIds,
}) => {
  if (role === "admin") return true;
  if (teamsPermission === "edit") return true;
  const scopes = teamScopes || {};
  return (formTeamIds || []).some((teamId) => scopes[teamId] === "edit");
};

/**
 * Decide what a submission should do to the per-form digest, given the
 * persisted marker and whether this process already has a timer armed. Pure so
 * the coalescing + restart-recovery behavior is testable without timers.
 * - "open-window": no marker yet — set it and arm a timer.
 * - "noop": a timer is already coalescing this window.
 * - "flush-now": a marker outlived its timer (process restart) and the window
 *   has already elapsed — send immediately rather than wait another window.
 * - "arm-timer": a marker exists with no timer but the window hasn't elapsed
 *   (restart mid-window) — re-arm without moving the marker.
 * @param {{ pendingSince?: string | null, hasArmedTimer?: boolean, nowMs: number, windowMs: number }} params
 * @returns {"open-window" | "noop" | "flush-now" | "arm-timer"}
 */
export const decideDigestAction = ({
  pendingSince,
  hasArmedTimer,
  nowMs,
  windowMs,
}) => {
  if (!pendingSince) return "open-window";
  if (hasArmedTimer) return "noop";
  const elapsed = nowMs - new Date(pendingSince).getTime();
  if (Number.isNaN(elapsed)) return "open-window"; // corrupt marker — restart it
  return elapsed >= windowMs ? "flush-now" : "arm-timer";
};

/**
 * Names to list in a digest: submissions in the window (submittedAt >= since),
 * oldest first, with a fallback for missing names. Captures the inclusion
 * boundary so it can be tested independently of Firestore.
 * @param {Array<{ submittedAt?: string, firstName?: string, lastName?: string }>} submissions
 * @param {string} since
 * @returns {string[]}
 */
export const collectDigestSubmitterNames = (submissions, since) =>
  (submissions || [])
    .filter((submission) => (submission?.submittedAt || "") >= since)
    .sort((a, b) =>
      (a?.submittedAt || "").localeCompare(b?.submittedAt || ""),
    )
    .map((submission) => {
      const name =
        `${submission?.firstName || ""} ${submission?.lastName || ""}`.trim();
      return name || "Someone";
    });

/**
 * Select the addresses to notify from lead candidates carrying their own
 * preference. Drops non-leads, muted leads, and blank emails; dedupes
 * case-insensitively while preserving the first-seen casing for sending.
 * @param {Array<{ email?: string, isTeamLead?: boolean, preference?: unknown }>} candidates
 * @returns {string[]}
 */
export const selectIntakeNotifyRecipients = (candidates) => {
  const seen = new Set();
  const recipients = [];
  for (const candidate of candidates || []) {
    if (!candidate?.isTeamLead) continue;
    if (!isIntakeNotificationEnabled(candidate.preference)) continue;
    const email = String(candidate.email || "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(email);
  }
  return recipients;
};
