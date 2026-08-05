import type { TeamRecord, TeamSchedule } from "../../../api/authTypes";
import type { Option } from "../../../types";

// A schedule belongs to exactly one team, but the picker lists every team's
// schedules together — and teams commonly name theirs for the same month
// ("August 2026"), which leaves identical-looking entries. Grouping by team
// disambiguates them without adding a second control to the header.
//
// A church running ten teams adds ten schedules a month, so this list would
// grow past a hundred entries within a year. The picker is a quick-switcher for
// what an operator is actually working on, not a browser: it shows the most
// recent schedules per team and defers the full, filterable list to the
// schedules list page.

type SchedulePickerSchedule = Pick<
  TeamSchedule,
  "scheduleId" | "name" | "teamId" | "archivedAt"
> &
  Partial<Pick<TeamSchedule, "startDate" | "endDate">>;

type SchedulePickerTeam = Pick<TeamRecord, "teamId" | "name">;

/** Heading for schedules whose team is missing (deleted or not loaded). */
export const UNASSIGNED_SCHEDULE_GROUP = "Other schedules";

/**
 * Appended to the heading of the open schedule when its team is filtered out.
 * Without it the entry reads as the team filter leaking, rather than as the
 * schedule the operator currently has on screen.
 */
export const CURRENT_SCHEDULE_GROUP_SUFFIX = " — currently open";

/** How many schedules each team contributes to the quick-switcher. */
export const MAX_PICKER_SCHEDULES_PER_TEAM = 6;

/** Sentinel value for the entry that opens the full schedules list. */
export const BROWSE_ALL_SCHEDULES_VALUE = "__browse_all_schedules__";

/** Newest first, by date window and then name, so the current month leads. */
const byMostRecent = (
  a: SchedulePickerSchedule,
  b: SchedulePickerSchedule,
) => {
  const aDate = a.startDate || a.endDate || "";
  const bDate = b.startDate || b.endDate || "";
  if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
  if (aDate !== bDate) return aDate ? -1 : 1;
  return (a.name || "").localeCompare(b.name || "");
};

export const buildSchedulePickerOptions = ({
  schedules,
  teams,
  selectedScheduleId = "",
  includeArchived = false,
  teamId = "",
  maxPerTeam = MAX_PICKER_SCHEDULES_PER_TEAM,
}: {
  schedules: SchedulePickerSchedule[];
  teams: SchedulePickerTeam[];
  /** Always listed even when archived or beyond the per-team cap. */
  selectedScheduleId?: string;
  includeArchived?: boolean;
  /** Narrow to one team; empty means every team. */
  teamId?: string;
  maxPerTeam?: number;
}): Option[] => {
  const teamNameById = new Map(teams.map((team) => [team.teamId, team.name]));
  // Teams keep the order they appear in elsewhere on the page rather than being
  // re-sorted alphabetically; schedules with an unknown team sort last.
  const teamRank = new Map(teams.map((team, index) => [team.teamId, index]));

  // The open schedule always survives filtering, so narrowing to a team can
  // never leave the picker showing a blank trigger for what's on screen.
  const visible = schedules.filter((schedule) => {
    if (schedule.scheduleId === selectedScheduleId) return true;
    if (!includeArchived && schedule.archivedAt) return false;
    return !teamId || schedule.teamId === teamId;
  });

  // Cap per team on the most recent, but never hide the open schedule — an
  // operator who deep-linked to an old one must still see it selected.
  const byTeam = new Map<string, SchedulePickerSchedule[]>();
  visible.forEach((schedule) => {
    const key = schedule.teamId || "";
    byTeam.set(key, [...(byTeam.get(key) || []), schedule]);
  });
  const capped = [...byTeam.entries()].flatMap(([, teamSchedules]) => {
    const sorted = [...teamSchedules].sort(byMostRecent);
    const kept = sorted.slice(0, Math.max(0, maxPerTeam));
    const selected = sorted.find(
      (schedule) => schedule.scheduleId === selectedScheduleId,
    );
    if (selected && !kept.includes(selected)) kept.push(selected);
    return kept;
  });

  const ordered = capped.sort(
    (a, b) =>
      (teamRank.get(a.teamId) ?? Number.MAX_SAFE_INTEGER) -
        (teamRank.get(b.teamId) ?? Number.MAX_SAFE_INTEGER) ||
      byMostRecent(a, b),
  );

  // The open schedule survives the team filter, so say why it is listed instead
  // of leaving it looking like the filter failed.
  const isPinnedOutsideFilter = (schedule: SchedulePickerSchedule) =>
    Boolean(teamId) &&
    schedule.scheduleId === selectedScheduleId &&
    schedule.teamId !== teamId;

  // One team's worth of schedules needs no heading — skip the noise. A pinned
  // out-of-filter schedule always gets one, even if it is the only entry.
  const showGroups =
    new Set(ordered.map((schedule) => schedule.teamId || "")).size > 1 ||
    ordered.some(isPinnedOutsideFilter);

  const options: Option[] = ordered.map((schedule) => ({
    label: `${schedule.name}${schedule.archivedAt ? " (archived)" : ""}`,
    value: schedule.scheduleId,
    group: showGroups
      ? `${teamNameById.get(schedule.teamId) || UNASSIGNED_SCHEDULE_GROUP}${
        isPinnedOutsideFilter(schedule) ? CURRENT_SCHEDULE_GROUP_SUFFIX : ""
      }`
      : undefined,
  }));

  // Only offer the full list when the quick-switcher is actually hiding
  // something, so small churches never see a pointless extra row.
  if (options.length < schedules.length) {
    // Ungrouped so it reads as an action on the list, not another team's entry.
    options.push({
      label: "Browse all schedules…",
      value: BROWSE_ALL_SCHEDULES_VALUE,
    });
  }

  return options;
};
