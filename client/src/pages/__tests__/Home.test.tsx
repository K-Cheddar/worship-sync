import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Home from "../Home";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  createMockControllerContext,
  createMockGlobalContext,
} from "../../test/mocks";
import { usePwaInstallPrompt } from "../../hooks/usePwaInstallPrompt";
import {
  isLinuxBrowser,
  isMacBrowser,
  isWindowsBrowser,
} from "../../utils/environment";

jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => (
  <div>User</div>
));

jest.mock("../../utils/environment", () => ({
  isElectron: jest.fn(() => false),
  isWindowsBrowser: jest.fn(() => true),
  isMacBrowser: jest.fn(() => false),
  isLinuxBrowser: jest.fn(() => false),
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
const mockIsWindowsBrowser = jest.mocked(isWindowsBrowser);
const mockIsMacBrowser = jest.mocked(isMacBrowser);
const mockIsLinuxBrowser = jest.mocked(isLinuxBrowser);
const originalUserAgent = window.navigator.userAgent;

const setUserAgent = (userAgent: string) => {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
};

describe("Home", () => {
  beforeEach(() => {
    setUserAgent(originalUserAgent);
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
      isStandalone: false,
    });
    mockIsWindowsBrowser.mockReturnValue(true);
    mockIsMacBrowser.mockReturnValue(false);
    mockIsLinuxBrowser.mockReturnValue(false);
  });

  it("describes features and keeps controller and display guidance available", async () => {
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter>
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
    expect(
      screen.getByText(
        /Present slides and media, manage overlays, timers, and credits/,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /Presentation Controller/i }),
    ).toHaveAttribute("href", "/controller");
    expect(
      screen.getByRole("link", { name: /Overlay Controller/i }),
    ).toHaveAttribute("href", "/overlay-controller");
    expect(
      screen.getByRole("link", { name: /^Credits Editor / }),
    ).toHaveAttribute("href", "/credits-editor");
    expect(
      screen.getByRole("link", { name: /Board moderation/i }),
    ).toHaveAttribute("href", "/boards/controller");

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
    expect(screen.getByText(/Advanced access/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    await user.click(
      screen.getByRole("button", { name: /Download Windows app/i }),
    );
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

  it("uses one popover with install and download when both are available", async () => {
    const user = userEvent.setup();
    const installPwa = jest.fn().mockResolvedValue(undefined);
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: true,
      installPwa,
      isStandalone: false,
    });
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter>
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
      screen.queryByRole("button", { name: /Download Windows App/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Install$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    expect(
      await screen.findByText(/Choose how to run WorshipSync/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Download Windows app/i }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(
      screen.getByRole("dialog", { name: /windows download help/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    await user.click(screen.getByRole("button", { name: /^Install app$/i }));
    expect(installPwa).toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it("hides board moderation when the user is not logged in", () => {
    render(
      <MemoryRouter>
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
      screen.getByRole("link", { name: /^Credits Editor / }),
    ).toHaveAttribute("href", "/credits-editor");
  });

  it("hides board moderation and display outputs for view access", () => {
    render(
      <MemoryRouter>
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
      screen.queryByRole("button", { name: /^Show display links$/ }),
    ).not.toBeInTheDocument();
    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
    expect(
      screen.getByRole("link", { name: /^Credits Editor / }),
    ).toHaveAttribute("href", "/credits-editor");
  });

  it("shows only presentation controller for music access", () => {
    render(
      <MemoryRouter>
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
      screen.getByRole("link", { name: /Presentation Controller/i }),
    ).toHaveAttribute("href", "/controller");
    expect(
      screen.queryByRole("link", { name: /Overlay Controller/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Credits Editor / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Board moderation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Show display links$/ }),
    ).not.toBeInTheDocument();

    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
  });

  it("hides display output links when the user is not logged in and explains why", () => {
    render(
      <MemoryRouter>
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

    // Avoid matching the guest explainer copy ("Sign in to show display links…").
    expect(
      screen.queryByText(/^Show display links$/),
    ).not.toBeInTheDocument();
    const outboundLinks = screen.getAllByRole("link");
    const hrefs = outboundLinks.map((el) => el.getAttribute("href") || "");
    expect(hrefs.some((h) => h.includes("/monitor"))).toBe(false);
    expect(hrefs.some((h) => h.includes("/stream"))).toBe(false);
    expect(
      screen.getByText(/Sign in to show display links/),
    ).toBeInTheDocument();
  });

  it("offers Mac DMG download in the popover when on macOS", async () => {
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(true);
    mockIsLinuxBrowser.mockReturnValue(false);
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    await user.click(
      screen.getByRole("button", { name: /Download Mac app/i }),
    );
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
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(false);
    mockIsLinuxBrowser.mockReturnValue(true);
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MemoryRouter>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    await user.click(
      screen.getByRole("button", { name: /Download Linux app/i }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
    expect(await screen.findByText(/Download for Linux/)).toBeInTheDocument();
    expect(screen.getByText(/Linux AppImage or \.deb/i)).toBeInTheDocument();
    openSpy.mockRestore();
  });

  it("shows iOS install instructions when prompt event is unavailable on mobile", async () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1");
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(false);
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    expect(
      await screen.findByRole("dialog", { name: /mobile install instructions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/On iPhone and iPad, open Safari's Share menu/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
  });

  it("uses beforeinstallprompt install flow on mobile when available", async () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36");
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(false);
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
      <MemoryRouter>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /^Install$/i }));
    expect(installPwa).toHaveBeenCalled();
    rerender(
      <MemoryRouter>
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
      screen.queryByRole("dialog", { name: /mobile install instructions/i }),
    ).not.toBeInTheDocument();
  });

  it("hides install controls when already running as the installed PWA", () => {
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
      isStandalone: true,
    });

    const providerTree = (
      <MemoryRouter>
        <GlobalInfoContext.Provider value={createMockGlobalContext() as any}>
          <ControllerInfoContext.Provider
            value={createMockControllerContext() as any}
          >
            <Home />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </MemoryRouter>
    );

    const { unmount } = render(providerTree);
    expect(screen.queryByRole("button", { name: /^Install$/i })).not.toBeInTheDocument();
    unmount();

    setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    );
    mockIsWindowsBrowser.mockReturnValue(false);
    mockIsMacBrowser.mockReturnValue(false);
    render(providerTree);
    expect(screen.queryByRole("button", { name: /^Install$/i })).not.toBeInTheDocument();
  });
});
