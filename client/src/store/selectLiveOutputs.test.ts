import { configureStore } from "@reduxjs/toolkit";
import {
  presentationSlice,
  syncOutputSlots,
  toggleOutputTransmitting,
} from "./presentationSlice";
import {
  displayOutputsSlice,
  setDisplayOutputsFromRemote,
} from "./displayOutputsSlice";
import {
  selectLiveOutputIdsOfType,
  selectOverlayTargetIds,
} from "./selectLiveOutputs";

const REGISTRY = {
  projector: { id: "projector", type: "projector", name: "Main", order: 0 },
  stream: { id: "stream", type: "stream", name: "Stream", order: 1 },
  out_foyer: { id: "out_foyer", type: "stream", name: "Foyer", order: 2 },
};

const createStore = (
  registry: Record<string, unknown> = REGISTRY,
): ReturnType<typeof configureStore> => {
  const store = configureStore({
    reducer: {
      presentation: presentationSlice.reducer,
      displayOutputs: displayOutputsSlice.reducer,
    },
  });
  store.dispatch(setDisplayOutputsFromRemote(registry));
  store.dispatch(
    syncOutputSlots([
      { id: "projector", type: "projector" },
      { id: "stream", type: "stream" },
      { id: "out_foyer", type: "stream" },
    ]),
  );
  return store;
};

const liveStreams = (store: ReturnType<typeof createStore>) =>
  selectLiveOutputIdsOfType(store.getState() as never, "stream");

describe("selectLiveOutputIdsOfType", () => {
  it("reports nothing when no display of the type is live", () => {
    expect(liveStreams(createStore())).toEqual([]);
  });

  it("names every live stream, not just the first", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("stream"));
    store.dispatch(toggleOutputTransmitting("out_foyer"));

    expect(liveStreams(store)).toEqual(["stream", "out_foyer"]);
  });

  it("names a live custom stream when the built-in is off air", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("out_foyer"));

    // This is the case where enablement and targeting used to disagree: any
    // stream was live, but targeting picked the first *enabled* one.
    expect(liveStreams(store)).toEqual(["out_foyer"]);
  });

  it("skips a live slot whose display was disabled", () => {
    const store = createStore({
      ...REGISTRY,
      out_foyer: { ...REGISTRY.out_foyer, enabled: false },
    });
    store.dispatch(toggleOutputTransmitting("out_foyer"));

    expect(liveStreams(store)).toEqual([]);
  });

  it("does not mix render profiles", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("projector"));

    expect(liveStreams(store)).toEqual([]);
    expect(
      selectLiveOutputIdsOfType(store.getState() as never, "projector"),
    ).toEqual(["projector"]);
  });
});

describe("selectOverlayTargetIds", () => {
  const withSelection = (
    store: ReturnType<typeof createStore>,
    overlayTargetOutputIds: string[],
  ) =>
    ({
      ...(store.getState() as object),
      undoable: {
        present: { preferences: { preferences: { overlayTargetOutputIds } } },
      },
    }) as never;

  it("follows every live stream when nothing is picked", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("stream"));
    store.dispatch(toggleOutputTransmitting("out_foyer"));

    expect(selectOverlayTargetIds(withSelection(store, []))).toEqual([
      "stream",
      "out_foyer",
    ]);
  });

  it("sends only to the picked displays", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("stream"));
    store.dispatch(toggleOutputTransmitting("out_foyer"));

    expect(
      selectOverlayTargetIds(withSelection(store, ["out_foyer"])),
    ).toEqual(["out_foyer"]);
  });

  it("drops a picked display that is not live", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("stream"));

    // The reducers skip slots that are not transmitting, so offering this as a
    // target would be a send that silently reaches nothing.
    expect(
      selectOverlayTargetIds(withSelection(store, ["out_foyer"])),
    ).toEqual([]);
  });

  it("can target a projector, for when overlays reach one", () => {
    const store = createStore();
    store.dispatch(toggleOutputTransmitting("projector"));

    expect(
      selectOverlayTargetIds(withSelection(store, ["projector"])),
    ).toEqual(["projector"]);
  });
});
