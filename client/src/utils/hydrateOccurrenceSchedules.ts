/**
 * Fills in the assignment maps for one service date.
 *
 * The Teams bootstrap only ships hydrated schedules for a window around today
 * (see `scheduleHydrationWindow` on the server); everything outside it arrives
 * as a summary with `assignmentsOmitted`. Dropping those — all
 * `onlyHydratedSchedules` can do on its own — renders as "nobody is scheduled",
 * which is indistinguishable from an empty roster. So any surface that reads
 * one date's cells fetches the detail for the schedules actually covering that
 * date first.
 *
 * Best effort by design: a failed fetch still returns everything that did
 * arrive, flagged `incomplete`, so the caller can say the roster may be short
 * rather than present it as the whole truth.
 */
import { getTeamScheduleDetail } from "../api/auth";
import { isHydratedSchedule } from "../api/authTypes";
import { getUnhydratedOccurrenceScheduleIds } from "../pages/Teams/pages/teamsAssignmentsSummary";
import type {
  TeamSchedule,
  TeamScheduleOccurrence,
  TeamScheduleSummary,
} from "../api/authTypes";

export type HydratedOccurrenceSchedules = {
  /**
   * The input list with any fetched detail merged in, in the original order.
   * Summaries covering *other* dates are kept as they were: dropping them would
   * leave a later date switch unable to tell that its cells are missing too.
   */
  schedules: (TeamSchedule | TeamScheduleSummary)[];
  /** A schedule covering this date could not be fetched, so cells are missing. */
  incomplete: boolean;
};

export const hydrateOccurrenceSchedules = async ({
  churchId,
  occurrence,
  schedules,
}: {
  churchId: string | undefined;
  occurrence: TeamScheduleOccurrence | null | undefined;
  schedules: (TeamSchedule | TeamScheduleSummary)[];
}): Promise<HydratedOccurrenceSchedules> => {
  const missingIds = occurrence
    ? getUnhydratedOccurrenceScheduleIds(occurrence, schedules)
    : [];
  if (!churchId || !missingIds.length) {
    return { schedules, incomplete: false };
  }

  const results = await Promise.allSettled(
    missingIds.map((scheduleId) => getTeamScheduleDetail(churchId, scheduleId)),
  );
  // One schedule failing must not discard the ones that arrived — a partly
  // filled roster still beats a blank one.
  const fetchedById = new Map<string, TeamSchedule>();
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    // Detail responses carry the overlapping other-team schedules too; taking
    // them saves a second round trip when the panel lists more than one team.
    [result.value.schedule, ...(result.value.relatedSchedules || [])].forEach(
      (schedule) => fetchedById.set(schedule.scheduleId, schedule),
    );
  });

  return {
    // The same array back when nothing was fetched, not an equal copy. Callers
    // hold this in state and re-run on its identity, so a failed fetch that
    // handed back a fresh array would refetch forever.
    schedules: fetchedById.size
      ? schedules.map(
          (schedule) => fetchedById.get(schedule.scheduleId) ?? schedule,
        )
      : schedules,
    incomplete: missingIds.some(
      (scheduleId) => !isHydratedSchedule(fetchedById.get(scheduleId)),
    ),
  };
};
