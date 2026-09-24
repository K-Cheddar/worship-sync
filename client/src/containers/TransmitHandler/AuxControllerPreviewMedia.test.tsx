import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import TransmitHandler from "./TransmitHandler";
import { ActiveControllerProvider } from "../../context/activeController";
import { controllerProfilesSlice } from "../../store/controllerProfilesSlice";
import { displayOutputsSlice } from "../../store/displayOutputsSlice";
import {
  presentationSlice,
  setOutputTransmitting,
  syncOutputSlots,
  updatePresentation,
} from "../../store/presentationSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { timersSlice } from "../../store/timersSlice";
import itemListsReducer from "../../store/itemListsSlice";
import type { Box } from "../../types";

jest.unmock("../../hooks/useCachedMediaUrl");

const AUX_ID = "ctrl_lobby";

const OUTPUTS = {
  projector: {
    id: "projector",
    type: "projector",
    name: "Main",
    order: 0,
    enabled: true,
  },
  out_lobby: {
    id: "out_lobby",
    type: "projector",
    name: "Lobby TVs",
    order: 1,
    enabled: true,
  },
  monitor: {
    id: "monitor",
    type: "monitor",
    name: "Stage",
    order: 2,
    enabled: true,
  },
  stream: {
    id: "stream",
    type: "stream",
    name: "Stream",
    order: 3,
    enabled: true,
  },
};

const createStore = () => {
  const store = configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      displayOutputs: displayOutputsSlice.reducer,
      controllerProfiles: controllerProfilesSlice.reducer,
      timers: timersSlice.reducer,
      undoable: (
        state = {
          present: {
            preferences: {
              ...preferencesSlice.getInitialState(),
              isMediaExpanded: false,
            },
            itemLists: itemListsReducer(undefined, { type: "@@init" }),
          },
        },
      ) => state,
    },
  });
  store.dispatch(
    displayOutputsSlice.actions.setDisplayOutputsFromRemote(OUTPUTS),
  );
  store.dispatch(
    controllerProfilesSlice.actions.setControllerProfilesFromRemote([
      {
        id: "presentation",
        type: "presentation",
        name: "Presentation",
        order: 0,
        enabled: true,
        outputIds: ["projector", "monitor", "stream"],
        outputsConfigured: true,
        outlineScope: "presentation",
      },
      {
        id: AUX_ID,
        type: "aux-presentation",
        name: "Lobby",
        order: 1,
        enabled: true,
        outputIds: ["out_lobby"],
        outputsConfigured: true,
        outlineScope: AUX_ID,
      },
    ]),
  );
  store.dispatch(
    syncOutputSlots([
      { id: "projector", type: "projector" },
      { id: "out_lobby", type: "projector" },
      { id: "monitor", type: "monitor" },
      { id: "stream", type: "stream" },
    ]),
  );
  return store;
};

const videoBox = (mediaKey: string, background: string): Box => ({
  id: `box-${mediaKey}`,
  width: 100,
  height: 100,
  mediaInfo: {
    id: mediaKey,
    type: "video",
    background,
  } as NonNullable<Box["mediaInfo"]>,
});

const slide = (name: string, mediaKey: string, background: string) => ({
  type: "media" as const,
  name,
  slide: {
    id: `slide-${name}`,
    type: "Media" as const,
    name,
    boxes: [videoBox(mediaKey, background)],
  },
});

describe("Aux Controller preview video continuity", () => {
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
  const originalDuration = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    "duration",
  );

  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: jest.fn(() => "probably"),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 60,
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: originalPlay,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: originalPause,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      configurable: true,
      value: originalLoad,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
      configurable: true,
      value: originalCanPlayType,
    });
    if (originalDuration) {
      Object.defineProperty(
        HTMLMediaElement.prototype,
        "duration",
        originalDuration,
      );
    }
  });

  it("keeps the real staged video element and playhead through mirror changes", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.dispatch(
      setOutputTransmitting({ outputId: "projector", value: true }),
    );
    store.dispatch(
      setOutputTransmitting({ outputId: "out_lobby", value: true }),
    );
    store.dispatch(
      updatePresentation({
        ...slide(
          "Main video",
          "main-video",
          "https://media.test/main.mp4",
        ),
        outputIds: ["projector"],
      }),
    );
    store.dispatch(
      updatePresentation({
        ...slide(
          "Staged video",
          "staged-video",
          "https://media.test/staged.mp4",
        ),
        outputIds: ["out_lobby"],
      }),
    );
    expect(store.getState().presentation.outputs.out_lobby.info.slide?.id).toBe(
      "slide-Staged video",
    );
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    const stagedCard = screen.getByTestId("aux-staged-preview");
    const stagedVideo = (await within(stagedCard).findByTestId(
      "hls-video-player",
    )) as HTMLVideoElement;
    const load = HTMLMediaElement.prototype.load as jest.Mock;
    await waitFor(() => {
      expect(load.mock.contexts).toContain(stagedVideo);
    });
    load.mockClear();
    let playhead = 0;
    const seek = jest.fn((value: number) => {
      playhead = value;
    });
    const play = jest.fn().mockResolvedValue(undefined);
    const pause = jest.fn();
    Object.defineProperty(stagedVideo, "currentTime", {
      configurable: true,
      get: () => playhead,
      set: seek,
    });
    Object.defineProperty(stagedVideo, "play", {
      configurable: true,
      value: play,
    });
    Object.defineProperty(stagedVideo, "pause", {
      configurable: true,
      value: pause,
    });
    fireEvent.loadedMetadata(stagedVideo);
    playhead = 18.25;
    const playheadBeforeTransition = playhead;
    play.mockClear();
    pause.mockClear();
    seek.mockClear();

    await user.click(screen.getByRole("button", { name: "Mirror Main" }));

    expect(stagedCard).not.toHaveAttribute("hidden");
    expect(within(stagedCard).getByTestId("hls-video-player")).toBe(
      stagedVideo,
    );
    expect(within(stagedCard).getAllByTestId("hls-video-player")).toHaveLength(
      1,
    );
    expect(stagedVideo.currentTime).toBeCloseTo(playheadBeforeTransition, 2);
    expect(seek).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
    expect(load.mock.contexts).not.toContain(stagedVideo);

    await user.click(screen.getByRole("button", { name: "Stop mirroring" }));

    expect(stagedCard).toHaveAttribute("hidden");
    expect(within(stagedCard).getByTestId("hls-video-player")).toBe(
      stagedVideo,
    );
    expect(within(stagedCard).getAllByTestId("hls-video-player")).toHaveLength(
      1,
    );
    expect(stagedVideo.currentTime).toBeCloseTo(playheadBeforeTransition, 2);
    expect(seek).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(load.mock.contexts).not.toContain(stagedVideo);
    expect(store.getState().presentation.outputs.out_lobby.info.name).toBe(
      "Staged video",
    );
  });
});
