import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { getAvailableTeamsNavSections } from "../teamsNavSections";
import TeamsMobileShortcuts from "./TeamsMobileShortcuts";

let mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: true, canViewServices: true });
jest.mock("../TeamsPageContext", () => ({ useTeamsPage: () => ({ availableNavSections: mockSections }) }));

const renderNavigation = (path = "/teams-and-services/members") => render(
  <MemoryRouter initialEntries={[path]}>
    <TeamsNavigationGuardProvider>
      <CurrentPath />
      <TeamsMobileShortcuts secondary />
      <TeamsMobileShortcuts />
    </TeamsNavigationGuardProvider>
  </MemoryRouter>,
);

const CurrentPath = () => {
  const location = useLocation();
  return <span data-testid="current-path">{location.pathname}</span>;
};

beforeEach(() => {
  mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: true, canViewServices: true });
});

it("selects the primary group and secondary page on a nested deep link", () => {
  renderNavigation("/teams-and-services/qualifications/area-1");
  const primary = within(screen.getByRole("navigation", { name: "Primary navigation" }));
  expect(primary.getAllByRole("link").map((link) => link.textContent)).toEqual(["Services", "Scheduling", "Teams"]);
  expect(primary.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  expect(primary.getByRole("link", { name: "Teams" })).toHaveAttribute("aria-current", "page");
  expect(primary.getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/teams-and-services/groups");
  expect(screen.getByRole("tab", { name: "Qualifications" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tablist", { name: "Teams pages" })).toHaveAttribute("data-variant", "navigation");
  expect(screen.getByRole("tabpanel")).toHaveClass("flex", "flex-col", "flex-1", "min-h-0");
});

it("switches groups and secondary pages immediately", async () => {
  const user = userEvent.setup();
  renderNavigation();
  await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Services" }));
  const secondary = within(screen.getByRole("navigation", { name: "Services pages" }));
  expect(secondary.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Services", "Templates", "Equipment", "Service setup"]);
  expect(secondary.getByRole("tab", { name: "Services" })).toHaveAttribute("aria-selected", "true");
  await user.click(secondary.getByRole("tab", { name: "Equipment" }));
  expect(secondary.getByRole("tab", { name: "Equipment" })).toHaveAttribute("aria-selected", "true");
  expect(secondary.getByRole("tab", { name: "Equipment" })).toHaveAttribute("data-state", "active");
});

it("supports keyboard tab navigation and follows the selected route", async () => {
  const user = userEvent.setup();
  renderNavigation("/teams-and-services/services");
  const servicesTab = screen.getByRole("tab", { name: "Services" });
  await user.click(servicesTab);
  await user.keyboard("{ArrowRight}");

  expect(screen.getByRole("tab", { name: "Templates" })).toHaveAttribute("aria-selected", "true");
  await waitFor(() => {
    expect(screen.getByTestId("current-path")).toHaveTextContent("/teams-and-services/templates");
  });
});

it("selects Services for Equipment and keeps all primary items the same size", () => {
  renderNavigation("/teams-and-services/microphones");
  const primary = within(screen.getByRole("navigation", { name: "Primary navigation" }));
  const links = primary.getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual(["Services", "Scheduling", "Teams"]);
  expect(primary.getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("tab", { name: "Equipment" })).toHaveAttribute("aria-selected", "true");

  for (const link of links) {
    expect(link).toHaveClass("h-14", "flex-1");
  }
  const selectedIconPill = within(primary.getByRole("link", { name: "Services" })).getByTestId("teams-primary-navigation-icon-pill");
  const inactiveIcon = within(primary.getByRole("link", { name: "Teams" })).getByTestId("teams-primary-navigation-icon-pill");
  expect(selectedIconPill).toHaveClass("rounded-full", "bg-cyan-500/15");
  expect(selectedIconPill).toHaveClass("text-cyan-300");
  expect(inactiveIcon).not.toHaveClass("bg-cyan-500/15");
  expect(inactiveIcon).toHaveClass("text-gray-400");
  expect(primary.getByRole("link", { name: "Services" })).not.toHaveClass("border-cyan-400/40");
  expect(primary.getByRole("link", { name: "Services" })).toHaveClass("font-semibold", "text-cyan-300");
});

it("preserves scoped availability labels and hides unauthorized shortcuts", async () => {
  mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: false, canViewServices: false, canManageTeamAvailability: true });
  renderNavigation("/teams-and-services/forms");
  expect(screen.queryByRole("link", { name: "Services" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Availability" })).toHaveAttribute("aria-selected", "true");
});
