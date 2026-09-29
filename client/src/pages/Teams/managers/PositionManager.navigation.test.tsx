import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import PositionManager from "./PositionManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import {
  createTeamPosition,
  getServicePlanMicrophones,
  updateTeamPosition,
} from "../../../api/auth";
import type { TeamPosition, TeamRecord } from "../../../api/authTypes";
import type { TeamsData } from "../types";
import { TEAMS_RETURN_STORAGE_KEY, TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeamPosition: jest.fn(),
  createTeamPosition: jest.fn(),
  deleteTeamPosition: jest.fn(),
  getServicePlanMicrophones: jest.fn().mockResolvedValue({ microphones: [] }),
  updateTeamPosition: jest.fn(),
}));

const team: TeamRecord = {
  churchId: "church-1",
  teamId: "team-worship",
  name: "Worship",
  memberIds: [],
};
const position: TeamPosition = {
  churchId: "church-1",
  teamId: team.teamId,
  positionId: "position-vocal",
  name: "Vocal",
  description: "Lead singing",
};
const data: TeamsData = {
  members: [], positions: [position], teams: [team], teamRoles: [],
  qualificationAreas: [], qualificationLevels: [], services: [], schedules: [],
  intakeForms: [], intakeSubmissions: [], intakeRecipients: [],
};
const returnTo = {
  label: "Back to team",
  pathname: TEAMS_SECTION_PATHS.groups,
  restore: { kind: "groups" as const, editTeamId: team.teamId },
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
};

const renderManager = () => render(
  <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.positions, state: { teamsReturnTo: returnTo } }]}>
    <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
      <ToastProvider>
        <TeamsNavigationGuardProvider>
          <PositionManager
            positions={[position]} teams={[team]} data={data} canEdit
            onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} onReordered={jest.fn()}
          />
          <LocationProbe />
        </TeamsNavigationGuardProvider>
      </ToastProvider>
    </GlobalInfoContext.Provider>
  </MemoryRouter>,
);

beforeEach(() => {
  jest.mocked(createTeamPosition).mockReset();
  jest.mocked(updateTeamPosition).mockReset();
  jest.mocked(getServicePlanMicrophones).mockResolvedValue({ microphones: [] } as never);
});

afterEach(() => sessionStorage.removeItem(TEAMS_RETURN_STORAGE_KEY));

describe("PositionManager return navigation", () => {
  it("keeps an edited position open and returns with restore state only on Back", async () => {
    const user = userEvent.setup();
    jest.mocked(updateTeamPosition).mockResolvedValue({ success: true, position: { ...position, name: "Lead Vocal" } } as never);
    renderManager();

    await user.click(screen.getByText("Vocal"));
    await user.clear(screen.getByLabelText(/^Name:?$/));
    await user.type(screen.getByLabelText(/^Name:?$/), "Lead Vocal");
    await user.click(screen.getByRole("button", { name: "Save position" }));

    await waitFor(() => expect(updateTeamPosition).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Edit position" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to team" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
    await user.click(screen.getByRole("button", { name: "Back to team" }));

    expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
      pathname: TEAMS_SECTION_PATHS.groups,
      state: { teamsRestore: returnTo.restore },
    }));
  });

  it("uses the persisted identity after create so another Save updates", async () => {
    const user = userEvent.setup();
    const created = { ...position, positionId: "position-created", name: "New Position", description: "" };
    jest.mocked(createTeamPosition).mockResolvedValue({ success: true, position: created } as never);
    jest.mocked(updateTeamPosition).mockResolvedValue({ success: true, position: { ...created, name: "Renamed" } } as never);
    renderManager();

    await user.click(screen.getAllByRole("button", { name: "Create position" })[0]);
    await user.type(screen.getByLabelText(/^Name:?$/), "New Position");
    await user.click(screen.getAllByRole("button", { name: "Create position" })[1]);
    await waitFor(() => expect(createTeamPosition).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Edit position" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Created" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Name:?$/));
    await user.type(screen.getByLabelText(/^Name:?$/), "Renamed");
    expect(screen.getByRole("button", { name: "Save position" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save position" }));
    await waitFor(() => expect(updateTeamPosition).toHaveBeenCalledWith("church-1", created.positionId, expect.anything()));
    expect(createTeamPosition).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText(/^Description:?$/), "Updated after saving");
    await user.click(screen.getByRole("button", { name: "Back to team" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });
});
