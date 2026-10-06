import { render, screen, waitFor, within } from "@testing-library/react";
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

it("closes an individual role editor without leaving the Roles page", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.roles, state: { teamsReturnTo: returnTo } }]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[role]} teams={[team]} canEditTeam={() => true} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
          <LocationProbe />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Lead"));
  await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);

  expect(screen.getByRole("heading", { name: "Team roles" })).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.roles);
  expect(screen.getAllByRole("button", { name: "Back to team" })).not.toHaveLength(0);
});

it("keeps an edited role open after Save and navigates with restore state only on Back", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeamRole).mockResolvedValue({ success: true, role: { ...role, name: "Worship Lead" } } as never);
  render(
    <MemoryRouter initialEntries={[{ pathname: TEAMS_SECTION_PATHS.roles, state: { teamsReturnTo: returnTo } }]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[role]} teams={[team]} canEditTeam={() => true} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
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
  expect(screen.getAllByRole("button", { name: "Back to team" })).not.toHaveLength(0);
  expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(TEAMS_SECTION_PATHS.roles);
  await user.click(screen.getAllByRole("button", { name: "Back to team" }).at(-1)!);

  expect(screen.getByTestId("location")).toHaveTextContent(JSON.stringify({
    pathname: TEAMS_SECTION_PATHS.groups,
    state: { teamsRestore: returnTo.restore },
  }));
});

it("creates a role with its selected icon and renders icons with a fallback for legacy roles", async () => {
  const user = userEvent.setup();
  const onSaved = jest.fn();
  const icon = { source: "lucide", name: "Users" } as const;
  const storedIcon = { ...icon, color: "#22c55e" } as const;
  jest.mocked(createTeamRole).mockResolvedValue({
    success: true,
    role: { ...role, name: "Safety Lead", icon },
  } as never);
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.roles]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[role, { ...role, roleId: "role-stored-icon", name: "Stored icon", icon: storedIcon }]} teams={[team]} canEditTeam={() => true} onSaved={onSaved} onArchived={jest.fn()} onRemoved={jest.fn()} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(screen.getAllByTestId("entity-icon-badge")).toHaveLength(2);
  expect(screen.getAllByTestId("entity-icon-badge")[1]).toHaveStyle({ backgroundColor: "#22c55e" });
  await user.click(screen.getByText("Lead"));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  expect(screen.getByRole("button", { name: /Shield Check/i })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Icon picker" })).toHaveTextContent("Shield Check (default)");
  await user.keyboard("{Escape}");
  await user.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  await user.click(screen.getAllByRole("button", { name: "Create role" }).at(-1)!);
  await user.type(screen.getByLabelText(/^Name:?$/), "Safety Lead");
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Users" }));
  await user.click(screen.getAllByRole("button", { name: "Create role" }).at(-1)!);

  await waitFor(() => expect(createTeamRole).toHaveBeenCalledWith("church-1", expect.objectContaining({ icon })));
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ icon }), expect.any(String));
});

it("removes a saved role icon through the shared picker", async () => {
  const user = userEvent.setup();
  const icon = { source: "lucide", name: "ShieldCheck", color: "#22c55e" } as const;
  jest.mocked(updateTeamRole).mockResolvedValue({ success: true, role: { ...role, icon: "" } } as never);
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.roles]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[{ ...role, icon }]} teams={[team]} canEditTeam={() => true} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Lead"));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Clear icon" }));
  await user.click(screen.getByRole("button", { name: "Save role" }));
  await waitFor(() => expect(updateTeamRole).toHaveBeenCalledWith("church-1", role.roleId, expect.objectContaining({ icon: "" })));
});

it("changes a role icon and keeps its selected color", async () => {
  const user = userEvent.setup();
  const previousIcon = { source: "lucide", name: "Users", color: "#22c55e" } as const;
  const icon = { source: "lucide", name: "Guitar", color: "#22c55e" } as const;
  jest.mocked(updateTeamRole).mockResolvedValue({ success: true, role: { ...role, icon } } as never);
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.roles]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", churchBranding: { colors: [] } } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[{ ...role, icon: previousIcon }]} teams={[team]} canEditTeam={() => true} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  await user.click(screen.getByText("Lead"));
  await user.click(screen.getByRole("button", { name: "Icon picker" }));
  await user.click(screen.getByRole("button", { name: "Guitar" }));
  await user.click(screen.getByRole("button", { name: "Save role" }));
  await waitFor(() => expect(updateTeamRole).toHaveBeenCalledWith("church-1", role.roleId, expect.objectContaining({ icon })));
});

it("shows AV as read-only and creates roles for the editable Worship team", async () => {
  const user = userEvent.setup();
  const avTeam: TeamRecord = { churchId: "church-1", teamId: "team-av", name: "AV", memberIds: [] };
  const avRole: TeamRole = { churchId: "church-1", teamId: avTeam.teamId, roleId: "role-av", name: "Operator" };
  jest.mocked(createTeamRole).mockResolvedValue({
    success: true,
    role: { ...role, roleId: "role-new", name: "New role" },
  } as never);
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.roles]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[avRole, role]} teams={[avTeam, team]} canEditTeam={(teamId) => teamId === team.teamId} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  expect(screen.getByRole("button", { name: "Edit Lead" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit Operator" })).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Create role" })[0]);
  expect(screen.getAllByText("Worship", { exact: true })).not.toHaveLength(0);
  await user.type(screen.getByLabelText(/^Name:?$/), "New role");
  await user.click(screen.getAllByRole("button", { name: "Create role" }).at(-1)!);

  await waitFor(() => expect(createTeamRole).toHaveBeenCalledWith("church-1", expect.objectContaining({ teamId: team.teamId })));
});

it("hides create and edit controls for a roster-only reader", () => {
  const avTeam: TeamRecord = { churchId: "church-1", teamId: "team-av", name: "AV", memberIds: [] };
  const avRole: TeamRole = { churchId: "church-1", teamId: avTeam.teamId, roleId: "role-av", name: "Operator" };
  render(
    <MemoryRouter initialEntries={[TEAMS_SECTION_PATHS.roles]}>
      <GlobalInfoContext.Provider value={{ churchId: "church-1" } as never}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <TeamRoleManager roles={[avRole, role]} teams={[avTeam, team]} canEditTeam={() => false} onSaved={jest.fn()} onArchived={jest.fn()} onRemoved={jest.fn()} />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );

  const list = within(screen.getByTestId("teams-create-panel-list"));
  expect(list.queryByRole("button", { name: "Create role" })).not.toBeInTheDocument();
  expect(list.queryByRole("button", { name: "Edit Lead" })).not.toBeInTheDocument();
  expect(list.queryByRole("button", { name: "Edit Operator" })).not.toBeInTheDocument();
  expect(list.getByText("Lead")).toBeInTheDocument();
  expect(list.getByText("Operator")).toBeInTheDocument();
});
