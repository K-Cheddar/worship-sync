import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import QualificationManager from "./QualificationManager";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider, useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { createTeamQualificationArea, createTeamQualificationLevel, updateTeamQualificationArea, updateTeamQualificationLevel } from "../../../api/auth";
import type { TeamQualificationArea, TeamQualificationLevel, TeamRecord } from "../../../api/authTypes";
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
  it("closes an individual qualification editor without leaving the Qualifications page", async () => {
    const user = userEvent.setup();
    const returnTo = {
      label: "Back to team",
      pathname: TEAMS_SECTION_PATHS.groups,
      restore: { kind: "groups" as const, editTeamId: activeTeam.teamId },
    };

    render(
      <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.qualifications, state: { teamsReturnTo: returnTo } }]}>
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <QualificationManager
              areas={[]}
              levels={[]}
              teams={[activeTeam]}
              canEditTeam={() => true}
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
    await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

    expect(screen.getByRole("heading", { name: "Qualifications" })).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(TEAMS_SECTION_PATHS.qualifications);
    expect(screen.getAllByRole("button", { name: "Back to team" })).not.toHaveLength(0);
  });

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
              canEditTeam={() => true}
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
              canEditTeam={() => true}
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
    await user.click(screen.getByRole("button", { name: "Create qualification area" }));

    await waitFor(() => expect(createTeamQualificationArea).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Edit qualification area" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Back to team" })).not.toHaveLength(0);
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
    await user.click(screen.getByRole("button", { name: "Save qualification area" }));
    await waitFor(() => expect(updateTeamQualificationArea).toHaveBeenCalledTimes(1));
    expect(createTeamQualificationArea).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Edit qualification area" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Back to team" }).at(-1)!);
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
              canEditTeam={() => true}
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
    await user.click(screen.getAllByRole("button", { name: "Back to team" }).at(-1)!);

    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByTestId("location-state")).toHaveTextContent(
      TEAMS_SECTION_PATHS.qualifications,
    );

    await user.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText(/^Area name:?$/)).toHaveValue("Unsaved area");
    expect(screen.getByRole("heading", { name: "Create qualification area" })).toBeInTheDocument();
  });
});

it("keeps AV qualifications read-only and creates Worship areas and levels under Worship", async () => {
  const user = userEvent.setup();
  const avTeam: TeamRecord = { churchId: "church-1", teamId: "team-av", name: "AV", memberIds: [] };
  const avArea: TeamQualificationArea = { churchId: "church-1", areaId: "area-av", teamId: avTeam.teamId, name: "Camera skill" };
  const worshipArea: TeamQualificationArea = { churchId: "church-1", areaId: "area-worship", teamId: activeTeam.teamId, name: "Vocal skill" };
  const avLevel: TeamQualificationLevel = { churchId: "church-1", levelId: "level-av", areaId: avArea.areaId, name: "Experienced", rank: 1 };
  const createdArea = { ...worshipArea, areaId: "area-new", name: "New skill" };
  const createdLevel = { churchId: "church-1", levelId: "level-new", areaId: createdArea.areaId, name: "Starter", rank: 1 };
  jest.mocked(createTeamQualificationArea).mockClear();
  jest.mocked(createTeamQualificationLevel).mockClear();
  jest.mocked(createTeamQualificationArea).mockResolvedValue({ success: true, area: createdArea } as never);
  jest.mocked(createTeamQualificationLevel).mockResolvedValue({ success: true, level: createdLevel } as never);
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.qualifications]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <QualificationManager
            areas={[avArea, worshipArea]} levels={[avLevel]} teams={[avTeam, activeTeam]}
            canEditTeam={(teamId) => teamId === activeTeam.teamId}
            onAreaSaved={jest.fn()} onLevelSaved={jest.fn()} onArchived={jest.fn()} onAreaRemoved={jest.fn()}
          />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("button", { name: "Edit Vocal skill" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit Camera skill" })).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Create area" })[0]);
  expect(screen.getAllByText("Worship", { exact: true })).not.toHaveLength(0);
  await user.type(screen.getByLabelText(/^Area name:?$/), "New skill");
  await user.click(screen.getByRole("button", { name: "Create qualification area" }));
  await waitFor(() => expect(createTeamQualificationArea).toHaveBeenCalledWith("church-1", expect.objectContaining({ teamId: activeTeam.teamId })));

  await user.type(screen.getByPlaceholderText("New level"), "Starter");
  await user.click(screen.getByRole("button", { name: "Add level" }));
  await waitFor(() => expect(createTeamQualificationLevel).toHaveBeenCalledWith("church-1", expect.objectContaining({ areaId: createdArea.areaId })));
});

it("hides create and edit controls for a roster-only reader", () => {
  const area: TeamQualificationArea = { churchId: "church-1", areaId: "area-read", teamId: activeTeam.teamId, name: "Vocal skill" };
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.qualifications]}>
      <ToastProvider><TeamsNavigationGuardProvider>
        <QualificationManager
          areas={[area]} levels={[]} teams={[activeTeam]} canEditTeam={() => false}
          onAreaSaved={jest.fn()} onLevelSaved={jest.fn()} onArchived={jest.fn()} onAreaRemoved={jest.fn()}
        />
      </TeamsNavigationGuardProvider></ToastProvider>
    </MemoryRouter>,
  );

  const list = within(screen.getByTestId("teams-create-panel-list"));
  expect(list.queryByRole("button", { name: "Create area" })).not.toBeInTheDocument();
  expect(list.queryByRole("button", { name: "Edit Vocal skill" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add level" })).not.toBeInTheDocument();
  expect(list.getByText("Vocal skill")).toBeInTheDocument();
});

it("creates a qualification area with an icon and renders a fallback for legacy areas", async () => {
  const user = userEvent.setup();
  const onAreaSaved = jest.fn();
  const icon = { source: "tabler", name: "bible" } as const;
  const storedIcon = { source: "worshipsync", name: "bible", color: "#fbbf24" } as const;
  const createdArea: TeamQualificationArea = {
    churchId: "church-1",
    areaId: "area-audio",
    teamId: activeTeam.teamId,
    name: "Audio",
    icon,
  };
  jest.mocked(createTeamQualificationArea).mockResolvedValue({ success: true, area: createdArea });
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.qualifications]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}><ToastProvider><TeamsNavigationGuardProvider>
        <QualificationManager
          areas={[
            { churchId: "church-1", areaId: "area-legacy", teamId: activeTeam.teamId, name: "Legacy area" },
            { churchId: "church-1", areaId: "area-stored-icon", teamId: activeTeam.teamId, name: "Stored icon", icon: storedIcon },
          ]}
          levels={[]}
          teams={[activeTeam]}
          canEditTeam={() => true}
          onAreaSaved={onAreaSaved}
          onLevelSaved={jest.fn()}
          onArchived={jest.fn()}
          onAreaRemoved={jest.fn()}
        />
      </TeamsNavigationGuardProvider></ToastProvider></GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(screen.getAllByTestId("entity-icon-badge")).toHaveLength(2);
  expect(screen.getAllByTestId("entity-icon-badge")[1]).toHaveStyle({ backgroundColor: "#fbbf24" });
  await user.click(screen.getByText("Legacy area"));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  expect(screen.getByRole("button", { name: "Award" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Icon picker" })).toHaveTextContent("Award (default)");
  await user.keyboard("{Escape}");
  await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: "Create area" }));
  await user.type(screen.getByLabelText(/^Area name:?$/), "Audio");
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Bible" }));
  await user.click(screen.getByRole("button", { name: "Create qualification area" }));

  await waitFor(() => expect(createTeamQualificationArea).toHaveBeenCalledWith("church-1", expect.objectContaining({ icon })));
  expect(onAreaSaved).toHaveBeenCalledWith(expect.objectContaining({ icon }), expect.any(String));
});

it("removes a saved qualification area icon without changing its levels", async () => {
  const user = userEvent.setup();
  const icon = { source: "lucide", name: "Award", color: "#fbbf24" } as const;
  const area: TeamQualificationArea = {
    churchId: "church-1",
    areaId: "area-audio",
    teamId: activeTeam.teamId,
    name: "Audio",
    icon,
  };
  jest.mocked(updateTeamQualificationArea).mockResolvedValue({ success: true, area: { ...area, icon: "" } });
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.qualifications]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}><ToastProvider><TeamsNavigationGuardProvider>
        <QualificationManager
          areas={[area]}
          levels={[]}
          teams={[activeTeam]}
          canEditTeam={() => true}
          onAreaSaved={jest.fn()}
          onLevelSaved={jest.fn()}
          onArchived={jest.fn()}
          onAreaRemoved={jest.fn()}
        />
      </TeamsNavigationGuardProvider></ToastProvider></GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Audio"));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Clear icon" }));
  await user.click(screen.getByRole("button", { name: "Save qualification area" }));
  await waitFor(() => expect(updateTeamQualificationArea).toHaveBeenCalledWith("church-1", area.areaId, expect.objectContaining({ icon: "" })));
  expect(updateTeamQualificationLevel).not.toHaveBeenCalled();
});
