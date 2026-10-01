import type * as ReactTypes from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { TeamRosterMember } from "../../../api/authTypes";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";
import ScheduleAssignmentPicker from "./ScheduleAssignmentPicker";

jest.mock("@/components/ui/Popover", () => {
  const React = jest.requireActual("react") as typeof import("react");
  const actual = jest.requireActual(
    "@/components/ui/Popover",
  ) as typeof import("@/components/ui/Popover");

  const PopoverContent = React.forwardRef<
    HTMLDivElement,
    ReactTypes.ComponentProps<"div"> & {
      side?: string;
      sideOffset?: number;
      avoidCollisions?: boolean;
      collisionPadding?: number;
      onOpenAutoFocus?: (event: Event) => void;
    }
  >((props, ref) => {
    const {
      side,
      avoidCollisions,
      collisionPadding,
      sideOffset: _sideOffset,
      onOpenAutoFocus: _onOpenAutoFocus,
      children,
      ...contentProps
    } = props;

    return React.createElement(
      "div",
      {
        ...contentProps,
        ref,
        "data-testid": "picker-popover-content",
        "data-side": side,
        "data-avoid-collisions": String(avoidCollisions),
        "data-collision-padding": String(collisionPadding),
      },
      children,
    );
  });

  return { ...actual, PopoverContent };
});

const member: TeamRosterMember = {
  memberId: "member-2",
  churchId: "church-1",
  firstName: "Taylor",
  lastName: "Morgan",
  positionIds: ["camera"],
  blockoutDates: [],
};

const assignmentActionIssues = (): MemberAssignmentActionIssues => ({
  replace: "",
  shadow: "",
  reverseShadow: "",
});

const PlacementHarness = () => {
  const [open, setOpen] = useState(true);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={setAnchorEl} type="button">
        Assignment anchor
      </button>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}>
          Reopen picker
        </button>
      ) : null}
      <ScheduleAssignmentPicker
        open={open}
        anchorEl={anchorEl}
        label="Sunday Camera"
        positionId="camera"
        positionName="Camera"
        members={[member]}
        assignmentQuery=""
        onAssignmentQueryChange={jest.fn()}
        currentPrimaryMemberId="member-1"
        currentAssigneeLabel="Morgan"
        hasCurrentAssignee
        getIssue={() => ""}
        getAssignmentActionIssues={assignmentActionIssues}
        onSelectMember={jest.fn()}
        onAssignmentAction={jest.fn()}
        onAssignGuest={jest.fn()}
        onClose={() => setOpen(false)}
      />
    </>
  );
};

const expectCollisionPolicy = (content: HTMLElement) => {
  expect(content).toHaveAttribute("data-avoid-collisions", "true");
  expect(content).toHaveAttribute("data-collision-padding", "8");
};

it("keeps collision handling enabled through expanded views and resets placement on reopen", () => {
  render(<PlacementHarness />);

  const initialMenu = screen.getByTestId("picker-popover-content");
  expectCollisionPolicy(initialMenu);

  fireEvent.mouseDown(screen.getByRole("menuitem", { name: "More options" }));
  expectCollisionPolicy(screen.getByTestId("picker-popover-content"));

  fireEvent.mouseDown(screen.getByRole("option", { name: "Taylor" }));
  expectCollisionPolicy(screen.getByTestId("picker-popover-content"));

  fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Back" }));
  fireEvent.mouseDown(screen.getByRole("menuitem", { name: "More options" }));
  fireEvent.mouseDown(screen.getByRole("button", { name: "Add guest" }));
  expectCollisionPolicy(screen.getByTestId("picker-popover-content"));

  fireEvent.mouseDown(screen.getByRole("button", { name: "Close assignee picker" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen picker" }));

  const reopenedMenu = screen.getByTestId("picker-popover-content");
  expect(reopenedMenu).toHaveAttribute("data-side", "bottom");
  expectCollisionPolicy(reopenedMenu);
});
