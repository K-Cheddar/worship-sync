import { act, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { ReactElement } from "react";
import Home from "../Home";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import { usePwaInstallPrompt } from "../../hooks/usePwaInstallPrompt";
import { getAppOs } from "../../utils/platform";
import {
  controllerProfilesSlice,
  reorderControllerProfiles,
  setControllerProfilesForChurch,
} from "../../store/controllerProfilesSlice";
import { displayOutputsSlice, setDisplayOutputsForChurch } from "../../store/displayOutputsSlice";
import { getDefaultControllerProfiles } from "../../utils/controllerProfiles";
import { getDefaultDisplayOutputs } from "../../utils/displayOutputs";
import { readHomeNavigationMetadata, writeHomeNavigationMetadata } from "../home/homeNavigationCache";

jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => (
  <div>User</div>
));

jest.mock("../../utils/environment", () => ({
  ...jest.requireActual("../../utils/environment"),
  isElectron: jest.fn(() => false),
  getApiBasePath: jest.fn(() => "/"),
}));

// Home reads the OS through the platform capability layer. `isMobileBrowser` /
// `isIosBrowser` stay real so the user-agent set by each test still drives them.
jest.mock("../../utils/platform", () => ({
  ...jest.requireActual("../../utils/platform"),
  getAppOs: jest.fn(() => "windows"),
}));

jest.mock("../../utils/githubRelease", () => ({
  getLatestReleaseUrl: jest.fn(
    () => "https://github.com/K-Cheddar/worship-sync/releases/latest",
  ),
  fetchLatestWindowsInstallerUrl: jest.fn(() => Promise.resolve(null)),
  fetchLatestMacInstallerUrl: jest.fn(() => Promise.resolve(null)),
  fetchLatestLinuxInstallerUrl: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../../hooks/usePwaInstallPrompt", () => ({
  usePwaInstallPrompt: jest.fn(),
}));

const mockUsePwaInstallPrompt = jest.mocked(usePwaInstallPrompt);
const mockGetAppOs = jest.mocked(getAppOs);
const originalUserAgent = window.navigator.userAgent;

type HomeStoreOptions = {
  profiles?: ReturnType<typeof getDefaultControllerProfiles>;
  profilesLoaded?: boolean;
  displayOutputs?: ReturnType<typeof getDefaultDisplayOutputs>;
  displayOutputsLoaded?: boolean;
};

const createHomeStore = (options: HomeStoreOptions = {}) =>
  configureStore({
    reducer: {
      controllerProfiles: controllerProfilesSlice.reducer,
      displayOutputs: displayOutputsSlice.reducer,
    },
    preloadedState: {
      controllerProfiles: {
        list: options.profiles ?? getDefaultControllerProfiles(),
        isLoaded: options.profilesLoaded ?? true,
        syncedChurchId: options.profilesLoaded === false ? null : "church-1",
      },
      displayOutputs: {
        list: options.displayOutputs ?? getDefaultDisplayOutputs(),
        isLoaded: options.displayOutputsLoaded ?? true,
        syncedChurchId: options.displayOutputsLoaded === false ? null : "church-1",
      },
    },
  });

const render = (
  ui: ReactElement,
  options: HomeStoreOptions = {},
) => {
  const store = createHomeStore(options);
  const wrap = (node: ReactElement) => (
    <Provider store={store}>{node}</Provider>
  );
  const view = rtlRender(wrap(ui));
  return {
    store,
    ...view,
    rerender: (node: ReactElement) => view.rerender(wrap(node)),
  };
};

const openHomeHubMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open menu/i }));
};

/** Radix submenu clicks are unreliable with user-event in JSDOM; use native click events. */
const fireClickInstallSubmenuItem = (label: RegExp) => {
  fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
};

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
};

describe("Home", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(originalUserAgent);
    // Reset alongside the user agent; the iPad case sets it and it would
    // otherwise leak into later tests as a false iPadOS signal.
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
      isStandalone: false,
    });
    mockGetAppOs.mockReturnValue("windows");
  });

  it("uses the same two, three, and four column grid across launcher sections", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    const grids = screen.getAllByRole("group", { name: /navigation$/i });
    expect(grids.length).toBeGreaterThanOrEqual(3);
    for (const grid of grids) {
      expect(grid).toHaveClass("grid-cols-2", "md:grid-cols-3", "lg:grid-cols-4");
      expect(grid.className).not.toMatch(/(?:xl|2xl):grid-cols-5/);
    }
  });

  it("hydrates cached controller labels without making cached-only routes actionable", () => {
    writeHomeNavigationMetadata({
      churchId: "church-1",
      controllers: [
        { id: "presentation", name: "Text Master", icon: "captions", iconColor: "teal", order: 0 },
        { id: "ctrl_lobby", name: "Lobby Screen", icon: "monitor", iconColor: "cyan", order: 2 },
      ],
      displays: [],
    });
    const { store } = render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profilesLoaded: false, displayOutputsLoaded: false },
    );

    expect(screen.getByText("Text Master")).toBeInTheDocument();
    expect(screen.getByText("Lobby Screen")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Text Master" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Lobby Screen" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Controllers" })).toHaveAttribute("aria-busy", "true");
    expect(store.getState().controllerProfiles.isLoaded).toBe(false);
  });

  it("does not show another church's cached navigation during a church change", () => {
    writeHomeNavigationMetadata({
      churchId: "church-1",
      controllers: [
        { id: "ctrl_lobby", name: "Church One Lobby", icon: "monitor", iconColor: "cyan", order: 2 },
      ],
      displays: [],
    });
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext({ churchId: "church-2" }) as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profilesLoaded: false, displayOutputsLoaded: false },
    );

    expect(screen.queryByText("Church One Lobby")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ctrl_lobby/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading controller settings" })).toBeInTheDocument();
  });

  it("does not show another church's live registry while the new church is syncing", async () => {
    const profiles = getDefaultControllerProfiles().map((profile) =>
      profile.id === "presentation" ? { ...profile, name: "Church One Slides" } : profile,
    );
    const outputs = getDefaultDisplayOutputs().map((output) =>
      output.id === "projector" ? { ...output, name: "Church One Projector" } : output,
    );
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext({ churchId: "church-2" }) as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profiles, displayOutputs: outputs },
    );

    expect(screen.queryByText("Church One Slides")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Church One Slides" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading controller settings" })).toBeInTheDocument();

    await userEvent.click(screen.getByText("Display outputs"));
    expect(screen.getByText("Loading this church's displays...")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Church One Projector" })).not.toBeInTheDocument();
  });

  it("replaces cached controller metadata with remote names and removes retired entries", () => {
    writeHomeNavigationMetadata({
      churchId: "church-1",
      controllers: [
        { id: "presentation", name: "Text Master", icon: "captions", iconColor: "teal", order: 0 },
        { id: "overlay", name: "Old Overlay", icon: "layers", iconColor: "purple", order: 1 },
        { id: "ctrl_lobby", name: "Lobby Screen", icon: "monitor", iconColor: "cyan", order: 2 },
      ],
      displays: [],
    });
    const defaults = getDefaultControllerProfiles();
    const { store } = render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profilesLoaded: false, displayOutputsLoaded: false },
    );

    expect(screen.getByText("Lobby Screen")).toBeInTheDocument();
    act(() => {
      store.dispatch(setControllerProfilesForChurch({
        churchId: "church-1",
        data: [
          { ...defaults[0], name: "Sunday Slides", icon: "presentation", iconColor: "orange", order: 0 },
          { ...defaults[1], enabled: false, order: 1 },
        ],
      }));
      store.dispatch(setDisplayOutputsForChurch({
        churchId: "church-1",
        data: getDefaultDisplayOutputs(),
      }));
    });

    expect(screen.getByRole("link", { name: "Sunday Slides" })).toHaveAttribute("href", "/controller");
    expect(screen.queryByText("Lobby Screen")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Old Overlay" })).not.toBeInTheDocument();
    expect(readHomeNavigationMetadata("church-1")?.controllers).toEqual([
      expect.objectContaining({ id: "presentation", name: "Sunday Slides", iconColor: "orange" }),
    ]);
  });

  it("follows configured controller order and hides disabled auxiliary controllers", () => {
    const lobby = {
      id: "ctrl_lobby",
      type: "aux-presentation" as const,
      name: "Lobby",
      description: "",
      order: 2,
      enabled: true,
      outputIds: [],
      outputsConfigured: true,
      defaultSendOutputIds: [],
      outlineScope: "ctrl_lobby",
    };
    const disabled = { ...lobby, id: "ctrl_disabled", name: "Disabled", enabled: false, outlineScope: "ctrl_disabled" };
    const { store } = render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profiles: [...getDefaultControllerProfiles(), lobby, disabled] },
    );
    act(() => store.dispatch(reorderControllerProfiles(["ctrl_lobby", "overlay", "presentation"])));

    const controllerGrid = screen.getByRole("group", { name: "Controllers navigation" });
    const hrefs = within(controllerGrid).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs.slice(0, 3)).toEqual([
      "/aux-controller/ctrl_lobby",
      "/overlay-controller",
      "/controller",
    ]);
    expect(screen.getByRole("link", { name: "Lobby" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Disabled" })).not.toBeInTheDocument();
  });

  it("opens and copies canonical display URLs with the configured output id", async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const outputs = getDefaultDisplayOutputs()
      .filter((output) => output.id !== "projector")
      .concat({
        ...getDefaultDisplayOutputs()[0],
        id: "out_sanctuary",
        name: "Sanctuary",
        order: 0,
      });
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider value={createMockControllerContext() as any}>
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { displayOutputs: outputs },
    );

    expect(screen.getByTestId("display-outputs-details")).not.toHaveAttribute("open");
    await user.click(screen.getByText("Display outputs"));
    expect(screen.getByTestId("display-outputs-details")).toHaveAttribute("open", "");
    expect(screen.getByRole("link", { name: "Open Sanctuary" })).toHaveAttribute("href", "/projector?output=out_sanctuary");
    expect(screen.getByRole("link", { name: "Open Sanctuary (browser source)" })).toHaveAttribute("href", "/projector-full?output=out_sanctuary");
    expect(screen.getByRole("link", { name: "Open Stream" })).toHaveAttribute("href", "/stream?output=stream");
    await user.click(screen.getByRole("button", { name: "Copy Sanctuary link" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("#/projector?output=out_sanctuary"));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied for Sanctuary.");
    expect(screen.getByRole("button", { name: "Copied Sanctuary link" })).toHaveClass("text-emerald-300");
    await user.click(screen.getByRole("button", { name: "Copy Sanctuary (browser source) link" }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("#/projector-full?output=out_sanctuary"));
  });

  it("shows the compact launcher, preserves destinations, and keeps installation available", async () => {
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /Controllers/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Present slides and media, manage overlays/)).not.toBeInTheDocument();
    expect(screen.queryByAltText("WorshipSync")).not.toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /^Presentation$/i }),
    ).toHaveAttribute("href", "/controller");
    expect(
      screen.getByRole("link", { name: /^Overlays$/i }),
    ).toHaveAttribute("href", "/overlay-controller");
    expect(
      screen.getByRole("link", { name: /Service Workspace/i }),
    ).toHaveAttribute("href", "/current-service");
    expect(
      screen.getByRole("link", { name: /^Credits Editor$/ }),
    ).toHaveAttribute("href", "/credits-editor");
    expect(
      screen.getByRole("link", { name: /Board moderation/i }),
    ).toHaveAttribute("href", "/boards/controller");
    expect(
      screen.getByRole("link", { name: /^Teams and Services$/i }),
    ).toHaveAttribute("href", "/teams-and-services");

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

    expect(
      screen.getByText(
        /Fullscreen in the browser/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Browser sources \(streaming\)/i,
        hidden: true,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Display outputs")).toBeInTheDocument();

    await openHomeHubMenu(user);
    fireClickInstallSubmenuItem(/Download Windows app/i);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      await screen.findByText(/Download for Windows/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your download should begin automatically/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /release page/i })).toHaveAttribute(
      "href",
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
    );
    expect(
      screen.getByRole("button", { name: /Download again/i }),
    ).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it.each(["none", "view", "music", "full"] as const)(
    "gives a %s Controller human without normal Teams access a My teams entry",
    (access) => {
      render(
        <MemoryRouter initialEntries={["/home"]}>
          <GlobalInfoContext.Provider
            value={
              createMockGlobalContext({
                access,
                role: "member",
                permissions: {
                  teams: "none",
                  services: "none",
                  teamScopes: {},
                },
                canViewTeams: false,
                canViewServices: false,
                canEditTeams: false,
                canEditServices: false,
              }) as any
            }
          >
            <ControllerInfoContext.Provider
              value={createMockControllerContext() as any}
            >
              <Home />
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </MemoryRouter>,
      );

      expect(screen.getByRole("link", { name: /My teams/ })).toHaveAttribute(
        "href",
        "/teams-and-services",
      );
      expect(
        screen.queryByRole("link", { name: /^Teams and Services$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("View your team rosters, positions, and schedules."),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps Controller None Home free of operator cards", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              access: "none",
              role: "member",
              permissions: { teams: "none", services: "none", teamScopes: {} },
              canViewTeams: false,
              canViewServices: false,
              canEditTeams: false,
              canEditServices: false,
            }) as any
          }
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("heading", { name: "Church administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Resources/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Service Workspace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Presentation/ })).not.toBeInTheDocument();
  });

  it("keeps the existing Teams entry without a duplicate My teams card", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ canViewTeams: true }) as any}
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /^Teams and Services$/i })).toHaveAttribute(
      "href",
      "/teams-and-services",
    );
    expect(screen.queryByRole("link", { name: /My teams/ })).not.toBeInTheDocument();
  });

  it("shows a pending state on a home card before navigation completes", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    const overlayLink = screen.getByRole("link", {
      name: /^Overlays$/i,
    });
    // Button omits aria-busy when idle (`isLoading || undefined`).
    expect(overlayLink).not.toHaveAttribute("aria-busy");

    await user.click(overlayLink);

    expect(overlayLink).toHaveAttribute("aria-busy", "true");
    expect(overlayLink).toHaveClass("ring-2", "ring-cyan-400/30");
  });

  it("offers install app and desktop download from the menu when both are available", async () => {
    const user = userEvent.setup();
    const installPwa = jest.fn().mockResolvedValue(undefined);
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: true,
      installPwa,
      isStandalone: false,
    });
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    expect(
      screen.getByRole("menuitem", { name: /^Install app$/i }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("menuitem", { name: /Download Windows app/i }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      screen.getByRole("dialog", { name: /Download for Windows/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await openHomeHubMenu(user);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install app$/i }));
    expect(installPwa).toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("hides board moderation when the user is not logged in", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ loginState: "guest" }) as any}
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: /Board moderation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Credits Editor$/ }),
    ).toHaveAttribute("href", "/credits-editor");
  });

  it("shows an offline demo hub with locked sign-in previews for guests", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ loginState: "guest" }) as any}
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /Offline demo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Presentation$/i }),
    ).toHaveAttribute("href", "/controller");
    expect(
      screen.getByRole("link", { name: /^Overlays$/i }),
    ).toHaveAttribute("href", "/overlay-controller");
    expect(
      screen.getByRole("heading", { name: /Available after sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Sign in to show display links/),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Teams and Services\. Sign in required\./i,
      }),
    );
    const signInDialog = screen.getByRole("dialog", {
      name: /Sign in required/i,
    });
    expect(signInDialog).toBeInTheDocument();
    expect(
      within(signInDialog).getByText(
        /Teams and Services needs a church account\. Sign in to continue\./i,
      ),
    ).toBeInTheDocument();
    expect(
      within(signInDialog).getByRole("link", { name: /^Sign in$/i }),
    ).toHaveAttribute("href", "/login");
  });

  it("hides the personal schedule from shared workstations", () => {
    const provider = createMockGlobalContext({
      loginState: "success",
      sessionKind: "workstation",
      permissions: { teams: "none", services: "view" },
      canViewTeams: false,
      canEditTeams: false,
      canEditServices: false,
      canViewServices: true,
    });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={provider as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: /My schedule/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Service Workspace/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Current Service Viewer/i }),
    ).toHaveAttribute("href", "/current-service/view");
  });

  it("shows Service Workspace on booth workstations with Teams view", () => {
    const provider = createMockGlobalContext({
      loginState: "success",
      sessionKind: "workstation",
      permissions: { teams: "view", services: "edit" },
      canViewTeams: true,
      canEditTeams: false,
      canEditServices: true,
      canViewServices: true,
    });

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={provider as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: /Service Workspace/i }),
    ).toHaveAttribute("href", "/current-service");
  });

  it("places Service Workspace beside My schedule, not under Controllers", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    const scheduleLink = screen.getByRole("link", { name: /My schedule/i });
    const workspaceLink = screen.getByRole("link", {
      name: /Service Workspace/i,
    });
    const controllersHeading = screen.getByRole("heading", {
      name: /Controllers/i,
    });

    expect(scheduleLink.compareDocumentPosition(workspaceLink)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(workspaceLink.compareDocumentPosition(controllersHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows configured controller names, icons, and colors on the home card", () => {
    const profiles = getDefaultControllerProfiles().map((profile) =>
      profile.id === "presentation"
        ? {
          ...profile,
          name: "Text Master",
          description: "Run slides for the sanctuary.",
          icon: "captions" as const,
          iconColor: "teal" as const,
        }
        : profile,
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profiles },
    );

    expect(
      screen.getByRole("link", {
        name: "Text Master",
      }),
    ).toHaveAttribute("href", "/controller");
    expect(
      within(screen.getByRole("link", { name: "Text Master" })).getByTestId("home-navigation-icon"),
    ).toHaveClass("text-teal-300");
    expect(screen.queryByText("Run slides for the sanctuary.")).not.toBeInTheDocument();
  });

  it("hides built-in controllers that are switched off in Controllers admin", () => {
    const profiles = getDefaultControllerProfiles().map((profile) =>
      profile.id === "presentation" || profile.id === "overlay"
        ? { ...profile, enabled: false }
        : profile,
    );

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
      { profiles },
    );

    expect(
      screen.queryByRole("link", { name: /^Presentation$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Overlays$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Credits Editor$/ }),
    ).toHaveAttribute("href", "/credits-editor");
  });

  it("hides board moderation and display outputs for view access", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              loginState: "success",
              access: "view",
            }) as any
          }
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("link", { name: /Board moderation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Display outputs"),
    ).not.toBeInTheDocument();
    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
    expect(
      screen.getByRole("link", { name: /^Credits Editor$/ }),
    ).toHaveAttribute("href", "/credits-editor");
  });

  it("shows only presentation controller for music access", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={
            createMockGlobalContext({
              loginState: "success",
              access: "music",
            }) as any
          }
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: /^Presentation$/i }),
    ).toHaveAttribute("href", "/controller");
    expect(
      screen.queryByRole("link", { name: /^Overlays$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Credits Editor$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Board moderation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Display outputs"),
    ).not.toBeInTheDocument();

    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
  });

  it("hides display output links when the user is not logged in and explains why", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider
          value={createMockGlobalContext({ loginState: "idle" }) as any}
        >
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    // The unauthenticated state has a short sign-in explanation, not routes.
    expect(screen.queryByTestId("display-outputs-details")).not.toBeInTheDocument();
    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
    expect(
      screen.getByText("Sign in to show display links."),
    ).toBeInTheDocument();
  });

  it("offers Mac DMG download in the popover when on macOS", async () => {
    mockGetAppOs.mockReturnValue("mac");
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireClickInstallSubmenuItem(/Download Mac app/i);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(await screen.findByText(/Download for Mac/)).toBeInTheDocument();
    expect(
      screen.getByText(/Mac disk image.*\.dmg/i),
    ).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("offers Linux desktop download in the popover when on Linux", async () => {
    mockGetAppOs.mockReturnValue("linux");
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireClickInstallSubmenuItem(/Download Linux app/i);
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(await screen.findByText(/Download for Linux/)).toBeInTheDocument();
    expect(screen.getByText(/Linux AppImage or \.deb/i)).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("shows iOS Safari install instructions when prompt event is unavailable on mobile", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1");
    mockGetAppOs.mockReturnValue("ios");
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Install WorshipSync/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/On iPhone and iPad, open Safari's Share menu/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
  });

  it("tells iOS Chrome users to open Safari for Add to Home Screen", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
    );
    mockGetAppOs.mockReturnValue("ios");
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Install WorshipSync/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Add to Home Screen only works in Safari/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Open this site in Safari/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/On iPhone and iPad, open Safari's Share menu/i),
    ).not.toBeInTheDocument();
  });

  it("offers iPad the mobile install path, not a Mac installer", async () => {
    // iPadOS 13+ reports a desktop "Macintosh" user agent; before the platform
    // layer resolved ios ahead of mac, iPads were offered a Mac DMG.
    setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    );
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      value: 5,
    });
    mockGetAppOs.mockReturnValue("ios");
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: /Download Mac app/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    expect(
      await screen.findByRole("dialog", { name: /Install WorshipSync/i }),
    ).toBeInTheDocument();
  });

  it("uses beforeinstallprompt install flow on mobile when available", async () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36");
    mockGetAppOs.mockReturnValue("android");
    let canShowInstall = true;
    const installPwa = jest.fn().mockImplementation(async () => {
      canShowInstall = false;
    });
    mockUsePwaInstallPrompt.mockImplementation(() => ({
      canShowInstall,
      installPwa,
      isStandalone: false,
    }));
    const user = userEvent.setup();

    const { rerender } = render(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await openHomeHubMenu(user);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Install$/i }));
    expect(installPwa).toHaveBeenCalled();
    rerender(
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("dialog", { name: /Install WorshipSync/i }),
    ).not.toBeInTheDocument();
  });

  it("hides install controls when already running as the installed PWA", async () => {
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
      isStandalone: true,
    });

    const providerTree = (
      <MemoryRouter initialEntries={["/home"]}>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    );

    const user = userEvent.setup();
    const { unmount } = render(providerTree);
    await openHomeHubMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: /^Install$/i }),
    ).not.toBeInTheDocument();
    unmount();

    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    );
    mockGetAppOs.mockReturnValue("android");
    render(providerTree);
    await openHomeHubMenu(user);
    expect(
      screen.queryByRole("menuitem", { name: /^Install$/i }),
    ).not.toBeInTheDocument();
  });
});
