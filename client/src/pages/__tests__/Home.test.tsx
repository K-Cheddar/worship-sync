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

jest.mock("../../containers/Toolbar/ToolbarElements/UserSection", () => () => (
  <div>User</div>
));

jest.mock("../../utils/environment", () => ({
  isElectron: jest.fn(() => false),
  isWindowsBrowser: jest.fn(() => true),
}));

jest.mock("../../utils/githubRelease", () => ({
  getLatestReleaseUrl: jest.fn(
    () => "https://github.com/K-Cheddar/worship-sync/releases/latest",
  ),
  fetchLatestWindowsInstallerUrl: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../../hooks/usePwaInstallPrompt", () => ({
  usePwaInstallPrompt: jest.fn(),
}));

const mockUsePwaInstallPrompt = jest.mocked(usePwaInstallPrompt);

describe("Home", () => {
  beforeEach(() => {
    mockUsePwaInstallPrompt.mockReturnValue({
      canShowInstall: false,
      installPwa: jest.fn(),
    });
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
      screen.getByRole("link", { name: /Info Controller/i }),
    ).toHaveAttribute("href", "/info-controller");

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
    expect(
      screen.getByText(/Advanced access/, { hidden: true }),
    ).toBeInTheDocument();

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

  it("hides board moderation, info controller, and display outputs for view access", () => {
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
      screen.queryByRole("link", { name: /Info Controller/i }),
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
      screen.queryByRole("link", { name: /Info Controller/i }),
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
});
