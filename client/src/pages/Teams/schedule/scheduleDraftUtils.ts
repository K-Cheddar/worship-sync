import type { TeamSchedulePayload } from "../../../api/auth";
import type {
  TeamRecord,
  TeamSchedule,
  TeamScheduleAssignments,
  TeamScheduleOccurrence,
  TeamService,
} from "../../../api/authTypes";
import { clampPlainDateToMin } from "@/utils/plainDate";
import { getDefaultScheduleRange } from "@/utils/teamScheduleOccurrences";

type BuildScheduleDraftArgs = {
  persistedDraft?: TeamSchedulePayload;
  selectedSchedule?: TeamSchedule | null;
  defaultTeamId: string;
  defaultServiceIds: string[];
  defaultRange?: { startDate: string; endDate: string };
};

const withClampedScheduleDates = (
  draft: TeamSchedulePayload,
): TeamSchedulePayload => {
  const startDate = draft.startDate || "";
  const endDate = clampPlainDateToMin(draft.endDate || "", startDate);
  if (endDate === (draft.endDate || "")) return draft;
  return { ...draft, endDate };
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
    return withClampedScheduleDates({
      ...persistedDraft,
      ...(selectedSchedule?.guests !== undefined
        ? { guests: selectedSchedule.guests }
        : {}),
    });
  }

  if (selectedSchedule) {
    return withClampedScheduleDates({
      name: selectedSchedule.name,
      description: selectedSchedule.description || "",
      teamId: selectedSchedule.teamId,
      startDate: selectedSchedule.startDate || defaultRange.startDate,
      endDate: selectedSchedule.endDate || defaultRange.endDate,
      serviceIds: selectedSchedule.serviceIds || [],
      occurrences: selectedSchedule.occurrences || [],
      assignments: selectedSchedule.assignments || {},
      ...(selectedSchedule.guests !== undefined
        ? { guests: selectedSchedule.guests }
        : {}),
    });
  }

  return withClampedScheduleDates({
    name: "",
    description: "",
    teamId: defaultTeamId,
    startDate: defaultRange.startDate,
    endDate: defaultRange.endDate,
    serviceIds: defaultServiceIds,
    occurrences: [],
    assignments: {},
  });
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
  const sourceToTargets = mapOccurrencesByServiceIndex(
    sourceOccurrences,
    targetOccurrences,
  );
  mapReplacementOccurrences({
    sourceOccurrences,
    targetOccurrences,
    sourceToTargets,
  });
  return buildRemappedAssignments({
    sourceOccurrences,
    assignments,
    sourceToTargets,
  });
};

const occurrenceBucketKey = (occurrence: TeamScheduleOccurrence) =>
  occurrence.groupId ? `group:${occurrence.groupId}` : occurrence.serviceId;

const sortOccurrences = (occurrences: TeamScheduleOccurrence[]) =>
  [...occurrences].sort(
    (a, b) =>
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      a.occurrenceId.localeCompare(b.occurrenceId),
  );

const getMappedTargetIds = (sourceToTargets: Map<string, string[]>) =>
  new Set([...sourceToTargets.values()].flat());

const mapOccurrencesByServiceIndex = (
  sourceOccurrences: TeamScheduleOccurrence[],
  targetOccurrences: TeamScheduleOccurrence[],
  sourceToTargets: Map<string, string[]> = new Map(),
) => {
  const sourceByService = new Map<string, TeamScheduleOccurrence[]>();
  const targetByService = new Map<string, TeamScheduleOccurrence[]>();
  const mappedTargetIds = getMappedTargetIds(sourceToTargets);

  sourceOccurrences.forEach((occurrence) => {
    if (sourceToTargets.has(occurrence.occurrenceId)) return;
    const key = occurrenceBucketKey(occurrence);
    sourceByService.set(key, [...(sourceByService.get(key) || []), occurrence]);
  });
  targetOccurrences.forEach((occurrence) => {
    if (mappedTargetIds.has(occurrence.occurrenceId)) return;
    const key = occurrenceBucketKey(occurrence);
    targetByService.set(key, [...(targetByService.get(key) || []), occurrence]);
  });

  sourceByService.forEach((sourceList, serviceKey) => {
    const targetList = sortOccurrences(targetByService.get(serviceKey) || []);
    sortOccurrences(sourceList).forEach((sourceOccurrence, index) => {
      const targetOccurrence = targetList[index];
      if (targetOccurrence) {
        sourceToTargets.set(sourceOccurrence.occurrenceId, [
          targetOccurrence.occurrenceId,
        ]);
      }
    });
  });
  return sourceToTargets;
};

/**
 * Service selections can change while a schedule is edited or copied. After
 * preserving every exact service match, carry the remaining rows to a
 * replacement service on the same date; when the range moved too, line them up
 * chronologically. Newly added services stay empty because only unmatched source
 * rows are considered here.
 */
const mapReplacementOccurrences = ({
  sourceOccurrences,
  targetOccurrences,
  sourceToTargets,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  targetOccurrences: TeamScheduleOccurrence[];
  sourceToTargets: Map<string, string[]>;
}) => {
  const mappedTargetIds = getMappedTargetIds(sourceToTargets);
  const unmatchedSources = sortOccurrences(
    sourceOccurrences.filter(
      (occurrence) => !sourceToTargets.has(occurrence.occurrenceId),
    ),
  );
  const unmatchedTargets = sortOccurrences(
    targetOccurrences.filter(
      (occurrence) => !mappedTargetIds.has(occurrence.occurrenceId),
    ),
  );
  const targetsByDate = new Map<string, TeamScheduleOccurrence[]>();
  unmatchedTargets.forEach((occurrence) => {
    const date = occurrenceDate(occurrence);
    targetsByDate.set(date, [...(targetsByDate.get(date) || []), occurrence]);
  });
  const sourceIndexByDate = new Map<string, number>();

  unmatchedSources.forEach((sourceOccurrence) => {
    const date = occurrenceDate(sourceOccurrence);
    const sameDayTargets = targetsByDate.get(date) || [];
    if (!sameDayTargets.length) return;
    const sourceIndex = sourceIndexByDate.get(date) || 0;
    // A replacement occurrence can safely receive only one source row. Extra
    // same-day source rows have no unambiguous counterpart, so leave them
    // unmapped instead of merging people from different services.
    if (sourceIndex >= sameDayTargets.length) return;
    const target = sameDayTargets[sourceIndex];
    sourceToTargets.set(sourceOccurrence.occurrenceId, [target.occurrenceId]);
    sourceIndexByDate.set(date, sourceIndex + 1);
  });

  const remainingSources = unmatchedSources.filter(
    (occurrence) => !sourceToTargets.has(occurrence.occurrenceId),
  );
  const newlyMappedTargetIds = getMappedTargetIds(sourceToTargets);
  const remainingTargets = unmatchedTargets.filter(
    (occurrence) => !newlyMappedTargetIds.has(occurrence.occurrenceId),
  );
  remainingSources.forEach((sourceOccurrence, index) => {
    const targetOccurrence = remainingTargets[index];
    if (targetOccurrence) {
      sourceToTargets.set(sourceOccurrence.occurrenceId, [
        targetOccurrence.occurrenceId,
      ]);
    }
  });
};

const buildRemappedAssignments = ({
  sourceOccurrences,
  assignments,
  sourceToTargets,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  assignments: TeamScheduleAssignments;
  sourceToTargets: Map<string, string[]>;
}): TeamScheduleAssignments => {
  const result: TeamScheduleAssignments = {};
  sortOccurrences(sourceOccurrences).forEach((sourceOccurrence) => {
    const row = assignments[sourceOccurrence.occurrenceId];
    const targetIds = sourceToTargets.get(sourceOccurrence.occurrenceId);
    if (!row || !targetIds) return;
    targetIds.forEach((targetId) => {
      const targetRow = (result[targetId] ||= {});
      Object.entries(row).forEach(([cellKey, cell]) => {
        if (targetRow[cellKey] === undefined) targetRow[cellKey] = cell;
      });
    });
  });
  return result;
};

/**
 * Build a draft that copies an existing schedule into a new one. The copy keeps
 * the team, services, date range, and assignments so the operator has a populated
 * starting point.
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
  guests: source.guests || [],
});

const occurrenceDate = (occurrence: TeamScheduleOccurrence) =>
  occurrence.startsAt.slice(0, 10);

const occurrenceServiceIds = (occurrence: TeamScheduleOccurrence) =>
  occurrence.serviceIds?.length
    ? occurrence.serviceIds
    : [occurrence.serviceId];

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
 * cell-by-cell with the earliest service winning a contested slot. Service
 * replacements and date changes then use the same safe fallback as copied
 * schedules, so editing services does not silently erase the people already
 * scheduled.
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
  const sourceToTargets = mapOccurrencesByServiceDate(
    sourceOccurrences,
    targetOccurrences,
  );
  mapOccurrencesByServiceIndex(
    sourceOccurrences,
    targetOccurrences,
    sourceToTargets,
  );
  mapReplacementOccurrences({
    sourceOccurrences,
    targetOccurrences,
    sourceToTargets,
  });
  return buildRemappedAssignments({
    sourceOccurrences,
    assignments,
    sourceToTargets,
  });
};

/**
 * Re-key occurrence-scoped data that does not need cell-by-cell merging, such
 * as daily microphone allocations and added positions. When several
 * rows combine, the earliest source row wins; the shared schedule assignment
 * can then be adjusted explicitly by the operator.
 */
export const rekeyScheduleOccurrenceRowsByServiceDate = <T,>({
  sourceOccurrences,
  targetOccurrences,
  rows,
}: {
  sourceOccurrences: TeamScheduleOccurrence[];
  targetOccurrences: TeamScheduleOccurrence[];
  rows: Record<string, T> | undefined;
}): Record<string, T> => {
  if (!rows || Object.keys(rows).length === 0) return {};
  const sourceToTargets = mapOccurrencesByServiceDate(
    sourceOccurrences,
    targetOccurrences,
  );
  mapOccurrencesByServiceIndex(sourceOccurrences, targetOccurrences, sourceToTargets);
  mapReplacementOccurrences({ sourceOccurrences, targetOccurrences, sourceToTargets });
  const result: Record<string, T> = {};
  sortOccurrences(sourceOccurrences).forEach((sourceOccurrence) => {
    const row = rows[sourceOccurrence.occurrenceId];
    const targetIds = sourceToTargets.get(sourceOccurrence.occurrenceId);
    if (row === undefined || !targetIds) return;
    targetIds.forEach((targetId) => {
      if (result[targetId] === undefined) result[targetId] = row;
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
  schedules: TeamSchedule[];
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
