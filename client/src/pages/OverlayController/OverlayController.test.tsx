import { render, screen } from "@testing-library/react";
import OverlayController from "./OverlayController";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { createMockGlobalContext } from "../../test/mocks";

const mockDispatch = jest.fn();

let mockState = {
  undoable: {
    present: {
      preferences: {
        scrollbarWidth: 0,
        overlayControllerPanel: "overlays" as string,
      },
    },
  },
};

let transmitHandlerProps: Record<string, unknown> | null = null;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

jest.mock("../Controller/useControllerPageLifecycle", () => ({
  useControllerPageLifecycle: () => ({ layoutRef: { current: null } }),
}));

jest.mock("../../components/ControllerPageShell/ControllerPageShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="controller-page-shell">{children}</div>
  ),
}));

jest.mock("../../containers/Overlays/Overlays", () => ({
  __esModule: true,
  default: () => <div data-testid="overlays-panel-mock" />,
}));

jest.mock("./BoardStreamPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="board-stream-panel-mock" />,
}));

jest.mock("./OverlaysAndPostsWorkspace", () => ({
  __esModule: true,
  default: () => <div data-testid="overlays-posts-workspace-mock" />,
}));

jest.mock("../CreditsEditor/CreditsEditor", () => ({
  __esModule: true,
  default: () => <div data-testid="credits-editor-mock" />,
}));

jest.mock("../../containers/ServiceTimes/ServiceTimes", () => ({
  __esModule: true,
  default: () => <div data-testid="service-times-mock" />,
}));

jest.mock("../../containers/Media/Media", () => ({
  __esModule: true,
  default: () => <div data-testid="media-panel-mock" />,
}));

jest.mock("../Controller/ServicePlanningSyncFloatingWindow", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../../containers/TransmitHandler/TransmitHandler", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    transmitHandlerProps = props;
    return <div data-testid="transmit-handler-mock" />;
  },
}));

describe("OverlayController shell", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    transmitHandlerProps = null;
    mockState = {
      undoable: {
        present: {
          preferences: {
            scrollbarWidth: 0,
            overlayControllerPanel: "overlays",
          },
        },
      },
    };
  });

  it("shows overlays panel and wires stream-focused transmit controls for full access", () => {
    render(
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({ access: "full", user: "op" })}
      >
        <ControllerInfoContext.Provider
          value={{ dbProgress: null, connectionStatus: "connected" } as never}
        >
          <OverlayController />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByTestId("overlays-panel-mock")).toBeInTheDocument();
    expect(screen.getByTestId("transmit-handler-mock")).toBeInTheDocument();
    expect(transmitHandlerProps).toMatchObject({
      visibleScreens: ["stream"],
      variant: "overlayStreamFocus",
      showStreamOverlayOnlyToggle: true,
      showClearStreamOverlaysButton: true,
    });
  });

  it("still wires overlay clear/hide controls for music access", () => {
    render(
      <GlobalInfoContext.Provider
        value={createMockGlobalContext({ access: "music", user: "music-op" })}
      >
        <ControllerInfoContext.Provider
          value={{ dbProgress: null, connectionStatus: "connected" } as never}
        >
          <OverlayController />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>,
    );

    expect(screen.getByTestId("transmit-handler-mock")).toBeInTheDocument();
    expect(transmitHandlerProps).toMatchObject({
      showStreamOverlayOnlyToggle: true,
      showClearStreamOverlaysButton: true,
    });
  });
});
