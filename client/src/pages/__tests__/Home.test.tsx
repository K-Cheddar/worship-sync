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

describe("Home", () => {
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

    await user.click(
      screen.getByRole("button", { name: /Download Windows App/i }),
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
      screen.getByText(/new browser tab/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /release page/i })).toHaveAttribute(
      "href",
      "https://github.com/K-Cheddar/worship-sync/releases/latest",
    );
    expect(
      screen.getByRole("button", { name: /Try download again/i }),
    ).toBeInTheDocument();
    openSpy.mockRestore();
  });
});
