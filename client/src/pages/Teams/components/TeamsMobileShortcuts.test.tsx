import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { getAvailableTeamsNavSections } from "../teamsNavSections";
import TeamsMobileShortcuts from "./TeamsMobileShortcuts";

let mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: true, canViewServices: true });
jest.mock("../TeamsPageContext", () => ({ useTeamsPage: () => ({ availableNavSections: mockSections }) }));

const renderNavigation = (path = "/teams-and-services/members") => render(
  <MemoryRouter initialEntries={[path]}>
    <TeamsNavigationGuardProvider>
      <TeamsMobileShortcuts secondary />
      <TeamsMobileShortcuts />
    </TeamsNavigationGuardProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: true, canViewServices: true });
});

it("selects the primary group and secondary page on a nested deep link", () => {
  renderNavigation("/teams-and-services/qualifications/area-1");
  const primary = within(screen.getByRole("navigation", { name: "Primary navigation" }));
  expect(primary.getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Services", "Scheduling", "Teams"]);
  expect(primary.getByRole("link", { name: "Teams" })).toHaveAttribute("aria-current", "page");
  expect(primary.getByRole("link", { name: "Teams" })).toHaveAttribute("href", "/teams-and-services/groups");
  expect(screen.getByRole("link", { name: "Qualifications" })).toHaveAttribute("aria-current", "page");
});

it("switches groups and secondary pages immediately", async () => {
  const user = userEvent.setup();
  renderNavigation();
  await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Services" }));
  const secondary = within(screen.getByRole("navigation", { name: "Services pages" }));
  expect(secondary.getAllByRole("link").map((link) => link.textContent)).toEqual(["Services", "Templates", "Equipment", "Service setup"]);
  expect(secondary.getByRole("link", { name: "Services" })).toHaveAttribute("aria-current", "page");
  await user.click(secondary.getByRole("link", { name: "Equipment" }));
  expect(secondary.getByRole("link", { name: "Equipment" })).toHaveAttribute("aria-current", "page");
});

it("preserves scoped availability labels and hides unauthorized shortcuts", async () => {
  mockSections = getAvailableTeamsNavSections({ hasTeamsWorkspaceAccess: true, hasBroadTeamsReadAccess: false, canViewServices: false, canManageTeamAvailability: true });
  renderNavigation("/teams-and-services/forms");
  expect(screen.queryByRole("link", { name: "Services" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Availability" })).toHaveAttribute("aria-current", "page");
});
