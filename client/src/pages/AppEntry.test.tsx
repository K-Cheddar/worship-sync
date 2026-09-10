import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppEntry from "./AppEntry";
import { GlobalInfoContext } from "../context/globalInfo";
import { createMockGlobalContext } from "../test/mocks";
import { usePwaInstallPrompt } from "../hooks/usePwaInstallPrompt";
import { getAppOs } from "../utils/platform";

jest.mock("../utils/devFeatures", () => ({
  isCreateChurchUiEnabled: () => true,
}));

jest.mock("../utils/environment", () => ({
  isElectron: jest.fn(() => false),
}));

jest.mock("../utils/platform", () => ({
  ...jest.requireActual("../utils/platform"),
  getAppOs: jest.fn(() => "windows"),
}));

jest.mock("../utils/githubRelease", () => ({
  getLatestReleaseUrl: jest.fn(
    () => "https://github.com/K-Cheddar/worship-sync/releases/latest",
  ),
  fetchLatestWindowsInstallerUrl: jest.fn(() => Promise.resolve(null)),
  fetchLatestMacInstallerUrl: jest.fn(() => Promise.resolve(null)),
  fetchLatestLinuxInstallerUrl: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../hooks/usePwaInstallPrompt", () => ({
  usePwaInstallPrompt: jest.fn(),
}));

const mockUsePwaInstallPrompt = jest.mocked(usePwaInstallPrompt);
const mockGetAppOs = jest.mocked(getAppOs);

describe("AppEntry", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
      isStandalone: false,
    });
    mockGetAppOs.mockReturnValue("windows");
  });

  it("shows the product landing with a header Sign in action", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("link", { name: /Create church/i })).toHaveAttribute(
      "href",
      "/login?createChurch=1",
    );
    expect(screen.getByRole("link", { name: /^Support$/i })).toHaveAttribute(
      "href",
      "/support",
    );
    expect(
      screen.getByRole("link", { name: /Privacy Policy/i }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      screen.getByRole("link", { name: /Terms of Service/i }),
    ).toHaveAttribute("href", "/terms");

    await user.click(screen.getByRole("button", { name: /open menu/i }));
    expect(
      screen.getByRole("menuitem", { name: /^Install$/i }),
    ).toBeInTheDocument();
  });

  it("keeps the product landing and shows an offline notice near more ways to get started", () => {
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
    expect(within(moreWays).getByText("Could not reach WorshipSync.")).toBeInTheDocument();
    expect(
      within(moreWays).getByText(
        "Sign-in and device linking need a connection. You can still use the offline demo on this device.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Link with code/i }),
    ).toBeDisabled();
    const guestDemo = screen.getByRole("button", { name: /Test as guest/i });
    expect(guestDemo).toBeInTheDocument();
    expect(guestDemo).not.toBeDisabled();

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

  it("explains that a saved session could not be verified when offline", () => {
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

    expect(screen.getByText("Could not verify this device.")).toBeInTheDocument();
    expect(screen.getByText("Reconnect to continue")).toBeInTheDocument();
    expect(
      screen.getByText("This device has a saved sign-in or link."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "WorshipSync can't verify this device with your church right now. You can retry or use the offline demo on this device.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "What you can do" }),
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
