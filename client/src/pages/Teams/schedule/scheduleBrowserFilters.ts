import type { TeamRecord, TeamSchedule } from "../../../api/authTypes";

/**
 * Filtering for the "browse all schedules" view. Kept separate from the dialog
 * so the matching rules — which decide what an operator can find once a church
 * has a few hundred schedules — are unit-testable on their own.
 */

export type ScheduleBrowserStatus = "active" | "archived" | "all";

export type ScheduleBrowserFilters = {
  search: string;
  teamId: string;
  status: ScheduleBrowserStatus;
  startDate: string;
  endDate: string;
};

export const emptyScheduleBrowserFilters: ScheduleBrowserFilters = {
  search: "",
  teamId: "",
  status: "active",
  startDate: "",
  endDate: "",
};

type BrowsableSchedule = Pick<
  TeamSchedule,
  "scheduleId" | "name" | "teamId" | "archivedAt"
> &
  Partial<Pick<TeamSchedule, "startDate" | "endDate">>;

export type ScheduleBrowserRow<T extends BrowsableSchedule> = {
  schedule: T;
  teamName: string;
};

/** Inclusive overlap between a schedule's window and the filter's window. */
const overlapsRange = (
  schedule: BrowsableSchedule,
  startDate: string,
  endDate: string,
) => {
  if (!startDate && !endDate) return true;
  const scheduleStart = schedule.startDate || schedule.endDate || "";
  const scheduleEnd = schedule.endDate || schedule.startDate || "";
  // Undated (legacy) schedules can't be excluded on dates without hiding them
  // from every dated search, so they always pass.
  if (!scheduleStart || !scheduleEnd) return true;
  if (startDate && scheduleEnd < startDate) return false;
  if (endDate && scheduleStart > endDate) return false;
  return true;
};

export const filterSchedulesForBrowser = <T extends BrowsableSchedule>({
  schedules,
  teams,
  filters,
}: {
  schedules: T[];
  teams: Pick<TeamRecord, "teamId" | "name">[];
  filters: ScheduleBrowserFilters;
}): ScheduleBrowserRow<T>[] => {
  const teamNameById = new Map(teams.map((team) => [team.teamId, team.name]));
  const search = filters.search.trim().toLowerCase();

  return schedules
    .filter((schedule) => {
      if (filters.status === "active" && schedule.archivedAt) return false;
      if (filters.status === "archived" && !schedule.archivedAt) return false;
      if (filters.teamId && schedule.teamId !== filters.teamId) return false;
      if (!overlapsRange(schedule, filters.startDate, filters.endDate)) {
        return false;
      }
      if (!search) return true;
      // Team name is searchable too: operators think "media august", not just
      // the schedule's own name.
      const teamName = teamNameById.get(schedule.teamId) || "";
      return `${schedule.name} ${teamName}`.toLowerCase().includes(search);
    })
    .map((schedule) => ({
      schedule,
      teamName: teamNameById.get(schedule.teamId) || "",
    }))
    .sort((a, b) => {
      const aDate = a.schedule.startDate || a.schedule.endDate || "";
      const bDate = b.schedule.startDate || b.schedule.endDate || "";
      if (aDate !== bDate) {
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate);
      }
      return (
        a.teamName.localeCompare(b.teamName) ||
        (a.schedule.name || "").localeCompare(b.schedule.name || "")
      );
    });
};
