import reducer, {
  createOutputSlot,
  selectFollowerOutputIds,
  selectOutputFollowing,
  selectOutputSlot,
  selectResolvedOutputSlot,
  setOutputFollowing,
  syncOutputSlots,
  updateOutputsFromRemote,
  updatePresentation,
  setOutputTransmitting,
  type PresentationState,
} from "./presentationSlice";

/**
 * Follow mode.
 *
 * The design claim under test: mirroring is resolved when a surface *reads* its
 * slot, never when a controller writes one. Everything else — content held and
 * restored, two controllers never fighting over a slot — is supposed to fall
 * out of that.
 */

const baseState = (): PresentationState => {
  let state: PresentationState = { outputs: {} };
  state = reducer(
    state,
    syncOutputSlots([
      { id: "projector", type: "projector" },
      { id: "out_lobby", type: "projector" },
      { id: "out_cafe", type: "projector" },
      { id: "stream", type: "stream" },
    ]),
  ) as PresentationState;
  for (const id of ["projector", "out_lobby", "out_cafe", "stream"]) {
    state = reducer(
      state,
      setOutputTransmitting({ outputId: id, value: true }),
    ) as PresentationState;
  }
  return state;
};

const wrap = (state: PresentationState) => ({ presentation: state });

const slide = (name: string) => ({
  type: "song",
  name,
  slide: {
    type: "Verse" as const,
    name,
    id: `slide-${name}`,
    boxes: [{ words: name, width: 100, height: 100 }],
  },
});

const send = (
  state: PresentationState,
  name: string,
  outputIds: string[],
): PresentationState =>
  reducer(
    state,
    updatePresentation({ ...slide(name), outputIds }),
  ) as PresentationState;

const follow = (state: PresentationState, outputId: string, sourceId: string) =>
  reducer(
    state,
    setOutputFollowing({ outputId, followingOutputId: sourceId }),
  ) as PresentationState;

describe("resolving a followed display", () => {
  it("renders its own content when not following", () => {
    let state = baseState();
    state = send(state, "Lobby Notice", ["out_lobby"]);
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Lobby Notice",
    );
  });

  it("renders the source's content while following", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "projector");
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Sermon",
    );
  });

  it("keeps following live, not as a one-time copy", () => {
    let state = baseState();
    state = follow(state, "out_lobby", "projector");
    state = send(state, "Verse 1", ["projector"]);
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Verse 1",
    );
    state = send(state, "Verse 2", ["projector"]);
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Verse 2",
    );
  });

  it("returns an existing slot object, so display windows do not re-render on every read", () => {
    let state = baseState();
    state = follow(state, "out_lobby", "projector");
    const first = selectResolvedOutputSlot(wrap(state), "out_lobby");
    const second = selectResolvedOutputSlot(wrap(state), "out_lobby");
    expect(first).toBe(second);
    expect(first).toBe(state.outputs.projector);
  });

  it("falls back to its own content if the source display disappears", () => {
    let state = baseState();
    state = send(state, "Lobby Notice", ["out_lobby"]);
    state = follow(state, "out_lobby", "out_cafe");
    state = reducer(
      state,
      syncOutputSlots([
        { id: "projector", type: "projector" },
        { id: "out_lobby", type: "projector" },
        { id: "stream", type: "stream" },
      ]),
    ) as PresentationState;
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Lobby Notice",
    );
  });

  it("returns a blank slot of the right profile for an unknown display", () => {
    const state = baseState();
    expect(
      selectResolvedOutputSlot(wrap(state), "out_missing", "stream").type,
    ).toBe("stream");
  });
});

describe("content is held and restored", () => {
  it("keeps taking sends while following, unseen", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "projector");
    state = send(state, "Staged Notice", ["out_lobby"]);

    // The room still sees the sanctuary.
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Sermon",
    );
    // The lobby's own slot has quietly moved on.
    expect(selectOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Staged Notice",
    );
  });

  it("puts the staged content on screen the moment it stops following", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "projector");
    state = send(state, "Staged Notice", ["out_lobby"]);
    state = follow(state, "out_lobby", "");

    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Staged Notice",
    );
  });

  it("fades out of what the room was actually watching", () => {
    // Fading from this display's own last slide would animate away content that
    // was never on screen.
    let state = baseState();
    state = send(state, "Old Lobby Slide", ["out_lobby"]);
    state = follow(state, "out_lobby", "projector");
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "");

    const slot = selectOutputSlot(wrap(state), "out_lobby");
    expect(slot.prevInfo.name).toBe("Sermon");
    expect(slot.info.transitionDirection).toBe("jump");
  });
});

describe("the mirroring controller never writes the source's slot", () => {
  it("leaves the source untouched while following", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "projector");
    state = send(state, "Staged Notice", ["out_lobby"]);
    expect(selectOutputSlot(wrap(state), "projector").info.name).toBe("Sermon");
  });

  it("leaves the source untouched when it stops following", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = follow(state, "out_lobby", "projector");
    state = follow(state, "out_lobby", "");
    expect(selectOutputSlot(wrap(state), "projector").info.name).toBe("Sermon");
  });
});

describe("live state stays the display's own", () => {
  it("does not put a dark display on air by mirroring a live one", () => {
    let state = baseState();
    state = reducer(
      state,
      setOutputTransmitting({ outputId: "out_lobby", value: false }),
    ) as PresentationState;
    state = follow(state, "out_lobby", "projector");
    expect(selectOutputSlot(wrap(state), "out_lobby").isTransmitting).toBe(
      false,
    );
  });
});

describe("one-hop guarantees", () => {
  it("refuses to follow itself", () => {
    let state = baseState();
    state = follow(state, "out_lobby", "out_lobby");
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
  });

  it("refuses to follow a different render profile", () => {
    let state = baseState();
    state = follow(state, "out_lobby", "stream");
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
  });

  it("refuses to follow a display that is itself following", () => {
    let state = baseState();
    state = follow(state, "out_cafe", "projector");
    state = follow(state, "out_lobby", "out_cafe");
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
  });

  it("refuses to start following while another display follows this one", () => {
    let state = baseState();
    state = follow(state, "out_cafe", "out_lobby");
    state = follow(state, "out_lobby", "projector");
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
    // and the existing follower is undisturbed
    expect(selectOutputFollowing(wrap(state), "out_cafe")).toBe("out_lobby");
  });

  it("ignores an unknown source rather than blanking the display", () => {
    let state = baseState();
    state = send(state, "Lobby Notice", ["out_lobby"]);
    state = follow(state, "out_lobby", "out_nope");
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Lobby Notice",
    );
  });
});

describe("follow state syncs between clients", () => {
  it("applies a remote follow", () => {
    let state = baseState();
    state = send(state, "Sermon", ["projector"]);
    state = reducer(
      state,
      updateOutputsFromRemote({
        out_lobby: { type: "projector", followingOutputId: "projector" },
      }),
    ) as PresentationState;
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Sermon",
    );
  });

  it("applies a remote unfollow", () => {
    let state = baseState();
    state = send(state, "Lobby Notice", ["out_lobby"]);
    state = follow(state, "out_lobby", "projector");
    state = reducer(
      state,
      updateOutputsFromRemote({
        out_lobby: { type: "projector", followingOutputId: "" },
      }),
    ) as PresentationState;
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
    expect(selectResolvedOutputSlot(wrap(state), "out_lobby").info.name).toBe(
      "Lobby Notice",
    );
  });

  it("re-checks the one-hop rules on receipt, so a stale client cannot install a chain", () => {
    let state = baseState();
    state = follow(state, "out_cafe", "projector");
    state = reducer(
      state,
      updateOutputsFromRemote({
        out_lobby: { type: "projector", followingOutputId: "out_cafe" },
      }),
    ) as PresentationState;
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
  });

  it("rejects a remote self-follow", () => {
    let state = baseState();
    state = reducer(
      state,
      updateOutputsFromRemote({
        out_lobby: { type: "projector", followingOutputId: "out_lobby" },
      }),
    ) as PresentationState;
    expect(selectOutputFollowing(wrap(state), "out_lobby")).toBe("");
  });
});

describe("selectFollowerOutputIds", () => {
  it("tells the source's controller that another screen is watching", () => {
    let state = baseState();
    state = follow(state, "out_lobby", "projector");
    state = follow(state, "out_cafe", "projector");
    // Copy before sorting: the selector is memoized and hands back a shared
    // array, so sorting in place would corrupt what every subscriber sees.
    expect(
      [...selectFollowerOutputIds(wrap(state), "projector")].sort(),
    ).toEqual(["out_cafe", "out_lobby"]);
    expect(selectFollowerOutputIds(wrap(state), "out_lobby")).toEqual([]);
  });

  it("returns a stable empty array when nothing mirrors this output", () => {
    const state = wrap(baseState());
    expect(selectFollowerOutputIds(state, "projector")).toBe(
      selectFollowerOutputIds(state, "projector"),
    );
  });
});

describe("new slots", () => {
  it("start unfollowed", () => {
    expect(createOutputSlot("out_new", "projector").followingOutputId).toBe("");
  });
});
