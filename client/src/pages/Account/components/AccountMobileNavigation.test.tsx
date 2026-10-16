import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import type { MenuItemType } from "../../../types";
import AccountMobileNavigation from "./AccountMobileNavigation";

const CurrentPath = () => {
  const { pathname } = useLocation();
  return <output aria-label="Current path">{pathname}</output>;
};

const menuItems: MenuItemType[] = [
  { text: "Home", to: "/home" },
  { text: "What's New", to: "/whats-new" },
  { text: "About", to: "/about" },
  { text: "Interface zoom", element: <button>Zoom controls</button>, preventClose: true },
];

it("keeps universal destinations and all grouped administration pages in the mobile menu", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <>
            <AccountMobileNavigation menuItems={menuItems} />
            <CurrentPath />
          </>
        ),
      },
    ],
    { initialEntries: ["/account/people"] },
  );
  render(<RouterProvider router={router} />);

  await user.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = screen.getByRole("dialog");
  for (const label of ["Home", "What's New", "About", "Access", "Service Tools", "Settings"]) {
    expect(within(drawer).getByText(label)).toBeInTheDocument();
  }
  for (const label of ["People", "Devices & security", "Controllers", "Workspace", "Branding", "Integrations", "Data export"]) {
    expect(within(drawer).getByRole("link", { name: label })).toBeInTheDocument();
  }
  expect(within(drawer).getByText("Interface zoom")).toBeInTheDocument();

  await user.click(within(drawer).getByRole("link", { name: "About" }));
  expect(screen.getByLabelText("Current path")).toHaveTextContent("/about");
});
