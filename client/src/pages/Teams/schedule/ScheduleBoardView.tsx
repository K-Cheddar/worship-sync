import { useContext } from "react";
import { ChevronDown, Users } from "lucide-react";
import Button from "@/components/Button/Button";
import Menu from "@/components/Menu/Menu";
import { cn } from "@/utils/cnHelper";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import {
  formatOccurrenceTiming,
  type SharedOccurrenceTiming,
} from "@/utils/teamScheduleOccurrences";
import type { OccurrenceFill, ScheduleSlotColumn } from "./scheduleRequirements";
import ScheduleBoardCell from "./ScheduleBoardCell";
import ScheduleFillBadge from "./ScheduleFillBadge";
import ScheduleOccurrenceDateButton from "./ScheduleOccurrenceDateButton";
import ScheduleUpNextBadge from "./ScheduleUpNextBadge";
import { ScheduleAssignmentContext } from "./ScheduleAssignmentContext";
import { scheduleUpNextBorderClassName } from "./scheduleUtils";

/** The per-occurrence cell data ScheduleBoardView consumes from buildGridCellProps. */
type BoardCellData = {
  slot: number;
  requiredCount: number;
  isSlotEnabled: boolean;
  isAdditionalPosition: boolean;
  assignmentCell?: TeamScheduleCellAssignment;
  isMemberHighlighted: boolean;
  isActiveSlot: boolean;
  justFilled?: boolean;
  allMembers: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  canEdit: boolean;
};

type BoardOccurrenceGroup = {
  serviceId: string;
  serviceName: string;
  occurrences: TeamScheduleOccurrence[];
  sharedTiming: SharedOccurrenceTiming;
};

type ScheduleBoardViewProps = {
  groups: BoardOccurrenceGroup[];
  columns: ScheduleSlotColumn[];
  teamName: string;
  canEdit: boolean;
  nextUpcomingOccurrenceId: string | null;
  fillByOccurrence: Map<string, OccurrenceFill>;
  /** Whether a card's positions are shown. Owned by ScheduleTab so the header's
   *  expand-all/collapse-all controls and the per-card chevrons stay in sync. */
  isExpanded: (occurrenceId: string) => boolean;
  onToggleExpanded: (occurrenceId: string) => void;
  serviceArchivedById: (serviceId: string) => boolean;
  onOpenServiceSummary: (occurrenceId: string) => void;
  getAdditionalPositionOptions: (occurrenceId: string) => {
    positionId: string;
    label: string;
  }[];
  buildCellProps: (
    occurrence: TeamScheduleOccurrence,
    column: ScheduleSlotColumn,
    rowTone: string,
  ) => BoardCellData;
};

/**
 * Per-service card layout: one card per occurrence, each listing only the
 * positions that occurrence actually needs, including optional slots enabled for
 * that date. Cards reuse buildGridCellProps + the shared assignment
 * context, so assignment, shadows, and the picker behave exactly like the tables.
 *
 * Each card's date, service, team, and fill summary stay visible; only the
 * positions list collapses, so a collapsed card still reads as a quick overview.
 * The soonest upcoming service gets a thin orange border plus an absolutely
 * positioned "Up next" marker that never shifts the surrounding cards.
 */
const ScheduleBoardView = ({
  groups,
  columns,
  teamName,
  canEdit,
  nextUpcomingOccurrenceId,
  fillByOccurrence,
  isExpanded,
  onToggleExpanded,
  serviceArchivedById,
  onOpenServiceSummary,
  getAdditionalPositionOptions,
  buildCellProps,
}: ScheduleBoardViewProps) => {
  const handlersRef = useContext(ScheduleAssignmentContext);
  const occurrences = groups.flatMap((group) =>
    group.occurrences.map((occurrence) => ({ occurrence, group })),
  );

  return (
    // One column on phones; a responsive card grid from md up. `items-start`
    // keeps a collapsed card compact instead of stretching to a taller expanded
    // sibling in its row. Top padding leaves room for the absolute "Up next"
    // badge so the schedule scrollport's overflow does not clip it.
    <div className="grid grid-cols-1 items-start gap-4 pt-3 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
      {occurrences.map(({ occurrence, group }) => {
        const rows = columns.flatMap((column) => {
          const cellProps = buildCellProps(occurrence, column, "");
          if (!cellProps.isSlotEnabled) return [];
          return [{ column, cellProps }];
        });
        const additionalPositionOptions = getAdditionalPositionOptions(occurrence.occurrenceId);
        const serviceArchived = serviceArchivedById(group.serviceId);
        const occurrenceTiming = formatOccurrenceTiming(occurrence);
        const expanded = isExpanded(occurrence.occurrenceId);
        const fill = fillByOccurrence.get(occurrence.occurrenceId);
        const isNextUpcoming =
          occurrence.occurrenceId === nextUpcomingOccurrenceId;
        return (
          <section
            key={occurrence.occurrenceId}
            className={cn(
              // Always render the border so colouring the up-next card never
              // shifts layout.
              "relative flex flex-col rounded-xl border bg-gray-950/60",
              isNextUpcoming ? scheduleUpNextBorderClassName : "border-transparent",
            )}
          >
            {isNextUpcoming ? (
              <div className="pointer-events-none absolute -top-2.5 left-1/2 z-20 -translate-x-1/2">
                <ScheduleUpNextBadge />
              </div>
            ) : null}
            <div className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <ScheduleOccurrenceDateButton
                  label={occurrenceTiming}
                  ariaLabel={`View and copy assignments for ${group.serviceName} on ${occurrenceTiming}`}
                  className={cn(
                    // Override the shared button's w-full so it shares this row
                    // with the expand control instead of pushing it onto a new line.
                    "min-w-0 w-auto flex-1",
                  )}
                  onClick={() => onOpenServiceSummary(occurrence.occurrenceId)}
                />
                <Button
                  type="button"
                  variant="tertiary"
                  svg={ChevronDown}
                  iconSize="lg"
                  padding="p-1"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${group.serviceName} on ${occurrenceTiming}`}
                  onClick={() => onToggleExpanded(occurrence.occurrenceId)}
                  className={cn(
                    // Match the date button: drop Button's mobile min-height so the
                    // header row stays compact. Rotate the icon for expand/collapse.
                    "shrink-0 text-gray-300 max-md:min-h-0 [&_svg]:transition-transform motion-reduce:[&_svg]:transition-none",
                    expanded && "[&_svg]:rotate-180",
                  )}
                />
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-gray-400">
                <span className="truncate">{group.serviceName}</span>
                {serviceArchived ? (
                  <span className="shrink-0 text-gray-500">· Archived</span>
                ) : null}
              </p>
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{teamName}</span>
                {fill ? (
                  <ScheduleFillBadge
                    filled={fill.filled}
                    required={fill.required}
                    showLabel
                    className="ml-auto"
                  />
                ) : null}
              </div>
            </div>
            <div className={cn(expanded ? "block" : "hidden")}>
              <div className="flex flex-col divide-y divide-gray-800/60 border-t border-gray-800/60 px-3 py-2">
                {rows.length > 0 ? (
                  rows.map(({ column, cellProps }) => (
                    <ScheduleBoardCell
                      key={column.columnKey}
                      occurrenceId={occurrence.occurrenceId}
                      occurrenceName={occurrence.name}
                      columnKey={column.columnKey}
                      positionId={column.positionId}
                      positionLabel={column.label}
                      positionIcon={column.position.icon}
                      positionArchived={Boolean(column.position.archivedAt)}
                      assignmentCell={cellProps.assignmentCell}
                      isMemberHighlighted={cellProps.isMemberHighlighted}
                      isActiveSlot={cellProps.isActiveSlot}
                      isAdditionalPosition={cellProps.isAdditionalPosition}
                      justFilled={cellProps.justFilled}
                      allMembers={cellProps.allMembers}
                      duplicateFirstNames={cellProps.duplicateFirstNames}
                      canEdit={cellProps.canEdit}
                    />
                  ))
                ) : (
                  <p className="px-2.5 py-3 text-center text-xs text-gray-500">
                    No positions required for this service.
                  </p>
                )}
                {canEdit && additionalPositionOptions.length > 0 ? (
                  <div className="px-2.5 py-2">
                    <Menu
                      align="start"
                      menuItems={additionalPositionOptions.map((option) => ({
                        text: `Add ${option.label}`,
                        onClick: () =>
                          void handlersRef?.current?.addAdditionalPosition({
                            serviceId: occurrence.occurrenceId,
                            positionId: option.positionId,
                          }),
                      }))}
                      TriggeringButton={
                        <Button type="button" variant="tertiary" className="text-xs">
                          Add position
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default ScheduleBoardView;
