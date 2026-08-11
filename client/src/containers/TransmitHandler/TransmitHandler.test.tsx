import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import TransmitHandler from "./TransmitHandler";
import { presentationSlice } from "../../store/presentationSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import { timersSlice } from "../../store/timersSlice";
import userEvent from "@testing-library/user-event";

jest.mock("../../components/Presentation/PresentationPreview", () => ({
  __esModule: true,
  default: ({
    name,
    hideQuickLinks,
    minimalHeader,
    fillWidth,
  }: {
    name: string;
    hideQuickLinks?: boolean;
    minimalHeader?: boolean;
    fillWidth?: boolean;
  }) => (
    <div
      data-testid={`presentation-${name.toLowerCase()}`}
      data-hide-quick-links={hideQuickLinks}
      data-minimal-header={minimalHeader}
      data-fill-width={fillWidth}
    >
      {name}
    </div>
  ),
}));

const createStore = () =>
  configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      timers: timersSlice.reducer,
      undoable: (
        state = {
          present: {
            preferences: preferencesSlice.getInitialState(),
          },
        },
      ) => state,
    },
    preloadedState: {
      presentation: presentationSlice.getInitialState(),
      timers: timersSlice.getInitialState(),
      undoable: {
        present: {
          preferences: {
            ...preferencesSlice.getInitialState(),
            isMediaExpanded: false,
          },
        },
      },
    },
  } as Parameters<typeof configureStore>[0]);

describe("TransmitHandler", () => {
  it("renders only Stream when visibleScreens is stream", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler visibleScreens={["stream"]} />
      </Provider>,
    );
    expect(screen.getByTestId("presentation-stream")).toBeInTheDocument();
    expect(
      screen.queryByTestId("presentation-projector"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("presentation-monitor"),
    ).not.toBeInTheDocument();
  });

  it("renders all three screens by default", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler />
      </Provider>,
    );
    expect(screen.getByTestId("presentation-stream")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-projector")).toBeInTheDocument();
    expect(screen.getByTestId("presentation-monitor")).toBeInTheDocument();
  });

  it("renders previews without live controls in read-only mode", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler readOnly />
      </Provider>,
    );

    expect(screen.queryByText("Clear All")).not.toBeInTheDocument();
    expect(screen.queryByText("Live on All:")).not.toBeInTheDocument();
    expect(screen.getByTestId("presentation-stream")).toHaveAttribute(
      "data-hide-quick-links",
      "true",
    );
    expect(screen.getByTestId("presentation-stream")).toHaveAttribute(
      "data-minimal-header",
      "true",
    );
  });

  it("uses a full-width stage when requested", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler visibleScreens={["stream"]} fillWidth />
      </Provider>,
    );

    expect(screen.getByTestId("presentation-stream")).toHaveAttribute(
      "data-fill-width",
      "true",
    );
  });

  it("hides overlay-only controls by default", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler visibleScreens={["stream"]} />
      </Provider>,
    );

    expect(screen.queryByText("Hide Content")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear Overlays")).not.toBeInTheDocument();
  });

  it("shows stream-focused controls when requested", () => {
    const store = createStore();
    render(
      <Provider store={store}>
        <TransmitHandler
          visibleScreens={["stream"]}
          variant="overlayStreamFocus"
          showStreamOverlayOnlyToggle
          showClearStreamOverlaysButton
        />
      </Provider>,
    );

    expect(screen.getByText("Clear All")).toBeInTheDocument();
    expect(screen.getByText("Live:")).toBeInTheDocument();
    expect(screen.getByText("Hide Content:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear Overlays" }),
    ).toBeInTheDocument();
  });

  it("Clear Overlays dispatches clearStreamOverlaysOnly and keeps slide content", async () => {
    const user = userEvent.setup();
    const base = presentationSlice.getInitialState();
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
        undoable: (
          state = {
            present: {
              preferences: preferencesSlice.getInitialState(),
            },
          },
        ) => state,
      },
      preloadedState: {
        presentation: {
          ...base,
          isStreamTransmitting: true,
          streamInfo: {
            ...base.streamInfo,
            name: "Keep me",
            type: "song",
            slide: {
              id: "s1",
              type: "Verse" as const,
              name: "Song",
              boxes: [{ width: 100, height: 100, words: "Lyrics" }],
            },
            participantOverlayInfo: {
              id: "p1",
              name: "Ann",
              time: 1,
            },
          },
        },
        timers: timersSlice.getInitialState(),
        undoable: {
          present: {
            preferences: {
              ...preferencesSlice.getInitialState(),
              isMediaExpanded: false,
            },
          },
        },
      },
    } as Parameters<typeof configureStore>[0]);

    render(
      <Provider store={store}>
        <TransmitHandler
          visibleScreens={["stream"]}
          variant="overlayStreamFocus"
          showClearStreamOverlaysButton
        />
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Clear Overlays" }));

    const state = store.getState().presentation;
    expect(state.streamInfo.participantOverlayInfo?.name).toBe("");
    expect(state.prevStreamInfo.participantOverlayInfo?.name).toBe("Ann");
    expect(state.streamInfo.slide?.boxes?.[0]?.words).toBe("Lyrics");
  });

  it("Hide Content toggle sets streamItemContentBlocked", async () => {
    const user = userEvent.setup();
    const store = createStore();

    render(
      <Provider store={store}>
        <TransmitHandler
          visibleScreens={["stream"]}
          variant="overlayStreamFocus"
          showStreamOverlayOnlyToggle
        />
      </Provider>,
    );

    expect(store.getState().presentation.streamItemContentBlocked).toBe(false);
    await user.click(screen.getByText("Hide Content:"));
    expect(store.getState().presentation.streamItemContentBlocked).toBe(true);
  });
});
