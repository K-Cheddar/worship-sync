import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import WindowControls from "./WindowControls";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "../../../store/displayOutputsSlice";

const openWindow = jest.fn().mockResolvedValue(true);
const refreshWindowStates = jest.fn().mockResolvedValue(undefined);

jest.mock("../../../hooks/useElectronWindows", () => ({
  useElectronWindows: () => ({
    isElectron: true,
    displays: [],
    windowStates: { displays: {} },
    refreshDisplays: jest.fn(),
    refreshWindowStates,
    openWindow,
    closeWindow: jest.fn(),
    focusWindow: jest.fn(),
    moveWindowToDisplay: jest.fn(),
    setDisplayPreference: jest.fn(),
  }),
}));

jest.mock("../../../components/WindowControl/WindowControl", () => ({
  __esModule: true,
  default: ({
    windowType,
    title,
    onOpen,
  }: {
    windowType: string;
    title: string;
    onOpen: () => void;
  }) => (
    <button type="button" data-testid={`window-${windowType}`} onClick={onOpen}>
      {title}
    </button>
  ),
}));

const REGISTRY = {
  projector: { id: "projector", type: "projector", name: "Main", order: 0 },
  out_lobby: { id: "out_lobby", type: "projector", name: "Lobby", order: 1 },
  monitor: { id: "monitor", type: "monitor", name: "Stage", order: 2 },
  stream: { id: "stream", type: "stream", name: "Stream", order: 3 },
  credits: { id: "credits", type: "credits", name: "Credits", order: 4 },
};

const renderControls = (registry: Record<string, unknown> = REGISTRY) => {
  const store = configureStore({
    reducer: { displayOutputs: displayOutputsSlice.reducer },
  });
  store.dispatch(setDisplayOutputsFromRemote(registry));
  return render(
    <Provider store={store}>
      <WindowControls />
    </Provider>,
  );
};

beforeEach(() => {
  openWindow.mockClear();
  refreshWindowStates.mockClear();
});

describe("WindowControls", () => {
  it("offers a window for every display, not just the original two", () => {
    renderControls();
    expect(screen.getByTestId("window-projector")).toBeInTheDocument();
    expect(screen.getByTestId("window-out_lobby")).toBeInTheDocument();
    expect(screen.getByTestId("window-monitor")).toBeInTheDocument();
    expect(screen.getByTestId("window-stream")).toBeInTheDocument();
  });

  it("names each window after its display", () => {
    renderControls();
    expect(screen.getByText("Lobby Window")).toBeInTheDocument();
    expect(screen.getByText("Stage Window")).toBeInTheDocument();
  });

  it("offers no window for a pull display, which has no presentation output", () => {
    renderControls();
    expect(screen.queryByTestId("window-credits")).not.toBeInTheDocument();
  });

  it("omits a retired display", () => {
    renderControls({
      ...REGISTRY,
      out_lobby: { ...REGISTRY.out_lobby, enabled: false },
    });
    expect(screen.queryByTestId("window-out_lobby")).not.toBeInTheDocument();
  });

  it("opens a window by display id and render profile", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId("window-out_lobby"));

    expect(openWindow).toHaveBeenCalledWith("out_lobby", "projector");
  });

  it("asks the main process about the displays it shows controls for", () => {
    renderControls();
    expect(refreshWindowStates).toHaveBeenCalledWith([
      "projector",
      "out_lobby",
      "monitor",
      "stream",
    ]);
  });
});
