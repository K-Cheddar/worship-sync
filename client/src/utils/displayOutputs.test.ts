import {
  BUILT_IN_OUTPUT_IDS,
  DisplayOutput,
  createDisplayOutputId,
  getBoardAliasForOutput,
  reorderVisibleOutputIds,
  getDefaultDisplayOutputs,
  getDisplayOutputsByType,
  getEnabledDisplayOutputs,
  getLegacyPresentationKey,
  getPullOutputs,
  getPushOutputs,
  getUniqueDisplayOutputName,
  isBuiltInOutputId,
  isPullOutputType,
  isPushOutputType,
  normalizeDisplayOutputSource,
  normalizeDisplayOutputs,
  resolveOutputForScreen,
  sanitizeDisplayOutputName,
  serializeDisplayOutputs,
} from "./displayOutputs";

const output = (overrides: Partial<DisplayOutput> = {}): DisplayOutput => ({
  id: "out_1",
  type: "projector",
  name: "Lobby",
  order: 5,
  enabled: true,
  ...overrides,
});

describe("push vs pull outputs", () => {
  it("classifies the controller-driven render profiles as push", () => {
    expect(isPushOutputType("projector")).toBe(true);
    expect(isPushOutputType("monitor")).toBe(true);
    expect(isPushOutputType("stream")).toBe(true);
    expect(isPullOutputType("projector")).toBe(false);
  });

  it("classifies the data-source render profiles as pull", () => {
    expect(isPullOutputType("credits")).toBe(true);
    expect(isPullOutputType("stream-info")).toBe(true);
    expect(isPullOutputType("board")).toBe(true);
    expect(isPushOutputType("board")).toBe(false);
  });

  it("partitions a registry into push and pull", () => {
    const outputs = getDefaultDisplayOutputs();
    expect(getPushOutputs(outputs).map((o) => o.id)).toEqual([
      "projector",
      "monitor",
      "stream",
    ]);
    expect(getPullOutputs(outputs).map((o) => o.id)).toEqual([
      "credits",
      "stream-info",
      "board",
    ]);
  });
});

describe("built-in outputs", () => {
  it("seeds every product surface that already exists", () => {
    expect(BUILT_IN_OUTPUT_IDS).toEqual([
      "projector",
      "monitor",
      "stream",
      "credits",
      "stream-info",
      "board",
    ]);
  });

  it("maps only the push built-ins onto legacy Firebase presentation keys", () => {
    expect(getLegacyPresentationKey("projector")).toBe("projectorInfo");
    expect(getLegacyPresentationKey("monitor")).toBe("monitorInfo");
    expect(getLegacyPresentationKey("stream")).toBe("streamInfo");
  });

  it("has no legacy key for pull built-ins, which never had presentation state", () => {
    expect(getLegacyPresentationKey("credits")).toBeNull();
    expect(getLegacyPresentationKey("stream-info")).toBeNull();
    expect(getLegacyPresentationKey("board")).toBeNull();
  });

  it("has no legacy key for outputs created after the registry", () => {
    expect(getLegacyPresentationKey("out_abc")).toBeNull();
    expect(isBuiltInOutputId("out_abc")).toBe(false);
  });

  it("hands back a fresh, mutable copy of the defaults each call", () => {
    const first = getDefaultDisplayOutputs();
    first[0].name = "Mutated";
    expect(getDefaultDisplayOutputs()[0].name).toBe("Projector");
  });
});

describe("pull output sources", () => {
  it("keeps a board alias on a board output", () => {
    expect(
      normalizeDisplayOutputSource({ boardAliasId: " youth " }, "board"),
    ).toEqual({ boardAliasId: "youth" });
  });

  it("drops a board alias from any non-board type, push or pull", () => {
    expect(
      normalizeDisplayOutputSource({ boardAliasId: "youth" }, "projector"),
    ).toBeUndefined();
    expect(
      normalizeDisplayOutputSource({ boardAliasId: "youth" }, "credits"),
    ).toBeUndefined();
  });

  it("treats an empty or malformed binding as unbound", () => {
    expect(
      normalizeDisplayOutputSource({ boardAliasId: "  " }, "board"),
    ).toBeUndefined();
    expect(normalizeDisplayOutputSource(null, "board")).toBeUndefined();
    expect(normalizeDisplayOutputSource("nope", "board")).toBeUndefined();
  });

  it("reads the configured alias back off an output", () => {
    expect(
      getBoardAliasForOutput(
        output({ type: "board", source: { boardAliasId: "youth" } }),
      ),
    ).toBe("youth");
    expect(getBoardAliasForOutput(output({ type: "board" }))).toBe("");
    expect(getBoardAliasForOutput(output({ type: "projector" }))).toBe("");
  });
});

describe("createDisplayOutputId", () => {
  it("namespaces generated ids so they can never collide with a built-in", () => {
    const id = createDisplayOutputId();
    expect(id.startsWith("out_")).toBe(true);
    expect(isBuiltInOutputId(id)).toBe(false);
  });
});

describe("sanitizeDisplayOutputName", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeDisplayOutputName("  Lobby   Left  ", "projector")).toBe(
      "Lobby Left",
    );
  });

  it("falls back to a capitalized type when the name is empty", () => {
    expect(sanitizeDisplayOutputName("   ", "monitor")).toBe("Monitor");
    expect(sanitizeDisplayOutputName(null, "stream")).toBe("Stream");
    expect(sanitizeDisplayOutputName(undefined, "projector")).toBe("Projector");
  });

  it("caps length so operator pickers stay readable", () => {
    expect(sanitizeDisplayOutputName("x".repeat(80), "projector")).toHaveLength(
      40,
    );
  });
});

describe("getUniqueDisplayOutputName", () => {
  it("returns the name unchanged when nothing collides", () => {
    expect(getUniqueDisplayOutputName("Lobby", ["Main", "Choir"])).toBe(
      "Lobby",
    );
  });

  it("suffixes on a case-insensitive collision", () => {
    expect(getUniqueDisplayOutputName("Lobby", ["lobby"])).toBe("Lobby 2");
    expect(getUniqueDisplayOutputName("Lobby", ["Lobby", "Lobby 2"])).toBe(
      "Lobby 3",
    );
  });
});

describe("normalizeDisplayOutputs", () => {
  const BUILT_IN_COUNT = 6;

  it("returns the built-ins for an empty or absent node", () => {
    expect(normalizeDisplayOutputs(null).map((o) => o.id)).toEqual([
      "projector",
      "monitor",
      "stream",
      "credits",
      "stream-info",
      "board",
    ]);
    expect(normalizeDisplayOutputs(undefined)).toHaveLength(BUILT_IN_COUNT);
    expect(normalizeDisplayOutputs("garbage")).toHaveLength(BUILT_IN_COUNT);
    expect(normalizeDisplayOutputs(42)).toHaveLength(BUILT_IN_COUNT);
  });

  it("reads the Firebase id-keyed map form", () => {
    const result = normalizeDisplayOutputs({
      projector: { id: "projector", type: "projector", name: "Main", order: 0 },
      out_lobby: {
        id: "out_lobby",
        type: "projector",
        name: "Lobby",
        order: 1,
      },
      monitor: { id: "monitor", type: "monitor", name: "Stage", order: 2 },
      stream: { id: "stream", type: "stream", name: "Stream", order: 3 },
    });
    expect(result.slice(0, 4).map((o) => o.id)).toEqual([
      "projector",
      "out_lobby",
      "monitor",
      "stream",
    ]);
    expect(result[1].name).toBe("Lobby");
  });

  it("reads the array form", () => {
    const result = normalizeDisplayOutputs([
      { id: "out_lobby", type: "projector", name: "Lobby", order: 0 },
    ]);
    expect(result.map((o) => o.id)).toContain("out_lobby");
    expect(result).toHaveLength(BUILT_IN_COUNT + 1);
  });

  it("restores every built-in a malformed payload dropped", () => {
    const result = normalizeDisplayOutputs({
      out_lobby: {
        id: "out_lobby",
        type: "projector",
        name: "Lobby",
        order: 0,
      },
    });
    expect(result.map((o) => o.id).sort()).toEqual([
      "board",
      "credits",
      "monitor",
      "out_lobby",
      "projector",
      "stream",
      "stream-info",
    ]);
  });

  it("forces a built-in back to its canonical render profile", () => {
    const result = normalizeDisplayOutputs({
      stream: { id: "stream", type: "projector", name: "Stream", order: 0 },
    });
    expect(result.find((o) => o.id === "stream")?.type).toBe("stream");
  });

  it("drops a stale source when a built-in is forced back to a push profile", () => {
    const result = normalizeDisplayOutputs({
      monitor: {
        id: "monitor",
        type: "board",
        name: "Stage",
        order: 0,
        source: { boardAliasId: "youth" },
      },
    });
    const monitor = result.find((o) => o.id === "monitor");
    expect(monitor?.type).toBe("monitor");
    expect(monitor?.source).toBeUndefined();
  });

  it("keeps a board output's configured alias", () => {
    const result = normalizeDisplayOutputs({
      out_foyer: {
        id: "out_foyer",
        type: "board",
        name: "Foyer Board",
        order: 0,
        source: { boardAliasId: "youth" },
      },
    });
    expect(result.find((o) => o.id === "out_foyer")?.source).toEqual({
      boardAliasId: "youth",
    });
  });

  it("strips a source a push output should never have carried", () => {
    const result = normalizeDisplayOutputs([
      {
        id: "out_lobby",
        type: "projector",
        name: "Lobby",
        order: 0,
        source: { boardAliasId: "youth" },
      },
    ]);
    expect(result.find((o) => o.id === "out_lobby")?.source).toBeUndefined();
  });

  it("drops entries with no id, an unknown type, or a duplicate id", () => {
    const result = normalizeDisplayOutputs([
      { id: "", type: "projector", name: "No id", order: 0 },
      { id: "out_bad", type: "hologram", name: "Unknown type", order: 1 },
      { id: "out_dupe", type: "projector", name: "First", order: 2 },
      { id: "out_dupe", type: "monitor", name: "Second", order: 3 },
      null,
      "nonsense",
    ]);
    const ids = result.map((o) => o.id);
    expect(ids).not.toContain("out_bad");
    expect(ids.filter((id) => id === "out_dupe")).toHaveLength(1);
    expect(result.find((o) => o.id === "out_dupe")?.name).toBe("First");
  });

  it("treats a missing enabled flag as enabled and respects an explicit false", () => {
    const result = normalizeDisplayOutputs([
      { id: "out_old", type: "projector", name: "Old", order: 0 },
      {
        id: "out_off",
        type: "projector",
        name: "Retired",
        order: 1,
        enabled: false,
      },
    ]);
    expect(result.find((o) => o.id === "out_old")?.enabled).toBe(true);
    expect(result.find((o) => o.id === "out_off")?.enabled).toBe(false);
  });

  it("sorts by order and reassigns contiguous order values", () => {
    const result = normalizeDisplayOutputs([
      { id: "stream", type: "stream", name: "Stream", order: 90 },
      { id: "out_lobby", type: "projector", name: "Lobby", order: 10 },
      { id: "projector", type: "projector", name: "Main", order: 0 },
      { id: "monitor", type: "monitor", name: "Stage", order: 50 },
    ]);
    expect(result.slice(0, 4).map((o) => o.id)).toEqual([
      "projector",
      "out_lobby",
      "monitor",
      "stream",
    ]);
    expect(result.map((o) => o.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("sorts entries with a non-numeric order to the end rather than dropping them", () => {
    const result = normalizeDisplayOutputs([
      { id: "out_late", type: "projector", name: "Late", order: "oops" },
      { id: "projector", type: "projector", name: "Main", order: 0 },
    ]);
    expect(result[result.length - 1].id).toBe("out_late");
  });
});

describe("serializeDisplayOutputs", () => {
  it("round-trips through normalize", () => {
    const outputs = normalizeDisplayOutputs([
      { id: "out_lobby", type: "projector", name: "Lobby", order: 0 },
    ]);
    expect(normalizeDisplayOutputs(serializeDisplayOutputs(outputs))).toEqual(
      outputs,
    );
  });

  it("keys the map by output id", () => {
    expect(Object.keys(serializeDisplayOutputs([output()]))).toEqual(["out_1"]);
  });

  it("round-trips a bound board output", () => {
    const outputs = normalizeDisplayOutputs([
      {
        id: "out_foyer",
        type: "board",
        name: "Foyer Board",
        order: 0,
        source: { boardAliasId: "youth" },
      },
    ]);
    expect(normalizeDisplayOutputs(serializeDisplayOutputs(outputs))).toEqual(
      outputs,
    );
  });

  it("omits an absent source, which RTDB would reject as undefined", () => {
    const serialized = serializeDisplayOutputs([output()]);
    expect("source" in serialized.out_1).toBe(false);
  });
});

describe("filters", () => {
  const list = [
    output({ id: "projector", name: "Main" }),
    output({ id: "out_lobby", name: "Lobby", enabled: false }),
    output({ id: "monitor", type: "monitor", name: "Stage" }),
  ];

  it("filters to enabled outputs", () => {
    expect(getEnabledDisplayOutputs(list).map((o) => o.id)).toEqual([
      "projector",
      "monitor",
    ]);
  });

  it("filters by render profile", () => {
    expect(getDisplayOutputsByType(list, "projector").map((o) => o.id)).toEqual(
      ["projector", "out_lobby"],
    );
    expect(getDisplayOutputsByType(list, "stream")).toEqual([]);
  });
});

describe("resolveOutputForScreen", () => {
  const outputs = normalizeDisplayOutputs([
    { id: "projector", type: "projector", name: "Main", order: 0 },
    { id: "out_lobby", type: "projector", name: "Lobby", order: 1 },
    { id: "monitor", type: "monitor", name: "Stage", order: 2 },
    { id: "stream", type: "stream", name: "Stream", order: 3 },
  ]);

  it("returns the requested output when it is enabled", () => {
    expect(resolveOutputForScreen(outputs, "out_lobby", "projector").id).toBe(
      "out_lobby",
    );
  });

  it("refuses an output whose profile does not match the surface", () => {
    // /projector-full?output=monitor would otherwise bind the projector page to
    // a monitor slot and render with the wrong profile.
    expect(resolveOutputForScreen(outputs, "monitor", "projector").id).toBe(
      "projector",
    );
    expect(resolveOutputForScreen(outputs, "stream", "monitor").id).toBe(
      "monitor",
    );
  });

  it("falls back to the first enabled output of the surface type when unpaired", () => {
    expect(resolveOutputForScreen(outputs, null, "projector").id).toBe(
      "projector",
    );
    expect(resolveOutputForScreen(outputs, undefined, "monitor").id).toBe(
      "monitor",
    );
  });

  it("keeps a retired display's own slot rather than borrowing another", () => {
    const retired = outputs.map((o) =>
      o.id === "out_lobby" ? { ...o, enabled: false } : o,
    );
    // Showing Main on the lobby projector is worse than showing that display's
    // own empty slot.
    expect(resolveOutputForScreen(retired, "out_lobby", "projector").id).toBe(
      "out_lobby",
    );
  });

  it("keeps an unknown id, since the registry may simply not have synced", () => {
    expect(resolveOutputForScreen(outputs, "out_deleted", "stream").id).toBe(
      "out_deleted",
    );
  });

  it("falls back to the built-in when unpaired and every display is retired", () => {
    const allOff = outputs.map((o) =>
      o.type === "projector" ? { ...o, enabled: false } : o,
    );
    expect(resolveOutputForScreen(allOff, null, "projector").id).toBe(
      "projector",
    );
  });

  it("returns a default output even when the registry is empty", () => {
    expect(resolveOutputForScreen([], null, "stream").id).toBe("stream");
    expect(resolveOutputForScreen([], null, "monitor").id).toBe("monitor");
  });
});

describe("reordering visible outputs", () => {
  const visible = ["projector", "monitor", "stream"];
  const all = [...visible, "credits", "board"];

  it("moves a display past its visible neighbour", () => {
    expect(
      reorderVisibleOutputIds(visible, all, "monitor", "projector"),
    ).toEqual(["monitor", "projector", "stream", "credits", "board"]);
  });

  it("keeps unlisted outputs after the rows the operator can see", () => {
    const result = reorderVisibleOutputIds(visible, all, "stream", "projector");
    expect(result?.slice(3)).toEqual(["credits", "board"]);
  });

  it("treats a drop on the original row as no change", () => {
    expect(
      reorderVisibleOutputIds(visible, all, "monitor", "monitor"),
    ).toBeNull();
  });

  it("ignores a drop involving a row that is not listed", () => {
    expect(reorderVisibleOutputIds(visible, all, "monitor", "credits")).toBeNull();
  });
});
