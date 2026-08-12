import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import ProjectorFull from "../ProjectorFull";
import { presentationSlice } from "../../store/presentationSlice";
import { timersSlice } from "../../store/timersSlice";

const mockUseCloseOnEscape = jest.fn();

jest.mock("../../hooks/useWakeLock", () => ({
  useWakeLock: () => { },
}));

jest.mock("../../hooks/useCloseOnEscape", () => ({
  useCloseOnEscape: (handler: () => void) => mockUseCloseOnEscape(handler),
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: {
    displayType?: string;
    width?: number;
    shouldPlayVideo?: boolean;
  }) => (
    <div
      data-testid="projector-full-display-window"
      data-display-type={props.displayType || ""}
      data-width={String(props.width ?? "")}
      data-should-play-video={props.shouldPlayVideo ? "true" : "false"}
    />
  ),
}));

describe("ProjectorFull page", () => {
  beforeEach(() => {
    mockUseCloseOnEscape.mockReset();
  });

  it("wires projector state with video playback and registers Escape close", () => {
    const base = presentationSlice.getInitialState();
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
      },
      preloadedState: {
        presentation: {
          ...base,
          projectorInfo: {
            ...base.projectorInfo,
            displayType: "projector",
          },
        },
        timers: timersSlice.getInitialState(),
      },
    });

    render(
      <Provider store={store}>
        <ProjectorFull />
      </Provider>,
    );

    const stage = screen.getByTestId("projector-full-display-window");
    expect(stage).toHaveAttribute("data-display-type", "projector");
    expect(stage).toHaveAttribute("data-width", "100");
    expect(stage).toHaveAttribute("data-should-play-video", "true");
    expect(mockUseCloseOnEscape).toHaveBeenCalledTimes(1);
  });
});
