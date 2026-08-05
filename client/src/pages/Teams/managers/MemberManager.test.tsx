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

jest.mock("../../../api/auth", () => ({
  archiveTeamRosterMember: jest.fn(),
  createTeamRosterMember: (...args: unknown[]) =>
    mockCreateTeamRosterMember(...args),
  deleteTeamRosterMember: jest.fn(),
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
}: {
  data?: TeamsData;
  onSaved?: jest.Mock;
  onTeamSaved?: jest.Mock;
} = {}) => {
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          { churchId: "church-1" } as ContextType<typeof GlobalInfoContext>
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
