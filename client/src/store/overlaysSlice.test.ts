import { configureStore } from "@reduxjs/toolkit";
import overlaysReducer, {
  addOverlayToList,
  initiateOverlayList,
  updateList as updateOverlayList,
  deleteOverlayFromList,
  setHasPendingListUpdate,
} from "./overlaysSlice";
import type { OverlayInfo } from "../types";
import { createOverlay } from "../test/fixtures";

jest.mock("../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-overlay-id",
}));

type OverlaysState = ReturnType<typeof overlaysReducer>;
type OverlaysSliceState = { overlays: OverlaysState };

const createStore = (preloadedState?: Partial<OverlaysSliceState>) =>
  configureStore({
    reducer: { overlays: overlaysReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as OverlaysSliceState,
      }),
  });

describe("overlaysSlice", () => {
  describe("reducer only", () => {
    it("initiateOverlayList sets list and isInitialized", () => {
      const store = createStore();
      const list: OverlayInfo[] = [
        createOverlay({ id: "o1", name: "Overlay 1", event: "event1" }),
      ];
      store.dispatch(initiateOverlayList(list));
      const state = store.getState().overlays;
      expect(state.list).toHaveLength(1);
      expect(state.list[0].name).toBe("Overlay 1");
      expect(state.isInitialized).toBe(true);
      expect(state.initialList).toEqual(["o1"]);
    });

    it("initiateOverlayList with empty payload clears list", () => {
      const store = createStore({
        overlays: {
          hasPendingUpdate: false,
          list: [createOverlay({ id: "o1", name: "O1" })],
          initialList: ["o1"],
          isInitialized: true,
        },
      });
      store.dispatch(initiateOverlayList([]));
      expect(store.getState().overlays.list).toHaveLength(0);
    });

    it("updateOverlayList replaces list and sets hasPendingUpdate", () => {
      const store = createStore();
      const list: OverlayInfo[] = [
        createOverlay({ id: "a", name: "A" }),
        createOverlay({ id: "b", name: "B" }),
      ];
      store.dispatch(updateOverlayList(list));
      expect(store.getState().overlays.list).toHaveLength(2);
      expect(store.getState().overlays.hasPendingUpdate).toBe(true);
    });

    it("addOverlayToList inserts after selectedOverlayId", () => {
      const store = createStore({
        overlays: {
          hasPendingUpdate: false,
          initialList: [],
          isInitialized: false,
          list: [
            createOverlay({ id: "1", name: "First" }),
            createOverlay({ id: "2", name: "Second" }),
          ],
        },
      });
      store.dispatch(
        addOverlayToList({
          newOverlay: createOverlay({ id: "new", name: "New" }),
          selectedOverlayId: "1",
        }),
      );
      const list = store.getState().overlays.list;
      expect(list).toHaveLength(3);
      expect(list[1].id).toBe("new");
    });

    it("deleteOverlayFromList removes overlay by id", () => {
      const store = createStore({
        overlays: {
          hasPendingUpdate: false,
          list: [
            createOverlay({ id: "1", name: "A" }),
            createOverlay({ id: "2", name: "B" }),
          ],
          initialList: ["1", "2"],
          isInitialized: true,
        },
      });
      store.dispatch(deleteOverlayFromList("1"));
      expect(store.getState().overlays.list).toHaveLength(1);
      expect(store.getState().overlays.list[0].id).toBe("2");
    });

    it("setHasPendingUpdate sets hasPendingUpdate", () => {
      const store = createStore();
      store.dispatch(setHasPendingListUpdate(true));
      expect(store.getState().overlays.hasPendingUpdate).toBe(true);
      store.dispatch(setHasPendingListUpdate(false));
      expect(store.getState().overlays.hasPendingUpdate).toBe(false);
    });
  });
});
