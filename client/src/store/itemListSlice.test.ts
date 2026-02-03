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

    it("setItemListIsLoading and setHasPendingUpdate update flags", () => {
      const store = createStore();
      store.dispatch(setItemListIsLoading(true));
      expect(store.getState().itemList.isLoading).toBe(true);
      store.dispatch(setHasPendingUpdate(true));
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);
    });
  });
});
