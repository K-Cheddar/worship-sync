import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import TeamRoleManager from "./TeamRoleManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { createTeamRole, updateTeamRole } from "../../../api/auth";
import type { TeamRecord, TeamRole } from "../../../api/authTypes";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeamRole: jest.fn(), createTeamRole: jest.fn(), deleteTeamRole: jest.fn(), updateTeamRole: jest.fn(),
}));

const team: TeamRecord = { churchId: "church-1", teamId: "team-worship", name: "Worship", memberIds: [] };
const role: TeamRole = { churchId: "church-1", teamId: team.teamId, roleId: "role-lead", name: "Lead", description: "Leads the team" };
const returnTo = {
  label: "Back to team", pathname: TEAMS_SECTION_PATHS.groups,
  restore: { kind: "groups" as const, editTeamId: team.teamId },
};
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
};

beforeEach(() => {
  jest.mocked(createTeamRole).mockReset();
  jest.mocked(updateTeamRole).mockReset();
});

it("keeps an edited role open after Save and navigates with restore state only on Back", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeamRole).mockResolvedValue({ success: true, role: { ...role, name: "Worship Lead" } } as never);
  render(
    <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.roles, state: { teamsReturnTo: returnTo } }]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[role]} teams={[team]} canEdit onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
          <LocationProbe />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Lead"));
  await user.clear(screen.getByLabelText(/^Name:?$/));
  await user.type(screen.getByLabelText(/^Name:?$/), "Worship Lead");
  await user.click(screen.getByRole("button", { name: "Save role" }));

  await waitFor(() => expect(updateTeamRole).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("heading", { name: "Edit role" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to team" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.roles);
  await user.click(screen.getByRole("button", { name: "Back to team" }));

  expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
    pathname: TEAMS_SECTION_PATHS.groups,
    state: { teamsRestore: returnTo.restore },
  }));
});
