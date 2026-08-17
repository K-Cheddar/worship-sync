import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import ProjectorFull from "../ProjectorFull";
import { presentationSlice, fromLegacyPresentationShape, toLegacyPresentationShape } from "../../store/presentationSlice";
import { timersSlice } from "../../store/timersSlice";

const mockUseCloseOnEscape = jest.fn();

jest.mock("../../hooks/useWakeLock", () => ({
  useWakeLock: () => { },
}));

jest.mock("../../hooks/useCloseOnEscape", () => ({
  useCloseOnEscape: (handler: () => void) => mockUseCloseOnEscape(handler),
}));

jest.mock("../../components/DisplayWindow/DisplayBoardTakeover", () => ({
  __esModule: true,
  default: ({ aliasId, outputId }: { aliasId: string; outputId: string }) => (
    <div
      data-testid="projector-full-board"
      data-alias={aliasId}
      data-output={outputId}
    />
  ),
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: {
    displayType?: string;
    width?: number;
    shouldPlayVideo?: boolean;
    showClockTimer?: boolean;
  }) => (
    <div
      data-testid="projector-full-display-window"
      data-display-type={props.displayType || ""}
      data-width={String(props.width ?? "")}
      data-should-play-video={props.shouldPlayVideo ? "true" : "false"}
      data-show-clock-timer={props.showClockTimer ? "true" : "false"}
    />
  ),
}));

describe("ProjectorFull page", () => {
  beforeEach(() => {
    mockUseCloseOnEscape.mockReset();
  });

  it("wires projector state with video playback and registers Escape close", () => {
    const base = toLegacyPresentationShape(presentationSlice.getInitialState());
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
      },
      preloadedState: {
        presentation: fromLegacyPresentationShape({
          ...base,
          projectorInfo: {
            ...base.projectorInfo,
            displayType: "projector",
          },
        }),
        timers: timersSlice.getInitialState(),
      },
    });

    render(
      <MemoryRouter>
        <Provider store={store}>
          <ProjectorFull />
        </Provider>
      </MemoryRouter>,
    );

    const stage = screen.getByTestId("projector-full-display-window");
    expect(stage).toHaveAttribute("data-display-type", "projector");
    expect(stage).toHaveAttribute("data-width", "100");
    expect(stage).toHaveAttribute("data-should-play-video", "true");
    expect(mockUseCloseOnEscape).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectorFull board takeover", () => {
  const renderWithBoard = (boardAliasId: string) => {
    const base = toLegacyPresentationShape(presentationSlice.getInitialState());
    const state = fromLegacyPresentationShape({
      ...base,
      projectorInfo: { ...base.projectorInfo, displayType: "projector" },
    });
    state.outputs.projector.boardAliasId = boardAliasId;

    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
      },
      preloadedState: {
        presentation: state,
        timers: timersSlice.getInitialState(),
      },
    });

    return render(
      <MemoryRouter>
        <Provider store={store}>
          <ProjectorFull />
        </Provider>
      </MemoryRouter>,
    );
  };

  it("shows the board on the route Electron actually opens", () => {
    renderWithBoard("youth");

    // Without this the sanctuary window keeps slides while the browser and
    // controller both show the board.
    expect(screen.getByTestId("projector-full-board")).toHaveAttribute(
      "data-alias",
      "youth",
    );
    expect(
      screen.queryByTestId("projector-full-display-window"),
    ).not.toBeInTheDocument();
  });

  it("renders slides when no board is sent to it", () => {
    renderWithBoard("");

    expect(
      screen.getByTestId("projector-full-display-window"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("projector-full-board")).not.toBeInTheDocument();
  });
});

describe("ProjectorFull display chrome", () => {
  it("renders the clock/timer overlay, like the windowed projector", () => {
    const base = toLegacyPresentationShape(presentationSlice.getInitialState());
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
      },
      preloadedState: {
        presentation: fromLegacyPresentationShape({
          ...base,
          projectorInfo: { ...base.projectorInfo, displayType: "projector" },
        }),
        timers: timersSlice.getInitialState(),
      },
    });

    render(
      <MemoryRouter>
        <Provider store={store}>
          <ProjectorFull />
        </Provider>
      </MemoryRouter>,
    );

    // This is the window the room actually sees; it must not be the one surface
    // that silently drops display chrome.
    expect(
      screen.getByTestId("projector-full-display-window"),
    ).toHaveAttribute("data-show-clock-timer", "true");
  });
});
