import type { MyScheduleOccurrence } from "../api/auth";
import { parseSlotKey } from "./Teams/schedule/scheduleRequirements";
import type {
  ScheduleExportCell,
  ScheduleExportModel,
} from "./Teams/schedule/scheduleExport";

/**
 * Builds the same on-screen model the public schedule table renders, from the
 * self-scoped serving roster on My Schedule. Co-servers have blank memberIds by
 * design, so this never goes through `buildScheduleExportModel`.
 */
export const buildMyScheduleExportModel = (
  occurrence: MyScheduleOccurrence,
): ScheduleExportModel => {
  const me = occurrence.serving.find((person) => person.isMe);
  const columnOrder: string[] = [];
  const columnMeta = new Map<
    string,
    { label: string; teamName: string; positionName: string; slot: number }
  >();

  occurrence.serving.forEach((person) => {
    if (columnMeta.has(person.columnKey)) return;
    const parsed = parseSlotKey(person.columnKey);
    const slot = parsed?.slot ?? 0;
    const positionName = person.positionName || "Role";
    const samePositionSlots = occurrence.serving.filter(
      (other) => other.positionId === person.positionId,
    );
    const maxSlot = samePositionSlots.reduce((highest, other) => {
      const otherSlot = parseSlotKey(other.columnKey)?.slot ?? 0;
      return Math.max(highest, otherSlot);
    }, 0);
    const label = maxSlot > 0 ? `${positionName} ${slot + 1}` : positionName;
    columnOrder.push(person.columnKey);
    columnMeta.set(person.columnKey, {
      label,
      teamName: person.teamName || "",
      positionName,
      slot,
    });
  });

  columnOrder.sort((leftKey, rightKey) => {
    const left = columnMeta.get(leftKey)!;
    const right = columnMeta.get(rightKey)!;
    return (
      left.teamName.localeCompare(right.teamName) ||
      left.positionName.localeCompare(right.positionName) ||
      left.slot - right.slot
    );
  });

  const cells: ScheduleExportCell[] = columnOrder.map((columnKey) => {
    const people = occurrence.serving.filter(
      (person) => person.columnKey === columnKey,
    );
    // Primary first so the public table's primary/shadow order stays familiar.
    const ordered = [...people].sort(
      (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
    );
    const tokens = ordered.map((person) => ({
      name: person.name,
      roleNote: person.isPrimary ? "" : "shadow",
      highlighted: person.isMe,
    }));
    return {
      state: "filled" as const,
      tokens,
      highlighted: tokens.some((token) => token.highlighted),
    };
  });

  const serviceName = String(occurrence.name || "").trim() || "Service";
  const startsAt = occurrence.startsAt ? new Date(occurrence.startsAt) : null;
  const rowLabel =
    startsAt && !Number.isNaN(startsAt.getTime())
      ? startsAt.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : occurrence.date || "Date not set";

  return {
    churchName: "",
    scheduleName: serviceName,
    dateRangeLabel: rowLabel,
    highlightName: me?.name || "You",
    columnLabels: columnOrder.map((key) => columnMeta.get(key)!.label),
    columnKeys: columnOrder,
    groups: [
      {
        serviceName,
        timingLabel: "",
        rows: [
          {
            occurrenceId: occurrence.occurrenceId,
            rowLabel,
            cells,
          },
        ],
      },
    ],
  };
};
