import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TeamManager from "./TeamManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { createTeam, updateTeam } from "../../../api/auth";
import type { TeamRecord, TeamRosterMember } from "../../../api/authTypes";
import type { TeamsData } from "../types";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeam: jest.fn(), createTeam: jest.fn(), deleteTeam: jest.fn(), updateTeam: jest.fn(),
}));

const worship: TeamRecord = {
  churchId: "church-1", teamId: "team-worship", name: "Worship",
  description: "Music team", icon: "Music", memberIds: ["member-1"],
};
const av: TeamRecord = {
  churchId: "church-1", teamId: "team-av", name: "AV", memberIds: ["member-1"],
};
const member: TeamRosterMember = {
  memberId: "member-1", churchId: "church-1", firstName: "Avery", lastName: "Singer",
  positionIds: [], blockoutDates: [],
};
const data: TeamsData = {
  members: [member], positions: [], teams: [worship, av], teamRoles: [],
  qualificationAreas: [], qualificationLevels: [], services: [], schedules: [],
  intakeForms: [], intakeSubmissions: [], intakeRecipients: [],
};

const renderManager = (
  initialEntry: string | { pathname: string; state?: unknown } = TEAMS_SECTION_PATHS.groups,
  permissions: { canEditTeams?: boolean; canEditTeam?: (teamId: string) => boolean } = {},
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <TeamManager
              teams={[worship, av]} positions={[]} roles={[]} qualificationAreas={[]}
              members={[member]} data={data} canEditTeams={permissions.canEditTeams ?? false}
              canEditTeam={permissions.canEditTeam ?? ((teamId) => teamId === worship.teamId)}
              onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()}
            />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.mocked(createTeam).mockReset();
  jest.mocked(updateTeam).mockReset();
});

it("lets a scoped manager edit team settings while showing the roster read-only", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeam).mockResolvedValue({
    success: true,
    team: { ...worship, name: "Worship and Music", memberIds: ["member-1"] },
  } as never);
  renderManager();

  expect(screen.getByRole("button", { name: "Edit Worship" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit AV" })).not.toBeInTheDocument();
  expect(within(screen.getByTestId("teams-create-panel-list")).queryByRole("button", { name: "Create team" })).not.toBeInTheDocument();
  await user.click(screen.getByText("AV"));
  expect(screen.queryByRole("heading", { name: "Edit team" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  expect(screen.getByRole("heading", { name: "Edit team" })).toBeInTheDocument();
  expect(screen.getByText("Avery Singer")).toBeInTheDocument();
  expect(screen.getByText("Roster changes are managed separately.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Team actions" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /select members/i })).not.toBeInTheDocument();

  await user.clear(screen.getByLabelText(/^Name:?$/));
  await user.type(screen.getByLabelText(/^Name:?$/), "Worship and Music");
  await user.clear(screen.getByLabelText(/Description/));
  await user.type(screen.getByLabelText(/Description/), "Updated description");
  await user.click(screen.getByRole("checkbox", { name: /Use microphone assignments/ }));
  await user.click(screen.getByRole("checkbox", { name: /Use IEM assignments/ }));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Camera" }));
  await user.click(screen.getByRole("button", { name: "Save team" }));

  await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
  expect(updateTeam).toHaveBeenCalledWith("church-1", worship.teamId, expect.objectContaining({
    name: "Worship and Music",
    description: "Updated description",
    icon: expect.objectContaining({ source: "lucide", name: "Camera" }),
    usesMicrophoneAssignments: true,
    usesIemAssignments: true,
    memberIds: ["member-1"],
  }));
});

it("does not open a read-only team's editor from a restore request", async () => {
  renderManager({
    pathname: TEAMS_SECTION_PATHS.groups,
    state: { teamsRestore: { kind: "groups", editTeamId: av.teamId } },
  });

  await screen.findByText("AV");
  expect(screen.queryByRole("heading", { name: "Edit team" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /^Name:?$/ })).toBeDisabled();
});

it("keeps Team creation global-only for roster readers", () => {
  renderManager(TEAMS_SECTION_PATHS.groups, { canEditTeam: () => false });
  expect(screen.getByText("Worship")).toBeInTheDocument();
  expect(screen.getByText("AV")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit Worship" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit AV" })).not.toBeInTheDocument();
  expect(within(screen.getByTestId("teams-create-panel-list")).queryByRole("button", { name: "Create team" })).not.toBeInTheDocument();
});

it("keeps creation and roster controls available to global Teams editors", async () => {
  const user = userEvent.setup();
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeams: true,
    canEditTeam: () => true,
  });

  expect(within(screen.getByTestId("teams-create-panel-list")).getByRole("button", { name: "Create team" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit AV" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  expect(screen.queryByText("Roster changes are managed separately.")).not.toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Members" })).getByText("Clear all")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Team actions" }));
  expect(await screen.findByText("Archive team")).toBeInTheDocument();
  expect(screen.getByText("Delete team")).toBeInTheDocument();
});
