import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import AccountMobileShortcuts from "./AccountMobileShortcuts";
import { PendingRouteNavigationProvider, PendingRouteReady } from "../../../hooks/usePendingRouteNavigation";

const CurrentPath = () => {
  const { pathname } = useLocation();
  return <output aria-label="Current path">{pathname}</output>;
};

const ReadyAtCurrentRoute = () => {
  const { pathname } = useLocation();
  return <PendingRouteReady routePath={pathname} />;
};

const renderAt = (path: string) => {
  const router = createMemoryRouter(
    [
      {
        path: "/account/*",
        element: (
          <PendingRouteNavigationProvider>
            <AccountMobileShortcuts>
              <main>Page content</main>
              <ReadyAtCurrentRoute />
              <CurrentPath />
            </AccountMobileShortcuts>
          </PendingRouteNavigationProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe("Account mobile navigation", () => {
  it("shows exactly the three primary destinations and selects the active nested group", () => {
    renderAt("/account/workspace");

    const primary = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    expect(primary.getAllByRole("link")).toHaveLength(3);
    expect(primary.getByRole("link", { name: "Service Tools" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Service Tools pages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens each group's default page and routes secondary tabs with browser history support", async () => {
    const user = userEvent.setup();
    const utils = renderAt("/account/people");

    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Service Tools" }));
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/account/controllers");

    await user.click(screen.getByRole("tab", { name: "Workspace" }));
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/account/workspace");
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      await utils.navigate(-1);
    });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/account/controllers");
    expect(screen.getByRole("tab", { name: "Controllers" })).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      await utils.navigate(1);
    });
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/account/workspace");
    expect(screen.getByRole("tab", { name: "Workspace" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the selected route tab visible when opened from a direct deep link", () => {
    renderAt("/account/data-transfer");

    expect(screen.getByRole("navigation", { name: "Settings pages" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data export" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });
});

