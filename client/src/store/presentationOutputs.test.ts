import { configureStore } from "@reduxjs/toolkit";
import {
  clearOutput,
  presentationSlice,
  RemoteOutputState,
  syncOutputSlots,
  toggleOutputTransmitting,
  updateOutputsFromRemote,
  updatePresentation,
  toLegacyPresentationShape,
} from "./presentationSlice";
import { Presentation } from "../types";

const createStore = () =>
  configureStore({ reducer: { presentation: presentationSlice.reducer } });

/** Registry with a second projector and a second stream alongside the built-ins. */
const withExtraOutputs = () => {
  const store = createStore();
  store.dispatch(
    syncOutputSlots([
      { id: "projector", type: "projector" },
      { id: "monitor", type: "monitor" },
      { id: "stream", type: "stream" },
      { id: "out_lobby", type: "projector" },
      { id: "out_foyer_stream", type: "stream" },
    ]),
  );
  return store;
};

const outputs = (store: ReturnType<typeof createStore>) =>
  store.getState().presentation.outputs;

const slide = (words: string) => ({
  id: `slide-${words}`,
  name: words,
  type: "Verse",
  boxes: [{ words, width: 100, height: 100 }],
});

const presentation = (name: string, words: string): Presentation => ({
  type: "song",
  name,
  slide: slide(words) as Presentation["slide"],
});

describe("syncOutputSlots", () => {
  it("creates a slot for every push output in the registry", () => {
    const store = withExtraOutputs();
    expect(Object.keys(outputs(store)).sort()).toEqual([
      "monitor",
      "out_foyer_stream",
      "out_lobby",
      "projector",
      "stream",
    ]);
    expect(outputs(store).out_lobby.type).toBe("projector");
  });

  it("seeds a stream slot with its overlay lane but a bare prev", () => {
    const store = withExtraOutputs();
    const stream = outputs(store).out_foyer_stream;
    expect(stream.info.participantOverlayInfo).toBeDefined();
    expect(stream.prevInfo.participantOverlayInfo).toBeUndefined();
  });

  it("leaves live content untouched when another output is added", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("projector"));
    store.dispatch(updatePresentation(presentation("Song", "Verse one")));
    const before = outputs(store).projector.info.slide;

    store.dispatch(
      syncOutputSlots([
        { id: "projector", type: "projector" },
        { id: "monitor", type: "monitor" },
        { id: "stream", type: "stream" },
        { id: "out_new", type: "projector" },
      ]),
    );
    expect(outputs(store).projector.info.slide).toEqual(before);
    expect(outputs(store).out_new).toBeDefined();
  });

  it("drops slots for outputs deleted from the registry", () => {
    const store = withExtraOutputs();
    store.dispatch(
      syncOutputSlots([
        { id: "projector", type: "projector" },
        { id: "monitor", type: "monitor" },
        { id: "stream", type: "stream" },
      ]),
    );
    expect(outputs(store).out_lobby).toBeUndefined();
  });

  it("restarts a slot whose render profile changed", () => {
    const store = withExtraOutputs();
    store.dispatch(syncOutputSlots([{ id: "out_lobby", type: "stream" }]));
    const slot = outputs(store).out_lobby;
    expect(slot.type).toBe("stream");
    // Blank state must match the new profile, not carry projector state over.
    expect(slot.info.participantOverlayInfo).toBeDefined();
  });
});

describe("per-output transmit", () => {
  it("takes one output live without affecting its siblings", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    expect(outputs(store).out_lobby.isTransmitting).toBe(true);
    expect(outputs(store).projector.isTransmitting).toBe(false);
  });

  it("ignores an unknown output id", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("nope"));
    expect(
      Object.values(outputs(store)).every((slot) => !slot.isTransmitting),
    ).toBe(true);
  });
});

describe("targeted sends", () => {
  it("sends different content to two projectors", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("projector"));
    store.dispatch(toggleOutputTransmitting("out_lobby"));

    store.dispatch(
      updatePresentation({
        ...presentation("Main deck", "Worship"),
        outputIds: ["projector"],
      } as Presentation),
    );
    store.dispatch(
      updatePresentation({
        ...presentation("Lobby deck", "Welcome"),
        outputIds: ["out_lobby"],
      } as Presentation),
    );

    expect(outputs(store).projector.info.name).toBe("Main deck");
    expect(outputs(store).out_lobby.info.name).toBe("Lobby deck");
  });

  it("reaches only the built-in display when no target is given", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("projector"));
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(updatePresentation(presentation("Shared", "Verse")));

    // Displays of the same kind exist so they can differ; an untargeted send
    // must not fan out across them.
    expect(outputs(store).projector.info.name).toBe("Shared");
    expect(outputs(store).out_lobby.info.name).toBe("");
  });

  it("mirrors only when both displays are named", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("projector"));
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(
      updatePresentation({
        ...presentation("Shared", "Verse"),
        outputIds: ["projector", "out_lobby"],
      } as Presentation),
    );

    expect(outputs(store).projector.info.name).toBe("Shared");
    expect(outputs(store).out_lobby.info.name).toBe("Shared");
  });

  it("skips a targeted display that is not live, without abandoning the rest", () => {
    const store = withExtraOutputs();
    // Only the later display is live; the loop must not stop at the first.
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(
      updatePresentation({
        ...presentation("Only lobby", "Verse"),
        outputIds: ["projector", "out_lobby"],
      } as Presentation),
    );

    expect(outputs(store).projector.info.name).toBe("");
    expect(outputs(store).out_lobby.info.name).toBe("Only lobby");
  });

  it("never stores targeting alongside synced presentation state", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(
      updatePresentation({
        ...presentation("Lobby", "Verse"),
        outputIds: ["out_lobby"],
      } as Presentation),
    );
    expect("outputIds" in outputs(store).out_lobby.info).toBe(false);
  });
});

describe("clearOutput", () => {
  it("clears one output and keeps its outgoing slide for the fade", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(
      updatePresentation({
        ...presentation("Lobby", "Welcome"),
        outputIds: ["out_lobby"],
      } as Presentation),
    );

    store.dispatch(clearOutput("out_lobby"));
    expect(outputs(store).out_lobby.info.name).toBe("");
    expect(outputs(store).out_lobby.prevInfo.name).toBe("Lobby");
  });

  it("leaves a monitor's board override off after clearing", () => {
    const store = withExtraOutputs();
    store.dispatch(presentationSlice.actions.setDisplayBoardAliasId({ aliasId: "youth" }));
    expect(outputs(store).monitor.boardAliasId).toBe("youth");

    store.dispatch(clearOutput("monitor"));
    expect(outputs(store).monitor.boardAliasId).toBe("");
  });

  it("ignores an unknown output id", () => {
    const store = withExtraOutputs();
    const before = outputs(store);
    store.dispatch(clearOutput("nope"));
    expect(outputs(store)).toEqual(before);
  });
});

describe("legacy remote updates stay on the built-in surfaces", () => {
  it("does not let projectorInfo overwrite an independent projector", () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("out_lobby"));
    store.dispatch(
      updatePresentation({
        ...presentation("Lobby deck", "Welcome"),
        outputIds: ["out_lobby"],
      } as Presentation),
    );

    store.dispatch(
      presentationSlice.actions.updateProjectorFromRemote({
        type: "song",
        name: "Built-in deck",
        slide: null,
        time: 9000,
      }),
    );

    expect(outputs(store).projector.info.name).toBe("Built-in deck");
    expect(outputs(store).out_lobby.info.name).toBe("Lobby deck");
  });

  it("does not let stream overlay keys reach a second stream", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.updateParticipantOverlayInfoFromRemote({
        id: "p1",
        name: "Alex",
        time: 9000,
      }),
    );

    expect(outputs(store).stream.info.participantOverlayInfo?.name).toBe(
      "Alex",
    );
    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.name,
    ).toBe("");
  });

  it("does not let the board-on-monitor override reach a second monitor", () => {
    const store = createStore();
    store.dispatch(
      syncOutputSlots([
        { id: "monitor", type: "monitor" },
        { id: "out_choir", type: "monitor" },
      ]),
    );
    store.dispatch(
      presentationSlice.actions.setMonitorBoardAliasIdFromRemote("youth"),
    );

    expect(outputs(store).monitor.boardAliasId).toBe("youth");
    expect(outputs(store).out_choir.boardAliasId).toBe("");
  });
});

describe("updateOutputsFromRemote", () => {
  const remote = (info: Partial<Presentation>): RemoteOutputState => ({
    type: "projector",
    info: { type: "song", name: "Remote", slide: null, time: 100, ...info },
  });

  it("applies content to an output created after the registry", () => {
    const store = withExtraOutputs();
    store.dispatch(updateOutputsFromRemote({ out_lobby: remote({}) }));
    expect(outputs(store).out_lobby.info.name).toBe("Remote");
  });

  it("ignores built-ins, which still travel in the legacy keys", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({
        projector: remote({ name: "Should not apply" }),
      }),
    );
    expect(outputs(store).projector.info.name).toBe("");
  });

  it("ignores a stale write", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({ out_lobby: remote({ time: 200 }) }),
    );
    store.dispatch(
      updateOutputsFromRemote({
        out_lobby: remote({ name: "Older", time: 100 }),
      }),
    );
    expect(outputs(store).out_lobby.info.name).toBe("Remote");
  });

  it("moves the outgoing slide into prev so the crossfade still runs", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({ out_lobby: remote({ time: 100 }) }),
    );
    store.dispatch(
      updateOutputsFromRemote({
        out_lobby: remote({ name: "Next", time: 200 }),
      }),
    );
    expect(outputs(store).out_lobby.prevInfo.name).toBe("Remote");
    expect(outputs(store).out_lobby.info.name).toBe("Next");
  });

  it("syncs a stream output's overlay-only flag", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: { type: "stream", itemContentBlocked: true },
      }),
    );
    expect(outputs(store).out_foyer_stream.itemContentBlocked).toBe(true);
  });

  it("does not sync transmit state, which stays a local controller decision", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({
        out_lobby: {
          ...remote({}),
          isTransmitting: true,
        } as RemoteOutputState,
      }),
    );
    expect(outputs(store).out_lobby.isTransmitting).toBe(false);
  });

  it("tolerates an empty or null payload", () => {
    const store = withExtraOutputs();
    const before = outputs(store);
    store.dispatch(updateOutputsFromRemote(null));
    store.dispatch(updateOutputsFromRemote({}));
    expect(outputs(store)).toEqual(before);
  });

  it("creates a slot for an output the registry has not delivered yet", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({ out_new: remote({ name: "Arrived" }) }),
    );
    // These updates are one-shot; dropping one strands that screen until an
    // operator re-sends.
    expect(outputs(store).out_new?.type).toBe("projector");
    expect(outputs(store).out_new?.info.name).toBe("Arrived");
  });

  it("ignores an output whose type is not a push profile", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({
        out_board: {
          type: "board",
          info: { type: "", name: "x", slide: null },
        },
      }),
    );
    expect(outputs(store).out_board).toBeUndefined();
  });

  it("never clears live content with an untimestamped payload", () => {
    const store = withExtraOutputs();
    store.dispatch(
      updateOutputsFromRemote({
        out_lobby: remote({ name: "Live", time: 500 }),
      }),
    );
    // A reconciled blank slot carries no time and must not wipe what is on air.
    store.dispatch(
      updateOutputsFromRemote({
        out_lobby: {
          type: "projector",
          info: { type: "", name: "", slide: null },
        },
      }),
    );
    expect(outputs(store).out_lobby.info.name).toBe("Live");
  });
});

describe("a board can take over any full-frame display", () => {
  it("puts the board on a named projector without touching the monitor", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({
        aliasId: "youth",
        outputIds: ["out_lobby"],
      }),
    );

    expect(outputs(store).out_lobby.boardAliasId).toBe("youth");
    expect(outputs(store).monitor.boardAliasId).toBe("");
  });

  it("still reaches the built-in monitor when no display is named", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({ aliasId: "youth" }),
    );

    expect(outputs(store).monitor.boardAliasId).toBe("youth");
    expect(outputs(store).out_lobby.boardAliasId).toBe("");
  });

  it("refuses a stream, which composites overlays instead of taking over", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({
        aliasId: "youth",
        outputIds: ["stream"],
      }),
    );

    expect(outputs(store).stream.boardAliasId).toBe("");
  });

  it("clears a projector's board when that display is cleared", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({
        aliasId: "youth",
        outputIds: ["out_lobby"],
      }),
    );

    store.dispatch(clearOutput("out_lobby"));

    expect(outputs(store).out_lobby.boardAliasId).toBe("");
  });
});

describe("clearing leaves board mode on every surface that can host one", () => {
  const putBoardOn = (
    store: ReturnType<typeof withExtraOutputs>,
    outputIds: string[],
  ) =>
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({
        aliasId: "youth",
        outputIds,
      }),
    );

  it("Clear All takes a board off a projector, not just the monitor", () => {
    const store = withExtraOutputs();
    putBoardOn(store, ["out_lobby", "monitor"]);

    store.dispatch(presentationSlice.actions.clearAll());

    // Panic-clearing mid-service must not leave the board on the room screen.
    expect(outputs(store).out_lobby.boardAliasId).toBe("");
    expect(outputs(store).monitor.boardAliasId).toBe("");
  });

  it("Clear Projector takes the board off every projector", () => {
    const store = withExtraOutputs();
    putBoardOn(store, ["out_lobby", "projector"]);

    store.dispatch(presentationSlice.actions.clearProjector());

    expect(outputs(store).out_lobby.boardAliasId).toBe("");
    expect(outputs(store).projector.boardAliasId).toBe("");
  });

  it("Clear Projector leaves a monitor's board alone", () => {
    const store = withExtraOutputs();
    putBoardOn(store, ["monitor"]);

    store.dispatch(presentationSlice.actions.clearProjector());

    expect(outputs(store).monitor.boardAliasId).toBe("youth");
  });
});

describe("the built-in projector's board reaches other machines", () => {
  it("carries projector board state through the legacy shape", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setDisplayBoardAliasId({
        aliasId: "youth",
        outputIds: ["projector"],
      }),
    );

    // buildRemoteOutputs skips built-ins, so this key is the only channel the
    // main projector's board has.
    expect(
      toLegacyPresentationShape(store.getState().presentation)
        .projectorBoardAliasId,
    ).toBe("youth");
  });

  it("applies a projector board arriving from another controller", () => {
    const store = withExtraOutputs();

    store.dispatch(
      presentationSlice.actions.setProjectorBoardAliasIdFromRemote("youth"),
    );

    expect(outputs(store).projector.boardAliasId).toBe("youth");
    // Named projectors keep their own state; the legacy key is built-in only.
    expect(outputs(store).out_lobby.boardAliasId).toBe("");
  });

  it("round-trips an empty value so turning the board off syncs", () => {
    const store = withExtraOutputs();
    store.dispatch(
      presentationSlice.actions.setProjectorBoardAliasIdFromRemote("youth"),
    );
    store.dispatch(
      presentationSlice.actions.setProjectorBoardAliasIdFromRemote(""),
    );

    expect(outputs(store).projector.boardAliasId).toBe("");
  });
});

describe("clearing streams", () => {
  const putContentOnBothStreams = (
    store: ReturnType<typeof withExtraOutputs>,
  ) => {
    store.dispatch(toggleOutputTransmitting("stream"));
    store.dispatch(toggleOutputTransmitting("out_foyer_stream"));
    store.dispatch(
      updatePresentation({
        ...presentation("Main stream", "Verse"),
        outputIds: ["stream", "out_foyer_stream"],
      } as Presentation),
    );
  };

  it("clears only the named stream, leaving another operator's alone", () => {
    const store = withExtraOutputs();
    putContentOnBothStreams(store);

    store.dispatch(
      presentationSlice.actions.clearStream({ outputIds: ["stream"] }),
    );

    expect(outputs(store).stream.info.name).toBe("");
    expect(outputs(store).out_foyer_stream.info.name).toBe("Main stream");
  });

  it("still clears every stream when untargeted, like the other clears", () => {
    const store = withExtraOutputs();
    putContentOnBothStreams(store);

    store.dispatch(presentationSlice.actions.clearStream());

    expect(outputs(store).stream.info.name).toBe("");
    expect(outputs(store).out_foyer_stream.info.name).toBe("");
  });
});

describe("named stream lanes sync independently", () => {
  // Slots seed each lane with serverNow(), so payloads must be plausibly newer
  // to clear the receive gate at all.
  const base = Date.now() + 10_000;
  const liveStream = () => {
    const store = withExtraOutputs();
    store.dispatch(toggleOutputTransmitting("out_foyer_stream"));
    return store;
  };

  const overlay = (time: number) => ({
    id: "p1",
    name: "Pastor",
    time,
    duration: 7,
  });

  it("keeps a remote overlay when a newer slide arrives without it", () => {
    const store = liveStream();
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          participantOverlayInfo: overlay(base + 500),
        },
      } as unknown as Record<string, RemoteOutputState>),
    );
    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.name,
    ).toBe("Pastor");

    // A controller that never saw the overlay sends a newer slide. Gated on the
    // max time across lanes, this used to outrank and replace the whole
    // payload, dropping the overlay off a live stream.
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          info: {
            type: "song",
            name: "Later slide",
            time: base + 900,
            slide: { id: "s2", type: "Song", boxes: [] },
          },
        },
      } as unknown as Record<string, RemoteOutputState>),
    );

    expect(outputs(store).out_foyer_stream.info.name).toBe("Later slide");
    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.name,
    ).toBe("Pastor");
  });

  it("applies a newer overlay without disturbing the slide", () => {
    const store = liveStream();
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          info: {
            type: "song",
            name: "Current slide",
            time: base + 400,
            slide: { id: "s1", type: "Song", boxes: [] },
          },
        },
      } as unknown as Record<string, RemoteOutputState>),
    );

    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          participantOverlayInfo: overlay(base + 800),
        },
      } as unknown as Record<string, RemoteOutputState>),
    );

    expect(outputs(store).out_foyer_stream.info.name).toBe("Current slide");
    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.time,
    ).toBe(base + 800);
  });

  it("ignores an overlay older than the one already showing", () => {
    const store = liveStream();
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          participantOverlayInfo: overlay(base + 800),
        },
      } as unknown as Record<string, RemoteOutputState>),
    );
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          participantOverlayInfo: { ...overlay(base + 200), name: "Stale" },
        },
      } as unknown as Record<string, RemoteOutputState>),
    );

    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.name,
    ).toBe("Pastor");
  });

  it("still reads lanes nested inside info from an older client", () => {
    const store = liveStream();
    store.dispatch(
      updateOutputsFromRemote({
        out_foyer_stream: {
          type: "stream",
          info: {
            type: "song",
            name: "Legacy blob",
            time: base + 400,
            slide: { id: "s1", type: "Song", boxes: [] },
            participantOverlayInfo: overlay(base + 450),
          },
        },
      } as unknown as Record<string, RemoteOutputState>),
    );

    expect(
      outputs(store).out_foyer_stream.info.participantOverlayInfo?.name,
    ).toBe("Pastor");
  });
});
