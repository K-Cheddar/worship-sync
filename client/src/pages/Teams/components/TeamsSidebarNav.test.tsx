import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamsSidebarNav from "./TeamsSidebarNav";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { getAvailableTeamsNavSections } from "../teamsNavSections";

let mockAvailableNavSections = getAvailableTeamsNavSections({
  hasTeamsWorkspaceAccess: true,
  hasBroadTeamsReadAccess: true,
  canViewServices: true,
});

jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => ({ availableNavSections: mockAvailableNavSections }),
}));

const renderSidebar = (
  initialEntry = "/teams-and-services/schedules",
  collapsed = false,
  onNavigate?: () => void,
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TeamsNavigationGuardProvider>
        <Routes>
          <Route
            path="/teams-and-services/*"
            element={
              <TeamsSidebarNav collapsed={collapsed} onNavigate={onNavigate} />
            }
          />
        </Routes>
      </TeamsNavigationGuardProvider>
    </MemoryRouter>,
  );

describe("TeamsSidebarNav", () => {
  beforeEach(() => {
    mockAvailableNavSections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: true,
      canViewServices: true,
    });
  });

  it("shows service and team sections without descriptions when expanded", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Assign people to services by position/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Services$/i })).toBeInTheDocument();
  });

  it("collapses to icon-only links while keeping accessible names", () => {
    renderSidebar("/teams-and-services/schedules", true);

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Assign people to services by position/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Schedules$/i)).not.toBeInTheDocument();
  });

  it("shows both navigation groups in the collapsed icon rail", () => {
    renderSidebar("/teams-and-services/schedules", true);

    expect(screen.getByRole("link", { name: /^Services$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Services$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Teams$/i)).not.toBeInTheDocument();
  });

  it("calls onNavigate for section links", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    renderSidebar("/teams-and-services/schedules", false, onNavigate);

    await user.click(screen.getByRole("link", { name: /^Equipment$/i }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("uses the safe membership-only section set", () => {
    mockAvailableNavSections = getAvailableTeamsNavSections({
      hasTeamsWorkspaceAccess: true,
      hasBroadTeamsReadAccess: false,
      canViewServices: false,
    });
    renderSidebar();

    expect(screen.getByRole("link", { name: "Schedules" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Forms" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Services" })).not.toBeInTheDocument();
  });
});
