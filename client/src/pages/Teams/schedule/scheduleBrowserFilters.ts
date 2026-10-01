import type { TeamRecord, TeamSchedule } from "../../../api/authTypes";
import { overlapsInclusiveDateRange } from "./dateRangeUtils";

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
      if (!overlapsInclusiveDateRange(schedule, filters)) {
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
