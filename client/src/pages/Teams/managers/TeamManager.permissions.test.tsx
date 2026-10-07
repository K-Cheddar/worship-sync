import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import TeamManager from "./TeamManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import {
  addTeamRosterMemberToTeam,
  createTeam,
  getTeamRosterMemberProfile,
  removeTeamRosterMemberFromTeam,
  searchTeamRosterCandidates,
  updateTeamRosterMemberProfile,
  updateTeam,
} from "../../../api/auth";
import type { TeamRecord, TeamRosterMember } from "../../../api/authTypes";
import type { TeamsData } from "../types";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeam: jest.fn(), createTeam: jest.fn(), deleteTeam: jest.fn(), updateTeam: jest.fn(),
  addTeamRosterMemberToTeam: jest.fn(), removeTeamRosterMemberFromTeam: jest.fn(), searchTeamRosterCandidates: jest.fn(),
  getTeamRosterMemberProfile: jest.fn(), updateTeamRosterMemberProfile: jest.fn(),
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
  email: "avery-private@example.test", phoneNumber: "+15555550123", notes: "private notes",
  qualifications: [{ qualificationId: "private-qualification", teamId: worship.teamId, areaId: "private-area", status: "completed", notes: "private" }],
  recurringAvailability: { weeksOfMonth: [1], includeLastWeekOfMonth: false },
  positionIds: [], blockoutDates: [],
};
const data: TeamsData = {
  members: [member], positions: [], teams: [worship, av], teamRoles: [],
  qualificationAreas: [], qualificationLevels: [], services: [], schedules: [{
    churchId: "church-1", scheduleId: "schedule-1", teamId: worship.teamId, name: "Sunday", serviceIds: [],
    assignments: { occurrence: { slot: { primaryMemberId: member.memberId, shadows: [] } } },
  }],
  intakeForms: [], intakeSubmissions: [], intakeRecipients: [],
};

const renderManager = (
  initialEntry: string | { pathname: string; state?: unknown } = TEAMS_SECTION_PATHS.groups,
  permissions: { canEditTeams?: boolean; canEditTeam?: (teamId: string) => boolean } = {},
  overrides: {
    teams?: TeamRecord[];
    member?: TeamRosterMember;
    positions?: TeamsData["positions"];
    roles?: TeamsData["teamRoles"];
    qualificationAreas?: TeamsData["qualificationAreas"];
    qualificationLevels?: TeamsData["qualificationLevels"];
    onRosterMemberSaved?: (member: TeamRosterMember) => void;
    onRosterMemberRemoved?: (memberId: string) => void;
    onRosterMutationReconcile?: (memberId: string) => void;
  } = {},
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <TeamManager
              teams={overrides.teams ?? [worship, av]} positions={overrides.positions ?? []} roles={overrides.roles ?? []} qualificationAreas={overrides.qualificationAreas ?? []}
              members={[overrides.member ?? member]} data={{ ...data, teams: overrides.teams ?? [worship, av], members: [overrides.member ?? member], qualificationLevels: overrides.qualificationLevels ?? [] }} canEditTeams={permissions.canEditTeams ?? false}
              canEditTeam={permissions.canEditTeam ?? ((teamId) => teamId === worship.teamId)}
              onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()}
              onRosterMemberSaved={overrides.onRosterMemberSaved}
              onRosterMemberRemoved={overrides.onRosterMemberRemoved}
              onRosterMutationReconcile={overrides.onRosterMutationReconcile}
            />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.mocked(createTeam).mockReset();
  jest.mocked(updateTeam).mockReset();
  jest.mocked(addTeamRosterMemberToTeam).mockReset();
  jest.mocked(removeTeamRosterMemberFromTeam).mockReset();
  jest.mocked(searchTeamRosterCandidates).mockReset();
  jest.mocked(getTeamRosterMemberProfile).mockReset();
  jest.mocked(updateTeamRosterMemberProfile).mockReset();
});

it("lets a scoped manager edit team settings and manage only that team's roster", async () => {
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
  expect(screen.getByRole("button", { name: "Add member" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove from team" })).toBeInTheDocument();
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

it("searches safe candidate results and adds the selected person", async () => {
  const user = userEvent.setup();
  jest.mocked(searchTeamRosterCandidates).mockResolvedValue({
    candidates: [{ memberId: "member-new", firstName: "Jordan", lastName: "Lee" }],
  } as never);
  jest.mocked(addTeamRosterMemberToTeam).mockResolvedValue({
    success: true,
    team: { ...worship, memberIds: ["member-1", "member-new"] },
    member: { memberId: "member-new", churchId: "church-1", firstName: "Jordan", lastName: "Lee" },
  } as never);
  const onTeamRosterSaved = jest.fn();
  const onRosterMemberSaved = jest.fn();
  const onRosterMutationReconcile = jest.fn();
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.groups]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamManager teams={[worship, av]} positions={[]} roles={[]} qualificationAreas={[]} members={[member]} data={data}
            canEditTeams={false} canEditTeam={(teamId) => teamId === worship.teamId}
            onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()}
            onTeamRosterSaved={onTeamRosterSaved} onRosterMemberSaved={onRosterMemberSaved}
            onRosterMutationReconcile={onRosterMutationReconcile} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.click(screen.getByRole("button", { name: "Add member" }));
  await user.type(screen.getByRole("textbox", { name: "Search existing person:" }), "Jordan");
  await user.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText("Jordan Lee")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Add$/ }));
  await waitFor(() => expect(addTeamRosterMemberToTeam).toHaveBeenCalledWith("church-1", worship.teamId, "member-new"));
  expect(onTeamRosterSaved).toHaveBeenCalledWith(expect.objectContaining({ memberIds: ["member-1", "member-new"] }));
  expect(onRosterMemberSaved).toHaveBeenCalledWith(expect.objectContaining({
    memberId: "member-new", positionIds: [], desiredPositionIds: [], blockoutDates: [],
    teamMemberships: {}, qualifications: [],
  }));
  const immediatelyAddedMember = jest.mocked(onRosterMemberSaved).mock.calls[0][0];
  expect(immediatelyAddedMember.email).toBeUndefined();
  expect(immediatelyAddedMember.phoneNumber).toBeUndefined();
  expect(immediatelyAddedMember.notes).toBeUndefined();
  expect(onRosterMutationReconcile).toHaveBeenCalledWith("member-new");
});

it("confirms team removal and explains that existing assignments stay", async () => {
  const user = userEvent.setup();
  const onRosterMemberSaved = jest.fn();
  const onRosterMemberRemoved = jest.fn();
  const onRosterMutationReconcile = jest.fn();
  jest.mocked(removeTeamRosterMemberFromTeam).mockResolvedValue({
    success: true,
    team: { ...worship, memberIds: [] },
    member: { memberId: member.memberId, churchId: "church-1", firstName: member.firstName, lastName: member.lastName },
    preservedAssignmentCount: 1,
  } as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {}, {
    onRosterMemberSaved, onRosterMemberRemoved, onRosterMutationReconcile,
  });
  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.click(screen.getByRole("button", { name: "Remove from team" }));
  expect(screen.getByRole("dialog", { name: "Remove Avery Singer from Worship?" })).toHaveTextContent(
    "Existing schedule assignments will remain and can be reassigned separately.",
  );
  await user.click(screen.getByRole("button", { name: /^Remove from team$/ }));
  await waitFor(() => expect(removeTeamRosterMemberFromTeam).toHaveBeenCalledWith("church-1", worship.teamId, member.memberId));
  expect(onRosterMemberSaved).toHaveBeenCalledWith(expect.objectContaining({
    memberId: member.memberId, churchId: "church-1", firstName: "Avery", lastName: "Singer",
    positionIds: [], desiredPositionIds: [], blockoutDates: [], teamMemberships: {}, qualifications: [],
  }));
  const immediatelyRemovedMember = onRosterMemberSaved.mock.calls[0][0];
  expect(immediatelyRemovedMember.email).toBeUndefined();
  expect(immediatelyRemovedMember.phoneNumber).toBeUndefined();
  expect(immediatelyRemovedMember.notes).toBeUndefined();
  expect(onRosterMemberRemoved).not.toHaveBeenCalled();
  expect(onRosterMutationReconcile).toHaveBeenCalledWith(member.memberId);
});

it("removes a sole-Team member from projected state immediately", async () => {
  const user = userEvent.setup();
  const onRosterMemberSaved = jest.fn();
  const onRosterMemberRemoved = jest.fn();
  const onRosterMutationReconcile = jest.fn();
  jest.mocked(removeTeamRosterMemberFromTeam).mockResolvedValue({
    success: true,
    team: { ...worship, memberIds: [] },
    member: { memberId: member.memberId, churchId: "church-1", firstName: "Avery", lastName: "Singer" },
    preservedAssignmentCount: 0,
  } as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {}, {
    teams: [worship], onRosterMemberSaved, onRosterMemberRemoved, onRosterMutationReconcile,
  });
  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.click(screen.getByRole("button", { name: "Remove from team" }));
  await user.click(screen.getByRole("button", { name: /^Remove from team$/ }));
  await waitFor(() => expect(onRosterMemberRemoved).toHaveBeenCalledWith(member.memberId));
  expect(onRosterMemberSaved).not.toHaveBeenCalled();
  expect(onRosterMutationReconcile).toHaveBeenCalledWith(member.memberId);
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

it("shows roster names to read-only Team viewers without roster mutation controls", () => {
  renderManager(TEAMS_SECTION_PATHS.groups, { canEditTeam: () => false });
  expect(screen.getAllByText(/1 member \| 0 positions · Avery Singer/)).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove from team" })).not.toBeInTheDocument();
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
  expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Members" })).getByText("Clear all")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Team actions" }));
  expect(await screen.findByText("Archive team")).toBeInTheDocument();
  expect(screen.getByText("Delete team")).toBeInTheDocument();
});

it("opens a Team-only member profile and saves through the scoped profile API", async () => {
  const user = userEvent.setup();
  const onRosterMutationReconcile = jest.fn();
  const worshipPosition = { positionId: "worship-singer", churchId: "church-1", teamId: worship.teamId, name: "Worship Singer" };
  const worshipDesired = { positionId: "worship-leader", churchId: "church-1", teamId: worship.teamId, name: "Worship Leader" };
  const avPosition = { positionId: "av-camera", churchId: "church-1", teamId: av.teamId, name: "AV Camera" };
  const worshipRole = { roleId: "worship-captain", churchId: "church-1", teamId: worship.teamId, name: "Worship Captain" };
  const avRole = { roleId: "av-operator", churchId: "church-1", teamId: av.teamId, name: "AV Operator" };
  const worshipArea = { areaId: "worship-safety", churchId: "church-1", teamId: worship.teamId, name: "Worship Safety" };
  const avArea = { areaId: "av-safety", churchId: "church-1", teamId: av.teamId, name: "AV Safety" };
  jest.mocked(getTeamRosterMemberProfile).mockResolvedValue({
    member: { memberId: member.memberId, firstName: "Avery", lastName: "Singer" },
    teamProfile: {
      teamId: worship.teamId,
      positionIds: [worshipPosition.positionId],
      desiredPositionIds: [worshipDesired.positionId],
      membership: { roleId: worshipRole.roleId, isTeamLead: false },
      qualifications: [{ qualificationId: "worship-qualification", areaId: worshipArea.areaId, teamId: worship.teamId, status: "completed" }],
    },
  } as never);
  jest.mocked(updateTeamRosterMemberProfile).mockResolvedValue({
    success: true,
    member: { memberId: member.memberId, firstName: "Avery", lastName: "Singer" },
    teamProfile: {
      teamId: worship.teamId,
      positionIds: [worshipPosition.positionId],
      desiredPositionIds: [worshipDesired.positionId],
      membership: { roleId: worshipRole.roleId, isTeamLead: true },
      qualifications: [{ qualificationId: "worship-qualification", areaId: worshipArea.areaId, teamId: worship.teamId, status: "completed" }],
    },
  } as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {}, {
    positions: [worshipPosition, worshipDesired, avPosition],
    roles: [worshipRole, avRole],
    qualificationAreas: [worshipArea, avArea],
    onRosterMutationReconcile,
  });

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.click(screen.getByRole("button", { name: "Manage" }));
  expect(await screen.findByRole("dialog", { name: "Manage Avery Singer" })).toBeInTheDocument();
  expect(getTeamRosterMemberProfile).toHaveBeenCalledWith("church-1", worship.teamId, member.memberId);
  expect(screen.getAllByText("Worship Singer")).toHaveLength(2);
  expect(screen.getAllByText("Worship Leader")).toHaveLength(2);
  expect(screen.queryByText("AV Camera")).not.toBeInTheDocument();
  expect(screen.queryByText("avery-private@example.test")).not.toBeInTheDocument();
  expect(screen.queryByText("private notes")).not.toBeInTheDocument();
  expect(screen.queryByText("AV Safety")).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Avery Singer is a Worship team lead" }));
  await user.click(screen.getByRole("button", { name: "Save Worship profile" }));
  await waitFor(() => expect(updateTeamRosterMemberProfile).toHaveBeenCalledWith(
    "church-1",
    worship.teamId,
    member.memberId,
    expect.objectContaining({
      positionIds: [worshipPosition.positionId],
      desiredPositionIds: [worshipDesired.positionId],
      membership: { roleId: worshipRole.roleId, isTeamLead: true },
      qualifications: [expect.objectContaining({ areaId: worshipArea.areaId })],
    }),
  ));
  expect(onRosterMutationReconcile).toHaveBeenCalledWith(member.memberId);
});
