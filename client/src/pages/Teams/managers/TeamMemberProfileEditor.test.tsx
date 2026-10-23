import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../../context/toastContext";
import type { TeamMemberTeamProfile } from "../../../api/auth";
import type { TeamPosition, TeamRecord, TeamRosterMember } from "../../../api/authTypes";
import TeamMemberProfileEditor from "./TeamMemberProfileEditor";

const mockGetTeamRosterMemberProfile = jest.fn();
const mockUpdateTeamRosterMemberProfile = jest.fn();

jest.mock("../../../api/auth", () => ({
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

const renderEditor = (initialProfile?: TeamMemberTeamProfile) => render(
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
      qualificationAreas={[]}
      qualificationLevels={[]}
      onTeamChange={jest.fn()}
      onEditorStateChange={jest.fn()}
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
