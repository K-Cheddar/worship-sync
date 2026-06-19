/**
 * Pure logic for "who gets emailed when a team intake form is submitted."
 *
 * The recipient pool is *derived* from who can edit the form's teams (computed
 * in authService against the live membership/permission data) — this module
 * never stores a second list of people. Its job is the tri-state preference
 * resolution and the final filter/dedupe, which is the easy-to-get-wrong part.
 */

const PREFERENCE_VALUES = new Set(["on", "off", "default"]);

/**
 * Resolve a stored preference to one of "on" | "off" | "default".
 * Unknown/missing values become "default" so we can change the default
 * behavior later without rewriting membership rows.
 * @param {unknown} value
 * @returns {"on" | "off" | "default"}
 */
export const normalizeIntakeNotificationPreference = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return PREFERENCE_VALUES.has(normalized) ? normalized : "default";
};

/**
 * Editors are notified unless they have explicitly turned it off. "default"
 * (and anything unrecognized) resolves to on, so new editors are opted in.
 * @param {unknown} preference
 * @returns {boolean}
 */
export const isIntakeNotificationEnabled = (preference) =>
  normalizeIntakeNotificationPreference(preference) !== "off";

/**
 * True when a member can edit at least one of the form's teams — the same rule
 * `requireTeamsEditForTeam` enforces on the live session, evaluated against a
 * stored membership's normalized permissions. Admins and church-wide team
 * editors always qualify; otherwise a per-team "edit" scope on any of the
 * form's teams qualifies.
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
 * Select the addresses to notify from editor candidates carrying their own
 * preference. Drops non-editors, muted editors, and blank emails; dedupes
 * case-insensitively while preserving the first-seen casing for sending.
 * @param {Array<{ email?: string, isEditor?: boolean, preference?: unknown }>} candidates
 * @returns {string[]}
 */
export const selectIntakeNotifyRecipients = (candidates) => {
  const seen = new Set();
  const recipients = [];
  for (const candidate of candidates || []) {
    if (!candidate?.isEditor) continue;
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
