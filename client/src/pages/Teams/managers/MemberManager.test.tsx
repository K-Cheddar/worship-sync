import { type ContextType } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MemberManager from "./MemberManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type {
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
} from "../../../api/authTypes";
import type { TeamsData } from "../types";

const mockCreateTeamRosterMember = jest.fn();
const mockUpdateTeamRosterMember = jest.fn();

const mockInviteTeamRosterMember = jest.fn(async () => ({ success: true }));

jest.mock("../../../api/auth", () => ({
  archiveTeamRosterMember: jest.fn(),
  createTeamRosterMember: (...args: unknown[]) =>
    mockCreateTeamRosterMember(...args),
  deleteTeamRosterMember: jest.fn(),
  linkTeamRosterMember: jest.fn(),
  unlinkTeamRosterMember: jest.fn(),
  listChurchMembers: jest.fn(async () => ({ members: [] })),
  inviteTeamRosterMember: (...args: unknown[]) =>
    mockInviteTeamRosterMember(...args),
  updateTeamRosterMember: (...args: unknown[]) =>
    mockUpdateTeamRosterMember(...args),
}));

const worshipTeam: TeamRecord = {
  teamId: "team-worship",
  churchId: "church-1",
  name: "Worship",
  memberIds: [],
};

const vocalPosition = {
  positionId: "position-vocal",
  churchId: "church-1",
  teamId: "team-worship",
  name: "Vocal",
};

const leadRole = {
  roleId: "role-lead",
  churchId: "church-1",
  teamId: "team-worship",
  name: "Team lead",
};

const buildData = (overrides: Partial<TeamsData> = {}): TeamsData => ({
  members: [],
  positions: [vocalPosition],
  teams: [worshipTeam],
  teamRoles: [leadRole],
  qualificationAreas: [],
  qualificationLevels: [],
  services: [],
  schedules: [],
  intakeForms: [],
  intakeSubmissions: [],
  ...overrides,
}) as TeamsData;

/** A member already on Worship and eligible for its Vocal position. */
const worshipMember: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: ["position-vocal"],
  blockoutDates: [],
};

const joinedData = (overrides: Partial<TeamsData> = {}) =>
  buildData({
    members: [worshipMember],
    teams: [{ ...worshipTeam, memberIds: ["member-1"] }],
    ...overrides,
  });

const renderManager = ({
  data = buildData(),
  onSaved = jest.fn(),
  onTeamSaved = jest.fn(),
  userId = "",
  role = "admin",
}: {
  data?: TeamsData;
  onSaved?: jest.Mock;
  onTeamSaved?: jest.Mock;
  userId?: string;
  /** Invite and the account picker call admin-only endpoints. */
  role?: string;
} = {}) => {
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          { churchId: "church-1", userId, role } as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <MemberManager
              members={data.members}
              positions={data.positions}
              data={data}
              canEdit
              onSaved={onSaved}
              onTeamSaved={onTeamSaved}
              onArchived={jest.fn()}
              onRemoved={jest.fn()}
            />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );
  return { onSaved, onTeamSaved };
};

const openCreateForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Create member" }));
};

const openMember = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) => {
  await user.click(screen.getByRole("button", { name }));
};

// The filter aside stays mounted alongside the editor and has its own Teams and
// Positions groups, so form queries are scoped to the editor region.
const form = () =>
  within(screen.getByRole("region", { name: /^(Create|Edit) member$/ }));

const positionsField = () => form().getByRole("group", { name: "Positions" });
const teamsField = () => form().getByRole("group", { name: "Teams" });

const toggleVocalPosition = async (
  user: ReturnType<typeof userEvent.setup>,
) => {
  await user.click(
    within(positionsField()).getByRole("checkbox", { name: /Vocal/ }),
  );
};

const toggleWorshipTeam = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    within(teamsField()).getByRole("checkbox", { name: /Worship/ }),
  );
};

const worshipTeamCheckbox = () =>
  within(teamsField()).getByRole("checkbox", { name: /Worship/ });
const vocalPositionCheckbox = () =>
  within(positionsField()).getByRole("checkbox", { name: /Vocal/ });

const fillName = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/First name/), "Sky");
  await user.type(screen.getByLabelText(/Last name/), "Lane");
};

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  mockCreateTeamRosterMember.mockReset();
  mockUpdateTeamRosterMember.mockReset();
  originalMatchMedia = window.matchMedia;
  // Desktop default: max-width queries do not match, so the panel stays open.
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("MemberManager member preferences", () => {
  it("keeps create and filter actions usable while a member is open", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData() });

    await openMember(user, /Rae Kim/);

    const createButton = screen.getByRole("button", { name: "Create member" });
    const filterButton = screen.getByRole("button", { name: "Filter members" });
    expect(createButton).toBeEnabled();
    expect(filterButton).toBeEnabled();

    await user.click(filterButton);
    expect(
      screen.getByRole("region", { name: "Filter members" }),
    ).not.toHaveAttribute("inert");
    expect(
      screen.getByRole("region", { name: "Edit member" }),
    ).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Close filters" }));
    await user.type(screen.getByLabelText(/First name/), " updated");
    await user.click(createButton);
    expect(
      screen.getByRole("dialog", { name: "Unsaved changes" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.getByRole("region", { name: "Create member" }),
    ).not.toHaveAttribute("inert");
    expect(screen.getByLabelText(/First name/)).toHaveValue("");
  });

  it("guards member changes after selecting a profile image and clears the preview", async () => {
    const user = userEvent.setup();
    const secondMember: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-2",
      firstName: "Jo",
      lastName: "Smith",
    };
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:member-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });

    try {
      renderManager({
        data: joinedData({ members: [worshipMember, secondMember] }),
      });
      await openMember(user, /Rae Kim/);
      const file = new File(["profile"], "profile.png", { type: "image/png" });
      await user.upload(screen.getByLabelText("Profile image upload"), file);

      await user.click(screen.getByRole("button", { name: /Jo Smith/ }));
      expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
      expect(screen.getByDisplayValue("Rae")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Discard changes" }));

      expect(screen.getByDisplayValue("Jo")).toBeInTheDocument();
      expect(screen.queryByAltText("Rae profile")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    }
  });

  it("allows manual minor status and saves the serving preference without a birth date", async () => {
    const user = userEvent.setup();
    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: {
        ...worshipMember,
        memberId: "member-new",
        firstName: "Sky",
        lastName: "Lane",
        isMinor: true,
        servingFrequency: "twice_monthly",
      },
    });
    renderManager();
    await openCreateForm(user);
    await fillName(user);

    const minorCheckbox = screen.getByRole("checkbox", { name: /Minor/ });
    expect(minorCheckbox).toBeEnabled();
    await user.click(minorCheckbox);
    await user.click(screen.getByRole("combobox", { name: /Serving frequency/ }));
    await user.click(screen.getByRole("option", { name: "Twice a month" }));
    await user.click(screen.getByRole("button", { name: "Save member" }));

    await waitFor(() => expect(mockCreateTeamRosterMember).toHaveBeenCalled());
    const [, body] = mockCreateTeamRosterMember.mock.calls[0];
    expect(body.isMinor).toBe(true);
    expect(body.servingFrequency).toBe("twice_monthly");
  });

  it("derives and disables minor status when a birth date is saved", async () => {
    const user = userEvent.setup();
    const birthDate = { year: new Date().getFullYear() - 10, month: 1, day: 1 };
    renderManager({
      data: joinedData({
        members: [
          {
            ...worshipMember,
            birthDate,
            isMinor: false,
          },
        ],
      }),
    });
    await openMember(user, /Rae Kim/);

    const minorCheckbox = screen.getByRole("checkbox", { name: /Minor/ });
    expect(minorCheckbox).toBeChecked();
    expect(minorCheckbox).toBeDisabled();
    expect(screen.getByText("Set automatically when the birth year is provided.")).toBeInTheDocument();
  });
});

describe("MemberManager team membership", () => {
  it("checks a position's team, so eligibility and membership cannot disagree", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);

    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "false");
    await toggleVocalPosition(user);
    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "true");
  });

  it("offers a team role as soon as a team is on the draft, before saving", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);

    expect(
      screen.getByText("Choose a team above to assign a team role."),
    ).toBeInTheDocument();

    await toggleWorshipTeam(user);

    expect(
      screen.getByRole("combobox", { name: /Worship role/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Choose a team above to assign a team role."),
    ).not.toBeInTheDocument();
  });

  it("puts a member on a team with no position, for someone not schedulable yet", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);
    await fillName(user);
    await toggleWorshipTeam(user);

    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, positionIds: [] },
    });
    await user.click(screen.getByRole("button", { name: "Save member" }));

    await waitFor(() => expect(mockCreateTeamRosterMember).toHaveBeenCalled());
    const [, body] = mockCreateTeamRosterMember.mock.calls[0];
    expect(body.teamIds).toEqual(["team-worship"]);
    expect(body.positionIds).toEqual([]);
  });

  it("warns which teams a save will join the member to", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);
    await toggleVocalPosition(user);

    expect(screen.getByText(/Saving will add/)).toHaveTextContent("Worship");
  });

  it("does not warn about a team the member already belongs to", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);

    expect(screen.queryByText(/Saving will add/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Saving will remove/)).not.toBeInTheDocument();
  });

  it("offers to leave a team once its last position is unchecked", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);

    expect(
      screen.queryByText("No Worship positions left"),
    ).not.toBeInTheDocument();

    await toggleVocalPosition(user);

    // The membership is deliberately kept — trainees and shadow assignees sit
    // on a roster with no position — so this offers the removal, not does it.
    expect(screen.getByText("No Worship positions left")).toBeInTheDocument();
    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "true");

    await user.click(
      screen.getByRole("button", { name: "Remove from Worship" }),
    );

    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Saving will remove/)).toHaveTextContent("Worship");
  });

  it("warns that leaving a team leaves existing assignments in place", async () => {
    const user = userEvent.setup();
    const schedule: TeamSchedule = {
      scheduleId: "schedule-1",
      churchId: "church-1",
      teamId: "team-worship",
      name: "August",
      serviceIds: ["service-1"],
      assignments: {
        "occurrence-1": {
          "position-vocal::0": { primaryMemberId: "member-1" },
        },
      },
    };
    renderManager({ data: joinedData({ schedules: [schedule] }) });
    await openMember(user, /Rae Kim/);
    await toggleWorshipTeam(user);

    expect(screen.getByText(/still assigned/)).toHaveTextContent(
      "Those assignments stay as they are.",
    );
  });

  it("drops a team's positions and role when the team is unchecked", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);

    expect(vocalPositionCheckbox()).toHaveAttribute("aria-checked", "true");
    await toggleWorshipTeam(user);

    // A position the member is not on the team for would be unassignable, so
    // the draft cannot hold both.
    expect(vocalPositionCheckbox()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.queryByRole("combobox", { name: /Worship role/ }),
    ).not.toBeInTheDocument();
  });

  it("sends the remaining membership so the server can drop the roster", async () => {
    const user = userEvent.setup();
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, positionIds: [] },
      teams: [worshipTeam],
    });
    const { onTeamSaved } = renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);
    await toggleWorshipTeam(user);
    await user.click(screen.getByRole("button", { name: "Save member" }));

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalled());
    const [, , body] = mockUpdateTeamRosterMember.mock.calls[0];
    expect(body.teamIds).toEqual([]);
    // The emptied roster comes back so the Teams tab updates immediately.
    await waitFor(() => expect(onTeamSaved).toHaveBeenCalledWith(worshipTeam));
  });

  it("applies the rosters the server changed when saving", async () => {
    const user = userEvent.setup();
    const savedMember: TeamRosterMember = {
      memberId: "member-1",
      churchId: "church-1",
      firstName: "Sky",
      lastName: "Lane",
      positionIds: ["position-vocal"],
      blockoutDates: [],
    };
    const joinedTeam: TeamRecord = { ...worshipTeam, memberIds: ["member-1"] };
    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: savedMember,
      teams: [joinedTeam],
    });

    const { onTeamSaved } = renderManager();
    await openCreateForm(user);
    await fillName(user);
    await toggleVocalPosition(user);
    await user.click(screen.getByRole("button", { name: "Save member" }));

    // Without this the Teams tab and schedule roster stay stale until the next
    // poll, which is what pushed admins to re-add the member by hand.
    await waitFor(() => expect(onTeamSaved).toHaveBeenCalledWith(joinedTeam));
  });

  it("saves cleanly when no roster changed", async () => {
    const user = userEvent.setup();
    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: {
        memberId: "member-1",
        churchId: "church-1",
        firstName: "Sky",
        lastName: "Lane",
        positionIds: [],
        blockoutDates: [],
      },
    });

    const { onSaved, onTeamSaved } = renderManager();
    await openCreateForm(user);
    await fillName(user);
    await user.click(screen.getByRole("button", { name: "Save member" }));

    await waitFor(() => expect(mockCreateTeamRosterMember).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(onTeamSaved).not.toHaveBeenCalled();
  });
});

describe("MemberManager account linking", () => {
  const linkableMembers = (selfUserId?: string) =>
    buildData({
      members: [
        {
          memberId: "member-self",
          churchId: "church-1",
          firstName: "Me",
          lastName: "Myself",
          positionIds: [],
          blockoutDates: [],
          ...(selfUserId ? { userId: selfUserId } : {}),
        },
        {
          memberId: "member-other",
          churchId: "church-1",
          firstName: "Someone",
          lastName: "Else",
          positionIds: [],
          blockoutDates: [],
        },
      ],
    } as Partial<TeamsData>);

  const openMember = async (
    user: ReturnType<typeof userEvent.setup>,
    name: RegExp,
  ) => {
    await user.click(screen.getByRole("button", { name }));
  };

  it("offers 'This is me' on an unlinked member when the account has claimed nobody", async () => {
    const user = userEvent.setup();
    renderManager({ data: linkableMembers(), userId: "user-1" });

    await openMember(user, /Someone Else/);

    expect(
      screen.getByRole("button", { name: /This is me/i }),
    ).toBeInTheDocument();
  });

  it("hides 'This is me' once the account has claimed another member", async () => {
    const user = userEvent.setup();
    // An account may hold at most one member per church, so the server would
    // reject this — offering it would be an action guaranteed to fail.
    renderManager({ data: linkableMembers("user-1"), userId: "user-1" });

    await openMember(user, /Someone Else/);

    expect(
      screen.queryByRole("button", { name: /This is me/i }),
    ).not.toBeInTheDocument();
    // Linking someone else stays available — that is the admin's tool.
    expect(
      screen.getByRole("button", { name: /Link an account/i }),
    ).toBeInTheDocument();
  });

  it("shows the claimed member as linked to you, with an unlink action", async () => {
    const user = userEvent.setup();
    renderManager({ data: linkableMembers("user-1"), userId: "user-1" });

    await openMember(user, /Me Myself/);

    expect(screen.getByText("Linked to your account.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Unlink$/i }),
    ).toBeInTheDocument();
  });

  it("hides the editable email once linked, so there is only one address", async () => {
    const user = userEvent.setup();
    renderManager({ data: linkableMembers("someone-else-uid"), userId: "user-1" });

    await openMember(user, /Me Myself/);

    expect(screen.getByText("Linked to their account.")).toBeInTheDocument();
    // Two editable addresses would mean two inboxes to check; the account
    // email is the single source once linked.
    expect(screen.queryByLabelText(/^Email/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Comes from their account/i),
    ).toBeInTheDocument();
  });

  it("reflects the link in the open panel without reopening the member", async () => {
    const user = userEvent.setup();
    renderManager({ data: linkableMembers(), userId: "user-1" });

    await openMember(user, /Someone Else/);
    expect(screen.getByText("Not linked to an account.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /This is me/i }));

    // The panel renders from local `editing` state, so updating only the parent
    // list would leave it stale while the toast claimed success. Asserted on the
    // controls rather than the status text, which the toast also renders.
    expect(
      await screen.findByRole("button", { name: /^Unlink$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /This is me/i }),
    ).not.toBeInTheDocument();
  });
});

describe("MemberManager notification readiness", () => {
  const rosterWithAndWithoutEmail = () =>
    buildData({
      members: [
        {
          memberId: "member-reachable",
          churchId: "church-1",
          firstName: "Has",
          lastName: "Email",
          email: "has@example.com",
          positionIds: [],
          blockoutDates: [],
        },
        {
          memberId: "member-unreachable",
          churchId: "church-1",
          firstName: "No",
          lastName: "Email",
          positionIds: [],
          blockoutDates: [],
        },
      ],
    } as Partial<TeamsData>);

  it("flags members a notification could never reach", () => {
    renderManager({ data: rosterWithAndWithoutEmail(), userId: "user-1" });

    // Surfaced in the list so it is fixable where addresses are entered,
    // rather than only visible after opening each member.
    expect(screen.getByText("No email")).toBeInTheDocument();
  });

  it("shows the invite disabled, with the reason, when there is no address", async () => {
    const user = userEvent.setup();
    renderManager({ data: rosterWithAndWithoutEmail(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /No Email/ }));

    // Hidden would mean a roster that never collected emails shows this action
    // nowhere, so it looks like it does not exist. Disabled with the reason is
    // discoverable.
    expect(
      screen.getByRole("button", { name: /Invite them to create an account/i }),
    ).toBeDisabled();
    expect(
      screen.getByText("Add an email above and save to invite them."),
    ).toBeInTheDocument();
  });

  it("blocks the invite while an email edit is unsaved", async () => {
    const user = userEvent.setup();
    renderManager({ data: rosterWithAndWithoutEmail(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /Has Email/ }));
    await user.type(screen.getByLabelText(/^Email/i), "x");

    // The server reads the saved address, so inviting now would mail the old
    // one while the form showed the new.
    expect(
      screen.getByRole("button", { name: /Invite them to create an account/i }),
    ).toBeDisabled();
    expect(
      screen.getByText("Save your email change first."),
    ).toBeInTheDocument();
  });

  it("records that an invite went out so it is not sent twice", async () => {
    const user = userEvent.setup();
    renderManager({ data: rosterWithAndWithoutEmail(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /Has Email/ }));
    await user.click(
      screen.getByRole("button", { name: /Invite them to create an account/i }),
    );

    expect(mockInviteTeamRosterMember).toHaveBeenCalledWith("church-1", {
      email: "has@example.com",
      memberId: "member-reachable",
    });
    // Without persisting evidence an admin would keep re-sending.
    expect(
      await screen.findByText("Invite sent. Not linked until they accept."),
    ).toBeInTheDocument();
  });
});

describe("MemberManager email validation", () => {
  const oneMember = () =>
    buildData({
      members: [
        {
          memberId: "member-1",
          churchId: "church-1",
          firstName: "Val",
          lastName: "Idate",
          positionIds: [],
          blockoutDates: [],
        },
      ],
    } as Partial<TeamsData>);

  it("rejects a malformed address inline instead of on save", async () => {
    const user = userEvent.setup();
    renderManager({ data: oneMember(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /Val Idate/ }));
    await user.type(screen.getByLabelText(/^Email/i), "not-an-email");

    // The server rejects this too; catching it here avoids a failed round-trip.
    expect(
      screen.getByText("Enter a valid email address."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save member/i }),
    ).toBeDisabled();
  });

  it("accepts a valid address and re-enables saving", async () => {
    const user = userEvent.setup();
    renderManager({ data: oneMember(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /Val Idate/ }));
    await user.type(screen.getByLabelText(/^Email/i), "val@example.com");

    expect(
      screen.queryByText("Enter a valid email address."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save member/i }),
    ).not.toBeDisabled();
  });

  it("treats an empty address as valid, since most members have none", async () => {
    const user = userEvent.setup();
    renderManager({ data: oneMember(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /Val Idate/ }));

    expect(
      screen.queryByText("Enter a valid email address."),
    ).not.toBeInTheDocument();
  });
});

describe("MemberManager admin-only linking controls", () => {
  const oneMember = () =>
    buildData({
      members: [
        {
          memberId: "member-1",
          churchId: "church-1",
          firstName: "Needs",
          lastName: "Account",
          email: "needs@example.com",
          positionIds: [],
          blockoutDates: [],
        },
      ],
    } as Partial<TeamsData>);

  it("hides invite and the account picker from a non-admin editor", async () => {
    const user = userEvent.setup();
    // A Teams editor passes `canEdit`, but `createInvite` and
    // `listChurchMembers` both require an admin session — showing these would
    // mean a 403 on invite and a permanently empty picker.
    renderManager({ data: oneMember(), userId: "user-1", role: "member" });

    await user.click(screen.getByRole("button", { name: /Needs Account/ }));

    expect(
      screen.queryByRole("button", {
        name: /Invite them to create an account/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Link an account/i }),
    ).not.toBeInTheDocument();
  });

  it("still lets a non-admin editor claim their own record", async () => {
    const user = userEvent.setup();
    renderManager({ data: oneMember(), userId: "user-1", role: "member" });

    await user.click(screen.getByRole("button", { name: /Needs Account/ }));

    // Self-claim and unlink run on teams-edit endpoints, so they stay.
    expect(
      screen.getByRole("button", { name: /This is me/i }),
    ).toBeInTheDocument();
  });
});
