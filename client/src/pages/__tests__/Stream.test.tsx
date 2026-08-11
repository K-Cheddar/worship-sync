import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import Stream from "../Stream";
import { presentationSlice } from "../../store/presentationSlice";
import { timersSlice } from "../../store/timersSlice";

jest.mock("../../hooks/useWakeLock", () => ({
  useWakeLock: () => { },
}));

jest.mock("../../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: {
    displayType?: string;
    width?: number;
    streamItemContentBlocked?: boolean;
    boardPostStreamInfo?: { text?: string };
    participantOverlayInfo?: { name?: string };
  }) => (
    <div
      data-testid="stream-display-window"
      data-display-type={props.displayType || ""}
      data-width={String(props.width ?? "")}
      data-item-blocked={props.streamItemContentBlocked ? "true" : "false"}
      data-board-post={props.boardPostStreamInfo?.text || ""}
      data-participant={props.participantOverlayInfo?.name || ""}
    />
  ),
}));

const createStore = () => {
  const base = presentationSlice.getInitialState();
  return configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      timers: timersSlice.reducer,
    },
    preloadedState: {
      presentation: {
        ...base,
        streamItemContentBlocked: true,
        streamInfo: {
          ...base.streamInfo,
          displayType: "stream",
          participantOverlayInfo: {
            id: "p1",
            name: "Alex",
            time: 1,
          },
          boardPostStreamInfo: {
            author: "Pat",
            authorHexColor: "#fff",
            text: "Hello stream",
            time: 1,
          },
        },
      },
      timers: timersSlice.getInitialState(),
    },
  });
};

describe("Stream page", () => {
  it("wires stream presentation state into DisplayWindow including overlays", () => {
    render(
      <Provider store={createStore()}>
        <Stream />
      </Provider>,
    );

    const stage = screen.getByTestId("stream-display-window");
    expect(stage).toHaveAttribute("data-display-type", "stream");
    expect(stage).toHaveAttribute("data-width", "100");
    expect(stage).toHaveAttribute("data-item-blocked", "true");
    expect(stage).toHaveAttribute("data-participant", "Alex");
    expect(stage).toHaveAttribute("data-board-post", "Hello stream");
  });
});
