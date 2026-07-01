import type { TeamPosition, TeamRosterMember } from "../../../api/authTypes";
import type { ScheduleSlotColumn } from "./scheduleRequirements";
import { makeSlotKey } from "./scheduleRequirements";
import {
  buildRowPastePreview,
  countSkippedRows,
  parsePastedRow,
} from "./schedulePasteRow";

const member = (
  memberId: string,
  firstName: string,
  lastName: string,
  positionIds: string[],
): TeamRosterMember => ({
  memberId,
  churchId: "c1",
  firstName,
  lastName,
  positionIds,
  blockoutDates: [],
});

const position = (positionId: string, name: string): TeamPosition => ({
  positionId,
  churchId: "c1",
  teamId: "t1",
  name,
});

const column = (positionId: string, name: string): ScheduleSlotColumn => ({
  columnKey: makeSlotKey(positionId, 0),
  position: position(positionId, name),
  positionId,
  slot: 0,
  totalSlots: 1,
  label: name,
});

const columns: ScheduleSlotColumn[] = [
  column("pos-vocal", "Vocals"),
  column("pos-keys", "Keys"),
  column("pos-drums", "Drums"),
];

const members: TeamRosterMember[] = [
  member("m-avery", "Avery", "Lee", ["pos-vocal"]),
  member("m-morgan", "Morgan", "Kay", ["pos-keys"]),
  member("m-johns", "John", "Smith", ["pos-vocal", "pos-drums"]),
  member("m-johnd", "John", "Doe", ["pos-drums"]),
];
// John appears twice, so the schedule shows "John S." / "John D.".
const duplicateFirstNames = new Set<string>(["john"]);

const noIssues = () => "";

describe("parsePastedRow", () => {
  it("splits an Excel tab-separated row and preserves empty cells", () => {
    expect(parsePastedRow("Avery\t\tJohn Doe")).toEqual({
      cells: ["Avery", "", "John Doe"],
      extraLineCount: 0,
    });
  });

  it("falls back to commas when there is no tab", () => {
    expect(parsePastedRow("Avery,Morgan,John Doe").cells).toEqual([
      "Avery",
      "Morgan",
      "John Doe",
    ]);
  });

  it("skips a leading date/label cell when asked", () => {
    expect(
      parsePastedRow("Jan 5\tAvery\tMorgan", { skipFirstCell: true }).cells,
    ).toEqual(["Avery", "Morgan"]);
  });

  it("uses the first non-empty line and counts the extras", () => {
    const parsed = parsePastedRow("\nAvery\tMorgan\nExtra one\nExtra two");
    expect(parsed.cells).toEqual(["Avery", "Morgan"]);
    expect(parsed.extraLineCount).toBe(2);
  });
});

describe("buildRowPastePreview", () => {
  it("assigns confident first-name and full-name matches", () => {
    const { rows, applyEntries } = buildRowPastePreview({
      cells: ["Avery", "Morgan Kay", ""],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(rows[0].outcome).toEqual({
      kind: "assign",
      memberId: "m-avery",
      memberLabel: "Avery",
    });
    expect(rows[1].outcome.kind).toBe("assign");
    expect(rows[2].outcome.kind).toBe("empty");
    expect(applyEntries).toEqual([
      { columnKey: makeSlotKey("pos-vocal", 0), positionId: "pos-vocal", memberId: "m-avery" },
      { columnKey: makeSlotKey("pos-keys", 0), positionId: "pos-keys", memberId: "m-morgan" },
    ]);
  });

  it("resolves a duplicate first name from its 'First L.' display form", () => {
    const { rows } = buildRowPastePreview({
      cells: ["", "", "John D."],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(rows[2].outcome).toEqual({
      kind: "assign",
      memberId: "m-johnd",
      memberLabel: "John D.",
    });
  });

  it("reports a bare duplicate first name as ambiguous", () => {
    const { rows, applyEntries } = buildRowPastePreview({
      cells: ["", "", "John"],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(rows[2].outcome.kind).toBe("ambiguous");
    expect(applyEntries).toHaveLength(0);
  });

  it("reports unknown names as not found", () => {
    const { rows } = buildRowPastePreview({
      cells: ["Nobody"],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(rows[0].outcome.kind).toBe("not-found");
  });

  it("surfaces the assignment issue reason and skips the slot", () => {
    const { rows, applyEntries } = buildRowPastePreview({
      cells: ["Avery"],
      columns,
      members,
      duplicateFirstNames,
      getIssue: (memberId) =>
        memberId === "m-avery" ? "Blocked out" : "",
    });
    expect(rows[0].outcome).toEqual({
      kind: "issue",
      reason: "Blocked out",
      memberId: "m-avery",
      memberLabel: "Avery",
    });
    expect(applyEntries).toHaveLength(0);
  });

  it("drops a name repeated across two columns in the same paste", () => {
    // John S. is eligible for both Vocals and Drums; pasting him twice should
    // only assign the first slot.
    const { rows, applyEntries } = buildRowPastePreview({
      cells: ["John S.", "", "John S."],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(rows[0].outcome.kind).toBe("assign");
    expect(rows[2].outcome).toEqual({
      kind: "issue",
      reason: "Already assigned in this service",
      memberId: "m-johns",
      memberLabel: "John S.",
    });
    expect(applyEntries).toEqual([
      { columnKey: makeSlotKey("pos-vocal", 0), positionId: "pos-vocal", memberId: "m-johns" },
    ]);
  });

  it("counts pasted cells that overflow the position columns", () => {
    const { ignoredCellCount } = buildRowPastePreview({
      cells: ["Avery", "Morgan", "John D.", "Extra", "Another"],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(ignoredCellCount).toBe(2);
  });

  it("counts skipped non-empty cells for the summary", () => {
    const { rows } = buildRowPastePreview({
      cells: ["Avery", "Nobody", ""],
      columns,
      members,
      duplicateFirstNames,
      getIssue: noIssues,
    });
    expect(countSkippedRows(rows)).toBe(1);
  });
});
