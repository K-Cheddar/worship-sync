import { configureStore } from "@reduxjs/toolkit";
import itemListReducer, {
  updateItemList,
  setActiveItemInList,
  removeItemFromList,
  removeItemFromListById,
  addItemToItemList,
  initiateItemList,
  setItemListIsLoading,
  setHasPendingUpdate,
} from "./itemListSlice";
import { createServiceItem } from "../test/fixtures";
import type { ServiceItem } from "../types";

type ItemListState = {
  list: ServiceItem[];
  isLoading: boolean;
  selectedItemListId: string;
  hasPendingUpdate: boolean;
  initialItems: string[];
  isInitialized: boolean;
};

type ItemListSliceState = { itemList: ItemListState };

jest.mock("../utils/generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-list-id",
}));

const createStore = (preloadedState?: Partial<ItemListSliceState>) =>
  configureStore({
    reducer: { itemList: itemListReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as ItemListSliceState,
      }),
  });

describe("itemListSlice", () => {
  describe("reducer only", () => {
    it("initiateItemList sets list and isInitialized", () => {
      const store = createStore();
      const items: ServiceItem[] = [
        createServiceItem({ name: "A", _id: "a", listId: "lid-a" }),
        {
          ...createServiceItem({ name: "B", _id: "b" }),
          listId: undefined,
        } as unknown as ServiceItem,
      ];
      store.dispatch(initiateItemList(items));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.isInitialized).toBe(true);
      expect(state.list[1].listId).toBe("fixed-list-id");
    });

    it("updateItemList replaces list and sets hasPendingUpdate", () => {
      const store = createStore();
      const items = [createServiceItem({ name: "X", _id: "x" })];
      store.dispatch(updateItemList(items));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(1);
      expect(state.list[0].name).toBe("X");
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("setActiveItemInList updates selectedItemListId", () => {
      const store = createStore();
      store.dispatch(setActiveItemInList("selected-id"));
      expect(store.getState().itemList.selectedItemListId).toBe("selected-id");
    });

    it("removeItemFromList removes by listId", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A", _id: "a", listId: "l1" }),
            createServiceItem({ name: "B", _id: "b", listId: "l2" }),
          ],
          isLoading: false,
          selectedItemListId: "l1",
          hasPendingUpdate: false,
          initialItems: ["l1", "l2"],
          isInitialized: true,
        },
      });
      store.dispatch(removeItemFromList("l1"));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(1);
      expect(state.list[0].listId).toBe("l2");
    });

    it("removeItemFromListById removes by _id", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A", _id: "id-a", listId: "l1" }),
            createServiceItem({ name: "B", _id: "id-b", listId: "l2" }),
          ],
          isLoading: false,
          selectedItemListId: "",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      store.dispatch(removeItemFromListById("id-a"));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(1);
      expect(state.list[0]._id).toBe("id-b");
    });

    it("addItemToItemList inserts after selected and sets selected", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A", _id: "a", listId: "l1" }),
            createServiceItem({ name: "B", _id: "b", listId: "l2" }),
          ],
          isLoading: false,
          selectedItemListId: "l1",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const newItem = createServiceItem({ name: "New", _id: "new" });
      store.dispatch(addItemToItemList(newItem));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(3);
      expect(state.list[1].name).toBe("New");
      expect(state.selectedItemListId).toBe("fixed-list-id");
    });

    it("addItemToItemList adds existing song to outline", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "Intro", _id: "intro", listId: "l0" }),
          ],
          isLoading: false,
          selectedItemListId: "l0",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const existingSong = createServiceItem({
        name: "Amazing Grace",
        _id: "song-1",
        type: "song",
      });
      store.dispatch(addItemToItemList(existingSong));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.list[1].type).toBe("song");
      expect(state.list[1].name).toBe("Amazing Grace");
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("addItemToItemList adds existing free form to outline", () => {
      const store = createStore({
        itemList: {
          list: [createServiceItem({ name: "Song", _id: "s1", listId: "l1" })],
          isLoading: false,
          selectedItemListId: "l1",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const existingFree = createServiceItem({
        name: "Announcement",
        _id: "free-1",
        type: "free",
      });
      store.dispatch(addItemToItemList(existingFree));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.list[1].type).toBe("free");
      expect(state.list[1].name).toBe("Announcement");
    });

    it("addItemToItemList adds existing timer to outline", () => {
      const store = createStore({
        itemList: {
          list: [createServiceItem({ name: "Song", _id: "s1", listId: "l1" })],
          isLoading: false,
          selectedItemListId: "l1",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const existingTimer = createServiceItem({
        name: "Welcome Timer",
        _id: "timer-1",
        type: "timer",
      });
      store.dispatch(addItemToItemList(existingTimer));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.list[1].type).toBe("timer");
      expect(state.list[1].name).toBe("Welcome Timer");
    });

    it("removeItemFromList deletes item from outline (e.g. remove song)", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({
              name: "Song A",
              _id: "a",
              listId: "l1",
              type: "song",
            }),
            createServiceItem({
              name: "Song B",
              _id: "b",
              listId: "l2",
              type: "song",
            }),
            createServiceItem({
              name: "Song C",
              _id: "c",
              listId: "l3",
              type: "song",
            }),
          ],
          isLoading: false,
          selectedItemListId: "l2",
          hasPendingUpdate: false,
          initialItems: ["l1", "l2", "l3"],
          isInitialized: true,
        },
      });
      store.dispatch(removeItemFromList("l2"));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.list.map((i) => i.name)).toEqual(["Song A", "Song C"]);
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("removeItemFromListById deletes item from outline by _id (e.g. remove free form)", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({
              name: "Song",
              _id: "s1",
              listId: "l1",
              type: "song",
            }),
            createServiceItem({
              name: "Announcement",
              _id: "ann-1",
              listId: "l2",
              type: "free",
            }),
            createServiceItem({
              name: "Timer",
              _id: "t1",
              listId: "l3",
              type: "timer",
            }),
          ],
          isLoading: false,
          selectedItemListId: "l2",
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      store.dispatch(removeItemFromListById("ann-1"));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(2);
      expect(state.list.map((i) => i._id)).toEqual(["s1", "t1"]);
      expect(state.hasPendingUpdate).toBe(true);
    });

    it("setItemListIsLoading and setHasPendingUpdate update flags", () => {
      const store = createStore();
      store.dispatch(setItemListIsLoading(true));
      expect(store.getState().itemList.isLoading).toBe(true);
      store.dispatch(setHasPendingUpdate(true));
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);
    });
  });
});
