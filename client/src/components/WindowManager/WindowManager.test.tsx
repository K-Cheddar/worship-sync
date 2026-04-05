import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import WindowManager from "./WindowManager";

const mockUseElectronWindows = jest.fn();

jest.mock("../../hooks/useElectronWindows", () => ({
  useElectronWindows: () => mockUseElectronWindows(),
}));

describe("WindowManager", () => {
  beforeEach(() => {
    mockUseElectronWindows.mockReset();
  });

  it("hides the default projector and monitor window controls outside Electron", () => {
    mockUseElectronWindows.mockReturnValue({
      isElectron: false,
      displays: [],
      windowStates: null,
    });

    const { container } = render(<WindowManager />);

    expect(container.firstChild).toBeNull();
  });

  it("renders the default projector and monitor controls and wires their actions", async () => {
    const refreshDisplays = jest.fn();
    const refreshWindowStates = jest.fn();
    const openWindow = jest.fn();
    const closeWindow = jest.fn();
    const focusWindow = jest.fn();
    const moveWindowToDisplay = jest.fn();

    mockUseElectronWindows.mockReturnValue({
      isElectron: true,
      displays: [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
          rotation: 0,
          internal: true,
          label: "Main Display",
        },
        {
          id: 2,
          bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
          workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
          rotation: 0,
          internal: false,
          label: "Side Display",
        },
      ],
      windowStates: {
        projector: { displayId: 1, width: 1280, height: 720, isFullScreen: true },
        monitor: { displayId: 1, width: 1280, height: 720, isFullScreen: false },
        projectorOpen: false,
        monitorOpen: true,
      },
      refreshDisplays,
      refreshWindowStates,
      openWindow,
      closeWindow,
      focusWindow,
      moveWindowToDisplay,
    });

    render(<WindowManager />);

    expect(screen.getByText("Projector Window")).toBeInTheDocument();
    expect(screen.getByText("Stage Monitor Window")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshDisplays).toHaveBeenCalledTimes(1);
    expect(refreshWindowStates).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(openWindow).toHaveBeenCalledWith("projector");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closeWindow).toHaveBeenCalledWith("monitor");

    fireEvent.click(screen.getByRole("button", { name: "Bring to Front" }));
    expect(focusWindow).toHaveBeenCalledWith("monitor");

    const monitorCard = screen.getByText("Stage Monitor Window").closest("div");
    if (!monitorCard) {
      throw new Error("Monitor card not found");
    }

    const monitorRadio = within(monitorCard).getByLabelText(
      "Side Display (1920x1080):"
    );
    fireEvent.click(monitorRadio);

    await waitFor(() =>
      expect(moveWindowToDisplay).toHaveBeenCalledWith("monitor", 2)
    );
  });
});
