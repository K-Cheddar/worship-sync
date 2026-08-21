import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type { TeamScheduleGuest } from "../../../api/authTypes";
import ScheduleAssignmentPicker from "./ScheduleAssignmentPicker";

const PickerHarness = ({
  currentPrimaryMemberId,
  currentAssigneeLabel,
  currentAssigneeIsGuest,
  hasCurrentAssignee,
  recentGuests,
  onAssignGuest,
  onEditGuest,
}: {
  currentPrimaryMemberId: string;
  currentAssigneeLabel: string;
  currentAssigneeIsGuest: boolean;
  hasCurrentAssignee: boolean;
  recentGuests: TeamScheduleGuest[];
  onAssignGuest: jest.Mock;
  onEditGuest: jest.Mock;
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchorEl} type="button">
        Assignment anchor
      </button>
      <ScheduleAssignmentPicker
        open
        anchorEl={anchorEl}
        label="Sunday Camera"
        positionId="camera"
        positionName="Camera"
        members={[]}
        assignmentQuery=""
        onAssignmentQueryChange={jest.fn()}
        currentPrimaryMemberId={currentPrimaryMemberId}
        currentAssigneeLabel={currentAssigneeLabel}
        currentAssigneeIsGuest={currentAssigneeIsGuest}
        hasCurrentAssignee={hasCurrentAssignee}
        recentGuests={recentGuests}
        getIssue={() => ""}
        onSelectMember={jest.fn()}
        onAssignGuest={onAssignGuest}
        onEditGuest={onEditGuest}
      />
    </>
  );
};

const renderPicker = ({
  currentPrimaryMemberId = "",
  currentAssigneeLabel = "Empty",
  currentAssigneeIsGuest = false,
  hasCurrentAssignee = false,
  recentGuests = [],
  onAssignGuest = jest.fn(),
  onEditGuest = jest.fn(),
}: {
  currentPrimaryMemberId?: string;
  currentAssigneeLabel?: string;
  currentAssigneeIsGuest?: boolean;
  hasCurrentAssignee?: boolean;
  recentGuests?: TeamScheduleGuest[];
  onAssignGuest?: jest.Mock;
  onEditGuest?: jest.Mock;
} = {}) => {
  render(
    <PickerHarness
      currentPrimaryMemberId={currentPrimaryMemberId}
      currentAssigneeLabel={currentAssigneeLabel}
      currentAssigneeIsGuest={currentAssigneeIsGuest}
      hasCurrentAssignee={hasCurrentAssignee}
      recentGuests={recentGuests}
      onAssignGuest={onAssignGuest}
      onEditGuest={onEditGuest}
    />,
  );
  return { onAssignGuest, onEditGuest };
};

describe("ScheduleAssignmentPicker guests", () => {
  it("collects optional guest details and assigns without creating a member", async () => {
    const { onAssignGuest } = renderPicker();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Add guest" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Guest name/i }), {
      target: { value: "Alex Rivera" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Guest email/i }), {
      target: { value: "alex@example.com" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Guest phone/i }), {
      target: { value: "555-0100" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Guest note/i }), {
      target: { value: "Visiting camera operator" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add & assign" }));

    await waitFor(() =>
      expect(onAssignGuest).toHaveBeenCalledWith({
        name: "Alex Rivera",
        email: "alex@example.com",
        phone: "555-0100",
        note: "Visiting camera operator",
      }),
    );
  });

  it("makes replacement explicit when a slot is already filled", () => {
    renderPicker({
      currentPrimaryMemberId: "member-1",
      currentAssigneeLabel: "Morgan",
      hasCurrentAssignee: true,
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Add guest" }));

    expect(
      screen.getByText("This will replace Morgan in this slot."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replace & assign" }),
    ).toBeDisabled();
  });

  it("keeps recent guests behind a submenu near Add guest", async () => {
    const { onAssignGuest } = renderPicker({
      recentGuests: [
        { guestId: "scheduleGuest_1", name: "Alex Rivera" },
        { guestId: "scheduleGuest_2", name: "Jordan Lee" },
      ],
    });

    expect(screen.queryByRole("menuitem", { name: /Alex Rivera/i })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Recent guests" }));

    const alex = screen.getByRole("menuitem", { name: /Alex Rivera/i });
    expect(alex).toBeInTheDocument();
    fireEvent.mouseDown(alex);

    await waitFor(() =>
      expect(onAssignGuest).toHaveBeenCalledWith({
        guestId: "scheduleGuest_1",
        name: "Alex Rivera",
      }),
    );
  });

  it("does not list the current guest assignee under recent guests", () => {
    renderPicker({
      currentPrimaryMemberId: "scheduleGuest_1",
      currentAssigneeLabel: "Michael",
      currentAssigneeIsGuest: true,
      hasCurrentAssignee: true,
      recentGuests: [
        { guestId: "scheduleGuest_1", name: "Michael" },
        { guestId: "scheduleGuest_2", name: "Jordan Lee" },
      ],
    });

    expect(
      within(screen.getByLabelText(/Current assignee/i)).getByText("Michael"),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Recent guests" }));

    expect(screen.getByRole("menuitem", { name: /Jordan Lee/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Michael/i })).not.toBeInTheDocument();
  });

  it("edits a recent guest without assigning it to the active slot", async () => {
    const { onAssignGuest, onEditGuest } = renderPicker({
      recentGuests: [{ guestId: "scheduleGuest_1", name: "Alex Rivera" }],
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Recent guests" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Edit Alex Rivera" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Guest name/i }), {
      target: { value: "Alex R." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(onEditGuest).toHaveBeenCalledWith({
        guestId: "scheduleGuest_1",
        name: "Alex R.",
      }),
    );
    expect(onAssignGuest).not.toHaveBeenCalled();
  });
});
