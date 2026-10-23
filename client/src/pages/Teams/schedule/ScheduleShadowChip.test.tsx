import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import type { TeamScheduleShadowAssignment } from "../../../api/authTypes";
import ScheduleShadowChip from "./ScheduleShadowChip";
import { CurrentMemberIdentityProvider } from "../components/CurrentUserMemberIndicator";
import {
  ScheduleAssignmentContext,
  type ScheduleAssignmentHandlers,
} from "./ScheduleAssignmentContext";

const shadow: TeamScheduleShadowAssignment = { memberId: "m2", kind: "shadow" };

const baseProps = {
  occurrenceId: "o1",
  cellKey: "p1::0",
  positionId: "p1",
  shadow,
  memberName: "Josh",
  canEdit: true,
};

const renderChip = (
  props: Partial<typeof baseProps> & { memberId?: string } = {},
  selfMemberId: string | null = null,
) => {
  const commitShadowAssignment = jest.fn();
  const handlersRef = createRef<ScheduleAssignmentHandlers>() as RefObject<
    ScheduleAssignmentHandlers
  >;
  handlersRef.current = {
    commitShadowAssignment,
  } as unknown as ScheduleAssignmentHandlers;
  render(
    <CurrentMemberIdentityProvider memberId={selfMemberId}>
      <ScheduleAssignmentContext.Provider value={handlersRef}>
        <ScheduleShadowChip {...baseProps} {...props} />
      </ScheduleAssignmentContext.Provider>
    </CurrentMemberIdentityProvider>,
  );
  return { commitShadowAssignment };
};

describe("ScheduleShadowChip", () => {
  it("labels the chip with the shadow kind and member name", () => {
    renderChip();
    expect(screen.getByText("Shadow:")).toBeInTheDocument();
    expect(screen.getByText("Josh")).toBeInTheDocument();
  });

  it("marks the matching roster member in shadow text and its accessible remove action", () => {
    renderChip({ memberId: "m2" }, "m2");
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Shadow: Josh, You" })).toBeInTheDocument();
  });

  it("uses the reverse-shadow label for reverse shadows", () => {
    renderChip({ shadow: { memberId: "m2", kind: "reverse_shadow" } });
    expect(screen.getByText("Reverse shadow:")).toBeInTheDocument();
    expect(screen.getByText("Josh")).toBeInTheDocument();
  });

  it("removes the shadow through commitShadowAssignment when the × is clicked", () => {
    const { commitShadowAssignment } = renderChip();
    fireEvent.click(screen.getByRole("button", { name: "Remove Shadow: Josh" }));
    expect(commitShadowAssignment).toHaveBeenCalledTimes(1);
    expect(commitShadowAssignment).toHaveBeenCalledWith({
      serviceId: "o1",
      cellKey: "p1::0",
      basePositionId: "p1",
      memberId: "m2",
      shadowKind: "shadow",
      action: "remove",
    });
  });

  it("hides the remove control when editing is disabled", () => {
    renderChip({ canEdit: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Shadow:")).toBeInTheDocument();
    expect(screen.getByText("Josh")).toBeInTheDocument();
  });
});
