import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import QualificationManager from "./QualificationManager";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider, useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { createTeamQualificationArea, updateTeamQualificationArea } from "../../../api/auth";
import type { TeamQualificationArea, TeamRecord } from "../../../api/authTypes";
import {
  readPersistedTeamsReturnTo,
  TEAMS_SECTION_PATHS,
} from "../teamsReturnNavigation";

jest.mock("../../../api/auth", () => ({
  archiveTeamQualificationArea: jest.fn(),
  createTeamQualificationArea: jest.fn(),
  createTeamQualificationLevel: jest.fn(),
  deleteTeamQualificationArea: jest.fn(),
  updateTeamQualificationArea: jest.fn(),
  updateTeamQualificationLevel: jest.fn(),
}));

const activeTeam: TeamRecord = {
  churchId: "church-1",
  teamId: "team-worship",
  name: "Worship",
  memberIds: [],
};

const NavigationProbe = () => {
  const { requestNavigation } = useTeamsNavigationGuard();

  return (
    <button type="button" onClick={() => requestNavigation("/members")}>
      Leave Teams
    </button>
  );
};

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location-state">
      {JSON.stringify({ pathname: location.pathname, state: location.state })}
    </output>
  );
};

describe("QualificationManager navigation guard", () => {
  it("does not report unsaved changes before an editor is opened", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <QualificationManager
              areas={[]}
              levels={[]}
              teams={[activeTeam]}
              canEdit
              onAreaSaved={jest.fn()}
              onLevelSaved={jest.fn()}
              onArchived={jest.fn()}
              onAreaRemoved={jest.fn()}
            />
            <NavigationProbe />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Leave Teams" }));

    expect(
      screen.queryByRole("dialog", { name: "Unsaved changes" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a new cross-section entity open after saves and returns with restore state only on Back", async () => {
    const user = userEvent.setup();
    const createdArea: TeamQualificationArea = {
      churchId: "church-1",
      areaId: "area-saved",
      teamId: activeTeam.teamId,
      name: "Audio",
      description: "",
    };
    jest.mocked(createTeamQualificationArea).mockResolvedValue({
      success: true,
      area: createdArea,
    });
    jest.mocked(updateTeamQualificationArea).mockResolvedValue({
      success: true,
      area: { ...createdArea, name: "Audio Production" },
    });
    const returnTo = {
      label: "Back to team",
      pathname: TEAMS_SECTION_PATHS.groups,
      restore: { kind: "groups" as const, editTeamId: activeTeam.teamId },
    };

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: TEAMS_SECTION_PATHS.qualifications,
            state: { teamsReturnTo: returnTo },
          },
        ]}
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <QualificationManager
              areas={[]}
              levels={[]}
              teams={[activeTeam]}
              canEdit
              onAreaSaved={jest.fn()}
              onLevelSaved={jest.fn()}
              onArchived={jest.fn()}
              onAreaRemoved={jest.fn()}
            />
            <LocationProbe />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Create area" }));
    await user.type(screen.getByLabelText(/^Area name:?$/), "Audio");
    await user.click(screen.getByRole("button", { name: "Save area" }));

    await waitFor(() => expect(createTeamQualificationArea).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Edit qualification area" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to team" })).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      JSON.stringify({
        pathname: TEAMS_SECTION_PATHS.qualifications,
        state: { teamsReturnTo: returnTo },
      }),
    );
    expect(readPersistedTeamsReturnTo(TEAMS_SECTION_PATHS.qualifications)).toEqual(
      returnTo,
    );

    const nameInput = screen.getByLabelText(/^Area name:?$/);
    await user.clear(nameInput);
    await user.type(nameInput, "Audio Production");
    await user.click(screen.getByRole("button", { name: "Save area" }));
    await waitFor(() => expect(updateTeamQualificationArea).toHaveBeenCalledTimes(1));
    expect(createTeamQualificationArea).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Edit qualification area" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to team" }));
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      JSON.stringify({
        pathname: TEAMS_SECTION_PATHS.groups,
        state: { teamsRestore: returnTo.restore },
      }),
    );
  });

  it("guards contextual Back while qualification edits are unsaved", async () => {
    const user = userEvent.setup();
    const returnTo = {
      label: "Back to team",
      pathname: TEAMS_SECTION_PATHS.groups,
      restore: { kind: "groups" as const, editTeamId: activeTeam.teamId },
    };

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: TEAMS_SECTION_PATHS.qualifications,
            state: { teamsReturnTo: returnTo },
          },
        ]}
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <QualificationManager
              areas={[]}
              levels={[]}
              teams={[activeTeam]}
              canEdit
              onAreaSaved={jest.fn()}
              onLevelSaved={jest.fn()}
              onArchived={jest.fn()}
              onAreaRemoved={jest.fn()}
            />
            <LocationProbe />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Create area" }));
    await user.type(screen.getByLabelText(/^Area name:?$/), "Unsaved area");
    await user.click(screen.getByRole("button", { name: "Back to team" }));

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      TEAMS_SECTION_PATHS.qualifications,
    );

    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText(/^Area name:?$/)).toHaveValue("Unsaved area");
    expect(screen.getByRole("heading", { name: "Create qualification area" })).toBeInTheDocument();
  });
});
