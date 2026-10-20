import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import HomeToolbarMenu from "./HomeToolbarMenu";
import { GlobalInfoContext } from "../../context/globalInfo";

jest.mock("../../hooks/useAboutChangelogMenu", () => ({
  useAboutChangelogMenu: () => ({
    aboutChangelogMenuItems: [],
    aboutChangelogModals: null,
    updateReadyVersion: "",
  }),
}));
jest.mock("../../hooks/useInterfaceZoom", () => ({ useInterfaceZoom: () => ({}) }));

const LocationPath = () => <output data-testid="current-path">{useLocation().pathname}</output>;

const openHome = async (session: Record<string, unknown>) => {
  render(
    <MemoryRouter initialEntries={["/controller"]}>
      <GlobalInfoContext.Provider value={session as never}>
        <HomeToolbarMenu />
        <Routes>
          <Route path="/" element={<main>Public entry</main>} />
          <Route path="/home" element={<main>Home launcher</main>} />
          <Route path="/controller" element={<main>Controller</main>} />
        </Routes>
        <LocationPath />
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  await user.click(await screen.findByRole("menuitem", { name: /Home/ }));
};

describe("Home toolbar navigation", () => {
  it.each([
    ["human", { loginState: "success", sessionKind: "human" }],
    ["workstation", { loginState: "success", sessionKind: "workstation" }],
    ["guest", { loginState: "guest", sessionKind: null }],
  ])("opens Home directly for %s sessions", async (_kind, session) => {
    await openHome(session);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/home");
    expect(screen.getByText("Home launcher")).toBeInTheDocument();
    expect(screen.queryByText("Public entry")).not.toBeInTheDocument();
  });

  it.each([
    ["public", { loginState: "idle", sessionKind: null }],
    ["display", { loginState: "success", sessionKind: "display" }],
  ])("keeps the public entry route for %s sessions", async (_kind, session) => {
    await openHome(session);
    expect(screen.getByTestId("current-path")).toHaveTextContent("/");
    expect(screen.getByText("Public entry")).toBeInTheDocument();
  });
});
