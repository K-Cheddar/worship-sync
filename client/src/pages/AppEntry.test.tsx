import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppEntry from "./AppEntry";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";

describe("AppEntry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the product landing with a header Sign in action", () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "online",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Keep every part of worship in sync",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you can do" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Live presentation")).toBeInTheDocument();
    expect(screen.getByText("Teams and scheduling")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.getByRole("button", { name: /Test as guest/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Link with code/i }),
    ).toBeInTheDocument();
  });

  it("keeps the product landing and puts a compact offline notice near more ways to get started", () => {
    const refreshAuthBootstrap = jest.fn();
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "offline",
            refreshAuthBootstrap,
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Keep every part of worship in sync",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you can do" }),
    ).toBeInTheDocument();

    const moreWays = screen.getByRole("region", {
      name: "More ways to get started",
    });
    expect(
      within(moreWays).getByText(
        "Could not reach WorshipSync. Sign-in needs a connection.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Link with code/i }),
    ).toBeDisabled();
    const guestDemo = screen.getByRole("button", { name: /Test as guest/i });
    expect(guestDemo).toBeInTheDocument();
    expect(guestDemo).not.toBeDisabled();
    expect(
      screen.getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("link", { name: /Terms of Service/i }),
    ).toHaveAttribute("href", "/terms");

    fireEvent.click(within(moreWays).getByRole("button", { name: "Try again" }));

    expect(refreshAuthBootstrap).toHaveBeenCalledTimes(1);
  });

  it("shows loading state while retrying offline reconnect", async () => {
    let resolveRefresh: (() => void) | null = null;
    const refreshAuthBootstrap = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "offline",
            refreshAuthBootstrap,
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    const tryAgainButton = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(tryAgainButton);

    expect(refreshAuthBootstrap).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Trying again..." }),
    ).toBeDisabled();

    await act(async () => {
      resolveRefresh?.();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    });
  });

  it("keeps the product landing when a saved session cannot be verified offline", () => {
    localStorage.setItem("loggedIn", "true");

    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            loginState: "idle",
            sessionKind: null,
            authServerStatus: "offline",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(
      screen.getByRole("heading", {
        name: "Keep every part of worship in sync",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you can do" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Reconnect to continue"),
    ).not.toBeInTheDocument();

    const moreWays = screen.getByRole("region", {
      name: "More ways to get started",
    });
    expect(
      within(moreWays).getByText(
        "Could not verify this device. Retry or use the offline demo.",
      ),
    ).toBeInTheDocument();
  });

  it("redirects shared workstation from root to /home (matches human Home navigation)", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          createMockGlobalContext({
            sessionKind: "workstation",
            operatorName: "Alex",
          }) as any
        }
      >
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<AppEntry />} />
            <Route
              path="/home"
              element={<div data-testid="home-hub">Home hub</div>}
            />
            <Route
              path="/controller"
              element={<div data-testid="controller">Controller</div>}
            />
          </Routes>
        </MemoryRouter>
      </GlobalInfoContext.Provider>,
    );

    expect(await screen.findByTestId("home-hub")).toBeInTheDocument();
    expect(screen.queryByTestId("controller")).not.toBeInTheDocument();
  });
});
