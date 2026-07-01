import type { TeamRosterMember } from "../../../api/authTypes";
import { scheduleMemberName } from "../teamsUtils";
import type { ScheduleSlotColumn } from "./scheduleRequirements";

/**
 * Pure helpers for the "paste a schedule row from Excel" flow.
 *
 * The admin copies one row of names from a spreadsheet and drops it onto a single
 * service occurrence. These helpers turn the raw pasted text into a per-column
 * preview and the list of confident, eligible assignments to write. Nothing here
 * touches React, the network, or the schedule document — the caller applies the
 * result through the normal assignment path.
 */

/** Normalize a name for matching: trim, lowercase, collapse inner whitespace. */
const normalizeName = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

export type RowPasteOutcome =
  | { kind: "assign"; memberId: string; memberLabel: string }
  /** Cell was blank — leave the slot as it is (never overwrite with nothing). */
  | { kind: "empty" }
  /** No roster member matched the pasted text. */
  | { kind: "not-found" }
  /** More than one active member matched (e.g. shared first name, no surname). */
  | { kind: "ambiguous"; matchLabels: string[] }
  /** Matched a member, but they cannot take this slot (reason mirrors manual assign). */
  | { kind: "issue"; reason: string; memberId: string; memberLabel: string };

export type RowPastePreviewRow = {
  columnKey: string;
  positionId: string;
  positionLabel: string;
  pastedText: string;
  outcome: RowPasteOutcome;
};

export type RowPasteApplyEntry = {
  columnKey: string;
  positionId: string;
  memberId: string;
};

export type ParsedPastedRow = {
  /** Positional cells of the chosen row (empty cells preserved for alignment). */
  cells: string[];
  /** How many further non-empty lines were pasted and ignored (single-row flow). */
  extraLineCount: number;
};

export type RowPastePreview = {
  rows: RowPastePreviewRow[];
  applyEntries: RowPasteApplyEntry[];
  /** Pasted cells beyond the last position column, which have nowhere to go. */
  ignoredCellCount: number;
};

/**
 * Split pasted clipboard text into the positional cells of a single row.
 *
 * Uses the first non-empty line only (single-row flow). Tabs are Excel's default
 * separator; we fall back to commas for CSV-style pastes. Empty cells are kept so
 * columns stay aligned with the grid. `skipFirstCell` drops a leading date/label
 * cell so the rest line up with the position columns.
 */
export const parsePastedRow = (
  text: string,
  options?: { skipFirstCell?: boolean },
): ParsedPastedRow => {
  const nonEmptyLines = String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const row = nonEmptyLines[0] ?? "";
  const separator = row.includes("\t") ? "\t" : ",";
  let cells = row === "" ? [] : row.split(separator).map((cell) => cell.trim());
  if (options?.skipFirstCell) {
    cells = cells.slice(1);
  }
  return {
    cells,
    extraLineCount: Math.max(0, nonEmptyLines.length - 1),
  };
};

/**
 * Build a per-column preview of what a pasted row would do, plus the list of
 * confident assignments to write. Matching mirrors what the admin sees in the
 * grid (`scheduleMemberName`): exact "First Last", then the "First L." display
 * form, then a unique first name. Ambiguous, unknown, ineligible, and duplicate
 * names are reported, never guessed or forced.
 *
 * `getIssue` should return the same reason string as manual assignment
 * (eligibility, blockout, already assigned) for a member in this occurrence, or
 * an empty string when the member can take the slot.
 */
export const buildRowPastePreview = ({
  cells,
  columns,
  members,
  duplicateFirstNames,
  getIssue,
}: {
  cells: string[];
  columns: ScheduleSlotColumn[];
  members: TeamRosterMember[];
  duplicateFirstNames: Set<string>;
  getIssue: (memberId: string, positionId: string) => string;
}): RowPastePreview => {
  const labelOf = (member: TeamRosterMember) =>
    scheduleMemberName(member, duplicateFirstNames);

  // Priority-ordered lookups. A key can map to several members (ambiguous).
  const byFull = new Map<string, string[]>();
  const byDisplay = new Map<string, string[]>();
  const byFirst = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, memberId: string) => {
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      if (!existing.includes(memberId)) existing.push(memberId);
    } else {
      map.set(key, [memberId]);
    }
  };
  members.forEach((member) => {
    add(byFull, normalizeName(`${member.firstName} ${member.lastName}`), member.memberId);
    add(byDisplay, normalizeName(labelOf(member)), member.memberId);
    add(byFirst, normalizeName(member.firstName), member.memberId);
  });
  const memberById = new Map(members.map((member) => [member.memberId, member]));

  // Track members already slated within THIS paste so a name repeated across two
  // columns is caught up front (one member serves one position per service), the
  // same rule manual assignment enforces.
  const slatedMemberIds = new Set<string>();

  const rows: RowPastePreviewRow[] = columns.map((column, index) => {
    const pastedText = (cells[index] ?? "").trim();
    const base = {
      columnKey: column.columnKey,
      positionId: column.positionId,
      positionLabel: column.label,
      pastedText,
    };

    if (!pastedText) {
      return { ...base, outcome: { kind: "empty" } };
    }

    const key = normalizeName(pastedText);
    const matches =
      (byFull.get(key)?.length ? byFull.get(key) : undefined) ??
      (byDisplay.get(key)?.length ? byDisplay.get(key) : undefined) ??
      byFirst.get(key) ??
      [];

    if (matches.length === 0) {
      return { ...base, outcome: { kind: "not-found" } };
    }
    if (matches.length > 1) {
      const matchLabels = matches
        .map((memberId) => memberById.get(memberId))
        .filter((member): member is TeamRosterMember => Boolean(member))
        .map(labelOf);
      return { ...base, outcome: { kind: "ambiguous", matchLabels } };
    }

    const memberId = matches[0];
    const member = memberById.get(memberId);
    const memberLabel = member ? labelOf(member) : pastedText;

    if (slatedMemberIds.has(memberId)) {
      return {
        ...base,
        outcome: {
          kind: "issue",
          reason: "Already assigned in this service",
          memberId,
          memberLabel,
        },
      };
    }

    const issue = getIssue(memberId, column.positionId);
    if (issue) {
      return { ...base, outcome: { kind: "issue", reason: issue, memberId, memberLabel } };
    }

    slatedMemberIds.add(memberId);
    return { ...base, outcome: { kind: "assign", memberId, memberLabel } };
  });

  const applyEntries: RowPasteApplyEntry[] = rows.flatMap((row) =>
    row.outcome.kind === "assign"
      ? [
        {
          columnKey: row.columnKey,
          positionId: row.positionId,
          memberId: row.outcome.memberId,
        },
      ]
      : [],
  );

  return {
    rows,
    applyEntries,
    ignoredCellCount: Math.max(0, cells.length - columns.length),
  };
};

/** Non-empty cells that did not result in an assignment (for the summary line). */
export const countSkippedRows = (rows: RowPastePreviewRow[]): number =>
  rows.filter(
    (row) => row.pastedText !== "" && row.outcome.kind !== "assign",
  ).length;
