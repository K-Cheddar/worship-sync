import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamsSidebarNav from "./TeamsSidebarNav";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";

const renderSidebar = (
  initialEntry = "/teams-and-services/schedules",
  collapsed = false,
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TeamsNavigationGuardProvider>
        <Routes>
          <Route
            path="/teams-and-services/*"
            element={<TeamsSidebarNav collapsed={collapsed} />}
          />
        </Routes>
      </TeamsNavigationGuardProvider>
    </MemoryRouter>,
  );

describe("TeamsSidebarNav", () => {
  it("shows section labels and descriptions when expanded", () => {
    renderSidebar();

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      screen.getByText(/Assign people to services by position/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teams" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Services" })).toBeInTheDocument();
  });

  it("collapses to icon-only links while keeping accessible names", () => {
    renderSidebar("/teams-and-services/schedules", true);

    expect(screen.getByRole("link", { name: /^Schedules$/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Assign people to services by position/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Schedules$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Teams" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Services" })).toBeInTheDocument();
  });

  it("switches domains from the collapsed icon tabs", async () => {
    const user = userEvent.setup();
    renderSidebar("/teams-and-services/schedules", true);

    await user.click(screen.getByRole("tab", { name: "Services" }));

    expect(
      await screen.findByRole("link", { name: /^Plans$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Schedules$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Services" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
