import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../../context/toastContext";
import { AuthApiError, type TeamMemberTeamProfile } from "../../../api/auth";
import type { TeamPosition, TeamQualificationArea, TeamRecord, TeamRosterMember } from "../../../api/authTypes";
import TeamMemberProfileEditor, { type TeamMemberProfileEditorStatus } from "./TeamMemberProfileEditor";

const mockGetTeamRosterMemberProfile = jest.fn();
const mockUpdateTeamRosterMemberProfile = jest.fn();

jest.mock("../../../api/auth", () => ({
  ...jest.requireActual("../../../api/auth"),
  getTeamRosterMemberProfile: (...args: unknown[]) => mockGetTeamRosterMemberProfile(...args),
  updateTeamRosterMemberProfile: (...args: unknown[]) => mockUpdateTeamRosterMemberProfile(...args),
}));

const worshipTeam: TeamRecord = {
  teamId: "team-worship",
  churchId: "church-1",
  name: "Worship",
  memberIds: ["member-1"],
};
const mediaTeam: TeamRecord = {
  teamId: "team-media",
  churchId: "church-1",
  name: "Media",
  memberIds: ["member-1"],
};
const vocalPosition: TeamPosition = {
  positionId: "position-vocal",
  churchId: "church-1",
  teamId: worshipTeam.teamId,
  name: "Vocal",
};
const producerPosition: TeamPosition = {
  positionId: "position-producer",
  churchId: "church-1",
  teamId: mediaTeam.teamId,
  name: "Producer",
};
const member: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: [],
  blockoutDates: [],
};
const completeProfile: TeamMemberTeamProfile = {
  teamId: worshipTeam.teamId,
  positionIds: [vocalPosition.positionId],
  desiredPositionIds: [vocalPosition.positionId],
  membership: { roleId: "role-lead", isTeamLead: false },
  qualifications: [],
};

const renderEditor = (
  initialProfile?: TeamMemberTeamProfile,
  qualificationAreas: TeamQualificationArea[] = [],
  onEditorStateChange = jest.fn<void, [TeamMemberProfileEditorStatus]>(),
) => render(
  <ToastProvider>
    <TeamMemberProfileEditor
      churchId="church-1"
      team={worshipTeam}
      teams={[worshipTeam, mediaTeam]}
      member={member}
      initialProfile={initialProfile}
      positions={[vocalPosition, producerPosition]}
      roles={[{
        roleId: "role-lead",
        churchId: "church-1",
        teamId: worshipTeam.teamId,
        name: "Team lead",
      }]}
      qualificationAreas={qualificationAreas}
      qualificationLevels={[]}
      onTeamChange={jest.fn()}
      onEditorStateChange={onEditorStateChange}
      onSaved={jest.fn()}
    />
  </ToastProvider>,
);

beforeEach(() => {
  mockGetTeamRosterMemberProfile.mockReset();
  mockUpdateTeamRosterMemberProfile.mockReset();
});

it("renders complete bootstrap data immediately with only the selected team's options", async () => {
  const user = userEvent.setup();
  renderEditor(completeProfile);

  expect(mockGetTeamRosterMemberProfile).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Worship" })).toBeInTheDocument();
  const positions = screen.getByRole("group", { name: "Positions" });
  expect(within(positions).getByRole("checkbox", { name: /Vocal/ }))
    .toHaveAttribute("aria-checked", "true");
  expect(within(positions).queryByRole("checkbox", { name: /Producer/ })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Worship role:" })).toHaveTextContent("Team lead");

  await user.click(screen.getByRole("button", { name: "Desired positions" }));
  const desiredPositions = screen.getByRole("group", { name: "Desired positions" });
  expect(within(desiredPositions).getByRole("checkbox", { name: /Vocal/ }))
    .toHaveAttribute("aria-checked", "true");
});

it("uses the restricted profile read and offers retry when bootstrap data is unavailable", async () => {
  const user = userEvent.setup();
  let rejectProfileRead: (error: Error) => void = () => {};
  mockGetTeamRosterMemberProfile
    .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectProfileRead = reject; }))
    .mockResolvedValueOnce({ member, teamProfile: completeProfile });
  renderEditor();

  expect(screen.getByRole("status")).toHaveTextContent("Loading Worship profile");
  await act(async () => rejectProfileRead(new Error("Temporary profile read failure")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Temporary profile read failure");
  expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Try again" }));

  await waitFor(() => expect(mockGetTeamRosterMemberProfile).toHaveBeenCalledTimes(2));
  const vocalCheckbox = await within(screen.getByRole("group", { name: "Positions" }))
    .findByRole("checkbox", { name: /Vocal/ });
  expect(vocalCheckbox).toHaveAttribute("aria-checked", "true");
});

it("omits empty archived area options while preserving archived and known qualification areas", async () => {
  const user = userEvent.setup();
  renderEditor({
    ...completeProfile,
    qualifications: ["", "retired", "known"].map((areaId) => ({
      qualificationId: `qualification-${areaId || "blank"}`,
      areaId,
      teamId: worshipTeam.teamId,
      status: "in_training",
    })),
  }, [{ areaId: "known", teamId: worshipTeam.teamId, churchId: "church-1", name: "Known area" }]);

  expect(screen.getAllByRole("combobox", { name: "Area:" })[0]).toHaveTextContent("Choose area");
  await user.click(screen.getAllByRole("combobox", { name: "Area:" })[0]);
  expect(screen.queryByRole("option", { name: /Archived qualification area \(\)/ })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Archived qualification area \(retired\)/ })).toBeInTheDocument();
  expect(screen.getAllByRole("option", { name: /Known area/ })).toHaveLength(1);
  expect(screen.queryByRole("option", { name: /Archived qualification area \(known\)/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /Known area/ }));
  expect(screen.getAllByRole("combobox", { name: "Area:" })[0]).toHaveTextContent("Known area");
  expect(mockUpdateTeamRosterMemberProfile).not.toHaveBeenCalled();
});

it("sends only a changed role and its loaded baseline, preserving a conflict draft on retry", async () => {
  const user = userEvent.setup();
  const onState = jest.fn<void, [TeamMemberProfileEditorStatus]>();
  const conflict = new AuthApiError("This part of the team profile changed. Reopen the profile to review it.", { status: 409 });
  mockUpdateTeamRosterMemberProfile.mockRejectedValue(conflict);
  renderEditor(completeProfile, [], onState);
  await user.click(screen.getByRole("combobox", { name: "Worship role:" }));
  await user.click(screen.getByRole("option", { name: "No role" }));
  const save = () => onState.mock.calls[onState.mock.calls.length - 1][0].save();
  await act(async () => save());
  expect(mockUpdateTeamRosterMemberProfile).toHaveBeenLastCalledWith("church-1", worshipTeam.teamId, member.memberId, {
    membership: { roleId: null }, baseProfile: { membership: { roleId: "role-lead" } },
  });
  expect(await screen.findByText(conflict.message)).toBeInTheDocument();
  expect(onState.mock.calls[onState.mock.calls.length - 1][0].hasPendingChanges).toBe(true);
  expect(screen.getByRole("combobox", { name: "Worship role:" })).toHaveTextContent("No role");
  await act(async () => save());
  expect(mockUpdateTeamRosterMemberProfile).toHaveBeenCalledTimes(2);
  expect(mockUpdateTeamRosterMemberProfile.mock.calls[1]).toEqual(mockUpdateTeamRosterMemberProfile.mock.calls[0]);
});

it("sends an explicit section clear with its original baseline and adopts the saved profile", async () => {
  const user = userEvent.setup();
  const onState = jest.fn<void, [TeamMemberProfileEditorStatus]>();
  mockGetTeamRosterMemberProfile.mockResolvedValue({ member, teamProfile: completeProfile });
  mockUpdateTeamRosterMemberProfile.mockResolvedValue({
    teamProfile: { ...completeProfile, positionIds: [] },
  });
  renderEditor(undefined, [], onState);
  await user.click(await screen.findByRole("checkbox", { name: /Vocal/ }));
  await act(async () => onState.mock.calls[onState.mock.calls.length - 1][0].save());
  expect(mockUpdateTeamRosterMemberProfile).toHaveBeenCalledWith("church-1", worshipTeam.teamId, member.memberId, {
    positionIds: [], baseProfile: { positionIds: completeProfile.positionIds },
  });
  expect(onState.mock.calls[onState.mock.calls.length - 1][0].hasPendingChanges).toBe(false);
});
