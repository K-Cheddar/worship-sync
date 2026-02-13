import { configureStore } from "@reduxjs/toolkit";
import overlaysReducer, {
  addOverlayToList,
  deleteOverlayHistoryEntry,
  getOverlayHistoryKeysForType,
  mergeOverlayHistoryFromDb,
  initiateOverlayList,
  mergeOverlayIntoHistory,
  mergeOverlaysIntoHistory,
  updateList as updateOverlayList,
  deleteOverlayFromList,
  setHasPendingListUpdate,
  updateOverlayHistoryEntry,
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
          overlayHistory: {},
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
          overlayHistory: {},
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
          overlayHistory: {},
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

  describe("overlay history", () => {
    it("mergeOverlaysIntoHistory adds participant name, title, event", () => {
      const prev: Record<string, string[]> = {};
      const overlays: OverlayInfo[] = [
        createOverlay({
          id: "1",
          type: "participant",
          name: "Alice",
          title: "Host",
          event: "Sunday",
        }),
      ];
      const next = mergeOverlaysIntoHistory(prev, overlays);
      expect(next["participant.name"]).toEqual(["Alice"]);
      expect(next["participant.title"]).toEqual(["Host"]);
      expect(next["participant.event"]).toEqual(["Sunday"]);
    });

    it("mergeOverlaysIntoHistory dedupes and appends", () => {
      const prev: Record<string, string[]> = {
        "participant.name": ["Bob"],
      };
      const overlays: OverlayInfo[] = [
        createOverlay({ id: "1", type: "participant", name: "Alice" }),
        createOverlay({ id: "2", type: "participant", name: "Bob" }),
      ];
      const next = mergeOverlaysIntoHistory(prev, overlays);
      expect(next["participant.name"]).toEqual(["Alice", "Bob"]);
    });

    it("mergeOverlaysIntoHistory ignores empty/whitespace values", () => {
      const next = mergeOverlaysIntoHistory(
        {},
        [createOverlay({ id: "1", type: "participant", name: "  ", title: "" })]
      );
      expect(next["participant.name"]).toBeUndefined();
      expect(next["participant.title"]).toBeUndefined();
    });

    it("mergeOverlayHistoryFromDb sets overlayHistory when state is empty", () => {
      const store = createStore();
      const history = { "participant.name": ["Alice", "Bob"] };
      store.dispatch(mergeOverlayHistoryFromDb(history));
      expect(store.getState().overlays.overlayHistory).toEqual(history);
    });

    it("deleteOverlayHistoryEntry removes key", () => {
      const store = createStore({
        overlays: {
          overlayHistory: { "participant.name": ["A"], "participant.title": ["Host"] },
          list: [],
          initialList: [],
          hasPendingUpdate: false,
          isInitialized: false,
        },
      });
      store.dispatch(deleteOverlayHistoryEntry("participant.name"));
      expect(store.getState().overlays.overlayHistory).toEqual({
        "participant.title": ["Host"],
      });
    });

    it("updateOverlayHistoryEntry sets values for key", () => {
      const store = createStore();
      store.dispatch(
        updateOverlayHistoryEntry({
          key: "participant.name",
          values: ["Alice", "Bob"],
        })
      );
      expect(store.getState().overlays.overlayHistory["participant.name"]).toEqual([
        "Alice",
        "Bob",
      ]);
    });

    it("mergeOverlayIntoHistory merges single overlay into state", () => {
      const store = createStore();
      store.dispatch(
        mergeOverlayIntoHistory(
          createOverlay({
            id: "1",
            type: "stick-to-bottom",
            heading: "Welcome",
            subHeading: "Guest",
          })
        )
      );
      expect(store.getState().overlays.overlayHistory["stick-to-bottom.heading"]).toEqual([
        "Welcome",
      ]);
      expect(store.getState().overlays.overlayHistory["stick-to-bottom.subHeading"]).toEqual([
        "Guest",
      ]);
    });

    it("getOverlayHistoryKeysForType returns keys for overlay type", () => {
      expect(getOverlayHistoryKeysForType("participant")).toEqual([
        "participant.name",
        "participant.title",
        "participant.event",
      ]);
      expect(getOverlayHistoryKeysForType("stick-to-bottom")).toEqual([
        "stick-to-bottom.heading",
        "stick-to-bottom.subHeading",
      ]);
      expect(getOverlayHistoryKeysForType("qr-code")).toEqual([
        "qr-code.url",
        "qr-code.description",
      ]);
      expect(getOverlayHistoryKeysForType("image")).toEqual(["image.name"]);
      expect(getOverlayHistoryKeysForType(undefined)).toEqual([
        "participant.name",
        "participant.title",
        "participant.event",
      ]);
    });
  });
});
