import { fireEvent, render, screen } from "@testing-library/react";
import type {
  TeamPosition,
  TeamScheduleOccurrence,
} from "../../../api/authTypes";
import type { ScheduleSlotColumn } from "./scheduleRequirements";
import ScheduleBoardView from "./ScheduleBoardView";

const position = (id: string, name: string): TeamPosition => ({
  positionId: id,
  churchId: "c1",
  teamId: "t1",
  name,
});

const column = (positionId: string, name: string): ScheduleSlotColumn => ({
  columnKey: `${positionId}::0`,
  position: position(positionId, name),
  positionId,
  slot: 0,
  totalSlots: 1,
  label: name,
});

const occurrence = (occurrenceId: string): TeamScheduleOccurrence => ({
  occurrenceId,
  serviceId: "s1",
  name: "Sunday Service",
  startsAt: "2026-07-12T14:00:00.000Z",
});

const columns = [
  column("p1", "Front Of House Audio"),
  column("p2", "Graphics Operator"),
];

// o1 requires only FOH, o2 requires both, o3 requires nothing.
const requiredCountByOccurrence: Record<string, Record<string, number>> = {
  o1: { p1: 1, p2: 0 },
  o2: { p1: 1, p2: 1 },
  o3: { p1: 0, p2: 0 },
};

const buildCellProps = (
  occ: TeamScheduleOccurrence,
  col: ScheduleSlotColumn,
) => ({
  slot: col.slot,
  requiredCount: requiredCountByOccurrence[occ.occurrenceId]?.[col.positionId] ?? 0,
  isSlotEnabled:
    col.slot < (requiredCountByOccurrence[occ.occurrenceId]?.[col.positionId] ?? 0),
  isAdditionalPosition: false,
  assignmentCell: undefined,
  isMemberHighlighted: false,
  isActiveSlot: false,
  allMembers: [],
  duplicateFirstNames: new Set<string>(),
  canEdit: true,
});

const renderView = (
  occurrenceIds: string[],
  options: {
    onOpenServiceSummary?: (occurrenceId: string) => void;
    nextUpcomingOccurrenceId?: string | null;
    isExpanded?: (occurrenceId: string) => boolean;
    onToggleExpanded?: (occurrenceId: string) => void;
  } = {},
) =>
  render(
    <ScheduleBoardView
      groups={[
        {
          serviceId: "s1",
          serviceName: "Sunday Service",
          occurrences: occurrenceIds.map(occurrence),
          sharedTiming: { sharedWeekday: null, sharedTime: null },
        },
      ]}
      columns={columns}
      teamName="Media Team"
      canEdit
      nextUpcomingOccurrenceId={options.nextUpcomingOccurrenceId ?? null}
      isExpanded={options.isExpanded ?? (() => true)}
      onToggleExpanded={options.onToggleExpanded ?? jest.fn()}
      fillByOccurrence={
        new Map(
          occurrenceIds.map((id) => {
            const req = requiredCountByOccurrence[id] ?? {};
            const required = columns.filter(
              (col) => col.slot < (req[col.positionId] ?? 0),
            ).length;
            return [id, { filled: 0, required }];
          }),
        )
      }
      serviceArchivedById={() => false}
      onOpenServiceSummary={options.onOpenServiceSummary ?? jest.fn()}
      getAdditionalPositionOptions={() => []}
      buildCellProps={buildCellProps}
    />,
  );

describe("ScheduleBoardView", () => {
  it("renders one card per occurrence with the team name header", () => {
    renderView(["o1", "o2", "o3"]);
    expect(screen.getAllByText("Media Team")).toHaveLength(3);
  });

  it("lists only the positions each occurrence requires", () => {
    renderView(["o1", "o2"]);
    // FOH is required by both occurrences; Graphics only by o2.
    expect(screen.getAllByText("Front Of House Audio")).toHaveLength(2);
    expect(screen.getAllByText("Graphics Operator")).toHaveLength(1);
  });

  it("shows an empty state for an occurrence that requires no positions", () => {
    renderView(["o3"]);
    expect(
      screen.getByText("No positions required for this service."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Front Of House Audio")).not.toBeInTheDocument();
  });

  it("opens the service summary when the occurrence date button is clicked", () => {
    const onOpenServiceSummary = jest.fn();
    renderView(["o1"], { onOpenServiceSummary });
    fireEvent.click(
      screen.getByRole("button", {
        name: /View and copy assignments for Sunday Service/i,
      }),
    );
    expect(onOpenServiceSummary).toHaveBeenCalledWith("o1");
  });

  it("reflects expanded state and reports toggles to the parent", () => {
    const onToggleExpanded = jest.fn();
    renderView(["o1"], { isExpanded: () => true, onToggleExpanded });
    const toggle = screen.getByRole("button", {
      name: /Collapse Sunday Service on/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggleExpanded).toHaveBeenCalledWith("o1");
  });

  it("offers the expand affordance when a card is collapsed", () => {
    renderView(["o1"], { isExpanded: () => false });
    expect(
      screen.getByRole("button", { name: /Expand Sunday Service on/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a labelled fill summary regardless of expanded state", () => {
    // o2 requires FOH + Graphics (2 positions), both unassigned; the summary
    // stays visible even when the positions are collapsed.
    renderView(["o2"], { isExpanded: () => false });
    expect(
      screen.getByLabelText("0 of 2 positions filled"),
    ).toBeInTheDocument();
    expect(screen.getByText("filled")).toBeInTheDocument();
  });

  it("marks only the next upcoming service", () => {
    renderView(["o1", "o2"], { nextUpcomingOccurrenceId: "o2" });
    expect(screen.getAllByText(/Up next/i)).toHaveLength(1);
  });
});
