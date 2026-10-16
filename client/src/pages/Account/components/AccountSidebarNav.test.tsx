import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import AccountSidebarNav from "./AccountSidebarNav";

const CurrentPath = () => {
  const { pathname } = useLocation();
  return <output aria-label="Current path">{pathname}</output>;
};

it("keeps all seven administration pages available by one desktop sidebar click", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      {
        path: "/account/*",
        element: (
          <>
            <AccountSidebarNav />
            <CurrentPath />
          </>
        ),
      },
    ],
    { initialEntries: ["/account/people"] },
  );
  render(<RouterProvider router={router} />);

  const navigation = screen.getByRole("navigation", { name: "Church administration sections" });
  expect(within(navigation).getAllByRole("link")).toHaveLength(7);
  expect(within(navigation).getByRole("heading", { name: "Access" })).toBeInTheDocument();
  expect(within(navigation).getByRole("heading", { name: "Service Tools" })).toBeInTheDocument();
  expect(within(navigation).getByRole("heading", { name: "Settings" })).toBeInTheDocument();

  const destinations = [
    ["People", "/account/people"],
    ["Devices & security", "/account/setup"],
    ["Controllers", "/account/controllers"],
    ["Workspace", "/account/workspace"],
    ["Branding", "/account/branding"],
    ["Integrations", "/account/integrations"],
    ["Data export", "/account/data-transfer"],
  ];
  for (const [label, path] of destinations) {
    await user.click(within(navigation).getByRole("link", { name: label }));
    expect(screen.getByLabelText("Current path")).toHaveTextContent(path);
  }
});
