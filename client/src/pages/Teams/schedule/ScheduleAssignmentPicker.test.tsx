import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type {
  TeamRosterMember,
  TeamScheduleGuest,
} from "../../../api/authTypes";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";
import ScheduleAssignmentPicker from "./ScheduleAssignmentPicker";

const PickerHarness = ({
  currentPrimaryMemberId,
  currentAssigneeLabel,
  currentAssigneeIsGuest,
  hasCurrentAssignee,
  recentGuests,
  editableGuestIds,
  getGuestWarning,
  onAssignGuest,
  onEditGuest,
  onRemoveGuest,
  members,
  getAssignmentActionIssues,
  onAssignmentAction,
  onClose,
}: {
  currentPrimaryMemberId: string;
  currentAssigneeLabel: string;
  currentAssigneeIsGuest: boolean;
  hasCurrentAssignee: boolean;
  recentGuests: TeamScheduleGuest[];
  editableGuestIds: Set<string>;
  getGuestWarning?: (guestId: string) => string;
  onAssignGuest: jest.Mock;
  onEditGuest: jest.Mock;
  onRemoveGuest?: jest.Mock;
  members: TeamRosterMember[];
  getAssignmentActionIssues?: (memberId: string) => MemberAssignmentActionIssues;
  onAssignmentAction?: jest.Mock;
  onClose?: jest.Mock;
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [assignmentQuery, setAssignmentQuery] = useState("");
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
        members={members}
        assignmentQuery={assignmentQuery}
        onAssignmentQueryChange={setAssignmentQuery}
        currentPrimaryMemberId={currentPrimaryMemberId}
        currentAssigneeLabel={currentAssigneeLabel}
        currentAssigneeIsGuest={currentAssigneeIsGuest}
        hasCurrentAssignee={hasCurrentAssignee}
        recentGuests={recentGuests}
        editableGuestIds={editableGuestIds}
        getGuestWarning={getGuestWarning}
        getIssue={() => ""}
        getAssignmentActionIssues={getAssignmentActionIssues}
        onSelectMember={jest.fn()}
        onAssignmentAction={onAssignmentAction}
        onClose={onClose}
        onAssignGuest={onAssignGuest}
        onEditGuest={onEditGuest}
        onRemoveGuest={onRemoveGuest}
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
  editableGuestIds = new Set<string>(),
  getGuestWarning,
  onAssignGuest = jest.fn(),
  onEditGuest = jest.fn(),
  onRemoveGuest,
  members = [],
  getAssignmentActionIssues,
  onAssignmentAction,
  onClose = jest.fn(),
}: {
  currentPrimaryMemberId?: string;
  currentAssigneeLabel?: string;
  currentAssigneeIsGuest?: boolean;
  hasCurrentAssignee?: boolean;
  recentGuests?: TeamScheduleGuest[];
  editableGuestIds?: Set<string>;
  getGuestWarning?: (guestId: string) => string;
  onAssignGuest?: jest.Mock;
  onEditGuest?: jest.Mock;
  onRemoveGuest?: jest.Mock;
  members?: TeamRosterMember[];
  getAssignmentActionIssues?: (memberId: string) => MemberAssignmentActionIssues;
  onAssignmentAction?: jest.Mock;
  onClose?: jest.Mock;
} = {}) => {
  render(
    <PickerHarness
      currentPrimaryMemberId={currentPrimaryMemberId}
      currentAssigneeLabel={currentAssigneeLabel}
      currentAssigneeIsGuest={currentAssigneeIsGuest}
      hasCurrentAssignee={hasCurrentAssignee}
      recentGuests={recentGuests}
      editableGuestIds={editableGuestIds}
      getGuestWarning={getGuestWarning}
      onAssignGuest={onAssignGuest}
      onEditGuest={onEditGuest}
      onRemoveGuest={onRemoveGuest}
      members={members}
      getAssignmentActionIssues={getAssignmentActionIssues}
      onAssignmentAction={onAssignmentAction}
      onClose={onClose}
    />,
  );
  return { onAssignGuest, onEditGuest, onRemoveGuest, onClose };
};

it("closes when the close button is pressed", () => {
  const { onClose } = renderPicker();

  fireEvent.mouseDown(screen.getByRole("button", { name: "Close assignee picker" }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

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
      editableGuestIds: new Set(["scheduleGuest_1"]),
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

  it("searches all recent guests beyond the five-item preview", () => {
    const recentGuests = Array.from({ length: 8 }, (_, index) => ({
      guestId: `scheduleGuest_${index + 1}`,
      name: index === 7 ? "Alex Rivera" : `Guest ${index + 1}`,
    }));
    renderPicker({ recentGuests });

    fireEvent.change(screen.getByRole("combobox", { name: "Sunday Camera" }), {
      target: { value: "Alex" },
    });

    expect(screen.getByRole("group", { name: "Guests" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Alex Rivera.*Guest/i })).toBeInTheDocument();
  });

  it("excludes the guest already assigned to the active slot from search results", () => {
    renderPicker({
      currentPrimaryMemberId: "scheduleGuest_1",
      currentAssigneeLabel: "Michael Guest",
      currentAssigneeIsGuest: true,
      hasCurrentAssignee: true,
      recentGuests: [
        { guestId: "scheduleGuest_1", name: "Michael Guest" },
        { guestId: "scheduleGuest_2", name: "Michael Other" },
      ],
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Sunday Camera" }), {
      target: { value: "Michael" },
    });

    expect(screen.getByRole("option", { name: /Michael Other/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Michael Guest/ })).not.toBeInTheDocument();
  });

  it("shows the move source for a matching guest", () => {
    renderPicker({
      recentGuests: [{ guestId: "scheduleGuest_1", name: "Alex Rivera" }],
      getGuestWarning: () => "Will move from Camera",
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Sunday Camera" }), {
      target: { value: "Alex" },
    });

    expect(screen.getByText("Will move from Camera")).toBeInTheDocument();
  });

  it("does not expose edit or remove actions for historical-only guests", () => {
    renderPicker({ recentGuests: [{ guestId: "scheduleGuest_old", name: "Alex Rivera" }] });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Recent guests" }));

    expect(screen.queryByRole("button", { name: "Edit Alex Rivera" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove from schedule" })).not.toBeInTheDocument();
  });

  it("offers removal from the edit form for a current-schedule guest", async () => {
    const onRemoveGuest = jest.fn();
    renderPicker({
      recentGuests: [{ guestId: "scheduleGuest_1", name: "Alex Rivera" }],
      editableGuestIds: new Set(["scheduleGuest_1"]),
      onRemoveGuest,
    });

    fireEvent.mouseDown(screen.getByRole("button", { name: "Recent guests" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "Edit Alex Rivera" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove from schedule" }));

    await waitFor(() =>
      expect(onRemoveGuest).toHaveBeenCalledWith("scheduleGuest_1"),
    );
  });
});

describe("ScheduleAssignmentPicker occupied slots", () => {
  const member: TeamRosterMember = {
    memberId: "member-2",
    churchId: "church-1",
    firstName: "Taylor",
    lastName: "Morgan",
    positionIds: ["camera"],
    blockoutDates: [],
  };

  const getAssignmentActionIssues = (): MemberAssignmentActionIssues => ({
    replace: "",
    shadow: "",
    reverseShadow: "",
  });

  it("starts with focused actions instead of the full member list", () => {
    renderPicker({
      currentPrimaryMemberId: "member-1",
      currentAssigneeLabel: "Morgan",
      hasCurrentAssignee: true,
      members: [member],
      getAssignmentActionIssues,
      onAssignmentAction: jest.fn(),
    });

    expect(screen.getByRole("menuitem", { name: "Find a sub" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Add shadow" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Add reverse shadow" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("opens the member list for the selected action", () => {
    const onAssignmentAction = jest.fn();
    renderPicker({
      currentPrimaryMemberId: "member-1",
      currentAssigneeLabel: "Morgan",
      hasCurrentAssignee: true,
      members: [member],
      getAssignmentActionIssues,
      onAssignmentAction,
    });

    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Add shadow" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Taylor" }));

    expect(onAssignmentAction).toHaveBeenCalledWith("member-2", "shadow");
  });

  it("returns to the full member list when the active slot becomes empty", () => {
    const SlotChangeHarness = () => {
      const [currentPrimaryMemberId, setCurrentPrimaryMemberId] = useState("member-1");
      const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => setCurrentPrimaryMemberId("")}
          >
            Select empty slot
          </button>
          <button ref={setAnchorEl} type="button">Assignment anchor</button>
          <ScheduleAssignmentPicker
            open
            anchorEl={anchorEl}
            label="Sunday Camera"
            positionId="camera"
            positionName="Camera"
            members={[member]}
            assignmentQuery=""
            onAssignmentQueryChange={jest.fn()}
            currentPrimaryMemberId={currentPrimaryMemberId}
            currentAssigneeLabel={currentPrimaryMemberId ? "Morgan" : "Empty"}
            hasCurrentAssignee={Boolean(currentPrimaryMemberId)}
            getIssue={() => ""}
            getAssignmentActionIssues={getAssignmentActionIssues}
            onSelectMember={jest.fn()}
            onAssignmentAction={jest.fn()}
          />
        </>
      );
    };

    render(<SlotChangeHarness />);
    expect(screen.getByRole("menuitem", { name: "Find a sub" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select empty slot" }));

    expect(screen.queryByRole("menuitem", { name: "Find a sub" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Taylor" })).toBeInTheDocument();
  });

  it("shows the roster photo in the member option without adding a nested button", () => {
    renderPicker({
      members: [{
        ...member,
        profileImageUrl: "https://example.com/taylor.jpg",
      }],
    });

    const option = screen.getByRole("option", { name: "Taylor" });
    expect(within(option).getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/taylor.jpg",
    );
    expect(within(option).queryByRole("button")).not.toBeInTheDocument();
  });
});
