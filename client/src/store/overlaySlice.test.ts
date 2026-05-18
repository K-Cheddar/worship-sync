import { configureStore } from "@reduxjs/toolkit";
import overlayReducer, {
  selectOverlay,
  setIsOverlayLoading,
  setHasPendingUpdate,
  forceUpdate,
  deleteOverlay,
  updateOverlay,
  markOverlayPersisted,
  bufferRemoteOverlayUpdate,
  discardPendingRemoteOverlay,
  applyPendingRemoteOverlay,
} from "./overlaySlice";
import { createOverlay } from "../test/fixtures";

const createStore = () =>
  configureStore({ reducer: { overlay: overlayReducer } });

describe("overlaySlice", () => {
  describe("initial state", () => {
    it("starts with no selected overlay and no pending updates", () => {
      const store = createStore();
      const state = store.getState().overlay;
      expect(state.selectedOverlay).toBeUndefined();
      expect(state.baseOverlay).toBeNull();
      expect(state.hasPendingUpdate).toBe(false);
      expect(state.isOverlayLoading).toBe(false);
      expect(state.hasRemoteUpdate).toBe(false);
      expect(state.pendingRemoteOverlay).toBeNull();
    });
  });

  describe("selectOverlay", () => {
    it("sets selectedOverlay and baseOverlay when overlay has an id", () => {
      const store = createStore();
      const overlay = createOverlay({ id: "o1", name: "Test Overlay" });
      store.dispatch(selectOverlay(overlay));
      const state = store.getState().overlay;
      expect(state.selectedOverlay?.id).toBe("o1");
      expect(state.baseOverlay?.id).toBe("o1");
      expect(state.hasRemoteUpdate).toBe(false);
      expect(state.pendingRemoteOverlay).toBeNull();
    });

    it("clears state when called with undefined", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(selectOverlay(undefined));
      const state = store.getState().overlay;
      expect(state.selectedOverlay).toBeUndefined();
      expect(state.baseOverlay).toBeNull();
    });

    it("clears state when payload has no id", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(selectOverlay({} as any));
      expect(store.getState().overlay.selectedOverlay).toBeUndefined();
    });
  });

  describe("setIsOverlayLoading", () => {
    it("toggles isOverlayLoading on and off", () => {
      const store = createStore();
      store.dispatch(setIsOverlayLoading(true));
      expect(store.getState().overlay.isOverlayLoading).toBe(true);
      store.dispatch(setIsOverlayLoading(false));
      expect(store.getState().overlay.isOverlayLoading).toBe(false);
    });
  });

  describe("setHasPendingUpdate", () => {
    it("sets hasPendingUpdate to the given value", () => {
      const store = createStore();
      store.dispatch(setHasPendingUpdate(true));
      expect(store.getState().overlay.hasPendingUpdate).toBe(true);
      store.dispatch(setHasPendingUpdate(false));
      expect(store.getState().overlay.hasPendingUpdate).toBe(false);
    });
  });

  describe("forceUpdate", () => {
    it("sets hasPendingUpdate to true", () => {
      const store = createStore();
      store.dispatch(forceUpdate());
      expect(store.getState().overlay.hasPendingUpdate).toBe(true);
    });
  });

  describe("deleteOverlay", () => {
    it("clears selected overlay state and hasPendingUpdate when the selected overlay is deleted", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(deleteOverlay("o1"));
      const state = store.getState().overlay;
      expect(state.selectedOverlay).toBeUndefined();
      expect(state.baseOverlay).toBeNull();
      expect(state.hasPendingUpdate).toBe(false);
    });

    it("sets hasPendingUpdate but keeps selection when a different overlay is deleted", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(deleteOverlay("o2"));
      expect(store.getState().overlay.hasPendingUpdate).toBe(true);
      expect(store.getState().overlay.selectedOverlay?.id).toBe("o1");
    });
  });

  describe("updateOverlay", () => {
    it("merges a partial update into the selected overlay and sets hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1", name: "Original" })));
      store.dispatch(updateOverlay({ id: "o1", name: "Updated" }));
      expect(store.getState().overlay.selectedOverlay?.name).toBe("Updated");
      expect(store.getState().overlay.hasPendingUpdate).toBe(true);
    });

    it("still sets hasPendingUpdate even when id does not match", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1", name: "Original" })));
      store.dispatch(updateOverlay({ id: "o2", name: "Updated" }));
      expect(store.getState().overlay.selectedOverlay?.name).toBe("Original");
      expect(store.getState().overlay.hasPendingUpdate).toBe(true);
    });
  });

  describe("bufferRemoteOverlayUpdate", () => {
    it("stores a remote update for the selected overlay", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(
        bufferRemoteOverlayUpdate(createOverlay({ id: "o1", name: "Remote" })),
      );
      const state = store.getState().overlay;
      expect(state.hasRemoteUpdate).toBe(true);
      expect(state.pendingRemoteOverlay?.name).toBe("Remote");
    });

    it("ignores a remote update for a non-selected overlay", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(
        bufferRemoteOverlayUpdate(createOverlay({ id: "o2" })),
      );
      expect(store.getState().overlay.hasRemoteUpdate).toBe(false);
      expect(store.getState().overlay.pendingRemoteOverlay).toBeNull();
    });
  });

  describe("discardPendingRemoteOverlay", () => {
    it("clears the pending remote update", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(
        bufferRemoteOverlayUpdate(createOverlay({ id: "o1" })),
      );
      store.dispatch(discardPendingRemoteOverlay());
      const state = store.getState().overlay;
      expect(state.hasRemoteUpdate).toBe(false);
      expect(state.pendingRemoteOverlay).toBeNull();
    });
  });

  describe("applyPendingRemoteOverlay", () => {
    it("merges remote overlay into selected, clears pending state, sets hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1", name: "Local" })));
      store.dispatch(
        bufferRemoteOverlayUpdate(createOverlay({ id: "o1", name: "Remote" })),
      );
      store.dispatch(applyPendingRemoteOverlay());
      const state = store.getState().overlay;
      expect(state.selectedOverlay?.name).toBe("Remote");
      expect(state.baseOverlay?.name).toBe("Remote");
      expect(state.hasRemoteUpdate).toBe(false);
      expect(state.pendingRemoteOverlay).toBeNull();
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("does nothing when there is no pending remote overlay", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1", name: "Local" })));
      store.dispatch(applyPendingRemoteOverlay());
      expect(store.getState().overlay.selectedOverlay?.name).toBe("Local");
    });

    it("does nothing when pending id does not match selected id", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(
        bufferRemoteOverlayUpdate(createOverlay({ id: "o1" })),
      );
      // Manually put a mismatched id in pending (simulate race)
      store.dispatch(selectOverlay(createOverlay({ id: "o2" })));
      store.dispatch(applyPendingRemoteOverlay());
      expect(store.getState().overlay.selectedOverlay?.id).toBe("o2");
    });
  });

  describe("markOverlayPersisted", () => {
    it("updates baseOverlay to the committed version and clears remote state", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1", name: "Local" })));
      const committed = createOverlay({ id: "o1", name: "Committed" });
      store.dispatch(markOverlayPersisted(committed));
      const state = store.getState().overlay;
      expect(state.baseOverlay?.name).toBe("Committed");
      expect(state.hasRemoteUpdate).toBe(false);
    });

    it("does nothing when the persisted id does not match the selected overlay", () => {
      const store = createStore();
      store.dispatch(selectOverlay(createOverlay({ id: "o1" })));
      store.dispatch(markOverlayPersisted(createOverlay({ id: "o2" })));
      expect(store.getState().overlay.baseOverlay?.id).toBe("o1");
    });

    it("does nothing when no overlay is selected", () => {
      const store = createStore();
      store.dispatch(markOverlayPersisted(createOverlay({ id: "o1" })));
      expect(store.getState().overlay.baseOverlay).toBeNull();
    });
  });
});
