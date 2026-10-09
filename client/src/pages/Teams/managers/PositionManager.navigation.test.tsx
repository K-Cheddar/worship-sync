import { render, screen, waitFor, within } from "@testing-library/react";
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
import { buildGroupsReturnTo, TEAMS_POSITION_EDIT_SEARCH_PARAM, TEAMS_RETURN_STORAGE_KEY, TEAMS_SECTION_PATHS } from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeamPosition: jest.fn(),
  createTeamPosition: jest.fn(),
  deleteTeamPosition: jest.fn(),
  getServicePlanMicrophones: jest.fn().mockResolvedValue({ microphones: [] }),
  getServiceEquipment: jest.fn().mockResolvedValue({ equipment: [] }),
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
const returnTo = buildGroupsReturnTo(team.teamId);
const avTeam: TeamRecord = {
  churchId: "church-1", teamId: "team-av", name: "AV", memberIds: [],
};
const avPosition: TeamPosition = {
  churchId: "church-1", teamId: avTeam.teamId,
  positionId: "position-camera", name: "Camera",
};
const worshipSecondPosition: TeamPosition = {
  ...position, positionId: "position-vocal-2", name: "Keys",
};

const renderScopedManager = (
  positions: TeamPosition[],
  teams: TeamRecord[],
  initialEntry: string = TEAMS_SECTION_PATHS.positions,
) => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
      <ToastProvider>
        <TeamsNavigationGuardProvider>
          <PositionManager
            positions={positions} teams={teams} data={{ ...data, positions, teams }}
            canEditTeam={(teamId) => teamId === team.teamId}
            onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} onReordered={jest.fn()}
          />
        </TeamsNavigationGuardProvider>
      </ToastProvider>
    </GlobalInfoContext.Provider>
  </MemoryRouter>,
);

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
            positions={[position]} teams={[team]} data={data} canEditTeam={() => true}
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
  it("closes an individual position editor and stays on the selected team's Positions page", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByText("Vocal"));
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

    expect(screen.getByRole("heading", { name: "Positions" })).toBeInTheDocument();
    expect(screen.getByText("Vocal")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
    expect(screen.getAllByRole("button", { name: "Back to teams" })).not.toHaveLength(0);
  });

  it("keeps a direct Positions visit on the page when the editor closes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.positions]}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
          <ToastProvider>
            <TeamsNavigationGuardProvider>
              <PositionManager
                positions={[position]} teams={[team]} data={data} canEditTeam={() => true}
                onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} onReordered={jest.fn()}
              />
              <LocationProbe />
            </TeamsNavigationGuardProvider>
          </ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByText("Vocal"));
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

    expect(screen.getByRole("heading", { name: "Positions" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
    expect(screen.queryByRole("button", { name: "Back to teams" })).not.toBeInTheDocument();
  });

  it("prompts before discarding a dirty position when its editor closes", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByText("Vocal"));
    await user.clear(screen.getByLabelText(/^Name:?$/));
    await user.type(screen.getByLabelText(/^Name:?$/), "Unsaved Vocal");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("Unsaved Vocal");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByRole("heading", { name: "Positions" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
  });

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
    expect(screen.getAllByRole("button", { name: "Back to teams" })).not.toHaveLength(0);
    expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.positions);
    await user.click(screen.getAllByRole("button", { name: "Back to teams" }).at(-1)!);

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
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    await user.clear(screen.getByLabelText(/^Name:?$/));
    await user.type(screen.getByLabelText(/^Name:?$/), "Renamed");
    expect(screen.getByRole("button", { name: "Save position" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save position" }));
    await waitFor(() => expect(updateTeamPosition).toHaveBeenCalledWith("church-1", created.positionId, expect.anything()));
    expect(createTeamPosition).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText(/^Description:?$/), "Updated after saving");
    await user.click(screen.getAllByRole("button", { name: "Back to teams" }).at(-1)!);
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  }, 20_000);

  it("keeps AV visible and read-only while create defaults to Worship", async () => {
    const user = userEvent.setup();
    const created = { ...position, positionId: "new-worship-position", name: "New keys" };
    jest.mocked(createTeamPosition).mockResolvedValue({ success: true, position: created } as never);
    renderScopedManager([avPosition, position], [avTeam, team]);

    expect(screen.getByRole("button", { name: "Edit Vocal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Camera" })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Create position" })[0]);
    expect(screen.getAllByText("Worship", { exact: true })).not.toHaveLength(0);
    await user.type(screen.getByLabelText(/^Name:?$/), "New keys");
    await user.click(screen.getAllByRole("button", { name: "Create position" }).at(-1)!);

    await waitFor(() => expect(createTeamPosition).toHaveBeenCalledWith("church-1", expect.objectContaining({ teamId: team.teamId })));
  });

  it("does not open a read-only AV position from an edit deep link", async () => {
    renderScopedManager(
      [position, avPosition],
      [team, avTeam],
      `${TEAMS_SECTION_PATHS.positions}?${TEAMS_POSITION_EDIT_SEARCH_PARAM}=${avPosition.positionId}`,
    );

    expect(await screen.findByRole("heading", { name: "Positions" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name:?$/)).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Edit position" })).not.toBeInTheDocument();
  });

  it("hides create and edit controls for a roster-only reader", () => {
    render(
      <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.positions]}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
          <ToastProvider><TeamsNavigationGuardProvider>
            <PositionManager
              positions={[position, avPosition]} teams={[team, avTeam]}
              data={{ ...data, positions: [position, avPosition], teams: [team, avTeam] }}
              canEditTeam={() => false} onSaved={jest.fn()} onArchived={jest.fn()}
              onRemoved={jest.fn()} onReordered={jest.fn()}
            />
          </TeamsNavigationGuardProvider></ToastProvider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    const list = within(screen.getByTestId("teams-create-panel-list"));
    expect(list.queryByRole("button", { name: "Create position" })).not.toBeInTheDocument();
    expect(list.queryByRole("button", { name: "Edit Vocal" })).not.toBeInTheDocument();
    expect(list.queryByRole("button", { name: "Edit Camera" })).not.toBeInTheDocument();
    expect(list.getByText("Vocal")).toBeInTheDocument();
    expect(list.getByText("Camera")).toBeInTheDocument();
  });

  it("shows reorder handles only for the selected editable team", async () => {
    const user = userEvent.setup();
    const { unmount } = renderScopedManager([position, worshipSecondPosition, avPosition], [avTeam, team]);
    await user.click(screen.getByRole("button", { name: "Filter positions" }));
    await user.click(screen.getByRole("checkbox", { name: "Worship" }));
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.getByRole("button", { name: "Drag to reorder Vocal" })).toBeInTheDocument();
    unmount();

    renderScopedManager([position, worshipSecondPosition, avPosition], [avTeam, team]);
    await user.click(screen.getByRole("button", { name: "Filter positions" }));
    await user.click(screen.getByRole("checkbox", { name: "AV" }));
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("button", { name: "Drag to reorder Camera" })).not.toBeInTheDocument();
  });
});
