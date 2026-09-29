import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import TeamManager from "./TeamManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { updateTeam } from "../../../api/auth";
import type { TeamRecord } from "../../../api/authTypes";
import type { TeamsData } from "../types";
import { TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeam: jest.fn(), createTeam: jest.fn(), deleteTeam: jest.fn(), updateTeam: jest.fn(),
}));

const team: TeamRecord = { churchId: "church-1", teamId: "team-worship", name: "Worship", memberIds: [] };
const data: TeamsData = {
  members: [], positions: [], teams: [team], teamRoles: [], qualificationAreas: [],
  qualificationLevels: [], services: [], schedules: [], intakeForms: [],
  intakeSubmissions: [], intakeRecipients: [],
};
const returnTo = {
  label: "Back to schedule", pathname: TEAMS_SECTION_PATHS.schedules,
  restore: { kind: "schedule" as const, scheduleId: "schedule-1" },
};
const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
};

beforeEach(() => jest.mocked(updateTeam).mockReset());

it("keeps an edited team open and returns to its originating schedule only on Back", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeam).mockResolvedValue({ success: true, team: { ...team, name: "Worship and Music" } } as never);
  render(
    <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.groups, state: { teamsReturnTo: returnTo } }]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <Routes>
            <Route path={TEAMS_SECTION_PATHS.groups} element={<TeamManager
              teams={[team]} positions={[]} roles={[]} qualificationAreas={[]} members={[]}
              data={data} canEdit onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()}
            />} />
            <Route path={TEAMS_SECTION_PATHS.schedules} element={<p>Schedule origin</p>} />
          </Routes>
          <LocationProbe />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Worship"));
  await user.clear(screen.getByLabelText(/^Name:?$/));
  await user.type(screen.getByLabelText(/^Name:?$/), "Worship and Music");
  await user.click(screen.getByRole("button", { name: "Save team" }));

  await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("heading", { name: "Edit team" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back to schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.groups);
  await user.click(screen.getByRole("button", { name: "Back to schedule" }));

  expect(screen.getByText("Schedule origin")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
    pathname: TEAMS_SECTION_PATHS.schedules,
    state: { teamsRestore: returnTo.restore },
  }));
});
