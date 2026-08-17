import reducer, {
  addDisplayOutput,
  removeDisplayOutput,
  renameDisplayOutput,
  reorderDisplayOutputs,
  setDisplayOutputEnabled,
  setDisplayOutputSource,
  setDisplayOutputsFromRemote,
  seedDisplayOutputSettings,
} from "./displayOutputsSlice";

const initial = () => reducer(undefined, { type: "@@INIT" });

const BUILT_IN_IDS = [
  "projector",
  "monitor",
  "stream",
  "credits",
  "stream-info",
  "board",
];

/** Registry with a second projector output alongside the three built-ins. */
const withLobby = () => {
  const state = initial();
  const action = addDisplayOutput({ type: "projector", name: "Lobby" });
  return {
    state: reducer(state, action),
    lobbyId: action.payload.id,
  };
};

describe("initial state", () => {
  it("starts with every built-in surface and unloaded", () => {
    const state = initial();
    expect(state.list.map((o) => o.id)).toEqual(BUILT_IN_IDS);
    expect(state.isLoaded).toBe(false);
  });

  it("seeds pull outputs with no source binding", () => {
    const board = initial().list.find((o) => o.id === "board");
    expect(board?.type).toBe("board");
    expect(board?.source).toBeUndefined();
  });
});

describe("setDisplayOutputsFromRemote", () => {
  it("replaces the registry and marks it loaded", () => {
    const state = reducer(
      initial(),
      setDisplayOutputsFromRemote({
        projector: {
          id: "projector",
          type: "projector",
          name: "Main",
          order: 0,
        },
        out_lobby: {
          id: "out_lobby",
          type: "projector",
          name: "Lobby",
          order: 1,
        },
        monitor: { id: "monitor", type: "monitor", name: "Stage", order: 2 },
        stream: { id: "stream", type: "stream", name: "Stream", order: 3 },
      }),
    );
    expect(state.list.slice(0, 4).map((o) => o.name)).toEqual([
      "Main",
      "Lobby",
      "Stage",
      "Stream",
    ]);
    expect(state.isLoaded).toBe(true);
  });

  it("keeps the built-ins when the remote payload is empty or malformed", () => {
    const state = reducer(initial(), setDisplayOutputsFromRemote(null));
    expect(state.list.map((o) => o.id)).toEqual(BUILT_IN_IDS);
    expect(state.isLoaded).toBe(true);
  });
});

describe("addDisplayOutput", () => {
  it("appends an enabled output with a generated id at the end of the order", () => {
    const { state, lobbyId } = withLobby();
    const lobby = state.list.find((o) => o.id === lobbyId);
    expect(lobby).toMatchObject({
      type: "projector",
      name: "Lobby",
      order: BUILT_IN_IDS.length,
      enabled: true,
    });
    expect(lobbyId.startsWith("out_")).toBe(true);
  });

  it("supports several outputs of the same type", () => {
    const first = addDisplayOutput({ type: "projector", name: "Lobby" });
    const second = addDisplayOutput({ type: "projector", name: "Choir" });
    let state = reducer(initial(), first);
    state = reducer(state, second);
    const projectors = state.list.filter((o) => o.type === "projector");
    expect(projectors.map((o) => o.name)).toEqual([
      "Projector",
      "Lobby",
      "Choir",
    ]);
  });

  it("suffixes a duplicate name so operators can tell outputs apart", () => {
    const state = reducer(
      initial(),
      addDisplayOutput({ type: "projector", name: "Projector" }),
    );
    expect(state.list.map((o) => o.name)).toContain("Projector 2");
  });

  it("names an unnamed output after its render profile", () => {
    const state = reducer(initial(), addDisplayOutput({ type: "stream" }));
    expect(state.list.map((o) => o.name)).toContain("Stream 2");
  });

  it("ignores an id that already exists", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(state, {
      type: addDisplayOutput.type,
      payload: { id: lobbyId, type: "monitor", name: "Duplicate" },
    });
    expect(next.list).toHaveLength(BUILT_IN_IDS.length + 1);
  });

  it("adds a second board output so two screens can show different boards", () => {
    const action = addDisplayOutput({ type: "board", name: "Foyer Board" });
    const state = reducer(initial(), action);
    const foyer = state.list.find((o) => o.id === action.payload.id);
    expect(foyer).toMatchObject({ type: "board", name: "Foyer Board" });
    expect(state.list.filter((o) => o.type === "board")).toHaveLength(2);
  });
});

describe("setDisplayOutputSource", () => {
  it("binds a board output to a discussion board alias", () => {
    const state = reducer(
      initial(),
      setDisplayOutputSource({
        id: "board",
        source: { boardAliasId: "youth" },
      }),
    );
    expect(state.list.find((o) => o.id === "board")?.source).toEqual({
      boardAliasId: "youth",
    });
  });

  it("unbinds when passed null", () => {
    let state = reducer(
      initial(),
      setDisplayOutputSource({
        id: "board",
        source: { boardAliasId: "youth" },
      }),
    );
    state = reducer(
      state,
      setDisplayOutputSource({ id: "board", source: null }),
    );
    expect(state.list.find((o) => o.id === "board")?.source).toBeUndefined();
  });

  it("refuses to bind a push output, which is driven by presentation state", () => {
    const state = reducer(
      initial(),
      setDisplayOutputSource({
        id: "monitor",
        source: { boardAliasId: "youth" },
      }),
    );
    expect(state.list.find((o) => o.id === "monitor")?.source).toBeUndefined();
  });

  it("ignores an unknown id", () => {
    const state = initial();
    expect(
      reducer(
        state,
        setDisplayOutputSource({ id: "nope", source: { boardAliasId: "x" } }),
      ).list,
    ).toEqual(state.list);
  });
});

describe("renameDisplayOutput", () => {
  it("renames a built-in", () => {
    const state = reducer(
      initial(),
      renameDisplayOutput({ id: "projector", name: "  Main   Stage " }),
    );
    expect(state.list.find((o) => o.id === "projector")?.name).toBe(
      "Main Stage",
    );
  });

  it("suffixes a rename that collides with another output", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(
      state,
      renameDisplayOutput({ id: lobbyId, name: "Monitor" }),
    );
    expect(next.list.find((o) => o.id === lobbyId)?.name).toBe("Monitor 2");
  });

  it("keeps an output's own name when renamed to itself", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(
      state,
      renameDisplayOutput({ id: lobbyId, name: "Lobby" }),
    );
    expect(next.list.find((o) => o.id === lobbyId)?.name).toBe("Lobby");
  });

  it("falls back to the render profile when renamed to blank", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(
      state,
      renameDisplayOutput({ id: lobbyId, name: "   " }),
    );
    expect(next.list.find((o) => o.id === lobbyId)?.name).toBe("Projector 2");
  });

  it("ignores an unknown id", () => {
    const state = initial();
    expect(
      reducer(state, renameDisplayOutput({ id: "nope", name: "X" })).list,
    ).toEqual(state.list);
  });
});

describe("setDisplayOutputEnabled", () => {
  it("retires and restores an output", () => {
    let state = reducer(
      initial(),
      setDisplayOutputEnabled({ id: "stream", enabled: false }),
    );
    expect(state.list.find((o) => o.id === "stream")?.enabled).toBe(false);
    state = reducer(
      state,
      setDisplayOutputEnabled({ id: "stream", enabled: true }),
    );
    expect(state.list.find((o) => o.id === "stream")?.enabled).toBe(true);
  });

  it("ignores an unknown id", () => {
    const state = initial();
    expect(
      reducer(state, setDisplayOutputEnabled({ id: "nope", enabled: false }))
        .list,
    ).toEqual(state.list);
  });
});

describe("removeDisplayOutput", () => {
  it("removes an added output and closes the order gap", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(state, removeDisplayOutput(lobbyId));
    expect(next.list.map((o) => o.id)).toEqual(BUILT_IN_IDS);
    expect(next.list.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("refuses to remove any built-in, push or pull", () => {
    const state = initial();
    const survivors = BUILT_IN_IDS.map(
      (id) => reducer(state, removeDisplayOutput(id)).list.length,
    );
    expect(survivors).toEqual(BUILT_IN_IDS.map(() => BUILT_IN_IDS.length));
  });

  it("ignores an unknown id", () => {
    const state = initial();
    expect(reducer(state, removeDisplayOutput("nope")).list).toEqual(
      state.list,
    );
  });
});

describe("reorderDisplayOutputs", () => {
  it("applies an explicit id sequence and reindexes order", () => {
    const state = reducer(
      initial(),
      reorderDisplayOutputs(["stream", "projector", "monitor"]),
    );
    expect(state.list.slice(0, 3).map((o) => o.id)).toEqual([
      "stream",
      "projector",
      "monitor",
    ]);
    expect(state.list.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps unlisted outputs at the end in their previous relative order", () => {
    const { state, lobbyId } = withLobby();
    const next = reducer(state, reorderDisplayOutputs(["stream"]));
    expect(next.list.map((o) => o.id)).toEqual([
      "stream",
      "projector",
      "monitor",
      "credits",
      "stream-info",
      "board",
      lobbyId,
    ]);
  });
});

describe("seedDisplayOutputSettings", () => {
  const withMonitorSettings = (settings?: Record<string, unknown>) =>
    reducer(
      initial(),
      setDisplayOutputsFromRemote({
        monitor: {
          id: "monitor",
          type: "monitor",
          name: "Stage",
          order: 0,
          ...(settings ? { settings } : {}),
        },
      }),
    );

  const monitorOf = (state: ReturnType<typeof initial>) =>
    state.list.find((output) => output.id === "monitor");

  it("fills a display that has never been configured", () => {
    const next = reducer(
      withMonitorSettings(),
      seedDisplayOutputSettings({
        id: "monitor",
        settings: { showClock: false, clockFontSize: 90 },
      }),
    );

    expect(monitorOf(next)?.settings).toMatchObject({
      showClock: false,
      clockFontSize: 90,
    });
  });

  it("backfills the gaps a partial save left behind", () => {
    // Flipping one toggle used to make the reducer refuse outright, so the
    // rest of the church's settings never reached Redux at all.
    const next = reducer(
      withMonitorSettings({ showBackground: true }),
      seedDisplayOutputSettings({
        id: "monitor",
        settings: { showClock: false, clockFontSize: 90 },
      }),
    );

    expect(monitorOf(next)?.settings).toMatchObject({
      showBackground: true,
      showClock: false,
      clockFontSize: 90,
    });
  });

  it("never overwrites a value the operator already chose", () => {
    const next = reducer(
      withMonitorSettings({ showClock: true }),
      seedDisplayOutputSettings({
        id: "monitor",
        settings: { showClock: false },
      }),
    );

    expect(monitorOf(next)?.settings?.showClock).toBe(true);
  });

  it("ignores a display that is not in the registry", () => {
    const before = withMonitorSettings();
    const next = reducer(
      before,
      seedDisplayOutputSettings({ id: "nope", settings: { showClock: false } }),
    );

    expect(next.list).toEqual(before.list);
  });

  it("does not replace settings that already match after normalize", () => {
    const before = withMonitorSettings({
      showClock: false,
      clockFontSize: 90,
    });
    const next = reducer(
      before,
      seedDisplayOutputSettings({
        id: "monitor",
        settings: { showClock: false, clockFontSize: 90 },
      }),
    );

    expect(next).toBe(before);
  });
});
