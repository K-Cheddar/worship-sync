import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import TransmitHandler from "./TransmitHandler";
import {
  presentationSlice,
  setDisplayBoardAliasId,
  setOutputTransmitting,
  syncOutputSlots,
  updatePresentation,
} from "../../store/presentationSlice";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "../../store/displayOutputsSlice";
import { preferencesSlice } from "../../store/preferencesSlice";
import {
  controllerProfilesSlice,
  setControllerProfilesFromRemote,
} from "../../store/controllerProfilesSlice";
import { timersSlice } from "../../store/timersSlice";
import { ActiveControllerProvider } from "../../context/activeController";
import itemListsReducer from "../../store/itemListsSlice";

jest.mock("../../components/Presentation/PresentationPreview", () => ({
  __esModule: true,
  default: ({
    name,
    isTransmitting,
    toggleIsTransmitting,
    footer,
    info,
    readOnly,
    minimalHeader,
  }: {
    name: string;
    isTransmitting?: boolean;
    toggleIsTransmitting?: () => void;
    footer?: React.ReactNode;
    readOnly?: boolean;
    minimalHeader?: boolean;
    info?: {
      name?: string;
      slide?: { id?: string } | null;
      videoPlayback?: { positionSeconds?: number; paused?: boolean };
    };
  }) => (
    <div
      data-testid={`preview-${name}`}
      data-live={String(!!isTransmitting)}
      data-read-only={String(!!readOnly || !!minimalHeader)}
      data-info-name={info?.name ?? ""}
      data-slide-id={info?.slide?.id ?? ""}
      data-video-position={info?.videoPlayback?.positionSeconds ?? ""}
      data-video-paused={
        info?.videoPlayback ? String(info.videoPlayback.paused) : ""
      }
    >
      {name}
      {!readOnly && !minimalHeader && (
        <button type="button" onClick={toggleIsTransmitting}>
          {`Toggle ${name}`}
        </button>
      )}
      {footer}
    </div>
  ),
}));

jest.mock("../../boards/useResolvedBoardDisplayAlias", () => ({
  useResolvedBoardDisplayAlias: ({ enabled }: { enabled: boolean }) =>
    enabled ? "board-alias" : "",
}));

jest.mock("./BoardMonitorPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="preview-Board" />,
}));

/** Registry with a second projector, as an operator would configure it. */
const REGISTRY = {
  projector: { id: "projector", type: "projector", name: "Main", order: 0 },
  out_lobby: { id: "out_lobby", type: "projector", name: "Lobby", order: 1 },
  monitor: { id: "monitor", type: "monitor", name: "Stage", order: 2 },
  stream: { id: "stream", type: "stream", name: "Stream", order: 3 },
  credits: { id: "credits", type: "credits", name: "Credits", order: 4 },
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
            preferences: preferencesSlice.getInitialState(),
          },
        },
      ) => state,
    },
  });
  store.dispatch(setDisplayOutputsFromRemote(REGISTRY));
  // A display belongs to no controller until it is assigned one, so the second
  // projector has to be given to the presentation controller before it appears
  // here. That assignment is what keeps it off other operators' screens.
  store.dispatch(
    setControllerProfilesFromRemote([
      {
        id: "presentation",
        type: "presentation",
        name: "Presentation",
        order: 0,
        enabled: true,
        outputIds: ["projector", "out_lobby", "monitor", "stream"],
        outputsConfigured: true,
        outlineScope: "presentation",
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

const renderHandler = (store: ReturnType<typeof createStore>) =>
  render(
    <Provider store={store}>
      <TransmitHandler />
    </Provider>,
  );

describe("TransmitHandler with multiple outputs", () => {
  it("renders a tile per enabled output, named by the operator", () => {
    renderHandler(createStore());
    expect(screen.getByTestId("preview-Main")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Lobby")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Stage")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Stream")).toBeInTheDocument();
  });

  it("does not render pull outputs, which have no presentation state", () => {
    renderHandler(createStore());
    expect(screen.queryByTestId("preview-Credits")).not.toBeInTheDocument();
  });

  it("hides a retired output", () => {
    const store = createStore();
    store.dispatch(
      setDisplayOutputsFromRemote({
        ...REGISTRY,
        out_lobby: { ...REGISTRY.out_lobby, enabled: false },
      }),
    );
    renderHandler(store);
    expect(screen.queryByTestId("preview-Lobby")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-Main")).toBeInTheDocument();
  });

  it("takes one projector live without taking its sibling live", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderHandler(store);

    await user.click(
      within(screen.getByTestId("preview-Lobby")).getByRole("button"),
    );

    expect(store.getState().presentation.outputs.out_lobby.isTransmitting).toBe(
      true,
    );
    expect(store.getState().presentation.outputs.projector.isTransmitting).toBe(
      false,
    );
    expect(screen.getByTestId("preview-Lobby")).toHaveAttribute(
      "data-live",
      "true",
    );
    expect(screen.getByTestId("preview-Main")).toHaveAttribute(
      "data-live",
      "false",
    );
  });

  it("falls back to the built-in surfaces when the registry is absent", () => {
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        timers: timersSlice.reducer,
        undoable: (
          state = {
            present: { preferences: preferencesSlice.getInitialState() },
          },
        ) => state,
      },
    });
    render(
      <Provider store={store}>
        <TransmitHandler />
      </Provider>,
    );
    expect(screen.getByTestId("preview-Projector")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Monitor")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Stream")).toBeInTheDocument();
  });
});

describe("discussion board placement", () => {
  const tileOrder = () =>
    screen
      .getAllByTestId(/^preview-/)
      .map((element) => element.getAttribute("data-testid"));

  it("keeps the board under its monitor after the operator reorders displays", () => {
    const store = createStore();
    store.dispatch(
      setDisplayOutputsFromRemote({
        ...REGISTRY,
        monitor: { ...REGISTRY.monitor, order: 0 },
        projector: { ...REGISTRY.projector, order: 1 },
        out_lobby: { ...REGISTRY.out_lobby, order: 2 },
        stream: { ...REGISTRY.stream, order: 3 },
      }),
    );
    renderHandler(store);

    expect(tileOrder()).toEqual([
      "preview-Stage",
      "preview-Board",
      "preview-Main",
      "preview-Lobby",
      "preview-Stream",
    ]);
  });

  it("follows the monitor to the end of the list too", () => {
    const store = createStore();
    store.dispatch(
      setDisplayOutputsFromRemote({
        ...REGISTRY,
        projector: { ...REGISTRY.projector, order: 0 },
        stream: { ...REGISTRY.stream, order: 1 },
        monitor: { ...REGISTRY.monitor, order: 2 },
      }),
    );
    renderHandler(store);

    expect(tileOrder()).toEqual([
      "preview-Main",
      "preview-Lobby",
      "preview-Stream",
      "preview-Stage",
      "preview-Board",
    ]);
  });
});

describe("mirror controls on an auxiliary controller", () => {
  const AUX_ID = "ctrl_lobby";

  const createAuxStore = () => {
    const store = configureStore({
      reducer: {
        presentation: presentationSlice.reducer,
        displayOutputs: displayOutputsSlice.reducer,
        controllerProfiles: controllerProfilesSlice.reducer,
        timers: timersSlice.reducer,
        // ActiveControllerProvider switches outline scope; keep a shim so that
        // write does not throw in this focused transmit-handler suite.
        undoable: (
          state: {
            present: {
              preferences: ReturnType<typeof preferencesSlice.getInitialState>;
              itemLists: ReturnType<typeof itemListsReducer>;
            };
          } = {
              present: {
                preferences: preferencesSlice.getInitialState(),
                itemLists: itemListsReducer(undefined, { type: "@@init" }),
              },
            },
          action: { type: string },
        ) => ({
          present: {
            preferences: state.present.preferences,
            itemLists: itemListsReducer(state.present.itemLists, action),
          },
        }),
      },
    });
    store.dispatch(setDisplayOutputsFromRemote(REGISTRY));
    store.dispatch(
      setControllerProfilesFromRemote([
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
          order: 2,
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

  it("shows the source preview and offers Mirror under the owned display", () => {
    const store = createAuxStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    expect(
      within(screen.getByTestId("preview-Lobby")).getByRole("button", {
        name: "Mirror Main",
      }),
    ).toBeInTheDocument();
    const sourcePreview = screen.getByTestId("preview-Main");
    expect(sourcePreview).toHaveAttribute("data-read-only", "true");
    expect(within(sourcePreview).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-Stage")).not.toBeInTheDocument();
  });

  it("toggles mirroring from the same control", async () => {
    const user = userEvent.setup();
    const store = createAuxStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    const preview = within(screen.getByTestId("preview-Lobby"));
    const mirrorButton = preview.getByRole("button", { name: "Mirror Main" });

    await user.click(mirrorButton);

    const stopButton = preview.getByRole("button", {
      name: "Stop mirroring",
    });
    expect(preview.getByTestId("mirror-status-out_lobby")).toHaveTextContent(
      "Mirroring Main",
    );
    expect(stopButton).toHaveAttribute("aria-pressed", "true");
    expect(store.getState().presentation.outputs.out_lobby.followingOutputId).toBe(
      "projector",
    );

    await user.click(stopButton);

    expect(
      preview.getByRole("button", { name: "Mirror Main" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(store.getState().presentation.outputs.out_lobby.followingOutputId).toBe(
      "",
    );
  });

  it("shows a read-only source tile alongside the aux-owned follower tile", async () => {
    const user = userEvent.setup();
    const store = createAuxStore();
    store.dispatch(
      setOutputTransmitting({ outputId: "projector", value: true }),
    );
    store.dispatch(
      setOutputTransmitting({ outputId: "out_lobby", value: true }),
    );

    const sendProjectorSlide = (
      name: string,
      videoPlayback?: {
        mediaKey: string;
        positionSeconds: number;
        paused: boolean;
        atServerMs: number;
        generation: number;
        applySeek: boolean;
      },
    ) =>
      store.dispatch(
        updatePresentation({
          type: "song",
          name,
          slide: {
            type: "Verse",
            name,
            id: `slide-${name}`,
            boxes: [{ words: name, width: 100, height: 100 }],
          },
          videoPlayback,
          outputIds: ["projector"],
        }),
      );

    sendProjectorSlide("Slide A", {
      mediaKey: "remote:video-a",
      positionSeconds: 20,
      paused: false,
      atServerMs: 1000,
      generation: 1,
      applySeek: true,
    });
    store.dispatch(
      updatePresentation({
        type: "song",
        name: "Lobby slide",
        slide: {
          type: "Verse",
          name: "Lobby slide",
          id: "slide-lobby",
          boxes: [{ words: "Lobby content", width: 100, height: 100 }],
        },
        videoPlayback: {
          mediaKey: "remote:video-lobby",
          positionSeconds: 7,
          paused: false,
          atServerMs: 1000,
          generation: 1,
          applySeek: true,
        },
        outputIds: ["out_lobby"],
      }),
    );

    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    const auxPreview = screen.getByTestId("preview-Lobby");
    const preview = within(auxPreview);
    const sourcePreview = screen.getByTestId("preview-Main");
    expect(sourcePreview).toHaveAttribute("data-read-only", "true");
    await user.click(preview.getByRole("button", { name: "Mirror Main" }));

    expect(sourcePreview).toHaveAttribute("data-read-only", "true");
    expect(sourcePreview).toHaveAttribute("data-live", "true");
    expect(sourcePreview).toHaveAttribute("data-info-name", "Slide A");
    expect(sourcePreview).toHaveAttribute("data-slide-id", "slide-Slide A");
    expect(sourcePreview).toHaveAttribute("data-video-position", "20");
    expect(sourcePreview).toHaveAttribute("data-video-paused", "false");
    expect(within(sourcePreview).queryByRole("button")).not.toBeInTheDocument();
    expect(auxPreview).toHaveAttribute("data-read-only", "false");
    expect(auxPreview).toHaveAttribute("data-info-name", "Slide A");
    expect(screen.getByText("SOURCE")).toBeInTheDocument();
    const stagedPreview = within(
      screen.getByTestId("staged-preview-out_lobby"),
    ).getByTestId("preview-Staged for TVs");
    expect(stagedPreview).toHaveAttribute("data-info-name", "Lobby slide");
    expect(stagedPreview).toHaveAttribute("data-slide-id", "slide-lobby");
    expect(stagedPreview).toHaveAttribute("data-video-position", "7");
    expect(screen.getByText("Staged for TVs")).toBeInTheDocument();
    expect(screen.getByText("Following Main")).toBeInTheDocument();

    act(() => {
      sendProjectorSlide("Slide B", {
        mediaKey: "remote:video-a",
        positionSeconds: 32,
        paused: false,
        atServerMs: 2000,
        generation: 2,
        applySeek: true,
      });
    });
    expect(auxPreview).toHaveAttribute("data-info-name", "Slide B");
    expect(auxPreview).toHaveAttribute("data-video-position", "32");
    expect(
      within(screen.getByTestId("staged-preview-out_lobby")).getByTestId(
        "preview-Staged for TVs",
      ),
    ).toHaveAttribute("data-info-name", "Lobby slide");

    await user.click(preview.getByRole("button", { name: "Stop mirroring" }));
    expect(auxPreview).toHaveAttribute("data-info-name", "Lobby slide");
    expect(screen.getByTestId("preview-Main")).toBeInTheDocument();
    expect(screen.getByTestId("preview-Lobby")).toBeInTheDocument();
    expect(screen.queryByTestId("staged-preview-out_lobby")).not.toBeInTheDocument();

    await user.click(preview.getByRole("button", { name: "Toggle Lobby" }));
    expect(store.getState().presentation.outputs.out_lobby.isTransmitting).toBe(
      false,
    );
    expect(store.getState().presentation.outputs.projector.isTransmitting).toBe(
      true,
    );
  });

  it("keeps an unavailable mirror visible so the operator can stop it", async () => {
    const user = userEvent.setup();
    const store = createAuxStore();
    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    const preview = within(screen.getByTestId("preview-Lobby"));
    await user.click(preview.getByRole("button", { name: "Mirror Main" }));
    act(() => {
      store.dispatch(
        setDisplayOutputsFromRemote({
          projector: { ...REGISTRY.projector, enabled: false },
          out_lobby: REGISTRY.out_lobby,
          monitor: REGISTRY.monitor,
          stream: REGISTRY.stream,
        }),
      );
    });

    expect(preview.getByTestId("mirror-status-out_lobby")).toHaveTextContent(
      "Mirror source unavailable: Main",
    );
    expect(preview.getByTestId("mirror-status-out_lobby")).toHaveTextContent(
      "Main",
    );
    expect(screen.getByTestId("preview-Main")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(preview.getByTestId("mirror-status-out_lobby")).not.toHaveTextContent(
      "Synced",
    );
    await user.click(preview.getByRole("button", { name: "Stop mirroring" }));
    expect(store.getState().presentation.outputs.out_lobby.followingOutputId).toBe(
      "",
    );
  });

  it("does not offer Mirror on the presentation controller even when another projector exists", () => {
    renderHandler(createStore());
    expect(
      screen.queryByRole("button", { name: /Mirror/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show the Presentation board takeover on an auxiliary controller", () => {
    const store = createAuxStore();
    store.dispatch(
      setDisplayBoardAliasId({
        aliasId: "live-board",
        outputIds: ["monitor"],
      }),
    );

    render(
      <Provider store={store}>
        <ActiveControllerProvider profileId={AUX_ID}>
          <TransmitHandler />
        </ActiveControllerProvider>
      </Provider>,
    );

    expect(screen.queryByText("Discussion Board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("preview-Board")).not.toBeInTheDocument();
  });
});
