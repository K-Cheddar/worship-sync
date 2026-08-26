import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamsSidebarNav from "./TeamsSidebarNav";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";

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
  it("shows service and team sections without descriptions when expanded", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Assign people to services by position/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Plans$/i })).toBeInTheDocument();
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

    expect(screen.getByRole("link", { name: /^Plans$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Services$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Teams$/i)).not.toBeInTheDocument();
  });

  it("calls onNavigate for section links", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    renderSidebar("/teams-and-services/schedules", false, onNavigate);

    await user.click(screen.getByRole("link", { name: /^Microphones$/i }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
