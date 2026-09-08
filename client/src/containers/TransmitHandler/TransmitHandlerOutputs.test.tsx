import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import TransmitHandler from "./TransmitHandler";
import {
  presentationSlice,
  syncOutputSlots,
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

jest.mock("../../components/Presentation/PresentationPreview", () => ({
  __esModule: true,
  default: ({
    name,
    isTransmitting,
    toggleIsTransmitting,
  }: {
    name: string;
    isTransmitting?: boolean;
    toggleIsTransmitting?: () => void;
  }) => (
    <div data-testid={`preview-${name}`} data-live={String(!!isTransmitting)}>
      {name}
      <button type="button" onClick={toggleIsTransmitting}>
        {`Toggle ${name}`}
      </button>
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
