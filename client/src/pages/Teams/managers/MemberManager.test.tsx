import { type ContextType } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import MemberManager from "./MemberManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { CurrentMemberIdentityProvider } from "../components/CurrentUserMemberIndicator";
import type {
  TeamRecord,
  TeamRosterMember,
  TeamSchedule,
} from "../../../api/authTypes";
import type { TeamsData } from "../types";
import { buildGroupsReturnTo, TEAMS_RETURN_STORAGE_KEY, TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

const mockCreateTeamRosterMember = jest.fn();
const mockUpdateTeamRosterMember = jest.fn();
const mockGetTeamRosterMemberProfile = jest.fn();
const mockUpdateTeamRosterMemberProfile = jest.fn();

const mockInviteTeamRosterMember = jest.fn(async (..._args: any[]) => ({
  success: true,
}));
const mockRecordMemberSmsConsent = jest.fn(async (..._args: unknown[]) => ({ success: true, eligibility: { status: "enabled", eligible: true, phoneNumber: "+19545551234" } }));

jest.mock("../../../api/auth", () => ({
  AuthApiError: class MockAuthApiError extends Error {},
  archiveTeamRosterMember: jest.fn(),
  getTeamRosterMemberProfile: (...args: unknown[]) => mockGetTeamRosterMemberProfile(...args),
  manageVolunteerPersonalAccess: jest.fn().mockResolvedValue({ success: true, status: "none" }),
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
  updateTeamRosterMemberProfile: (...args: unknown[]) => mockUpdateTeamRosterMemberProfile(...args),
  recordMemberSmsConsent: (...args: unknown[]) =>
    mockRecordMemberSmsConsent(...args),
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

const mediaTeam: TeamRecord = {
  teamId: "team-media",
  churchId: "church-1",
  name: "Media",
  memberIds: [],
};

const producerPosition = {
  positionId: "position-producer",
  churchId: "church-1",
  teamId: "team-media",
  name: "Producer",
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
  intakeRecipients: [],
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
  selfMemberId = null,
  role = "admin",
  canEdit = true,
  canEditAllTeams = true,
  canManageMemberLifecycle = true,
  canEditMember,
  teamProfileReadyMemberIds,
  initialEntry,
  onIdentityChanged = jest.fn(),
  onSmsConsentRecorded = jest.fn(),
  onSmsEligibilityRefresh,
  onScopedProfileSaved = jest.fn(),
  isLoading = false,
  churchId = "church-1",
  useHashRouter = false,
}: {
  data?: TeamsData;
  onSaved?: jest.Mock;
  onTeamSaved?: jest.Mock;
  userId?: string;
  selfMemberId?: string | null;
  /** Invite and the account picker call admin-only endpoints. */
  role?: string;
  canEdit?: boolean;
  canEditAllTeams?: boolean;
  canManageMemberLifecycle?: boolean;
  canEditMember?: (member: TeamRosterMember) => boolean;
  teamProfileReadyMemberIds?: ReadonlySet<string>;
  initialEntry?: string | { pathname: string; search?: string; state?: unknown };
  onIdentityChanged?: jest.Mock;
  onSmsConsentRecorded?: jest.Mock;
  onSmsEligibilityRefresh?: (memberId: string, phoneNumber: string, previousPhoneNumber: string) => Promise<void>;
  onScopedProfileSaved?: jest.Mock;
  isLoading?: boolean;
  churchId?: string;
  useHashRouter?: boolean;
} = {}) => {
  const content = (currentData = data, readyMemberIds = teamProfileReadyMemberIds) => (
    <>
      <LocationProbe />
      <GlobalInfoContext.Provider
        value={
          { churchId, userId, role } as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <CurrentMemberIdentityProvider memberId={selfMemberId}>
            <TeamsNavigationGuardProvider>
              <MemberManager
              members={currentData.members}
              isLoading={isLoading}
              positions={currentData.positions}
              data={currentData}
              canEdit={canEdit}
              canEditAllTeams={canEditAllTeams}
              canManageMemberLifecycle={canManageMemberLifecycle}
              canEditMember={canEditMember}
              teamProfileReadyMemberIds={readyMemberIds}
              onSaved={onSaved}
              onIdentityChanged={onIdentityChanged}
              onTeamSaved={onTeamSaved}
              onArchived={jest.fn()}
              onRemoved={jest.fn()}
              onSmsConsentRecorded={onSmsConsentRecorded}
              onSmsEligibilityRefresh={onSmsEligibilityRefresh}
              onScopedProfileSaved={onScopedProfileSaved}
              />
            </TeamsNavigationGuardProvider>
          </CurrentMemberIdentityProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </>
  );
  const routedContent = (currentData = data, readyMemberIds = teamProfileReadyMemberIds) =>
    useHashRouter ? <HashRouter>{content(currentData, readyMemberIds)}</HashRouter> :
      <MemoryRouter initialEntries={initialEntry ? [initialEntry] : undefined}>{content(currentData, readyMemberIds)}</MemoryRouter>;
  const view = render(routedContent());
  const refreshManager = (currentData: TeamsData, readyMemberIds?: ReadonlySet<string>) =>
    view.rerender(routedContent(currentData, readyMemberIds));
  return { ...view, refreshManager, onSaved, onTeamSaved, onIdentityChanged, onSmsConsentRecorded, onScopedProfileSaved };
};

const openCreateForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole("button", { name: "Create member" })[0]);
};

const openMember = async (
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) => {
  await user.click(screen.getByRole("button", { name }));
};

// The filter aside stays mounted alongside the editor and has its own Teams and
// Positions groups, so form queries are scoped to the editor region.
const saveButton = () => screen.getAllByRole("button", { name: /^(Create|Save) member$/ }).at(-1)!;

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
const producerPositionCheckbox = () =>
  within(positionsField()).getByRole("checkbox", { name: /Producer/ });

const fillName = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/First name/), "Sky");
  await user.type(screen.getByLabelText(/Last name/), "Lane");
};

const LocationProbe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
    <button onClick={() => navigate(`${TEAMS_SECTION_PATHS.members}?editMember=member-2&teamId=team-worship`)}>Link to second member</button>
    <button onClick={() => navigate(`${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-media`)}>Link to media profile</button>
    <button onClick={() => navigate(`${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=unauthorized`)}>Link to unavailable team</button>
    <div data-testid="location" data-search={location.search}>
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </div>
    </>
  );
};

const memberReturnTo = {
  label: "Back to schedule",
  pathname: TEAMS_SECTION_PATHS.schedules,
  restore: { kind: "schedule" as const, scheduleId: "schedule-1" },
};

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  mockCreateTeamRosterMember.mockReset();
  mockUpdateTeamRosterMember.mockReset();
  mockGetTeamRosterMemberProfile.mockReset();
  mockUpdateTeamRosterMemberProfile.mockReset();
  mockGetTeamRosterMemberProfile.mockResolvedValue({
    member: { memberId: worshipMember.memberId, firstName: "Rae", lastName: "Kim" },
    teamProfile: {
      teamId: worshipTeam.teamId,
      positionIds: [],
      desiredPositionIds: [],
      membership: {},
      qualifications: [],
    },
  });
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
  it("guards a deep link that would replace an unsaved new member draft", async () => {
    const user = userEvent.setup();
    const second = { ...worshipMember, memberId: "member-2", firstName: "Avery" };
    renderManager({ data: joinedData({ members: [worshipMember, second] }) });
    await openCreateForm(user);
    await fillName(user);
    await user.click(screen.getByRole("button", { name: "Link to second member" }));
    await user.click(await screen.findByRole("button", { name: "Stay" }));
    expect(screen.getByRole("textbox", { name: /^First name/ })).toHaveValue("Sky");
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "");
    await user.click(screen.getByRole("button", { name: "Link to second member" }));
    await user.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("textbox", { name: /^First name/ })).toHaveValue("Avery");
    expect(mockCreateTeamRosterMember).not.toHaveBeenCalled();
  });

  it("loads a pending direct link when data arrives and rejects an old church's delayed profile", async () => {
    let finishOld: (value: unknown) => void = () => {};
    mockGetTeamRosterMemberProfile.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const tree = (churchId: string, loading: boolean, memberChurchId = churchId) => {
      const data = joinedData({
        members: loading ? [] : [{ ...worshipMember, churchId: memberChurchId }],
        teams: [{ ...worshipTeam, churchId, memberIds: ["member-1"] }],
      });
      return <MemoryRouter initialEntries={[`${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-worship`]}>
        <GlobalInfoContext.Provider value={{ churchId } as ContextType<typeof GlobalInfoContext>}>
          <ToastProvider><TeamsNavigationGuardProvider>
            <MemberManager members={data.members} positions={data.positions} data={data} isLoading={loading}
              canEdit canEditAllTeams={false} onSaved={jest.fn()} onTeamSaved={jest.fn()}
              onArchived={jest.fn()} onRemoved={jest.fn()} />
          </TeamsNavigationGuardProvider></ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>;
    };
    const view = render(tree("church-1", true));
    expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalled();
    view.rerender(tree("church-1", false));
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledWith("church-1", "team-worship", "member-1"));
    view.rerender(tree("church-2", false, "church-1"));
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(1);
    view.rerender(tree("church-2", false));
    await screen.findByRole("checkbox", { name: /Vocal\s+Worship/ });
    expect(mockGetTeamRosterMemberProfile).toHaveBeenLastCalledWith("church-2", "team-worship", "member-1");
    await act(async () => finishOld({ teamProfile: { teamId: "team-worship", positionIds: ["position-vocal"], desiredPositionIds: [], membership: {}, qualifications: [] } }));
    expect(screen.getByRole("checkbox", { name: /Vocal\s+Worship/ })).not.toBeChecked();
    view.rerender(tree("church-2", false));
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(2);
  });

  it("confirms HashRouter Back once and loads the selected profile on Back and Forward", async () => {
    const originalUrl = window.location.href;
    const originalState = window.history.state;
    window.history.replaceState({ idx: 0 }, "", `#${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-worship`);
    const user = userEvent.setup();
    const teams = [worshipTeam, mediaTeam].map((team) => ({ ...team, memberIds: ["member-1"] }));
    const view = renderManager({ useHashRouter: true, canEditAllTeams: false,
      data: joinedData({ teams, positions: [vocalPosition, producerPosition] }) });
    try {
      await screen.findByRole("checkbox", { name: /Vocal\s+Worship/ });
      await user.click(screen.getByRole("button", { name: "Link to media profile" }));
      await user.click(await screen.findByRole("checkbox", { name: /Producer\s+Media/ }));
      act(() => window.history.back());
      await screen.findByRole("dialog", { name: "Unsaved changes" });
      await user.click(screen.getByRole("button", { name: "Stay" }));
      expect(screen.getByRole("checkbox", { name: /Producer\s+Media/ })).toBeChecked();
      act(() => window.history.back());
      await user.click(await screen.findByRole("button", { name: "Discard changes" }));
      await screen.findByRole("checkbox", { name: /Vocal\s+Worship/ });
      expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
      expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(3);
      act(() => window.history.forward());
      await screen.findByRole("checkbox", { name: /Producer\s+Media/ });
      expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(4);
    } finally {
      view.unmount();
      window.history.replaceState(originalState, "", originalUrl);
    }
  });

  it("guards URL member changes and keeps the current URL and draft when staying", async () => {
    const user = userEvent.setup();
    const second = { ...worshipMember, memberId: "member-2", firstName: "Avery" };
    renderManager({ data: joinedData({ members: [worshipMember, second] }),
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-worship` });
    await user.type(await screen.findByRole("textbox", { name: /^First name/ }), " draft");
    await user.click(screen.getByRole("button", { name: "Link to second member" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?editMember=member-1&teamId=team-worship");
    expect(screen.getByRole("textbox", { name: /^First name/ })).toHaveValue("Rae draft");
    await user.click(screen.getByRole("button", { name: "Link to second member" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("textbox", { name: /^First name/ })).toHaveValue("Avery");
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?editMember=member-2&teamId=team-worship");
    expect(mockUpdateTeamRosterMember).not.toHaveBeenCalled();
  });

  it("guards team-only URL changes and never requests an unauthorized team profile", async () => {
    const user = userEvent.setup();
    const teams = [worshipTeam, mediaTeam].map((team) => ({ ...team, memberIds: [worshipMember.memberId] }));
    renderManager({ data: joinedData({ teams }), canEditAllTeams: false,
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-worship` });
    await user.click(await screen.findByRole("checkbox", { name: /Vocal\s+Worship/ }));
    await user.click(screen.getByRole("button", { name: "Link to media profile" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByRole("checkbox", { name: /Vocal\s+Worship/ })).toBeChecked();
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Link to media profile" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenLastCalledWith("church-1", "team-media", "member-1"));
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Link to unavailable team" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?editMember=member-1&teamId=team-media"));
    expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalledWith("church-1", "unauthorized", "member-1");
  });

  it("ignores delayed profile responses after URL team and member changes", async () => {
    const user = userEvent.setup();
    let finishOld: (value: unknown) => void = () => {};
    mockGetTeamRosterMemberProfile.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const second = { ...worshipMember, memberId: "member-2", firstName: "Avery" };
    const teams = [worshipTeam, mediaTeam].map((team) => ({ ...team, memberIds: ["member-1", "member-2"] }));
    renderManager({ data: joinedData({ teams, members: [worshipMember, second] }), canEditAllTeams: false,
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=member-1&teamId=team-worship` });
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Link to media profile" }));
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Link to second member" }));
    await screen.findByRole("checkbox", { name: /Vocal\s+Worship/ });
    await act(async () => finishOld({ teamProfile: { teamId: "team-worship", positionIds: ["position-vocal"], desiredPositionIds: [], membership: {}, qualifications: [] } }));
    expect(screen.getByRole("checkbox", { name: /Vocal\s+Worship/ })).not.toBeChecked();
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?editMember=member-2&teamId=team-worship");
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(3);
  });

  it("marks the linked roster entry and current member editor context", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData(), selfMemberId: "member-1" });

    const memberRow = screen.getByTestId("entity-row");
    expect(within(memberRow).getByText("You")).toBeInTheDocument();
    expect(
      within(memberRow).getByRole("button", { name: "Edit Rae Kim, You" }),
    ).toBeInTheDocument();
    await openMember(user, /Rae Kim/);
    expect(screen.getAllByText("You")).toHaveLength(2);
    expect(screen.getByRole("group", { name: /Member details/ })).toBeInTheDocument();
  });

  it("shows only the team-scoped profile and hides church-level member lifecycle actions", async () => {
    const user = userEvent.setup();
    renderManager({
      data: joinedData(),
      canEditAllTeams: false,
      canManageMemberLifecycle: false,
      canEditMember: () => true,
    });
    await openMember(user, /Rae Kim/);
    const editor = await screen.findByRole("region", { name: "Rae Kim" });
    expect(within(editor).getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(within(editor).queryByLabelText(/^First name/i)).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText(/Email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Member actions" })).not.toBeInTheDocument();
    expect(screen.queryByText("Archive member")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete member")).not.toBeInTheDocument();
  });

  it("opens the full member editor from the Manage route for global editors", async () => {
    renderManager({
      data: joinedData(),
      canEditAllTeams: true,
      role: "admin",
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=${worshipMember.memberId}&teamId=${worshipTeam.teamId}`,
    });

    expect(await screen.findByRole("region", { name: "Edit member" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/i)).toHaveValue("Rae");
    expect(screen.getByRole("group", { name: /Member details/ })).toBeInTheDocument();
    expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalled();
    expect(new URLSearchParams(screen.getByTestId("location").getAttribute("data-search") || "").get("editMember"))
      .toBe(worshipMember.memberId);
  });

  it("opens the scoped member profile in the Members panel and saves only through the team-profile API", async () => {
    const user = userEvent.setup();
    const scopedMember = {
      ...worshipMember,
      email: "private@example.test",
      phoneNumber: "+15555550123",
      notes: "private member notes",
    };
    mockGetTeamRosterMemberProfile.mockResolvedValue({
      member: { memberId: scopedMember.memberId, firstName: "Rae", lastName: "Kim" },
      teamProfile: {
        teamId: worshipTeam.teamId,
        positionIds: [],
        desiredPositionIds: [],
        membership: {},
        qualifications: [],
      },
    });
    mockUpdateTeamRosterMemberProfile.mockResolvedValue({
      success: true,
      member: { memberId: scopedMember.memberId, firstName: "Rae", lastName: "Kim" },
      teamProfile: {
        teamId: worshipTeam.teamId,
        positionIds: [vocalPosition.positionId],
        desiredPositionIds: [],
        membership: {},
        qualifications: [],
      },
    });
    const { onScopedProfileSaved } = renderManager({
      data: joinedData({ members: [scopedMember] }),
      canEditAllTeams: false,
      canEditMember: (candidate) => candidate.memberId === scopedMember.memberId,
      role: "member",
    });

    await openMember(user, /Edit Rae Kim/);
    const editor = screen.getByRole("region", { name: "Rae Kim" });
    expect(await within(editor).findByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledWith(
      "church-1",
      worshipTeam.teamId,
      scopedMember.memberId,
    );
    expect(within(editor).getByRole("checkbox", { name: /Vocal/ })).toBeInTheDocument();
    expect(within(editor).getByRole("combobox", { name: "Worship role:" })).toBeInTheDocument();
    expect(within(editor).queryByLabelText(/Email/i)).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText(/Phone/i)).not.toBeInTheDocument();
    expect(within(editor).queryByLabelText(/Birth date/i)).not.toBeInTheDocument();
    expect(within(editor).queryByText("private member notes")).not.toBeInTheDocument();
    expect(within(editor).queryByText("Member details")).not.toBeInTheDocument();
    expect(within(editor).queryByText("Teams")).not.toBeInTheDocument();
    expect(within(editor).queryByText("Blockout dates")).not.toBeInTheDocument();

    await user.click(within(editor).getByRole("checkbox", { name: /Vocal/ }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(mockUpdateTeamRosterMemberProfile).toHaveBeenCalledWith(
      "church-1",
      worshipTeam.teamId,
      scopedMember.memberId,
      expect.objectContaining({
        positionIds: [vocalPosition.positionId],
        desiredPositionIds: [],
        membership: { roleId: null },
      }),
    ));
    expect(mockUpdateTeamRosterMember).not.toHaveBeenCalled();
    expect(onScopedProfileSaved).toHaveBeenCalledWith(scopedMember.memberId);
  });

  it("preserves a saved scoped position after refresh and switching teams before a role save", async () => {
    const user = userEvent.setup();
    const member: TeamRosterMember = {
      ...worshipMember,
      positionIds: [producerPosition.positionId],
      desiredPositionIds: [],
      teamMemberships: {},
      qualifications: [],
    };
    const data = joinedData({
      members: [member],
      teams: [worshipTeam, mediaTeam].map((team) => ({ ...team, memberIds: [member.memberId] })),
      positions: [vocalPosition, producerPosition],
    });
    const savedProfile = {
      teamId: worshipTeam.teamId,
      positionIds: [vocalPosition.positionId],
      desiredPositionIds: [],
      membership: {},
      qualifications: [],
    };
    mockUpdateTeamRosterMemberProfile.mockResolvedValue({ success: true, teamProfile: savedProfile });
    const { refreshManager, onScopedProfileSaved } = renderManager({
      data,
      canEditAllTeams: false,
      canManageMemberLifecycle: false,
      canEditMember: () => true,
      role: "member",
      teamProfileReadyMemberIds: new Set([member.memberId]),
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=${member.memberId}&teamId=${worshipTeam.teamId}`,
    });
    const editor = await screen.findByRole("region", { name: "Rae Kim" });
    await user.click(within(editor).getByRole("checkbox", { name: /Vocal/ }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(onScopedProfileSaved).toHaveBeenCalledWith(member.memberId));

    // The page invalidates readiness, then reconciles the authorized bootstrap projection.
    refreshManager(data, new Set());
    refreshManager({
      ...data,
      members: [{ ...member, positionIds: [producerPosition.positionId, vocalPosition.positionId] }],
    }, new Set([member.memberId]));
    await user.click(within(editor).getByRole("combobox", { name: "Team profile:" }));
    await user.click(screen.getByRole("option", { name: "Media" }));
    expect(within(editor).getByRole("checkbox", { name: /Producer/ }))
      .toHaveAttribute("aria-checked", "true");
    await user.click(within(editor).getByRole("combobox", { name: "Team profile:" }));
    await user.click(screen.getByRole("option", { name: "Worship" }));
    expect(within(editor).getByRole("checkbox", { name: /Vocal/ }))
      .toHaveAttribute("aria-checked", "true");
    expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalled();

    await user.click(within(editor).getByRole("combobox", { name: "Worship role:" }));
    await user.click(screen.getByRole("option", { name: "Team lead" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(mockUpdateTeamRosterMemberProfile).toHaveBeenCalledTimes(2));
    expect(mockUpdateTeamRosterMemberProfile).toHaveBeenLastCalledWith(
      "church-1", worshipTeam.teamId, member.memberId,
      expect.objectContaining({
        positionIds: [vocalPosition.positionId],
        membership: { roleId: leadRole.roleId },
      }),
    );
    expect(mockUpdateTeamRosterMember).not.toHaveBeenCalled();
  });

  it("opens a complete scoped bootstrap profile immediately with the shared controls", async () => {
    const user = userEvent.setup();
    const qualificationArea = {
      areaId: "area-worship-skills",
      churchId: "church-1",
      teamId: worshipTeam.teamId,
      name: "Worship skills",
    };
    const qualificationLevel = {
      levelId: "level-worship-experienced",
      churchId: "church-1",
      areaId: qualificationArea.areaId,
      name: "Experienced",
      rank: 1,
    };
    const archivedArea = {
      areaId: "area-old-training",
      churchId: "church-1",
      teamId: worshipTeam.teamId,
      name: "Old training",
      archivedAt: "2026-01-01",
    };
    const archivedLevel = {
      levelId: "level-old-training",
      churchId: "church-1",
      areaId: archivedArea.areaId,
      name: "Legacy level",
      rank: 1,
      archivedAt: "2026-01-01",
    };
    const archivedRole = {
      ...leadRole,
      roleId: "role-former-lead",
      name: "Former lead",
      archivedAt: "2026-01-01",
    };
    const completeMember: TeamRosterMember = {
      ...worshipMember,
      desiredPositionIds: [vocalPosition.positionId],
      teamMemberships: {
        [worshipTeam.teamId]: {
          teamId: worshipTeam.teamId,
          roleId: archivedRole.roleId,
        },
      },
      qualifications: [
        {
          qualificationId: "qualification-worship",
          areaId: qualificationArea.areaId,
          levelId: qualificationLevel.levelId,
          teamId: worshipTeam.teamId,
          status: "completed",
          completedAt: "2025-01-03",
          expiresAt: "2027-01-03",
          notes: "Keep through annual review",
        },
        {
          qualificationId: "qualification-old-training",
          areaId: archivedArea.areaId,
          levelId: archivedLevel.levelId,
          teamId: worshipTeam.teamId,
          status: "expired",
        },
      ],
    };

    renderManager({
      data: joinedData({
        members: [completeMember],
        teamRoles: [leadRole, archivedRole],
        qualificationAreas: [qualificationArea, archivedArea],
        qualificationLevels: [qualificationLevel, archivedLevel],
      }),
      canEditAllTeams: false,
      canEditMember: () => true,
      role: "member",
      teamProfileReadyMemberIds: new Set([completeMember.memberId]),
    });

    await openMember(user, /Edit Rae Kim/);
    const editor = screen.getByRole("region", { name: "Rae Kim" });
    expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalled();
    expect(within(editor).getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(within(within(editor).getByRole("group", { name: "Positions" }))
      .getByRole("checkbox", { name: /Vocal/ })).toHaveAttribute("aria-checked", "true");

    await user.click(within(editor).getByRole("button", { name: "Desired positions" }));
    expect(within(within(editor).getByRole("group", { name: "Desired positions" }))
      .getByRole("checkbox", { name: /Vocal/ })).toHaveAttribute("aria-checked", "true");
    expect(within(editor).getByRole("combobox", { name: "Worship role:" }))
      .toHaveTextContent("Former lead (archived)");
    expect(within(editor).getAllByRole("combobox", { name: "Area:" })[0])
      .toHaveTextContent("Worship skills");
    expect(within(editor).getAllByRole("combobox", { name: "Level:" })[0])
      .toHaveTextContent("Experienced");
    expect(within(editor).getAllByRole("combobox", { name: "Status:" })[0])
      .toHaveTextContent("Completed");
    expect(within(editor).getAllByRole("combobox", { name: "Area:" })[1])
      .toHaveTextContent("Old training (Worship) (archived)");
    expect(within(editor).getAllByRole("combobox", { name: "Level:" })[1])
      .toHaveTextContent("Legacy level (archived)");
    expect(within(editor).getAllByLabelText("Completed")[0]).not.toHaveValue("");
    expect(within(editor).getAllByLabelText("Expires")[0]).not.toHaveValue("");
    expect(within(editor).getAllByLabelText("Notes:")[0]).toHaveValue("Keep through annual review");
  });

  it("loads populated restricted profile data when bootstrap fields are incomplete", async () => {
    const user = userEvent.setup();
    const qualificationArea = {
      areaId: "area-worship-skills",
      churchId: "church-1",
      teamId: worshipTeam.teamId,
      name: "Worship skills",
    };
    mockGetTeamRosterMemberProfile.mockResolvedValue({
      member: { memberId: worshipMember.memberId, firstName: "Rae", lastName: "Kim" },
      teamProfile: {
        teamId: worshipTeam.teamId,
        positionIds: [vocalPosition.positionId],
        desiredPositionIds: [vocalPosition.positionId],
        membership: { roleId: leadRole.roleId, isTeamLead: false },
        qualifications: [{
          qualificationId: "qualification-worship",
          areaId: qualificationArea.areaId,
          teamId: worshipTeam.teamId,
          status: "completed",
          completedAt: "2025-01-03",
          notes: "Loaded from the restricted profile",
        }],
      },
    });

    renderManager({
      data: joinedData({ qualificationAreas: [qualificationArea] }),
      canEditAllTeams: false,
      canEditMember: () => true,
      role: "member",
      // A stale or incomplete projection must still take the authoritative path.
      teamProfileReadyMemberIds: new Set([worshipMember.memberId]),
    });

    await openMember(user, /Edit Rae Kim/);
    const editor = await screen.findByRole("region", { name: "Rae Kim" });
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledWith(
      "church-1",
      worshipTeam.teamId,
      worshipMember.memberId,
    ));
    expect(within(within(editor).getByRole("group", { name: "Positions" }))
      .getByRole("checkbox", { name: /Vocal/ })).toHaveAttribute("aria-checked", "true");
    expect(within(editor).getByRole("combobox", { name: "Worship role:" }))
      .toHaveTextContent("Team lead");
    expect(within(editor).getByLabelText("Notes:")).toHaveValue("Loaded from the restricted profile");
  });

  it("keeps the team from the Manage URL selected and guards switching a dirty team profile", async () => {
    const user = userEvent.setup();
    const scopedMember = { ...worshipMember, email: "private@example.test" };
    const mediaWithMember = { ...mediaTeam, memberIds: [scopedMember.memberId] };
    mockGetTeamRosterMemberProfile.mockResolvedValue({
      member: { memberId: scopedMember.memberId, firstName: "Rae", lastName: "Kim" },
      teamProfile: {
        teamId: worshipTeam.teamId,
        positionIds: [],
        desiredPositionIds: [],
        membership: {},
        qualifications: [],
      },
    });
    renderManager({
      data: joinedData({
        members: [scopedMember],
        teams: [
          { ...worshipTeam, memberIds: [scopedMember.memberId] },
          mediaWithMember,
        ],
      }),
      canEditAllTeams: false,
      canEditMember: () => true,
      role: "member",
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=${scopedMember.memberId}&teamId=${worshipTeam.teamId}`,
    });

    const editor = await screen.findByRole("region", { name: "Rae Kim" });
    expect(await within(editor).findByRole("heading", { name: "Worship" })).toBeInTheDocument();
    expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledWith(
      "church-1",
      worshipTeam.teamId,
      scopedMember.memberId,
    );
    await user.click(within(editor).getByRole("checkbox", { name: /Vocal/ }));
    await user.click(within(editor).getByRole("combobox", { name: "Team profile:" }));
    await user.click(screen.getByRole("option", { name: "Media" }));

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(within(editor).getByRole("heading", { name: "Worship" })).toBeInTheDocument();
    await user.click(within(editor).getByRole("combobox", { name: "Team profile:" }));
    await user.click(screen.getByRole("option", { name: "Media" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(await screen.findByRole("heading", { name: "Media" })).toBeInTheDocument();
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenLastCalledWith(
      "church-1",
      mediaWithMember.teamId,
      scopedMember.memberId,
    ));
    expect(new URLSearchParams(screen.getByTestId("location").getAttribute("data-search") || "").get("teamId"))
      .toBe(mediaWithMember.teamId);
  });

  it("guards switching to another member while a scoped team profile is dirty", async () => {
    const user = userEvent.setup();
    const secondMember: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-2",
      firstName: "Casey",
      lastName: "Jones",
    };
    const teamWithBothMembers = {
      ...worshipTeam,
      memberIds: [worshipMember.memberId, secondMember.memberId],
    };
    mockGetTeamRosterMemberProfile.mockImplementation(async (_churchId, teamId, memberId) => ({
      member: {
        memberId,
        firstName: memberId === secondMember.memberId ? "Casey" : "Rae",
        lastName: memberId === secondMember.memberId ? "Jones" : "Kim",
      },
      teamProfile: {
        teamId,
        positionIds: [],
        desiredPositionIds: [],
        membership: {},
        qualifications: [],
      },
    }));
    renderManager({
      data: joinedData({
        members: [worshipMember, secondMember],
        teams: [teamWithBothMembers],
      }),
      canEditAllTeams: false,
      canEditMember: () => true,
      role: "member",
      initialEntry: `${TEAMS_SECTION_PATHS.members}?editMember=${worshipMember.memberId}&teamId=${worshipTeam.teamId}`,
    });

    const RaeEditor = await screen.findByRole("region", { name: "Rae Kim" });
    await user.click(await within(RaeEditor).findByRole("checkbox", { name: /Vocal/ }));
    await user.click(screen.getByRole("button", { name: /Edit Casey Jones/ }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(within(RaeEditor).getByRole("heading", { name: "Worship" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit Casey Jones/ }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(await screen.findByRole("region", { name: "Casey Jones" })).toBeInTheDocument();
    await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenLastCalledWith(
      "church-1",
      worshipTeam.teamId,
      secondMember.memberId,
    ));
  });

  it("preselects the source Team and requires roster ownership for scoped creation", async () => {
    const user = userEvent.setup();
    mockCreateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, memberId: "member-created", firstName: "Sky", lastName: "Lane" },
    });
    renderManager({
      data: buildData(),
      canEditAllTeams: false,
      initialEntry: {
        pathname: TEAMS_SECTION_PATHS.members,
        state: { teamsCreateMember: { teamId: worshipTeam.teamId } },
      },
    });
    expect(await screen.findByRole("heading", { name: "Create member" })).toBeInTheDocument();
    expect(worshipTeamCheckbox()).toBeChecked();
    expect(within(teamsField()).queryByRole("checkbox", { name: /Media/ })).not.toBeInTheDocument();
    await fillName(user);
    await user.click(within(teamsField()).getByRole("button", { name: "Clear all" }));
    expect(saveButton()).toBeDisabled();
    await user.click(worshipTeamCheckbox());
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(mockCreateTeamRosterMember).toHaveBeenCalledWith("church-1", expect.objectContaining({ teamIds: [worshipTeam.teamId] })));
  });

  it("shows create, pending, and saved states after a successful member save", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: { success: true; member: TeamRosterMember }) => void = () => undefined;
    mockCreateTeamRosterMember.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    renderManager();
    await openCreateForm(user);
    await fillName(user);
    expect(saveButton()).toHaveAccessibleName("Create member");

    await user.click(saveButton());
    expect(screen.getByRole("button", { name: "Creating…" })).toBeInTheDocument();
    resolveCreate({
      success: true,
      member: { ...worshipMember, memberId: "member-created", firstName: "Sky", lastName: "Lane" },
    });
    expect(await screen.findByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Edit member" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^First name/i), "lar");
    expect(saveButton()).toHaveAccessibleName("Save member");
  });

  it("returns to an actionable create button and keeps error feedback when the API rejects", async () => {
    const user = userEvent.setup();
    let rejectCreate: (error: Error) => void = () => undefined;
    mockCreateTeamRosterMember.mockImplementation(
      () => new Promise((_, reject) => { rejectCreate = reject; }),
    );
    renderManager();
    await openCreateForm(user);
    await fillName(user);

    await user.click(saveButton());
    expect(screen.getByRole("button", { name: "Creating…" })).toBeInTheDocument();
    await act(async () => rejectCreate(new Error("Network unavailable")));
    await waitFor(() => expect(saveButton()).toHaveAccessibleName("Create member"));
    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/i)).toHaveValue("Sky");
  });

  it("does not apply Member A's delayed save to Member B after navigation", async () => {
    const user = userEvent.setup();
    const secondMember: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-2",
      firstName: "Jo",
      lastName: "Smith",
    };
    let resolveUpdate: (value: { success: true; member: TeamRosterMember }) => void = () => undefined;
    mockUpdateTeamRosterMember.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    renderManager({
      data: joinedData({ members: [worshipMember, secondMember] }),
    });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^First name/));
    await user.type(screen.getByLabelText(/^First name/), "Rae saved");
    await user.click(saveButton());
    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));

    await openMember(user, /Jo Smith/);
    expect(screen.getByLabelText(/^First name/)).toHaveValue("Jo");

    await act(async () => resolveUpdate({
      success: true,
      member: { ...worshipMember, firstName: "Rae saved" },
    }));
    expect(screen.getByLabelText(/^First name/)).toHaveValue("Jo");
  });

  it("preserves newer edits made to the same member while a save is pending", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (value: { success: true; member: TeamRosterMember }) => void = () => undefined;
    mockUpdateTeamRosterMember.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^First name/));
    await user.type(screen.getByLabelText(/^First name/), "Rae submitted");
    await user.click(saveButton());
    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));

    await user.clear(screen.getByLabelText(/^Last name/));
    await user.type(screen.getByLabelText(/^Last name/), "Newer");
    await act(async () => resolveUpdate({
      success: true,
      member: { ...worshipMember, firstName: "Rae submitted", lastName: "Kim" },
    }));

    expect(screen.getByLabelText(/^First name/)).toHaveValue("Rae submitted");
    expect(screen.getByLabelText(/^Last name/)).toHaveValue("Newer");
  });

  it("keeps a member's edits recoverable when an update fails", async () => {
    const user = userEvent.setup();
    let rejectUpdate: (error: Error) => void = () => undefined;
    mockUpdateTeamRosterMember.mockImplementation(
      () => new Promise((_, reject) => { rejectUpdate = reject; }),
    );
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^Last name/));
    await user.type(screen.getByLabelText(/^Last name/), "Submitted");
    await user.click(saveButton());

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));
    await act(async () => rejectUpdate(new Error("Save failed")));

    expect(screen.getByLabelText(/^Last name/)).toHaveValue("Submitted");
    await user.click(form().getByRole("button", { name: /^(Close|Cancel)$/ }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByText("Save failed")).toBeInTheDocument();
  });

  it("does not adopt a completed create into a newly opened create form", async () => {
    const user = userEvent.setup();
    let resolveCreate: (value: { success: true; member: TeamRosterMember }) => void = () => undefined;
    mockCreateTeamRosterMember.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    renderManager();
    await openCreateForm(user);
    await fillName(user);
    await user.click(saveButton());
    await waitFor(() => expect(mockCreateTeamRosterMember).toHaveBeenCalledTimes(1));

    await openCreateForm(user);
    expect(screen.getByRole("heading", { name: "Create member" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/)).toHaveValue("");

    await act(async () => resolveCreate({
      success: true,
      member: { ...worshipMember, memberId: "member-created", firstName: "Sky", lastName: "Lane" },
    }));
    expect(screen.getByRole("heading", { name: "Create member" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^First name/)).toHaveValue("");
  });

  it("formats a U.S. phone number while it is entered", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);

    const phone = await screen.findByLabelText(/Mobile/);
    await user.type(phone, "9545551234");

    expect(phone).toHaveValue("(954) 555-1234");
    expect(screen.queryByText(/E\.164/)).not.toBeInTheDocument();
  });

  it("keeps create and filter actions usable while a member is open", async () => {
    const user = userEvent.setup();
    renderManager({ data: joinedData() });

    await openMember(user, /Rae Kim/);
    expect(screen.queryByRole("checkbox", { name: /^Team lead$/i })).not.toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: "Create member" });
    const filterButton = screen.getByRole("button", { name: "Filter members" });
    expect(createButton).toBeEnabled();
    expect(filterButton).toBeEnabled();

    await user.click(filterButton);
    // Coverage runs stretch past the default 5s when both panels animate open.
    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Filter members" }),
      ).not.toHaveAttribute("inert");
    });
    expect(
      screen.getByRole("region", { name: "Edit member" }),
    ).not.toHaveAttribute("inert");
    const filterPanel = screen.getByRole("region", { name: "Filter members" });
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(within(filterPanel).getByRole("button", { name: "Clear all" })).toBeDisabled();

    await user.click(
      within(filterPanel).getByRole("checkbox", { name: "Worship" }),
    );
    expect(
      screen.getByRole("button", { name: "Filter members, 1 selected" }),
    ).toBeInTheDocument();
    expect(within(filterPanel).getByRole("button", { name: "Clear all" })).toBeEnabled();

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
  }, 15_000);

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
    await user.click(saveButton());

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

describe("MemberManager return navigation", () => {
  it("closes locally, preserves the list and origin, and returns explicitly after opening another member", async () => {
    const user = userEvent.setup();
    const returnTo = { ...buildGroupsReturnTo(worshipTeam.teamId), label: "Back to Worship" };
    const second = { ...worshipMember, memberId: "member-2", firstName: "Rae", lastName: "Lee" };
    renderManager({ data: joinedData({ members: [worshipMember, second],
      teams: [{ ...worshipTeam, memberIds: [worshipMember.memberId, second.memberId] }],
    }), initialEntry: {
      pathname: TEAMS_SECTION_PATHS.members,
      search: "?editMember=member-1&teamId=team-worship&view=active",
      state: { teamsReturnTo: returnTo },
    } });
    await user.type(screen.getByPlaceholderText(/Search members/), "Rae");
    await user.click(screen.getByRole("button", { name: "Filter members" }));
    await user.click(within(screen.getByRole("region", { name: "Filter members" })).getByRole("checkbox", { name: "Worship" }));
    await user.click(screen.getByRole("button", { name: "Close filters" }));
    // The scrollport has no interactive role; inspect its retained DOM identity.
    // eslint-disable-next-line testing-library/no-node-access
    const list = screen.getByTestId("teams-create-panel-list").querySelector(".overflow-y-auto")!;
    list.scrollTop = 140;
    await user.click(form().getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Edit member" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveAttribute("data-search", "?view=active");
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.members);
    expect(screen.getByPlaceholderText(/Search members/)).toHaveValue("Rae");
    expect(screen.getByRole("button", { name: "Filter members, 1 selected" })).toBeInTheDocument();
    expect(list.scrollTop).toBe(140);
    expect(screen.getAllByRole("button", { name: "Back to Worship" })).toHaveLength(1);
    await openMember(user, /Rae Lee/);
    expect(screen.getByLabelText(/^Last name/)).toHaveValue("Lee");
    expect(screen.getAllByRole("button", { name: "Back to Worship" })).toHaveLength(1);
    await user.type(screen.getByLabelText(/^Last name/), " unsaved");
    await user.click(screen.getByRole("button", { name: "Back to Worship" }));
    await user.click(screen.getByRole("button", { name: "Stay" }));
    await user.click(form().getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText(/^Last name/)).toHaveValue("Lee unsaved");
    await user.click(form().getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.members);
    await user.click(screen.getByRole("button", { name: "Back to Worship" }));
    expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
      pathname: TEAMS_SECTION_PATHS.groups, state: { teamsRestore: returnTo.restore },
    }));
    expect(sessionStorage.getItem(TEAMS_RETURN_STORAGE_KEY)).toBeNull();
  });

  it.each([false, true])("remounts the closed list without returning automatically (reload=%s)", async (reload) => {
    const user = userEvent.setup();
    const returnTo = buildGroupsReturnTo(worshipTeam.teamId);
    const view = renderManager({ data: joinedData(), initialEntry: {
      pathname: TEAMS_SECTION_PATHS.members,
      search: "?editMember=member-1&teamId=team-worship",
      state: { teamsReturnTo: returnTo },
    } });
    await user.click(form().getByRole("button", { name: "Close" }));
    view.unmount();
    const performanceSpy = jest.spyOn(window, "performance", "get").mockReturnValue({
      getEntriesByType: () => [{ type: reload ? "reload" : "navigate" }],
    } as unknown as Performance);
    try {
      renderManager({ data: joinedData(), initialEntry: {
        pathname: TEAMS_SECTION_PATHS.members,
        state: reload ? undefined : { teamsReturnTo: returnTo },
      } });
      expect(screen.queryByRole("region", { name: "Edit member" })).not.toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.members);
      expect(screen.getAllByRole("button", { name: "Back to teams" })).toHaveLength(1);
      await openMember(user, /Rae Kim/);
      expect(screen.getByLabelText(/^First name/)).toHaveValue("Rae");
    } finally {
      performanceSpy.mockRestore();
    }
  });

  it("keeps a cross-section edit open and only returns when contextual Back is selected", async () => {
    const user = userEvent.setup();
    let finishSave!: (value: { success: true; member: TeamRosterMember; teams: TeamRecord[] }) => void;
    mockUpdateTeamRosterMember.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    render(
      <MemoryRouter initialEntries={[{
        pathname: TEAMS_SECTION_PATHS.members,
        state: { teamsReturnTo: memberReturnTo },
      }]}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1", userId: "", role: "member" } as never}>
          <ToastProvider><TeamsNavigationGuardProvider>
            <MemberManager
              members={[worshipMember]} positions={[vocalPosition]}
              data={joinedData()} canEdit onSaved={jest.fn()} onTeamSaved={jest.fn()}
              onArchived={jest.fn()} onRemoved={jest.fn()}
            />
            <LocationProbe />
          </TeamsNavigationGuardProvider></ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Rae Kim/ }));
    await user.clear(screen.getByLabelText(/^First name:?$/));
    await user.type(screen.getByLabelText(/^First name:?$/), "Rachel");
    await user.click(saveButton());

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Back to schedule" })).toBeDisabled();
    expect(form().getByRole("button", { name: "Close" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Back to schedule" }));
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.members);
    await act(async () => finishSave({
      success: true, member: { ...worshipMember, firstName: "Rachel", lastName: "Kim" }, teams: [],
    }));
    expect(screen.getByRole("region", { name: "Edit member" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.members);
    await user.click(screen.getByRole("button", { name: "Back to schedule" }));

    expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
      pathname: TEAMS_SECTION_PATHS.schedules,
      state: { teamsRestore: memberReturnTo.restore },
    }));
  });
});

describe("MemberManager team membership", () => {
  it("keeps position search and shows desired positions without team filter chips", async () => {
    const user = userEvent.setup();
    const positions = [
      vocalPosition,
      producerPosition,
      ...Array.from({ length: 4 }, (_, index) => ({
        ...producerPosition,
        positionId: `position-camera-${index}`,
        name: `Camera ${index}`,
      })),
    ];
    renderManager({
      data: buildData({
        positions,
        teams: [worshipTeam, mediaTeam],
      }),
    });
    await openCreateForm(user);

    const search = within(positionsField()).getByRole("textbox", { name: /^Search Positions/ });
    await user.type(search, "Producer");
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(1);
    expect(producerPositionCheckbox()).toBeInTheDocument();
    await user.clear(search);
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(6);

    await user.click(form().getByRole("button", { name: "Desired positions" }));
    const desired = within(form().getByRole("group", { name: "Desired positions" }));
    expect(desired.getAllByRole("checkbox")).toHaveLength(6);
    expect(desired.queryByRole("group", { name: "Filter desired positions by team" })).not.toBeInTheDocument();
    expect(desired.queryByRole("button", { name: "All teams" })).not.toBeInTheDocument();
    await user.type(desired.getByRole("textbox", { name: /^Search Desired positions/ }), "Producer");
    expect(desired.getAllByRole("checkbox")).toHaveLength(1);
    expect(desired.getByRole("checkbox", { name: /Producer/ })).toBeInTheDocument();
  });

  it("shows only selected-team positions without team filter chips for an existing member", async () => {
    const user = userEvent.setup();
    renderManager({
      data: joinedData({
        positions: [vocalPosition, producerPosition],
        teams: [{ ...worshipTeam, memberIds: ["member-1"] }, mediaTeam],
      }),
    });
    await openMember(user, /Rae Kim/);

    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(1);
    expect(vocalPositionCheckbox()).toBeChecked();
    expect(within(positionsField()).queryByRole("checkbox", { name: /Producer/ })).not.toBeInTheDocument();
    expect(within(positionsField()).queryByRole("group", { name: "Filter positions by team" })).not.toBeInTheDocument();
    expect(within(positionsField()).queryByRole("button", { name: "All teams" })).not.toBeInTheDocument();
  });

  it("preserves the union of roster and team-membership teams without position filters", async () => {
    const user = userEvent.setup();
    renderManager({
      data: joinedData({
        positions: [vocalPosition, producerPosition],
        teams: [{ ...worshipTeam, memberIds: ["member-1"] }, mediaTeam],
        members: [
          {
            ...worshipMember,
            teamMemberships: { "team-media": { teamId: "team-media" } },
          },
        ],
      }),
    });
    await openMember(user, /Rae Kim/);

    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(2);
    expect(vocalPositionCheckbox()).toBeChecked();
    expect(producerPositionCheckbox()).toBeInTheDocument();
    expect(worshipTeamCheckbox()).toBeChecked();
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toBeChecked();
  });

  it("keeps positions scoped to selected teams as a new member's teams change", async () => {
    const user = userEvent.setup();
    renderManager({
      data: buildData({
        positions: [vocalPosition, producerPosition],
        teams: [worshipTeam, mediaTeam],
      }),
    });
    await openCreateForm(user);

    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(2);
    await toggleWorshipTeam(user);
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(1);
    await user.click(within(teamsField()).getByRole("checkbox", { name: /Media/ }));
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(2);
    await user.click(producerPositionCheckbox());
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(within(teamsField()).getByRole("checkbox", { name: /Media/ }));
    expect(within(positionsField()).queryByRole("checkbox", { name: /Producer/ })).not.toBeInTheDocument();
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows all positions again when no team is selected and adds a chosen position's team", async () => {
    const user = userEvent.setup();
    renderManager({
      data: buildData({
        positions: [vocalPosition, producerPosition],
        teams: [worshipTeam, mediaTeam],
      }),
    });
    await openCreateForm(user);
    await toggleWorshipTeam(user);
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(1);
    await toggleWorshipTeam(user);

    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(2);
    await user.click(producerPositionCheckbox());
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(positionsField()).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("checks a position's team, so eligibility and membership cannot disagree", async () => {
    const user = userEvent.setup();
    renderManager();
    await openCreateForm(user);

    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "false");
    await toggleVocalPosition(user);
    expect(worshipTeamCheckbox()).toHaveAttribute("aria-checked", "true");
  });

  it("shows another team's positions only after that team is selected", async () => {
    const user = userEvent.setup();
    const praiseTeam: TeamRecord = {
      teamId: "team-praise",
      churchId: "church-1",
      name: "Praise Team",
      memberIds: [],
    };
    const praisePosition = {
      positionId: "position-praise",
      churchId: "church-1",
      teamId: "team-praise",
      name: "Singer",
    };
    renderManager({
      data: joinedData({
        positions: [vocalPosition, producerPosition, praisePosition],
        teams: [
          { ...worshipTeam, memberIds: ["member-1"] },
          { ...mediaTeam, memberIds: ["member-1"] },
          praiseTeam,
        ],
        members: [{
          ...worshipMember,
          teamMemberships: { "team-media": { teamId: "team-media" } },
        }],
      }),
    });
    await openMember(user, /Rae Kim/);

    expect(within(positionsField()).queryByRole("checkbox", { name: /Singer/ })).not.toBeInTheDocument();
    expect(within(teamsField()).getByRole("checkbox", { name: /Praise Team/ })).toHaveAttribute(
      "aria-checked", "false",
    );

    await user.click(within(teamsField()).getByRole("checkbox", { name: /Praise Team/ }));
    expect(within(positionsField()).getByRole("checkbox", { name: /Singer/ })).not.toBeChecked();
    await user.click(within(positionsField()).getByRole("checkbox", { name: /Singer/ }));
    expect(within(teamsField()).getByRole("checkbox", { name: /Praise Team/ })).toHaveAttribute(
      "aria-checked", "true",
    );
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
    await user.click(saveButton());

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

  it("submits the member revision so stale roster edits cannot overwrite newer time off", async () => {
    const user = userEvent.setup();
    const member = { ...worshipMember, updatedAt: "member-revision-a" };
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...member, firstName: "Rachel" },
    });
    renderManager({
      data: joinedData({ members: [member] }),
    });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^First name/));
    await user.type(screen.getByLabelText(/^First name/), "Rachel");
    await user.click(saveButton());

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));
    const [, , body] = mockUpdateTeamRosterMember.mock.calls[0];
    expect(body.expectedUpdatedAt).toBe("member-revision-a");
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
    await user.click(saveButton());

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalled());
    const [, , body] = mockUpdateTeamRosterMember.mock.calls[0];
    expect(body.teamIds).toEqual([]);
    expect(body.baseTeamIds).toEqual(["team-worship"]);
    // The emptied roster comes back so the Teams tab updates immediately.
    await waitFor(() => expect(onTeamSaved).toHaveBeenCalledWith(worshipTeam));
  });

  it("omits unchanged membership on a profile-only save and rebases from the server", async () => {
    const user = userEvent.setup();
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, firstName: "Rachel" },
      membershipTeamIds: ["team-media", "team-worship"],
    });
    renderManager({
      data: joinedData({
        teams: [{ ...worshipTeam, memberIds: ["member-1"] }, mediaTeam],
      }),
    });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^First name/));
    await user.type(screen.getByLabelText(/^First name/), "Rachel");
    await user.click(saveButton());

    await waitFor(() => expect(mockUpdateTeamRosterMember).toHaveBeenCalledTimes(1));
    const [, , body] = mockUpdateTeamRosterMember.mock.calls[0];
    expect(body).not.toHaveProperty("teamIds");
    expect(body).not.toHaveProperty("baseTeamIds");
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toBeChecked();
  });

  it("keeps a removed team unchecked and clean after the server confirms its roster", async () => {
    const user = userEvent.setup();
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, positionIds: [] },
      teams: [{ ...worshipTeam, memberIds: [] }],
    });
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);
    await user.click(worshipTeamCheckbox());
    await user.click(saveButton());

    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(worshipTeamCheckbox()).not.toBeChecked();
    await user.click(form().getByRole("button", { name: /^(Close|Cancel)$/ }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("keeps a newly added team selected after the server confirms its roster", async () => {
    const user = userEvent.setup();
    const memberWithoutPositions = { ...worshipMember, positionIds: [] };
    const joinedMedia = { ...mediaTeam, memberIds: [memberWithoutPositions.memberId] };
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: memberWithoutPositions,
      teams: [joinedMedia],
    });
    renderManager({
      data: joinedData({
        members: [memberWithoutPositions],
        positions: [vocalPosition, producerPosition],
        teams: [{ ...worshipTeam, memberIds: [memberWithoutPositions.memberId] }, mediaTeam],
      }),
    });
    await openMember(user, /Rae Kim/);
    await user.click(within(teamsField()).getByRole("checkbox", { name: /Media/ }));
    await user.click(saveButton());

    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(within(teamsField()).getByRole("checkbox", { name: /Media/ })).toBeChecked();
    await user.click(form().getByRole("button", { name: /^(Close|Cancel)$/ }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("uses the existing roster baseline when a successful save omits unchanged teams", async () => {
    const user = userEvent.setup();
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...worshipMember, firstName: "Rachel" },
    });
    renderManager({ data: joinedData() });
    await openMember(user, /Rae Kim/);
    await user.clear(screen.getByLabelText(/^First name/));
    await user.type(screen.getByLabelText(/^First name/), "Rachel");
    await user.click(saveButton());

    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(worshipTeamCheckbox()).toBeChecked();
    await user.click(form().getByRole("button", { name: /^(Close|Cancel)$/ }));
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
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
    await user.click(saveButton());

    // Without this the Teams tab and schedule roster stay stale until the next
    // stale-focus bootstrap, which is what pushed admins to re-add the member by hand.
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
    await user.click(saveButton());

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

  it("does not expose profile image or account-link controls to a scoped manager", async () => {
    const user = userEvent.setup();
    renderManager({
      data: linkableMembers(),
      userId: "user-1",
      role: "member",
      canEditAllTeams: false,
    });

    await openMember(user, /Someone Else/);

    expect(screen.queryByRole("button", { name: /This is me/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Unlink/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Choose image|Replace image/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/i })).not.toBeInTheDocument();
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
    const { onIdentityChanged } = renderManager({ data: linkableMembers(), userId: "user-1" });

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
    expect(onIdentityChanged).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /^Unlink$/i }));
    await waitFor(() => expect(onIdentityChanged).toHaveBeenCalledTimes(2));
  });
});

describe("MemberManager roster contact information", () => {
  const rosterWithAndWithoutContactInfo = () =>
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
          memberId: "member-phone-only",
          churchId: "church-1",
          firstName: "Phone",
          lastName: "Only",
          phoneNumber: "+15555550123",
          positionIds: [],
          blockoutDates: [],
        },
        {
          memberId: "member-unreachable",
          churchId: "church-1",
          firstName: "No",
          lastName: "Contact",
          positionIds: [],
          blockoutDates: [],
        },
      ],
    } as Partial<TeamsData>);

  it("shows team assignments instead of treating missing contact details as a row warning", () => {
    renderManager({ data: rosterWithAndWithoutContactInfo(), userId: "user-1" });

    expect(screen.queryByText("No contact info")).not.toBeInTheDocument();
    expect(screen.getAllByText("No team assigned")).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: /Your teams/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Phone Only/ })).toBeInTheDocument();
  });

  it("groups scoped members first, keeps each person once, and labels hidden assignments safely", async () => {
    const user = userEvent.setup();
    const managedAvery: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-avery",
      firstName: "Avery",
      lastName: "Managed",
      teamMembershipStatus: "assigned",
    };
    const managedCharlie: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-charlie",
      firstName: "Charlie",
      lastName: "Managed",
      teamMembershipStatus: "assigned",
    };
    const otherAlpha: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-alpha",
      firstName: "Alpha",
      lastName: "Other",
      positionIds: [],
      teamMembershipStatus: "assigned",
    };
    const unassigned: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-none",
      firstName: "Noah",
      lastName: "Unassigned",
      positionIds: [],
      teamMembershipStatus: "none",
    };
    const unknown: TeamRosterMember = {
      ...worshipMember,
      memberId: "member-unknown",
      firstName: "Una",
      lastName: "Known",
      positionIds: [],
      teamMembershipStatus: "unknown",
    };
    const members = [otherAlpha, managedCharlie, unassigned, managedAvery, unknown];
    const secondManagedTeam = { ...mediaTeam, memberIds: [managedAvery.memberId] };
    renderManager({
      canEditAllTeams: false,
      canEditMember: (candidate) => [managedAvery.memberId, managedCharlie.memberId].includes(candidate.memberId),
      role: "member",
      data: buildData({
        members,
        teams: [
          { ...worshipTeam, memberIds: [managedAvery.memberId, managedCharlie.memberId] },
          secondManagedTeam,
        ],
        positions: [{ ...vocalPosition, teamId: worshipTeam.teamId }],
      }),
    });

    expect(screen.getByRole("heading", { name: "Your teams (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other members (3)" })).toBeInTheDocument();
    const rows = screen.getAllByTestId("entity-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Avery Managed"),
      expect.stringContaining("Charlie Managed"),
      expect.stringContaining("Alpha Other"),
      expect.stringContaining("Noah Unassigned"),
      expect.stringContaining("Una Known"),
    ]);
    expect(screen.getAllByText("Avery Managed")).toHaveLength(1);
    expect(screen.getByText("Not in your managed teams")).toBeInTheDocument();
    expect(screen.getByText("No team assigned")).toBeInTheDocument();
    expect(screen.getByText("Team assignments unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Hidden Team Name")).not.toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search members…");
    await user.type(search, "Alpha");
    expect(screen.getByRole("heading", { name: "Your teams (0)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other members (1)" })).toBeInTheDocument();
    expect(screen.getAllByTestId("entity-row")).toHaveLength(1);
    expect(screen.getByText("Alpha Other")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Managed");
    expect(screen.getByRole("heading", { name: "Your teams (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other members (0)" })).toBeInTheDocument();
    expect(screen.getAllByTestId("entity-row")).toHaveLength(2);
  });

  it("shows three positions, searches assignment names, and opens remaining positions without editing", async () => {
    const user = userEvent.setup();
    const positions = [
      { ...producerPosition, positionId: "position-camera", name: "Camera Operator" },
      { ...producerPosition, positionId: "position-audio", name: "Audio" },
      { ...producerPosition, positionId: "position-livestream", name: "Livestream" },
      { ...producerPosition, positionId: "position-producer-2", name: "Producer" },
      { ...producerPosition, positionId: "position-stage-manager", name: "Stage Manager" },
      { ...vocalPosition, positionId: "position-vocalist", name: "Vocalist" },
    ];
    const member = {
      ...worshipMember,
      positionIds: positions.map((position) => position.positionId),
    };
    renderManager({
      data: buildData({
        members: [member],
        positions,
        teams: [
          { ...mediaTeam, memberIds: [member.memberId] },
          { ...worshipTeam, memberIds: [member.memberId] },
        ],
      }),
    });

    const memberRow = screen.getAllByTestId("entity-row")[0];
    expect(memberRow).toHaveTextContent(
      "Media · Audio, Camera Operator, Livestream",
    );
    const assignmentLine = within(memberRow).getByLabelText(/Member assignments:/);
    const assignmentText = within(assignmentLine).getByTestId("member-assignment-text");
    expect(assignmentText).toHaveClass(
      "min-w-0",
      "overflow-hidden",
      "text-ellipsis",
      "whitespace-nowrap",
    );
    expect(assignmentLine).toHaveAttribute(
      "title",
      "Media · Audio, Camera Operator, Livestream, Producer, Stage Manager, Worship · Vocalist",
    );
    expect(
      within(assignmentLine).getByRole("button", {
        name: "Show 3 more positions for Rae Kim",
      }),
    ).toBeInTheDocument();
    const moreButton = screen.getByRole("button", {
      name: "Show 3 more positions for Rae Kim",
    });
    expect(moreButton).toHaveTextContent("+3 more");

    await user.click(moreButton);
    const popover = await screen.findByRole("dialog", {
      name: "Additional assignments for Rae Kim",
    });
    expect(within(popover).getByText("Producer")).toBeInTheDocument();
    expect(within(popover).getByText("Stage Manager")).toBeInTheDocument();
    expect(within(popover).getByText("Worship")).toBeInTheDocument();
    expect(within(popover).getByText("Vocalist")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument();
    await user.click(within(popover).getByText("Producer"));
    expect(screen.queryByRole("heading", { name: "Edit member" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Additional assignments for Rae Kim" })).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();

    const search = screen.getByPlaceholderText("Search members…");
    await user.type(search, "Camera");
    expect(screen.getByRole("button", { name: "Edit Rae Kim" })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Media");
    expect(screen.getByRole("button", { name: "Edit Rae Kim" })).toBeInTheDocument();
  });

  it("shows exactly three assigned positions without a more control", () => {
    const positions = [
      { ...producerPosition, positionId: "position-camera", name: "Camera Operator" },
      { ...producerPosition, positionId: "position-livestream", name: "Livestream" },
      { ...vocalPosition, positionId: "position-vocalist", name: "Vocalist" },
    ];
    const member = {
      ...worshipMember,
      positionIds: positions.map((position) => position.positionId),
    };
    renderManager({
      data: buildData({
        members: [member],
        positions,
        teams: [
          { ...mediaTeam, memberIds: [member.memberId] },
          { ...worshipTeam, memberIds: [member.memberId] },
        ],
      }),
    });

    const memberRow = screen.getAllByTestId("entity-row")[0];
    expect(memberRow).toHaveTextContent(
      "Media · Camera Operator, Livestream, Worship · Vocalist",
    );
    expect(screen.queryByRole("button", { name: /more assignments/i })).not.toBeInTheDocument();
  });

  it("shows roster photos and initials fallback in the member list", () => {
    renderManager({
      data: buildData({
        members: [
          {
            memberId: "member-photo",
            churchId: "church-1",
            firstName: "Rae",
            lastName: "Kim",
            positionIds: [],
            blockoutDates: [],
            profileImageUrl: "https://example.com/rae.jpg",
          },
          {
            memberId: "member-no-photo",
            churchId: "church-1",
            firstName: "Jo",
            lastName: "Lee",
            positionIds: [],
            blockoutDates: [],
          },
        ],
      }),
    });

    expect(screen.getByAltText("")).toHaveAttribute(
      "src",
      "https://example.com/rae.jpg",
    );
    expect(screen.getByText("JL")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Edit/ })).toHaveLength(2);
  });

  it("keeps a read-only projected roster visible without write controls", () => {
    renderManager({ data: rosterWithAndWithoutContactInfo(), canEdit: false });

    expect(screen.getByText("Has Email")).toBeInTheDocument();
    expect(screen.getByText("Phone Only")).toBeInTheDocument();
    expect(screen.getByText("No Contact")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Has Email/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import|Export/i })).not.toBeInTheDocument();
  });

  it("does not infer no team assigned from a restricted roster when status is missing", () => {
    renderManager({
      data: rosterWithAndWithoutContactInfo(),
      canEdit: false,
      canEditAllTeams: false,
    });

    expect(screen.getAllByText("Team assignments unavailable")).toHaveLength(3);
    expect(screen.queryByText("No team assigned")).not.toBeInTheDocument();
  });

  it("shows shared members while granting edit actions only to server-authorized ids", () => {
    const data = rosterWithAndWithoutContactInfo();
    renderManager({
      data,
      canEditMember: (member) => member.memberId === "member-reachable",
    });

    expect(screen.getByText("Has Email")).toBeInTheDocument();
    expect(screen.getByText("Phone Only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Edit Has Email/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Phone Only/i })).not.toBeInTheDocument();
  });

  it("offers contextual SMS opt-in link actions for a saved member", async () => {
    const user = userEvent.setup();
    const originalClipboard = navigator.clipboard;
    const writeText = jest.fn().mockResolvedValue(undefined);
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      renderManager({ data: rosterWithAndWithoutContactInfo(), userId: "user-1" });
      await user.click(screen.getByRole("button", { name: /Has Email/ }));
      await user.click(screen.getByRole("button", { name: /Member actions/i }));

      await user.click(
        screen.getByRole("menuitem", { name: /Open text message consent page/i }),
      );
      expect(open).toHaveBeenCalledWith(
        `${window.location.origin}/sms-opt-in/church-1`,
        "_blank",
        "noopener,noreferrer",
      );

      await user.click(screen.getByRole("button", { name: /Member actions/i }));
      await user.click(
        screen.getByRole("menuitem", { name: /Copy text message consent link/i }),
      );
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/sms-opt-in/church-1`,
      );
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
      open.mockRestore();
    }
  });

  it("shows the invite disabled, with the reason, when there is no address", async () => {
    const user = userEvent.setup();
    renderManager({ data: rosterWithAndWithoutContactInfo(), userId: "user-1" });

    await user.click(screen.getByRole("button", { name: /No Contact/ }));

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
    renderManager({ data: rosterWithAndWithoutContactInfo(), userId: "user-1" });

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
    renderManager({ data: rosterWithAndWithoutContactInfo(), userId: "user-1" });

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

describe("MemberManager SMS consent recording", () => {
  beforeEach(() => {
    mockRecordMemberSmsConsent.mockClear();
    mockRecordMemberSmsConsent.mockResolvedValue({
      success: true,
      eligibility: { status: "enabled", eligible: true, phoneNumber: "+19545551234" },
    });
  });

  it("records signed-form consent and refreshes the member eligibility", async () => {
    const user = userEvent.setup();
    const member = { ...worshipMember, phoneNumber: "+19545551234" };
    const onSmsConsentRecorded = jest.fn();
    renderManager({
      data: joinedData({
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "consent_needed", eligible: false, phoneNumber: member.phoneNumber },
        },
      }),
      onSmsConsentRecorded,
    });
    await openMember(user, /Rae Kim/);
    expect(screen.getByRole("status")).toHaveTextContent("Text message status: Consent needed");
    await user.click(screen.getByRole("button", { name: "Member actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Record text message consent" }));

    const dialog = screen.getByRole("dialog", { name: "Record text message consent" });
    expect(within(dialog).getByTestId("modal-content")).toHaveClass("text-gray-100");
    const consentDate = within(dialog).getByLabelText(/Date consent was obtained/);
    expect(consentDate).toHaveClass("[color-scheme:dark]");
    expect((consentDate as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(within(dialog).getByText("Consent source")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Verbal consent" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Signed volunteer/ministry form" })).toBeInTheDocument();
    expect(within(dialog).getByText("(954) 555-1234")).toBeInTheDocument();
    expect(within(dialog).getByText(/agreed to receive WorshipSync texts about volunteer availability, scheduling, assignments, and related reminders/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save consent" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "Signed volunteer/ministry form" }));
    await user.clear(within(dialog).getByLabelText(/Date consent was obtained/));
    await user.type(within(dialog).getByLabelText(/Date consent was obtained/), "2026-09-30");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Save consent" }));

    await waitFor(() => expect(mockRecordMemberSmsConsent).toHaveBeenCalledWith("church-1", {
      memberId: member.memberId,
      phoneNumberSnapshot: member.phoneNumber,
      source: "admin_signed_form",
      consentedAt: "2026-09-30",
      confirmed: true,
    }));
    expect(onSmsConsentRecorded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record text message consent" })).not.toBeInTheDocument());
  });

  it("hides the consent action for non-admins and members without a valid phone", async () => {
    const user = userEvent.setup();
    const member = { ...worshipMember, phoneNumber: "+19545551234" };
    renderManager({ data: joinedData({ members: [member] }), role: "member" });
    await openMember(user, /Rae Kim/);
    await user.click(screen.getByRole("button", { name: "Member actions" }));
    expect(screen.queryByRole("menuitem", { name: "Record text message consent" })).not.toBeInTheDocument();

    cleanup();
    const invalidMember = { ...worshipMember, phoneNumber: "555" };
    renderManager({ data: joinedData({ members: [invalidMember] }) });
    await openMember(user, /Rae Kim/);
    await user.click(screen.getAllByRole("button", { name: "Member actions" }).at(-1)!);
    expect(screen.queryByRole("menuitem", { name: "Record text message consent" })).not.toBeInTheDocument();
  });

  it("shows a checking state after a saved phone change and offers retry when eligibility cannot load", async () => {
    const user = userEvent.setup();
    const member = { ...worshipMember, phoneNumber: "" };
    let rejectRefresh: (error: Error) => void = () => undefined;
    const refresh = jest.fn<Promise<void>, [string, string, string]>()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }))
      .mockResolvedValueOnce();
    mockUpdateTeamRosterMember.mockResolvedValue({
      success: true,
      member: { ...member, phoneNumber: "+19545551234" },
    });
    renderManager({
      data: joinedData({
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status: "no_mobile", eligible: false, phoneNumber: "" },
        },
      }),
      onSmsEligibilityRefresh: refresh,
    });
    await openMember(user, /Rae Kim/);
    await user.type(screen.getByLabelText(/Mobile/), "9545551234");
    await user.click(saveButton());

    expect(await screen.findByText("Checking text message status…")).toBeInTheDocument();
    await act(async () => rejectRefresh(new Error("Network unavailable")));
    expect(await screen.findByText("Could not check text message status.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledWith(member.memberId, "+19545551234", "");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it.each([
    ["enabled", "Enabled"],
    ["opted_out", "Opted out"],
  ] as const)("shows %s status without offering another consent record", async (status, label) => {
    const user = userEvent.setup();
    const member = { ...worshipMember, phoneNumber: "+19545551234" };
    renderManager({
      data: joinedData({
        members: [member],
        smsEligibilityByMemberId: {
          [member.memberId]: { status, eligible: status === "enabled", phoneNumber: member.phoneNumber },
        },
      }),
    });
    await openMember(user, /Rae Kim/);
    expect(screen.getByRole("status")).toHaveTextContent(`Text message status: ${label}`);
    await user.click(screen.getByRole("button", { name: "Member actions" }));
    expect(screen.queryByRole("menuitem", { name: "Record text message consent" })).not.toBeInTheDocument();
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
      saveButton(),
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
      saveButton(),
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

it("administrators can reach personal link management from the existing member editor", async () => {
  const user = userEvent.setup();
  renderManager({ role: "admin", data: buildData({ members: [worshipMember] }) });
  await openMember(user, /Rae Kim/);
  await user.click(await screen.findByText("Personal My Schedule access"));
  expect(await screen.findByRole("button", { name: "Prepare personal link" })).toBeEnabled();
});
