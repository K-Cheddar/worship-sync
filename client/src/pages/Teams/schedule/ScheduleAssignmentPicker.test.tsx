import userEvent from "@testing-library/user-event";
import ScheduleQuickMemberForm from "./ScheduleQuickMemberForm";
import ScheduleMemberConsentFollowup from "./ScheduleMemberConsentFollowup";
import { ToastProvider } from "../../../context/toastContext";
import { AuthApiError, getTeamsBootstrap, recordMemberSmsConsent, searchTeamRosterCandidates } from "../../../api/auth";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import type {
  TeamRosterMember,
  TeamScheduleGuest,
} from "../../../api/authTypes";
import type { MemberAssignmentActionIssues } from "./MemberAssignmentSubmenu";
import ScheduleAssignmentPicker from "./ScheduleAssignmentPicker";
import { CurrentMemberIdentityProvider } from "../components/CurrentUserMemberIndicator";

jest.mock("../../../api/auth", () => ({ AuthApiError: class extends Error { isReachabilityError = true; }, getTeamsBootstrap: jest.fn(), recordMemberSmsConsent: jest.fn(), searchTeamRosterCandidates: jest.fn().mockResolvedValue({ candidates: [] }) }));
const searchCandidates = jest.mocked(searchTeamRosterCandidates);

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
  onCreateMember,
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
  onCreateMember?: jest.Mock;
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
        churchId="church-1"
        teamId="team-1"
        teamName="Worship"
        onCreateMember={onCreateMember}
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
  onCreateMember,
  selfMemberId = null,
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
  onCreateMember?: jest.Mock;
  selfMemberId?: string | null;
} = {}) => {
  const view = render(
    <CurrentMemberIdentityProvider memberId={selfMemberId}>
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
        onCreateMember={onCreateMember}
      />
    </CurrentMemberIdentityProvider>,
  );
  return { onAssignGuest, onEditGuest, onRemoveGuest, onClose, unmount: view.unmount };
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

  it("marks the exact current assignee and hides the marker for a guest", () => {
    const { unmount } = renderPicker({
      currentPrimaryMemberId: "member-self",
      currentAssigneeLabel: "Rae Kim",
      hasCurrentAssignee: true,
      selfMemberId: "member-self",
    });
    expect(screen.getByText("You")).toBeInTheDocument();

    unmount();
    renderPicker({
      currentPrimaryMemberId: "member-self",
      currentAssigneeLabel: "Rae Kim",
      currentAssigneeIsGuest: true,
      hasCurrentAssignee: true,
      selfMemberId: "member-self",
    });
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("marks the matching member in the assignment picker", () => {
    renderPicker({
      members: [{ ...member, memberId: "member-self" }],
      selfMemberId: "member-self",
    });

    expect(screen.getByRole("option", { name: /Taylor.*You/ })).toBeInTheDocument();
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


describe("quick member creation", () => {
  const newMember = { memberId: "new", churchId: "church-1", firstName: "Jordan", lastName: "Ray", positionIds: ["camera"], blockoutDates: [] };
  beforeEach(() => { searchCandidates.mockReset(); searchCandidates.mockResolvedValue({ candidates: [] }); });

  const openForm = async (onCreateMember = jest.fn().mockResolvedValue({ member: newMember })) => {
    const user = userEvent.setup();
    renderPicker({ onCreateMember });
    await user.click(screen.getByRole("button", { name: "Add new member" }));
    return { user, onCreateMember };
  };
  const fillNames = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByRole("textbox", { name: /First name/ }), "Jordan");
    await user.type(screen.getByRole("textbox", { name: /Last name/ }), "Ray");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add & assign" })).toBeEnabled());
  };

  it("shows one creation action without searching, alongside guests, only with permission", async () => {
    const { user } = await openForm();
    expect(screen.getByText(/Team: Worship/)).toBeInTheDocument();
    expect(screen.getByText(/Position: Camera/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("button", { name: "Add new member" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add guest" })).toBeInTheDocument();
  });

  it("prefills a typed name and validates optional contact information", async () => {
    const user = userEvent.setup();
    const onCreateMember = jest.fn().mockResolvedValue({ member: newMember });
    renderPicker({ onCreateMember });
    await user.type(screen.getByRole("combobox"), "Jordan Ray");
    await user.click(screen.getByRole("button", { name: "Add new member" }));
    expect(screen.getByRole("textbox", { name: /First name/ })).toHaveValue("Jordan");
    expect(screen.getByRole("textbox", { name: /Last name/ })).toHaveValue("Ray");
    await user.type(screen.getByRole("textbox", { name: /Mobile phone/ }), "2025550123");
    expect(screen.getByRole("textbox", { name: /Mobile phone/ })).toHaveValue("(202) 555-0123");
    await user.type(screen.getByRole("textbox", { name: /Email/ }), "bad");
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    await user.clear(screen.getByRole("textbox", { name: /Email/ }));
    await user.type(screen.getByRole("textbox", { name: /Email/ }), "Jordan@Example.com");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add & assign" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    expect(onCreateMember).toHaveBeenCalledWith({ firstName: "Jordan", lastName: "Ray", phoneNumber: "(202) 555-0123", email: "jordan@example.com" }, undefined);
  });

  it("keeps values and displays the actual create failure", async () => {
    const { user, onCreateMember } = await openForm(jest.fn().mockRejectedValue(new Error("Member could not be saved.")));
    await fillNames(user);
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Member could not be saved.");
    expect(screen.getByRole("textbox", { name: /Last name/ })).toHaveValue("Ray");
    expect(onCreateMember).toHaveBeenCalledTimes(1);
  });

  it("retains the created member and retries assignment with its ID after partial success", async () => {
    const onCreateMember = jest.fn().mockResolvedValueOnce({ member: newMember, assignmentError: "Connection lost." }).mockResolvedValue({ member: newMember });
    const { user } = await openForm(onCreateMember);
    await fillNames(user);
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Member saved. Could not confirm the schedule assignment.");
    expect(screen.queryByRole("textbox", { name: /First name/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry assignment" }));
    expect(onCreateMember).toHaveBeenLastCalledWith({ firstName: "Jordan", lastName: "Ray" }, "new");
  });

  it("requires an explicit distinct-person decision for a duplicate name", async () => {
    searchCandidates.mockResolvedValue({ candidates: [{ memberId: "existing", firstName: "Jordan", lastName: "Ray" }] });
    const { user, onCreateMember } = await openForm();
    await user.type(screen.getByRole("textbox", { name: /First name/ }), "Jordan");
    await user.type(screen.getByRole("textbox", { name: /Last name/ }), "Ray");
    await screen.findByRole("button", { name: "Use Jordan Ray" });
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /different person/ }));
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    expect(onCreateMember).toHaveBeenCalledWith({ firstName: "Jordan", lastName: "Ray" }, undefined);
  });

  it("uses an explicitly selected candidate without creating a new person", async () => {
    searchCandidates.mockResolvedValue({ candidates: [{ memberId: "existing", firstName: "Jordan", lastName: "Ray" }] });
    const { user, onCreateMember } = await openForm();
    await user.type(screen.getByRole("textbox", { name: /First name/ }), "Jordan");
    await user.type(screen.getByRole("textbox", { name: /Last name/ }), "Ray");
    await user.click(await screen.findByRole("button", { name: "Use Jordan Ray" }));
    expect(onCreateMember).toHaveBeenCalledWith({ firstName: "Jordan", lastName: "Ray" }, "existing");
  });


  it("blocks duplicate activation immediately while a submission is pending", async () => {
    let finish!: (value: { member: TeamRosterMember }) => void;
    const onCreateMember = jest.fn(() => new Promise<{ member: TeamRosterMember }>((resolve) => { finish = resolve; }));
    const { user } = await openForm(onCreateMember);
    await fillNames(user);
    await user.dblClick(screen.getByRole("button", { name: "Add & assign" }));
    expect(onCreateMember).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    await act(async () => { finish({ member: newMember }); });
  });

  it("ignores stale duplicate lookups after editing a name", async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof searchTeamRosterCandidates>>) => void;
    searchCandidates.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const user = userEvent.setup();
    render(<ScheduleQuickMemberForm churchId="church-1" teamId="team-1" teamName="Worship" positionName="Camera" initialName="Jordan Ray" members={[]} onSubmit={jest.fn()} onCancel={jest.fn()} onSuccess={jest.fn()} />);
    await waitFor(() => expect(searchCandidates).toHaveBeenCalledWith("church-1", "team-1", "jordan ray"));
    await user.clear(screen.getByRole("textbox", { name: /First name/ }));
    await user.type(screen.getByRole("textbox", { name: /First name/ }), "Jane");
    await waitFor(() => expect(screen.getByRole("button", { name: "Add & assign" })).toBeEnabled());
    await act(async () => { resolveOld({ candidates: [{ memberId: "old", firstName: "Jordan", lastName: "Ray" }] }); });
    expect(screen.queryByRole("button", { name: "Use Jordan Ray" })).not.toBeInTheDocument();
  });

  it("ignores completion after the form unmounts", async () => {
    let finish!: (value: { member: TeamRosterMember }) => void;
    const onSuccess = jest.fn();
    const user = userEvent.setup();
    const view = render(<ScheduleQuickMemberForm churchId="church-1" teamId="team-1" teamName="Worship" positionName="Camera" initialName="Jordan Ray" members={[]} onSubmit={() => new Promise((resolve) => { finish = resolve; })} onCancel={jest.fn()} onSuccess={onSuccess} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add & assign" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    view.unmount();
    await act(async () => { finish({ member: newMember }); });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("checks the team roster after an uncertain create response before permitting another creation", async () => {
    const onCreateMember = jest.fn().mockRejectedValue(new AuthApiError("Connection lost."));
    const { user } = await openForm(onCreateMember);
    await fillNames(user);
    await user.click(screen.getByRole("button", { name: "Add & assign" }));
    await screen.findByRole("button", { name: "Check roster" });
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    jest.mocked(getTeamsBootstrap).mockResolvedValue({ success: true, teams: [], positions: [], schedules: [], members: [newMember] });
    await user.click(screen.getByRole("button", { name: "Check roster" }));
    await screen.findByRole("button", { name: "Use Jordan Ray" });
    expect(screen.getByRole("button", { name: "Add & assign" })).toBeDisabled();
    expect(onCreateMember).toHaveBeenCalledTimes(1);
  });

  it("does not show member creation without its permission callback", () => {
    renderPicker();
    expect(screen.queryByRole("button", { name: "Add new member" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add guest" })).toBeInTheDocument();
  });
});


describe("optional quick-member SMS consent", () => {
  const member: TeamRosterMember = { memberId: "consent-member", churchId: "church-1", firstName: "Jordan", lastName: "Ray", phoneNumber: "+12025550123", positionIds: [], blockoutDates: [] };
  it.each(["consent_needed", "opted_out", "enabled"] as const)("only offers recording for consent_needed, current status %s", async (status) => {
    jest.mocked(getTeamsBootstrap).mockResolvedValue({ success: true, members: [member], teams: [], positions: [], schedules: [], smsEligibilityByMemberId: {
      [member.memberId]: { status, eligible: status === "enabled", phoneNumber: member.phoneNumber! },
    } });
    render(<ToastProvider><ScheduleMemberConsentFollowup churchId="church-1" member={member} onClose={jest.fn()} /></ToastProvider>);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    const record = screen.queryByRole("button", { name: "Record text message consent" });
    expect(Boolean(record)).toBe(status === "consent_needed");
    const inspectConsentForm = async () => {
      expect(screen.getByRole("button", { name: "Save consent" })).toBeDisabled();
      expect(screen.getByText("Consent source")).toBeInTheDocument();
      expect(screen.getByLabelText(/Date consent was obtained/)).toBeInTheDocument();
    };
    if (status === "consent_needed") {
      await userEvent.click(record!);
      await inspectConsentForm();
    }
    expect(recordMemberSmsConsent).not.toHaveBeenCalled();
  });
});
