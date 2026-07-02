import { cn } from "@/utils/cnHelper";
import type {
  TeamRosterMember,
  TeamScheduleCellAssignment,
} from "../../../api/authTypes";
import {
  getCellPrimaryMemberId,
  getCellShadowAssignments,
  scheduleMemberName,
  shadowKindLabel,
} from "../teamsUtils";

export const serviceHeaderRowTone = "bg-orange-500/15";
export const scheduleGridTopBorderClassName = "border-t-gray-800";
export const scheduleGridBottomBorderClassName = "border-b-gray-800";
export const scheduleGridLeftBorderClassName =
  "border-l-2 border-l-cyan-900/50";
export const scheduleGridRightBorderClassName =
  "border-r-2 border-r-cyan-900/50";
export const scheduleServiceHeaderTopBorderClassName = "border-t-orange-900/40";
export const scheduleServiceHeaderBottomBorderClassName =
  "border-b-orange-900/40";
export const scheduleServiceHeaderLeftBorderClassName =
  "border-l-2 border-l-orange-900/40";

export const scheduleDateColumnClassName = "whitespace-nowrap";
export const schedulePositionColumnClassName = "whitespace-nowrap";
export const scheduleCellPaddingClassName = "px-2 py-2";
/** Hide remove controls until hover on pointer devices; always visible on touch. */
export const scheduleCellRemoveButtonVisibilityClassName =
  "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";
/** Larger tap target for inline cell remove controls on small screens. */
export const scheduleCellRemoveButtonTouchClassName =
  "max-md:min-h-10 max-md:min-w-10 max-md:[&_svg]:size-4";
export const scheduleColumnMinCh = 8;
export const scheduleColumnPaddingCh = 1;
export const schedulePositionIconCh = 2;
export const scheduleAssignmentButtonCh = 1;

export const scheduleRowTone = (rowIndex: number) =>
  rowIndex % 2 === 0 ? "bg-gray-950/80" : "bg-gray-900/45";

export const scheduleStickyRowTone = (rowIndex: number) =>
  rowIndex % 2 === 0 ? "bg-gray-950" : "bg-gray-900/70";

export type ScheduleFocusedCell = {
  occurrenceId: string;
  columnKey: string;
};

export const scheduleGridCellKey = (occurrenceId: string, columnKey: string) =>
  `${occurrenceId}|${columnKey}`;

export type ScheduleGridLayout = "grid" | "transpose";

export const getScheduleAxisHighlight = ({
  layout,
  focusedCell,
  occurrenceId,
  columnKey,
}: {
  layout: ScheduleGridLayout;
  focusedCell: ScheduleFocusedCell | null;
  occurrenceId?: string;
  columnKey?: string;
}) => {
  if (!focusedCell) {
    return { row: false, column: false, intersection: false };
  }
  const matchesRow =
    layout === "transpose"
      ? Boolean(columnKey && columnKey === focusedCell.columnKey)
      : Boolean(occurrenceId && occurrenceId === focusedCell.occurrenceId);
  const matchesColumn =
    layout === "transpose"
      ? Boolean(occurrenceId && occurrenceId === focusedCell.occurrenceId)
      : Boolean(columnKey && columnKey === focusedCell.columnKey);
  return {
    row: matchesRow,
    column: matchesColumn,
    intersection: matchesRow && matchesColumn,
  };
};

export type ScheduleAxisSurface = "body" | "sticky" | "header";

const scheduleAxisHighlightRingClassName = "ring-1 ring-inset ring-white/15";

export type ScheduleExportAxisTheme = "light" | "board-attendee";

const scheduleExportAxisHighlightRingClassName = (
  theme: ScheduleExportAxisTheme,
) =>
  theme === "board-attendee"
    ? "ring-1 ring-inset ring-white/15"
    : "ring-1 ring-inset ring-gray-400/40";

/** Theme-aware axis highlight for public/export grid tables. */
export const scheduleExportAxisHighlightClassName = (
  { row, column, intersection }: ReturnType<typeof getScheduleAxisHighlight>,
  {
    rowIndex = 0,
    surface = "body",
    theme = "light",
  }: {
    rowIndex?: number;
    surface?: ScheduleAxisSurface;
    theme?: ScheduleExportAxisTheme;
  } = {},
) => {
  if (!row && !column && !intersection) return "";

  const ring = scheduleExportAxisHighlightRingClassName(theme);
  const isDark = theme === "board-attendee";
  const even = rowIndex % 2 === 0;

  if (surface === "header") {
    return cn(isDark ? "bg-stone-700" : "bg-orange-600", ring);
  }

  if (surface === "sticky") {
    return cn(
      isDark
        ? even
          ? "bg-stone-700"
          : "bg-stone-700/90"
        : even
          ? "bg-orange-200"
          : "bg-orange-100",
      ring,
    );
  }

  if (intersection) {
    return cn(
      isDark
        ? even
          ? "bg-stone-700/75"
          : "bg-stone-700/65"
        : even
          ? "bg-gray-300/80"
          : "bg-gray-200/90",
      ring,
    );
  }

  return cn(
    isDark
      ? even
        ? "bg-stone-700/55"
        : "bg-stone-700/50"
      : even
        ? "bg-gray-200/80"
        : "bg-gray-100/90",
    ring,
  );
};

export const scheduleAxisHighlightClassName = (
  { row, column, intersection }: ReturnType<typeof getScheduleAxisHighlight>,
  {
    rowIndex = 0,
    surface = "body",
  }: { rowIndex?: number; surface?: ScheduleAxisSurface } = {},
) => {
  if (!row && !column && !intersection) return "";

  if (surface === "header") {
    return cn("bg-gray-800", scheduleAxisHighlightRingClassName);
  }

  const even = rowIndex % 2 === 0;

  if (surface === "sticky") {
    return cn(
      even ? "bg-gray-800" : "bg-gray-800/90",
      scheduleAxisHighlightRingClassName,
    );
  }

  if (intersection) {
    return cn(
      even ? "bg-gray-800/75" : "bg-gray-800/65",
      scheduleAxisHighlightRingClassName,
    );
  }

  return cn(
    even ? "bg-gray-800/55" : "bg-gray-800/50",
    scheduleAxisHighlightRingClassName,
  );
};

export const pickLongestLabel = (...labels: (string | null | undefined)[]) =>
  labels
    .filter((label): label is string => Boolean(label?.trim()))
    .reduce(
      (longest, label) => (label.length > longest.length ? label : longest),
      "",
    );

export const toScheduleColumnMinCh = (label: string, extraCh = 0) =>
  Math.max(
    label.length + extraCh + scheduleColumnPaddingCh,
    scheduleColumnMinCh,
  );

export const toSchedulePositionColumnMinCh = ({
  longestLabel,
  headerLabel,
  hasIcon,
}: {
  longestLabel: string;
  headerLabel: string;
  hasIcon: boolean;
}) => {
  const headerCh = headerLabel.length + (hasIcon ? schedulePositionIconCh : 0);
  const contentCh = Math.max(longestLabel.length, headerCh);
  return Math.max(
    contentCh + scheduleAssignmentButtonCh + scheduleColumnPaddingCh,
    scheduleColumnMinCh,
  );
};

export const getAssignmentCellContentLabel = ({
  assignmentCell,
  positionName,
  members,
  duplicateFirstNames,
}: {
  assignmentCell?: TeamScheduleCellAssignment | null;
  positionName: string;
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
}) => {
  const labels = [positionName];
  const primaryMemberId = getCellPrimaryMemberId(assignmentCell);
  if (primaryMemberId) {
    const member = members.find((item) => item.memberId === primaryMemberId);
    labels.push(scheduleMemberName(member, duplicateFirstNames));
  }
  getCellShadowAssignments(assignmentCell).forEach((shadow) => {
    const member = members.find((item) => item.memberId === shadow.memberId);
    labels.push(
      `${shadowKindLabel(shadow.kind)}: ${scheduleMemberName(member, duplicateFirstNames)}`,
    );
  });
  return pickLongestLabel(...labels);
};
