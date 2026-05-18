import { configureStore } from "@reduxjs/toolkit";
import allItemsReducer, {
  updateAllItemsList,
  initiateAllItemsList,
  updateAllItemsListFromRemote,
  removeItemFromAllItemsList,
  addItemToAllItemsList,
  setIsInitialized,
  setSongSearchValue,
  setFreeFormSearchValue,
  setTimerSearchValue,
} from "./allItemsSlice";
import { createServiceItem } from "../test/fixtures";

const createStore = () =>
  configureStore({ reducer: { allItems: allItemsReducer } });

describe("allItemsSlice", () => {
  describe("initial state", () => {
    it("starts with empty list and loading=true", () => {
      const store = createStore();
      const state = store.getState().allItems;
      expect(state.list).toEqual([]);
      expect(state.isAllItemsLoading).toBe(true);
      expect(state.isInitialized).toBe(false);
      expect(state.songSearchValue).toBe("");
    });
  });

  describe("updateAllItemsList", () => {
    it("replaces the list", () => {
      const store = createStore();
      const items = [createServiceItem({ _id: "i1", name: "Item 1" })];
      store.dispatch(updateAllItemsList(items));
      expect(store.getState().allItems.list).toHaveLength(1);
    });
  });

  describe("initiateAllItemsList", () => {
    it("sets list, clears loading, and marks initialized", () => {
      const store = createStore();
      const items = [createServiceItem({ _id: "i1", name: "Item 1" })];
      store.dispatch(initiateAllItemsList(items));
      const state = store.getState().allItems;
      expect(state.list).toHaveLength(1);
      expect(state.isAllItemsLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
    });
  });

  describe("updateAllItemsListFromRemote", () => {
    it("replaces the list from remote data", () => {
      const store = createStore();
      const items = [
        createServiceItem({ _id: "r1", name: "Remote" }),
        createServiceItem({ _id: "r2", name: "Remote 2" }),
      ];
      store.dispatch(updateAllItemsListFromRemote(items));
      expect(store.getState().allItems.list).toHaveLength(2);
    });
  });

  describe("removeItemFromAllItemsList", () => {
    it("removes item by _id", () => {
      const store = createStore();
      store.dispatch(
        updateAllItemsList([
          createServiceItem({ _id: "i1", name: "Keep" }),
          createServiceItem({ _id: "i2", name: "Remove" }),
        ]),
      );
      store.dispatch(removeItemFromAllItemsList("i2"));
      expect(store.getState().allItems.list).toHaveLength(1);
      expect(store.getState().allItems.list[0]._id).toBe("i1");
    });

    it("is a no-op when id does not exist", () => {
      const store = createStore();
      store.dispatch(
        updateAllItemsList([createServiceItem({ _id: "i1", name: "Keep" })]),
      );
      store.dispatch(removeItemFromAllItemsList("missing"));
      expect(store.getState().allItems.list).toHaveLength(1);
    });
  });

  describe("addItemToAllItemsList", () => {
    it("appends an item to the list", () => {
      const store = createStore();
      store.dispatch(
        addItemToAllItemsList(createServiceItem({ _id: "i1", name: "New" })),
      );
      expect(store.getState().allItems.list).toHaveLength(1);
      expect(store.getState().allItems.list[0]._id).toBe("i1");
    });
  });

  describe("setIsInitialized", () => {
    it("sets isInitialized flag", () => {
      const store = createStore();
      store.dispatch(setIsInitialized(true));
      expect(store.getState().allItems.isInitialized).toBe(true);
    });
  });

  describe("search value setters", () => {
    it("setSongSearchValue", () => {
      const store = createStore();
      store.dispatch(setSongSearchValue("amazing grace"));
      expect(store.getState().allItems.songSearchValue).toBe("amazing grace");
    });

    it("setFreeFormSearchValue", () => {
      const store = createStore();
      store.dispatch(setFreeFormSearchValue("welcome"));
      expect(store.getState().allItems.freeFormSearchValue).toBe("welcome");
    });

    it("setTimerSearchValue", () => {
      const store = createStore();
      store.dispatch(setTimerSearchValue("countdown"));
      expect(store.getState().allItems.timerSearchValue).toBe("countdown");
    });
  });
});
