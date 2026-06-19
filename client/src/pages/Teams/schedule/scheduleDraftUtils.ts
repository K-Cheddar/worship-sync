import type { TeamSchedulePayload } from "../../../api/auth";
import type {
  TeamRecord,
  TeamSchedule,
  TeamScheduleAssignments,
  TeamScheduleAttendance,
  TeamScheduleOccurrence,
  TeamService,
} from "../../../api/authTypes";
import { getDefaultScheduleRange } from "@/utils/teamScheduleOccurrences";

type BuildScheduleDraftArgs = {
  persistedDraft?: TeamSchedulePayload;
  selectedSchedule?: TeamSchedule | null;
  defaultTeamId: string;
  defaultServiceIds: string[];
  defaultRange?: { startDate: string; endDate: string };
};

export const buildScheduleDraft = ({
  persistedDraft,
  selectedSchedule,
  defaultTeamId,
  defaultServiceIds,
  defaultRange = getDefaultScheduleRange(),
}: BuildScheduleDraftArgs): TeamSchedulePayload => {
  const cachedDraftLooksBlank = Boolean(
    selectedSchedule &&
    !String(persistedDraft?.name || "").trim() &&
    selectedSchedule.name.trim(),
  );

  if (persistedDraft && !cachedDraftLooksBlank) {
    return persistedDraft;
  }

  if (selectedSchedule) {
    return {
      name: selectedSchedule.name,
      description: selectedSchedule.description || "",
      teamId: selectedSchedule.teamId,
      startDate: selectedSchedule.startDate || defaultRange.startDate,
      endDate: selectedSchedule.endDate || defaultRange.endDate,
      serviceIds: selectedSchedule.serviceIds || [],
      occurrences: selectedSchedule.occurrences || [],
      assignments: selectedSchedule.assignments || {},
      attendance: selectedSchedule.attendance || {},
    };
  }

  return {
    name: "",
    description: "",
    teamId: defaultTeamId,
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    serviceIds: defaultServiceIds,
    occurrences: [],
    assignments: {},
    attendance: {},
  };
};

/**
 * Re-key assignments from one set of occurrences onto another by matching each
 * service's occurrences in chronological order (1st → 1st, 2nd → 2nd, …).
 *
 * This is what makes "copy a schedule and change the date" carry people over:
 * occurrence IDs embed the service date (`serviceId@startsAtISO`), so a shifted
 * date range produces brand-new IDs. Lining occurrences up by index keeps the
 * same person in, say, the first Sunday's slot when the whole range moves to the
 * next month. Source occurrences with no counterpart in the target (e.g. a month
 * with fewer Sundays) are dropped; extra target occurrences are simply left
 * empty for the user to fill in.
 *
 * When source and target occurrences are identical (a copy with no date change)
 * this is an identity remap, so assignments are preserved exactly.
 */
export const remapAssignmentsToOccurrences = ({
  sourceOccurrences,
  targetOccurrences,
  assignments,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  targetOccurrences: TeamScheduleOccurrence[];
  assignments: TeamScheduleAssignments;
}): TeamScheduleAssignments => {
  if (!assignments || Object.keys(assignments).length === 0) return {};

  // Combined occurrences are keyed by their shared group so they line up across a
  // date shift the same way single services do.
  const bucketKey = (occurrence: TeamScheduleOccurrence) =>
    occurrence.groupId ? `group:${occurrence.groupId}` : occurrence.serviceId;
  const byService = (occurrences: TeamScheduleOccurrence[]) => {
    const map = new Map<string, TeamScheduleOccurrence[]>();
    occurrences.forEach((occurrence) => {
      const key = bucketKey(occurrence);
      const list = map.get(key) || [];
      list.push(occurrence);
      map.set(key, list);
    });
    map.forEach((list) =>
      list.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      ),
    );
    return map;
  };

  const sourceByService = byService(sourceOccurrences);
  const targetByService = byService(targetOccurrences);

  // Map each source occurrence ID to the target occurrence holding the same
  // chronological position within its service.
  const sourceToTarget = new Map<string, string>();
  sourceByService.forEach((sourceList, serviceId) => {
    const targetList = targetByService.get(serviceId) || [];
    sourceList.forEach((sourceOccurrence, index) => {
      const targetOccurrence = targetList[index];
      if (targetOccurrence) {
        sourceToTarget.set(
          sourceOccurrence.occurrenceId,
          targetOccurrence.occurrenceId,
        );
      }
    });
  });

  const remapped: TeamScheduleAssignments = {};
  Object.entries(assignments).forEach(([sourceOccurrenceId, row]) => {
    const targetOccurrenceId = sourceToTarget.get(sourceOccurrenceId);
    if (targetOccurrenceId) {
      remapped[targetOccurrenceId] = row;
    }
  });
  return remapped;
};

/**
 * Build a draft that copies an existing schedule into a new one. The copy keeps
 * the team, services, date range, and assignments so the operator has a populated
 * starting point; attendance is day-of data and is intentionally not carried.
 */
export const buildScheduleCopyDraft = ({
  source,
  occurrences,
}: {
  source: TeamSchedule;
  occurrences: TeamScheduleOccurrence[];
}): TeamSchedulePayload => ({
  name: `Copy of ${source.name}`.trim(),
  description: source.description || "",
  teamId: source.teamId,
  startDate: source.startDate || "",
  endDate: source.endDate || "",
  serviceIds: source.serviceIds || [],
  occurrences,
  assignments: source.assignments || {},
  attendance: {},
});

const occurrenceDate = (occurrence: TeamScheduleOccurrence) =>
  occurrence.startsAt.slice(0, 10);

const occurrenceServiceIds = (occurrence: TeamScheduleOccurrence) =>
  occurrence.serviceIds?.length ? occurrence.serviceIds : [occurrence.serviceId];

/**
 * Map each source occurrence to the target occurrence(s) covering the same
 * service on the same date. Unlike {@link remapAssignmentsToOccurrences} (which
 * lines services up by chronological index for date shifts), this keys on
 * (serviceId, date) — the part of a service's identity that does *not* change
 * when it's combined or un-combined. That makes it the safe path when grouping is
 * turned on/off for services an existing schedule already uses: the occurrence id
 * format flips (`first@…` ⇄ `group:…@…`) but the service+date is unchanged.
 *
 * One source can fan out to several targets (un-combining) and several sources
 * can land on one target (combining); callers decide how to merge colliding rows.
 */
const mapOccurrencesByServiceDate = (
  sourceOccurrences: TeamScheduleOccurrence[],
  targetOccurrences: TeamScheduleOccurrence[],
): Map<string, string[]> => {
  const targetByServiceDate = new Map<string, string>();
  targetOccurrences.forEach((target) => {
    occurrenceServiceIds(target).forEach((serviceId) => {
      targetByServiceDate.set(
        `${serviceId}@${occurrenceDate(target)}`,
        target.occurrenceId,
      );
    });
  });

  const map = new Map<string, string[]>();
  sourceOccurrences.forEach((source) => {
    const targetIds = [
      ...new Set(
        occurrenceServiceIds(source)
          .map((serviceId) =>
            targetByServiceDate.get(`${serviceId}@${occurrenceDate(source)}`),
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (targetIds.length) map.set(source.occurrenceId, targetIds);
  });
  return map;
};

/**
 * Re-key assignments when an existing schedule's occurrence ids change shape due
 * to services being combined/un-combined. Rows are matched by (serviceId, date)
 * and, when several source rows collapse onto one combined occurrence, merged
 * cell-by-cell with the earliest service winning a contested slot. A no-op when
 * the ids are unchanged (it reproduces the assignments exactly).
 */
export const rekeyAssignmentsByServiceDate = ({
  sourceOccurrences,
  targetOccurrences,
  assignments,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  targetOccurrences: TeamScheduleOccurrence[];
  assignments: TeamScheduleAssignments;
}): TeamScheduleAssignments => {
  if (!assignments || Object.keys(assignments).length === 0) return {};
  const map = mapOccurrencesByServiceDate(sourceOccurrences, targetOccurrences);
  // Earliest service first so its assignments take precedence in a merge.
  const orderedSources = [...sourceOccurrences].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const result: TeamScheduleAssignments = {};
  orderedSources.forEach((source) => {
    const row = assignments[source.occurrenceId];
    const targetIds = map.get(source.occurrenceId);
    if (!row || !targetIds) return;
    targetIds.forEach((targetId) => {
      const dest = (result[targetId] ||= {});
      Object.entries(row).forEach(([cellKey, cell]) => {
        if (dest[cellKey] === undefined) dest[cellKey] = cell;
      });
    });
  });
  return result;
};

/** Attendance counterpart of {@link rekeyAssignmentsByServiceDate}, merged per member. */
export const rekeyAttendanceByServiceDate = ({
  sourceOccurrences,
  targetOccurrences,
  attendance,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  targetOccurrences: TeamScheduleOccurrence[];
  attendance: TeamScheduleAttendance;
}): TeamScheduleAttendance => {
  if (!attendance || Object.keys(attendance).length === 0) return {};
  const map = mapOccurrencesByServiceDate(sourceOccurrences, targetOccurrences);
  const orderedSources = [...sourceOccurrences].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const result: TeamScheduleAttendance = {};
  orderedSources.forEach((source) => {
    const row = attendance[source.occurrenceId];
    const targetIds = map.get(source.occurrenceId);
    if (!row || !targetIds) return;
    targetIds.forEach((targetId) => {
      const dest = (result[targetId] ||= {});
      Object.entries(row).forEach(([memberId, entry]) => {
        if (dest[memberId] === undefined) dest[memberId] = entry;
      });
    });
  });
  return result;
};

export type ScheduleEditFormProps = {
  draftKey: string;
  persistedDraft?: TeamSchedulePayload;
  selectedSchedule: TeamSchedule | null;
  defaultTeamId: string;
  defaultServiceIds: string[];
  defaultRange: { startDate: string; endDate: string };
  services: TeamService[];
  activeTeams: TeamRecord[];
  churchId: string;
  canEdit: boolean;
  onDraftChange: (draftKey: string, draft: TeamSchedulePayload) => void;
  onDraftFlush: (draftKey: string, draft: TeamSchedulePayload) => void;
  onScheduleSaved: (schedule: TeamSchedule, replaceId?: string) => void;
  onScheduleRemoved: (scheduleId: string) => void;
  setSelectedScheduleId: (scheduleId: string) => void;
  onCancel: () => void;
};

export const SCHEDULE_DRAFT_PERSIST_DELAY_MS = 400;
