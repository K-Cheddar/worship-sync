import type {
  PositionRequirement,
  TeamPosition,
  TeamScheduleOccurrence,
  TeamService,
} from "../../../api/authTypes";

/**
 * Schedule slot keying + position-requirement resolution.
 *
 * Every assignment uses an explicit slot key: `${positionId}::${slot}`.
 * Slot 0 is explicit too, so malformed or bare ids fail fast instead of being
 * treated as legacy data.
 */
export const SLOT_KEY_SEPARATOR = "::";

export const makeSlotKey = (positionId: string, slot: number): string =>
  `${positionId}${SLOT_KEY_SEPARATOR}${slot}`;

export const parseSlotKey = (
  key: string,
): { positionId: string; slot: number } | null => {
  const raw = String(key ?? "");
  const idx = raw.lastIndexOf(SLOT_KEY_SEPARATOR);
  if (idx === -1) return null;
  const base = raw.slice(0, idx);
  const slot = Number.parseInt(raw.slice(idx + SLOT_KEY_SEPARATOR.length), 10);
  if (!base || !Number.isInteger(slot) || slot < 0) {
    return null;
  }
  return { positionId: base, slot };
};

/** Drop blank/zero entries, clamp counts to >= 1, and dedupe by position. */
export const sanitizePositionRequirements = (
  value?: PositionRequirement[] | null,
): PositionRequirement[] => {
  if (!Array.isArray(value)) return [];
  const byPosition = new Map<string, PositionRequirement>();
  for (const req of value) {
    const positionId = String(req?.positionId || "").trim();
    if (!positionId) continue;
    const count = Math.floor(Number(req?.count));
    if (!Number.isFinite(count) || count < 1) continue;
    const minLevelId = req?.minLevelId ? String(req.minLevelId) : undefined;
    byPosition.set(positionId, {
      positionId,
      count,
      ...(minLevelId ? { minLevelId } : {}),
    });
  }
  return [...byPosition.values()];
};

/**
 * Resolve the position requirements that apply to one occurrence, by precedence:
 *   1. the occurrence's own override
 *   2. the service's default requirements
 *   3. fallback: every team position, one slot each
 */
export const resolveOccurrenceRequirements = ({
  occurrence,
  service,
  teamPositionIds,
}: {
  occurrence?: Pick<TeamScheduleOccurrence, "positionRequirements"> | null;
  service?: Pick<TeamService, "positionRequirements"> | null;
  teamPositionIds: string[];
}): PositionRequirement[] => {
  // Requirements can reference positions from several teams (a service may be run by
  // more than one team), so scope them to this schedule's team.
  const teamPositionIdSet = new Set(teamPositionIds);
  const scope = (reqs: PositionRequirement[]) =>
    reqs.filter((req) => teamPositionIdSet.has(req.positionId));
  const fromOccurrence = scope(sanitizePositionRequirements(occurrence?.positionRequirements));
  if (fromOccurrence.length) return fromOccurrence;
  const fromService = scope(sanitizePositionRequirements(service?.positionRequirements));
  if (fromService.length) return fromService;
  return teamPositionIds.map((positionId) => ({ positionId, count: 1 }));
};

/** How many slots a position needs for a given requirement set. */
export const getRequiredCount = (
  requirements: PositionRequirement[] | undefined,
  positionId: string,
): number => requirements?.find((req) => req.positionId === positionId)?.count ?? 0;

export type ScheduleSlotColumn = {
  /** Storage/assignment key: makeSlotKey(positionId, slot). */
  columnKey: string;
  position: TeamPosition;
  positionId: string;
  /** 0-based slot index within the position. */
  slot: number;
  /** Max slots needed for this position across the whole schedule. */
  totalSlots: number;
  label: string;
};

/**
 * Build the union of slot columns across every occurrence. A position gets as many
 * columns as the largest count any occurrence requires; occurrences that need
 * fewer leave the extra slots inactive in the grid. Column order follows the
 * team's position order, with any extra required positions appended.
 */
export const buildScheduleColumns = ({
  occurrences,
  requirementsByOccurrence,
  positions,
  teamPositionIds,
}: {
  occurrences: { occurrenceId: string }[];
  requirementsByOccurrence: Map<string, PositionRequirement[]>;
  positions: TeamPosition[];
  teamPositionIds: string[];
}): ScheduleSlotColumn[] => {
  const maxCountByPosition = new Map<string, number>();
  occurrences.forEach((occurrence) => {
    (requirementsByOccurrence.get(occurrence.occurrenceId) || []).forEach((req) => {
      maxCountByPosition.set(
        req.positionId,
        Math.max(maxCountByPosition.get(req.positionId) || 0, req.count),
      );
    });
  });

  const orderedPositionIds: string[] = [];
  const seen = new Set<string>();
  const pushPosition = (positionId: string) => {
    if (seen.has(positionId) || !maxCountByPosition.has(positionId)) return;
    seen.add(positionId);
    orderedPositionIds.push(positionId);
  };
  teamPositionIds.forEach(pushPosition);
  [...maxCountByPosition.keys()].forEach(pushPosition);

  const positionById = new Map(positions.map((position) => [position.positionId, position]));
  const columns: ScheduleSlotColumn[] = [];
  orderedPositionIds.forEach((positionId) => {
    const position = positionById.get(positionId);
    if (!position) return;
    const totalSlots = maxCountByPosition.get(positionId) || 0;
    for (let slot = 0; slot < totalSlots; slot += 1) {
      columns.push({
        columnKey: makeSlotKey(positionId, slot),
        position,
        positionId,
        slot,
        totalSlots,
        label: totalSlots > 1 ? `${position.name} ${slot + 1}` : position.name,
      });
    }
  });
  return columns;
};
