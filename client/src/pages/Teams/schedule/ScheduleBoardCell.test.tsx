import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import type { TeamRosterMember } from "../../../api/authTypes";
import ScheduleBoardCell from "./ScheduleBoardCell";
import {
  ScheduleAssignmentContext,
  type ScheduleAssignmentHandlers,
} from "./ScheduleAssignmentContext";

const member = (overrides: Partial<TeamRosterMember> = {}): TeamRosterMember => ({
  memberId: "m1",
  churchId: "c1",
  firstName: "Kameal",
  lastName: "Anderson",
  positionIds: ["p1"],
  blockoutDates: [],
  ...overrides,
});

const baseProps = {
  occurrenceId: "o1",
  occurrenceName: "Sunday Service",
  occurrenceDate: "2026-09-06",
  columnKey: "p1::0",
  positionId: "p1",
  positionLabel: "Front Of House Audio",
  positionIcon: undefined,
  positionArchived: false,
  isMemberHighlighted: false,
  isActiveSlot: false,
  allMembers: [member()],
  duplicateFirstNames: new Set<string>(),
  canEdit: true,
};

/** Render a cell wired to a spyable activateSlot handler via the shared context. */
const renderCell = (props: Partial<typeof baseProps> & Record<string, unknown> = {}) => {
  const activateSlot = jest.fn();
  const handlersRef = createRef<ScheduleAssignmentHandlers>() as RefObject<
    ScheduleAssignmentHandlers
  >;
  handlersRef.current = { activateSlot } as unknown as ScheduleAssignmentHandlers;
  render(
    <ScheduleAssignmentContext.Provider value={handlersRef}>
      <ScheduleBoardCell {...baseProps} {...props} />
    </ScheduleAssignmentContext.Provider>,
  );
  return { activateSlot };
};

describe("ScheduleBoardCell", () => {
  it("shows the position label and the assigned member's name", () => {
    renderCell({ assignmentCell: { primaryMemberId: "m1" } });
    expect(screen.getByText("Front Of House Audio")).toBeInTheDocument();
    expect(screen.getByText("Kameal")).toBeInTheDocument();
  });

  it("shows an unassigned placeholder when the slot is empty", () => {
    renderCell({ assignmentCell: undefined });
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("activates the matching slot, anchored to the row, when clicked (picker parity)", () => {
    const { activateSlot } = renderCell({ assignmentCell: { primaryMemberId: "m1" } });
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(activateSlot).toHaveBeenCalledTimes(1);
    expect(activateSlot).toHaveBeenCalledWith(
      { occurrenceId: "o1", columnKey: "p1::0" },
      trigger,
    );
  });

  it("does not activate a slot when editing is disabled", () => {
    const { activateSlot } = renderCell({ canEdit: false });
    fireEvent.click(screen.getByRole("button"));
    expect(activateSlot).not.toHaveBeenCalled();
  });

  // Members can now add their own blockouts after a schedule is built, so a
  // filled slot can go stale. The picker only warns while filling a slot.
  it("flags an assignee who has blocked the service date out", () => {
    renderCell({
      allMembers: [
        member({
          blockoutDates: [
            { startDate: "2026-09-05", endDate: "2026-09-08", notes: "Away" },
          ],
        }),
      ],
      assignmentCell: { primaryMemberId: "m1" },
    });

    expect(
      screen.getByRole("button", { name: /Blocked out/i }),
    ).toBeInTheDocument();
  });

  it("does not flag a blockout that misses the service date", () => {
    renderCell({
      allMembers: [
        member({
          blockoutDates: [{ startDate: "2026-10-01", endDate: "2026-10-05" }],
        }),
      ],
      assignmentCell: { primaryMemberId: "m1" },
    });

    expect(
      screen.queryByRole("button", { name: /Blocked out/i }),
    ).not.toBeInTheDocument();
  });

  it("renders shadow assignees below the primary slot", () => {
    renderCell({
      allMembers: [member(), member({ memberId: "m2", firstName: "Josh" })],
      assignmentCell: {
        primaryMemberId: "m1",
        shadows: [{ memberId: "m2", kind: "shadow" }],
      },
    });
    expect(screen.getByText(/Josh/)).toBeInTheDocument();
  });
});
