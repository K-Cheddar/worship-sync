import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import Stream from "../Stream";
import { presentationSlice, fromLegacyPresentationShape, toLegacyPresentationShape } from "../../store/presentationSlice";
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
    canCaptureLocalVideo?: boolean;
    localVideoInput?: { sourceId?: string };
    prevLocalVideoInput?: { sourceId?: string };
  }) => (
    <div
      data-testid="stream-display-window"
      data-display-type={props.displayType || ""}
      data-width={String(props.width ?? "")}
      data-item-blocked={props.streamItemContentBlocked ? "true" : "false"}
      data-board-post={props.boardPostStreamInfo?.text || ""}
      data-participant={props.participantOverlayInfo?.name || ""}
      data-capture-local-video={props.canCaptureLocalVideo ? "true" : "false"}
      data-local-video-source={props.localVideoInput?.sourceId || ""}
      data-prev-local-video-source={props.prevLocalVideoInput?.sourceId || ""}
    />
  ),
}));

const createStore = () => {
  const base = toLegacyPresentationShape(presentationSlice.getInitialState());
  return configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      timers: timersSlice.reducer,
    },
    preloadedState: {
      presentation: fromLegacyPresentationShape({
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
          localVideoInput: {
            sourceId: "source-1",
            deviceLabel: "USB Capture",
            ownerDeviceId: "workstation-1",
            ownerLabel: "Booth",
          },
        },
        prevStreamInfo: {
          ...base.prevStreamInfo,
          displayType: "stream",
          localVideoInput: {
            sourceId: "source-previous",
            deviceLabel: "Previous USB Capture",
            ownerDeviceId: "workstation-1",
            ownerLabel: "Booth",
          },
        },
      }),
      timers: timersSlice.getInitialState(),
    },
  });
};

describe("Stream page", () => {
  it("wires stream presentation state into DisplayWindow including overlays", () => {
    render(
      <MemoryRouter>
        <Provider store={createStore()}>
          <Stream />
        </Provider>
      </MemoryRouter>,
    );

    const stage = screen.getByTestId("stream-display-window");
    expect(stage).toHaveAttribute("data-display-type", "stream");
    expect(stage).toHaveAttribute("data-width", "100");
    expect(stage).toHaveAttribute("data-item-blocked", "true");
    expect(stage).toHaveAttribute("data-participant", "Alex");
    expect(stage).toHaveAttribute("data-board-post", "Hello stream");
    expect(stage).toHaveAttribute("data-capture-local-video", "true");
    expect(stage).toHaveAttribute("data-local-video-source", "source-1");
    expect(stage).toHaveAttribute(
      "data-prev-local-video-source",
      "source-previous",
    );
  });
});
