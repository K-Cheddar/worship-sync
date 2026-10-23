import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import TeamManager from "./TeamManager";
import MemberManager from "./MemberManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { CurrentMemberIdentityProvider } from "../components/CurrentUserMemberIndicator";
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
jest.mock("../../../utils/apiErrorToast", () => ({ showApiErrorToast: jest.fn() }));

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

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, search: location.search, state: location.state })}</output>;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderManager = (
  initialEntry: string | { pathname: string; state?: unknown } = TEAMS_SECTION_PATHS.groups,
  permissions: { canEditTeams?: boolean; canEditTeam?: (teamId: string) => boolean } = {},
  overrides: {
    teams?: TeamRecord[];
    member?: TeamRosterMember;
    members?: TeamRosterMember[];
    positions?: TeamsData["positions"];
    roles?: TeamsData["teamRoles"];
    qualificationAreas?: TeamsData["qualificationAreas"];
    qualificationLevels?: TeamsData["qualificationLevels"];
    onRosterMemberSaved?: (member: TeamRosterMember) => void;
    onRosterMemberRemoved?: (memberId: string) => void;
    onRosterMutationReconcile?: (memberId: string) => void;
    onTeamRosterSaved?: (team: TeamRecord) => void;
    onSaved?: (team: TeamRecord) => void;
  } = {},
) => {
  const initialTeams = overrides.teams ?? [worship, av];
  const initialMembers = overrides.members ?? [overrides.member ?? member];
  const Harness = () => {
    const [renderedTeams, setRenderedTeams] = useState(initialTeams);
    const [renderedMembers, setRenderedMembers] = useState(initialMembers);
    const upsertTeam = (team: TeamRecord, replaceId?: string) => {
      setRenderedTeams((current) => {
        const targetId = replaceId || team.teamId;
        const found = current.some((item) => item.teamId === targetId);
        return found
          ? current.map((item) => item.teamId === targetId ? team : item)
          : [...current, team];
      });
    };
    const upsertMember = (saved: TeamRosterMember) => {
      setRenderedMembers((current) => current.some((item) => item.memberId === saved.memberId)
        ? current.map((item) => item.memberId === saved.memberId ? saved : item)
        : [...current, saved]);
    };

    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
          <ToastProvider>
            <TeamsNavigationGuardProvider>
              <TeamManager
                teams={renderedTeams} positions={overrides.positions ?? []} roles={overrides.roles ?? []} qualificationAreas={overrides.qualificationAreas ?? []}
                members={renderedMembers} data={{ ...data, teams: renderedTeams, members: renderedMembers, qualificationLevels: overrides.qualificationLevels ?? [] }} canEditTeams={permissions.canEditTeams ?? false}
                canEditTeam={permissions.canEditTeam ?? ((teamId) => teamId === worship.teamId)}
                onSaved={(team, replaceId) => { upsertTeam(team, replaceId); overrides.onSaved?.(team); }}
                onArchived={jest.fn()} onRemoved={(teamId) => setRenderedTeams((current) => current.filter((team) => team.teamId !== teamId))}
                onTeamRosterSaved={(team) => { upsertTeam(team); overrides.onTeamRosterSaved?.(team); }}
                onRosterMemberSaved={(saved) => { upsertMember(saved); overrides.onRosterMemberSaved?.(saved); }}
                onRosterMemberRemoved={(memberId) => {
                  setRenderedMembers((current) => current.filter((item) => item.memberId !== memberId));
                  overrides.onRosterMemberRemoved?.(memberId);
                }}
                onRosterMutationReconcile={overrides.onRosterMutationReconcile}
              />
            </TeamsNavigationGuardProvider>
          </ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    );
  };
  return render(<Harness />);
};

beforeEach(() => {
  jest.mocked(createTeam).mockReset();
  jest.mocked(updateTeam).mockReset();
  jest.mocked(addTeamRosterMemberToTeam).mockReset();
  jest.mocked(removeTeamRosterMemberFromTeam).mockReset();
  jest.mocked(searchTeamRosterCandidates).mockReset();
  jest.mocked(getTeamRosterMemberProfile).mockReset();
  jest.mocked(updateTeamRosterMemberProfile).mockReset();
});

it("shows team member and position counts without listing member names", () => {
  renderManager();

  const teamList = screen.getByTestId("teams-create-panel-list");
  expect(within(teamList).getByText("Worship")).toBeInTheDocument();
  expect(teamList).toHaveTextContent("1 member | 0 positions");
  expect(within(teamList).queryByText("Avery Singer")).not.toBeInTheDocument();
});

it("lets a scoped manager edit team settings and manage only that team's roster", async () => {
  const user = userEvent.setup();
  const onSaved = jest.fn();
  jest.mocked(updateTeam).mockResolvedValue({
    success: true,
    team: { ...worship, name: "Worship and Music", memberIds: ["member-1"] },
  } as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {}, { onSaved });

  expect(screen.getByRole("button", { name: "Edit Worship" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit AV" })).not.toBeInTheDocument();
  expect(within(screen.getByTestId("teams-create-panel-list")).queryByRole("button", { name: "Create team" })).not.toBeInTheDocument();
  await user.click(screen.getByText("AV"));
  expect(screen.queryByRole("heading", { name: "Edit team" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  expect(screen.getByRole("heading", { name: "Edit team" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Edit team" })).getByText("Avery Singer")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Add members/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Actions for Avery Singer" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Avery Singer from team" })).not.toBeInTheDocument();
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
  }));
  const [, , settingsPayload] = jest.mocked(updateTeam).mock.calls[0];
  expect(settingsPayload).not.toHaveProperty("memberIds");
  expect(settingsPayload).not.toHaveProperty("baseMemberIds");
  expect(onSaved.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ memberIds: ["member-1"] }));
});

it("searches safe candidate results and adds the selected person", async () => {
  const user = userEvent.setup();
  jest.mocked(searchTeamRosterCandidates).mockResolvedValue({
    candidates: [{ memberId: "member-new", firstName: "Jordan", lastName: "Lee" }],
  } as never);
  const pendingAdd = deferred<{
    success: boolean;
    team: TeamRecord;
    member: TeamRosterMember;
  }>();
  jest.mocked(addTeamRosterMemberToTeam).mockReturnValue(pendingAdd.promise as never);
  const addResult = {
    success: true,
    team: { ...worship, memberIds: ["member-1", "member-new"] },
    member: { memberId: "member-new", churchId: "church-1", firstName: "Jordan", lastName: "Lee" },
  };
  const onTeamRosterSaved = jest.fn();
  const onRosterMemberSaved = jest.fn();
  const onRosterMutationReconcile = jest.fn();
  const privateOtherTeamMember: TeamRosterMember = {
    memberId: "private-other-team",
    churchId: "church-1",
    firstName: "Private",
    lastName: "Directory Entry",
    email: "private@example.test",
    positionIds: [],
    blockoutDates: [],
  };
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeam: (teamId) => teamId === worship.teamId,
  }, {
    members: [member, privateOtherTeamMember],
    onTeamRosterSaved,
    onRosterMemberSaved,
    onRosterMutationReconcile,
  });
  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  const search = screen.getByRole("textbox", { name: /Add members/i });
  expect(screen.queryByText("Private Directory Entry")).not.toBeInTheDocument();
  await user.type(search, "Jordan");
  expect(await screen.findByText("Jordan Lee")).toBeInTheDocument();
  expect(searchTeamRosterCandidates).toHaveBeenCalledWith("church-1", worship.teamId, "Jordan");
  expect(screen.queryByText("Private Directory Entry")).not.toBeInTheDocument();
  const addButton = screen.getByRole("button", { name: "Add Jordan Lee to team" });
  await user.click(addButton);
  expect(screen.getByText("Adding member...")).toBeInTheDocument();
  expect(addButton).toBeDisabled();
  await user.click(addButton);
  expect(addTeamRosterMemberToTeam).toHaveBeenCalledTimes(1);
  pendingAdd.resolve(addResult as never);
  await waitFor(() => expect(search).toHaveValue(""));
  expect(addTeamRosterMemberToTeam).toHaveBeenCalledWith("church-1", worship.teamId, "member-new");
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
  expect(within(screen.getByRole("list", { name: "Members on this team" })).getByText("Jordan Lee")).toBeInTheDocument();
});

it("limits pending add feedback to the team whose roster is being changed", async () => {
  const user = userEvent.setup();
  const pendingAdd = deferred<{
    success: boolean;
    team: TeamRecord;
    member: TeamRosterMember;
  }>();
  const worshipCandidates = Array.from({ length: 20 }, (_, index) => ({
    memberId: `worship-candidate-${String(index + 1).padStart(2, "0")}`,
    firstName: `Candidate ${String(index + 1).padStart(2, "0")}`,
    lastName: "Person",
  }));
  jest.mocked(searchTeamRosterCandidates)
    .mockResolvedValueOnce({ candidates: worshipCandidates, hasMore: true } as never)
    .mockResolvedValueOnce({
      candidates: [{ memberId: "av-candidate", firstName: "Maya", lastName: "New" }],
      hasMore: false,
    } as never);
  jest.mocked(addTeamRosterMemberToTeam).mockReturnValue(pendingAdd.promise as never);
  const onTeamRosterSaved = jest.fn();
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeam: () => true,
  }, { onTeamRosterSaved });

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "candidate");
  expect(await screen.findByText("Candidate 01 Person")).toBeInTheDocument();
  expect(screen.getByText("Showing the first 20 matches. Refine your search to narrow the list.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add Candidate 01 Person to team" }));
  expect(screen.getByText("Adding member...")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Candidate 02 Person to team" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Edit AV" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "Maya");
  expect(await screen.findByText("Maya New")).toBeInTheDocument();
  expect(screen.queryByText("Adding member...")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Maya New to team" })).toBeEnabled();

  pendingAdd.resolve({
    success: true,
    team: { ...worship, memberIds: ["member-1", worshipCandidates[0].memberId] },
    member: {
      memberId: worshipCandidates[0].memberId,
      churchId: "church-1",
      firstName: worshipCandidates[0].firstName,
      lastName: worshipCandidates[0].lastName,
      positionIds: [],
      blockoutDates: [],
    },
  });
  await waitFor(() => expect(onTeamRosterSaved).toHaveBeenCalledTimes(1));
  expect(addTeamRosterMemberToTeam).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Adding member...")).not.toBeInTheDocument();
});

it("ignores stale scoped search results after switching teams", async () => {
  const user = userEvent.setup();
  const oldSearch = deferred<{ candidates: Array<{ memberId: string; firstName: string; lastName: string }> }>();
  const newSearch = deferred<{ candidates: Array<{ memberId: string; firstName: string; lastName: string }> }>();
  jest.mocked(searchTeamRosterCandidates)
    .mockReturnValueOnce(oldSearch.promise as never)
    .mockReturnValueOnce(newSearch.promise as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeam: () => true,
  });

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "Jordan");
  expect(await screen.findByText("Searching members...")).toBeInTheDocument();
  await waitFor(() => expect(searchTeamRosterCandidates).toHaveBeenCalledWith("church-1", worship.teamId, "Jordan"));

  await user.click(screen.getByRole("button", { name: "Edit AV" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "Maya");
  await waitFor(() => expect(searchTeamRosterCandidates).toHaveBeenCalledWith("church-1", av.teamId, "Maya"));
  newSearch.resolve({ candidates: [{ memberId: "m-maya", firstName: "Maya", lastName: "New" }] });
  expect(await screen.findByText("Maya New")).toBeInTheDocument();

  oldSearch.resolve({ candidates: [{ memberId: "m-jordan", firstName: "Jordan", lastName: "Old" }] });
  await waitFor(() => expect(screen.queryByText("Jordan Old")).not.toBeInTheDocument());
  expect(screen.getByText("Maya New")).toBeInTheDocument();
});

it("shows scoped search failures and retries inline", async () => {
  const user = userEvent.setup();
  jest.mocked(searchTeamRosterCandidates)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({
      candidates: [{ memberId: "member-retry", firstName: "Riley", lastName: "Ready" }],
    } as never);
  renderManager();

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "Riley");
  expect(await screen.findByText("Could not search people. Try again.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Riley Ready")).toBeInTheDocument();
  expect(searchTeamRosterCandidates).toHaveBeenCalledTimes(2);
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
  await user.click(screen.getByRole("button", { name: "Actions for Avery Singer" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from team" }));
  expect(screen.getByRole("dialog", { name: "Remove Avery Singer from Worship?" })).toHaveTextContent(
    "Existing schedule assignments will remain and can be reassigned separately.",
  );
  expect(screen.getByRole("dialog", { name: "Remove Avery Singer from Worship?" })).toHaveTextContent(
    "It does not delete their member record.",
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
  expect(screen.getByText("No members on this team yet.")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Actions for Avery Singer" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from team" }));
  await user.click(screen.getByRole("button", { name: /^Remove from team$/ }));
  await waitFor(() => expect(onRosterMemberRemoved).toHaveBeenCalledWith(member.memberId));
  expect(onRosterMemberSaved).not.toHaveBeenCalled();
  expect(onRosterMutationReconcile).toHaveBeenCalledWith(member.memberId);
  expect(screen.getByText("No members on this team yet.")).toBeInTheDocument();
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

it("shows counts without member names or edit controls for read-only Team viewers", () => {
  renderManager(TEAMS_SECTION_PATHS.groups, { canEditTeam: () => false });
  const teamRows = screen.getAllByTestId("entity-row");
  expect(teamRows).toHaveLength(2);
  teamRows.forEach((row) => {
    expect(row).toHaveTextContent("1 member | 0 positions");
    expect(row).not.toHaveTextContent("Avery Singer");
  });
  expect(screen.queryByRole("button", { name: "Edit Worship" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit AV" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /Add members/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Manage .*$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
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
  expect(screen.getByRole("textbox", { name: /Add members/i })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: /Add member to/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Team actions" }));
  expect(await screen.findByText("Archive team")).toBeInTheDocument();
  expect(screen.getByText("Delete team")).toBeInTheDocument();
});

it("keeps global membership edits in the draft until Save and sends the original baseline", async () => {
  const user = userEvent.setup();
  const jordan = {
    memberId: "member-jordan", churchId: "church-1", firstName: "Jordan", lastName: "Lee",
  } as TeamRosterMember;
  const archivedJordan = {
    memberId: "member-archived", churchId: "church-1", firstName: "Jordan", lastName: "Archived",
    archivedAt: "2026-10-01T00:00:00.000Z",
  } as TeamRosterMember;
  jest.mocked(updateTeam).mockResolvedValue({
    success: true,
    team: { ...worship, memberIds: [jordan.memberId] },
  } as never);
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeams: true,
    canEditTeam: () => true,
  }, { members: [member, jordan, archivedJordan] });

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  const search = screen.getByRole("textbox", { name: /Add members/i });
  await user.type(search, "Jordan");
  expect(await screen.findByText("Jordan Lee")).toBeInTheDocument();
  expect(screen.queryByText("Jordan Archived")).not.toBeInTheDocument();
  expect(searchTeamRosterCandidates).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Add Jordan Lee to team" }));
  const assigned = screen.getByRole("list", { name: "Members on this team" });
  expect(within(assigned).getByText("Jordan Lee")).toBeInTheDocument();
  expect(addTeamRosterMemberToTeam).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Actions for Avery Singer" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from team" }));
  expect(screen.getByRole("dialog", { name: "Remove Avery Singer from Worship?" })).toHaveTextContent(
    "when you save your changes",
  );
  await user.click(screen.getByRole("button", { name: /^Remove from team$/ }));
  expect(within(assigned).queryByText("Avery Singer")).not.toBeInTheDocument();
  expect(updateTeam).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Save team" }));
  await waitFor(() => expect(updateTeam).toHaveBeenCalledWith("church-1", worship.teamId, expect.objectContaining({
    memberIds: [jordan.memberId],
    baseMemberIds: [member.memberId],
  })));
});

it("discards global membership draft additions when the editor is cancelled", async () => {
  const user = userEvent.setup();
  const jordan = {
    memberId: "member-jordan", churchId: "church-1", firstName: "Jordan", lastName: "Lee",
  } as TeamRosterMember;
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeams: true,
    canEditTeam: () => true,
  }, { members: [member, jordan] });

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Add members/i }), "Jordan");
  await user.click(await screen.findByRole("button", { name: "Add Jordan Lee to team" }));
  expect(within(screen.getByRole("list", { name: "Members on this team" })).getByText("Jordan Lee")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(updateTeam).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  expect(within(screen.getByRole("list", { name: "Members on this team" })).queryByText("Jordan Lee")).not.toBeInTheDocument();
});

it("shows Manage to a global Teams editor without a team-specific scope and navigates with member context", async () => {
  const user = userEvent.setup();
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeams: true,
    canEditTeam: () => false,
  });

  await user.click(screen.getByText("Worship"));
  expect(screen.getByRole("button", { name: "Manage Avery Singer" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Manage Avery Singer" }));

  const location = JSON.parse(screen.getByTestId("location").textContent || "{}");
  expect(location.pathname).toBe(TEAMS_SECTION_PATHS.members);
  expect(new URLSearchParams(location.search).get("editMember")).toBe(member.memberId);
  expect(new URLSearchParams(location.search).get("teamId")).toBe(worship.teamId);
  expect(location.state.teamsReturnTo).toEqual(expect.objectContaining({
    label: "Back to Worship",
    pathname: TEAMS_SECTION_PATHS.groups,
    restore: { kind: "groups", editTeamId: worship.teamId },
  }));
  expect(getTeamRosterMemberProfile).not.toHaveBeenCalled();
});

it("shows Manage to an authorized scoped team editor and preserves that team", async () => {
  const user = userEvent.setup();
  renderManager();

  await user.click(screen.getByText("Worship"));
  await user.click(screen.getByRole("button", { name: "Manage Avery Singer" }));

  const location = JSON.parse(screen.getByTestId("location").textContent || "{}");
  expect(location.pathname).toBe(TEAMS_SECTION_PATHS.members);
  expect(new URLSearchParams(location.search).get("teamId")).toBe(worship.teamId);
  expect(location.state.teamsReturnTo.restore).toEqual({
    kind: "groups",
    editTeamId: worship.teamId,
  });
});

it("guards Manage navigation when the Team editor has unsaved changes", async () => {
  const user = userEvent.setup();
  renderManager(TEAMS_SECTION_PATHS.groups, {
    canEditTeams: true,
    canEditTeam: () => false,
  });

  await user.click(screen.getByText("Worship"));
  await user.type(screen.getByLabelText(/^Description/i), "Draft");
  await user.click(screen.getByRole("button", { name: "Manage Avery Singer" }));
  expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.groups);

  await user.click(screen.getByRole("button", { name: "Stay" }));
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.groups);
  await user.click(screen.getByRole("button", { name: "Manage Avery Singer" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.members);
});

it("completes Team → Manage → Close → Cancel → Save → Back with the scoped save guard", async () => {
  const user = userEvent.setup();
  const position = {
    positionId: "position-vocal",
    churchId: "church-1",
    teamId: worship.teamId,
    name: "Vocal",
  };
  const flowData = {
    ...data,
    members: [member],
    teams: [worship, av],
    positions: [position],
    teamRoles: [],
    qualificationAreas: [],
    qualificationLevels: [],
  } as TeamsData;
  const onScopedProfileSaved = jest.fn();
  jest.mocked(getTeamRosterMemberProfile).mockResolvedValue({
    member: { memberId: member.memberId, firstName: member.firstName, lastName: member.lastName },
    teamProfile: {
      teamId: worship.teamId,
      positionIds: [],
      desiredPositionIds: [],
      membership: { isTeamLead: false },
      qualifications: [],
    },
  } as never);
  const pendingSave = deferred<Awaited<ReturnType<typeof updateTeamRosterMemberProfile>>>();
  jest.mocked(updateTeamRosterMemberProfile).mockReturnValue(pendingSave.promise);
  const savedProfile = {
    success: true,
    member: { memberId: member.memberId, firstName: member.firstName, lastName: member.lastName },
    teamProfile: {
      teamId: worship.teamId,
      positionIds: [position.positionId],
      desiredPositionIds: [],
      membership: { isTeamLead: false },
      qualifications: [],
    },
  } as Awaited<ReturnType<typeof updateTeamRosterMemberProfile>>;

  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.groups]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", role: "member" } as never}>
        <ToastProvider>
          <CurrentMemberIdentityProvider memberId={null}>
            <TeamsNavigationGuardProvider>
              <LocationProbe />
              <Routes>
              <Route
                path={TEAMS_SECTION_PATHS.groups}
                element={(
                  <TeamManager
                    teams={flowData.teams}
                    positions={flowData.positions}
                    roles={flowData.teamRoles}
                    qualificationAreas={flowData.qualificationAreas}
                    members={flowData.members}
                    data={flowData}
                    canEditTeams={false}
                    canEditTeam={(teamId) => teamId === worship.teamId}
                    onSaved={jest.fn()}
                    onArchived={jest.fn()}
                    onRemoved={jest.fn()}
                  />
                )}
              />
              <Route
                path={TEAMS_SECTION_PATHS.members}
                element={(
                  <MemberManager
                    members={flowData.members}
                    positions={flowData.positions}
                    data={{ ...flowData, teams: [worship] }}
                    canEdit
                    canEditAllTeams={false}
                    canEditMember={(candidate) => (worship.memberIds || []).includes(candidate.memberId)}
                    onSaved={jest.fn()}
                    onTeamSaved={jest.fn()}
                    onArchived={jest.fn()}
                    onRemoved={jest.fn()}
                    onScopedProfileSaved={onScopedProfileSaved}
                  />
                )}
              />
              </Routes>
            </TeamsNavigationGuardProvider>
          </CurrentMemberIdentityProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByRole("button", { name: "Edit Worship" }));
  await user.click(screen.getByRole("button", { name: `Manage ${member.firstName} ${member.lastName}` }));

  await screen.findByRole("checkbox", { name: "Eligible position: Vocal" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}")).toMatchObject({
    pathname: TEAMS_SECTION_PATHS.members, search: "",
  });
  expect(screen.getAllByRole("button", { name: "Back to Worship" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Edit Avery Singer" }));
  await user.click(await screen.findByRole("checkbox", { name: "Eligible position: Vocal" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.members);
  await user.click(screen.getByRole("button", { name: "Edit Avery Singer" }));
  const memberEditor = await screen.findByRole("region", { name: "Avery Singer" });
  expect(await within(memberEditor).findByRole("heading", { name: "Worship" })).toBeInTheDocument();
  await user.click(within(memberEditor).getByRole("checkbox", { name: "Eligible position: Vocal" }));
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Back to Worship" }));
  expect(screen.getByRole("dialog", { name: "Saving changes" })).toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.members);
  await user.click(screen.getByRole("button", { name: "Stay on page" }));
  await act(async () => pendingSave.resolve(savedProfile));

  await waitFor(() => expect(updateTeamRosterMemberProfile).toHaveBeenCalledWith(
    "church-1",
    worship.teamId,
    member.memberId,
    expect.objectContaining({ positionIds: [position.positionId] }),
  ));
  expect(onScopedProfileSaved).toHaveBeenCalledWith(member.memberId);
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.members);
  await user.click(await screen.findByRole("button", { name: "Back to Worship" }));

  expect(await screen.findByRole("heading", { name: "Edit team" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /^Name:?$/ })).toHaveValue("Worship");
  expect(within(screen.getByRole("list", { name: "Members on this team" })).getByText("Avery Singer")).toBeInTheDocument();
  expect(JSON.parse(screen.getByTestId("location").textContent || "{}").pathname).toBe(TEAMS_SECTION_PATHS.groups);
});
