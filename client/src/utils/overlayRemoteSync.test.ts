import {
  mergeRemoteOverlayListWithLocalBuffer,
  shouldKeepLocalListRowForRemoteOverlay,
  syncSelectedOverlayFromRemote,
  type OverlaySyncRootSlice,
} from "./overlayRemoteSync";
import { normalizeOverlayForSync } from "./overlayUtils";
import { overlaySlice } from "../store/overlaySlice";

const base = normalizeOverlayForSync({
  id: "o1",
  type: "participant",
  name: "A",
  title: "",
  event: "",
  duration: 7,
});

const remoteNew = normalizeOverlayForSync({
  ...base,
  name: "B",
});

function makeState(overlay: {
  selectedOverlay: typeof base;
  hasPendingUpdate: boolean;
  baseOverlay: typeof base | null;
  pendingRemoteOverlay: typeof base | null;
  hasRemoteUpdate: boolean;
}): OverlaySyncRootSlice {
  return {
    undoable: {
      present: {
        overlay: {
          selectedOverlay: overlay.selectedOverlay,
          isOverlayLoading: false,
          hasPendingUpdate: overlay.hasPendingUpdate,
          baseOverlay: overlay.baseOverlay,
          pendingRemoteOverlay: overlay.pendingRemoteOverlay,
          hasRemoteUpdate: overlay.hasRemoteUpdate,
        },
      },
    },
  };
}

describe("shouldKeepLocalListRowForRemoteOverlay", () => {
  it("returns true on first remote while local has pending edits (buffer not applied yet)", () => {
    const state = makeState({
      selectedOverlay: { ...base, name: "Local" },
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: null,
      hasRemoteUpdate: false,
    });
    const getState = () => state;
    expect(shouldKeepLocalListRowForRemoteOverlay(getState, remoteNew)).toBe(
      true,
    );
  });

  it("returns true when duplicate remote matches pending (conflict still unresolved)", () => {
    const state = makeState({
      selectedOverlay: { ...base, name: "Local" },
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: remoteNew,
      hasRemoteUpdate: true,
    });
    const getState = () => state;
    expect(shouldKeepLocalListRowForRemoteOverlay(getState, remoteNew)).toBe(
      true,
    );
  });

  it("returns false for another overlay id", () => {
    const state = makeState({
      selectedOverlay: { ...base, name: "Local" },
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: remoteNew,
      hasRemoteUpdate: true,
    });
    const getState = () => state;
    const other = { ...remoteNew, id: "o2" };
    expect(shouldKeepLocalListRowForRemoteOverlay(getState, other)).toBe(false);
  });

  it("returns false when no local edits and remote should replace list row", () => {
    const state = makeState({
      selectedOverlay: base,
      hasPendingUpdate: false,
      baseOverlay: base,
      pendingRemoteOverlay: null,
      hasRemoteUpdate: false,
    });
    const getState = () => state;
    expect(shouldKeepLocalListRowForRemoteOverlay(getState, remoteNew)).toBe(
      false,
    );
  });

  it("returns false when remote matches local (echo of pending edits)", () => {
    const localRow = { ...base, name: "Local" };
    const remoteEcho = normalizeOverlayForSync(localRow);
    const state = makeState({
      selectedOverlay: localRow,
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: null,
      hasRemoteUpdate: false,
    });
    const getState = () => state;
    expect(shouldKeepLocalListRowForRemoteOverlay(getState, remoteEcho)).toBe(
      false,
    );
  });
});

describe("syncSelectedOverlayFromRemote", () => {
  it("does not buffer when remote matches local overlay (echo)", () => {
    const localRow = { ...base, name: "Local" };
    const remoteEcho = normalizeOverlayForSync(localRow);
    const state = makeState({
      selectedOverlay: localRow,
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: null,
      hasRemoteUpdate: false,
    });
    const dispatch = jest.fn();
    syncSelectedOverlayFromRemote(dispatch, () => state, remoteEcho);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("buffers when remote differs from local while pending", () => {
    const localRow = { ...base, name: "Local" };
    const state = makeState({
      selectedOverlay: localRow,
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: null,
      hasRemoteUpdate: false,
    });
    const dispatch = jest.fn();
    syncSelectedOverlayFromRemote(dispatch, () => state, remoteNew);
    expect(dispatch).toHaveBeenCalledWith(
      overlaySlice.actions.bufferRemoteOverlayUpdate(remoteNew),
    );
  });
});

describe("mergeRemoteOverlayListWithLocalBuffer", () => {
  it("replaces selected id with selectedOverlay when buffering conflict", () => {
    const localRow = { ...base, name: "Local" };
    const state = makeState({
      selectedOverlay: localRow,
      hasPendingUpdate: true,
      baseOverlay: base,
      pendingRemoteOverlay: remoteNew,
      hasRemoteUpdate: true,
    });
    const getState = () => state;
    const remoteList = [remoteNew, { ...base, id: "o2", name: "X" }];
    const merged = mergeRemoteOverlayListWithLocalBuffer(remoteList, getState);
    expect(merged[0]).toEqual(localRow);
    expect(merged[1]?.name).toBe("X");
  });
});
