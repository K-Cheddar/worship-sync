import { configureStore } from "@reduxjs/toolkit";
import itemListsReducer, {
  updateItemLists,
  initiateItemLists,
  removeFromItemLists,
  selectItemList,
  setActiveItemList,
  setInitialItemList,
} from "./itemListsSlice";
import type { ItemList } from "../types";

type ItemListsSliceState = {
  itemLists: {
    currentLists: ItemList[];
    activeList: ItemList | undefined;
    selectedList: ItemList | undefined;
    isInitialized: boolean;
  };
};

const createStore = (preloadedState?: Partial<ItemListsSliceState>) =>
  configureStore({
    reducer: { itemLists: itemListsReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as ItemListsSliceState,
      }),
  });

const outline = (name: string, _id: string): ItemList => ({ name, _id });

describe("itemListsSlice", () => {
  describe("reducer only", () => {
    it("initiateItemLists sets currentLists and active/selected list", () => {
      const store = createStore();
      const lists: ItemList[] = [
        outline("Sunday AM", "outline-1"),
        outline("Sunday PM", "outline-2"),
      ];
      store.dispatch(initiateItemLists(lists));
      const state = store.getState().itemLists;
      expect(state.currentLists).toHaveLength(2);
      expect(state.activeList?._id).toBe("outline-1");
      expect(state.selectedList?._id).toBe("outline-1");
      expect(state.isInitialized).toBe(true);
    });

    it("updateItemLists adds a new outline", () => {
      const store = createStore({
        itemLists: {
          currentLists: [outline("Outline A", "id-a")],
          activeList: outline("Outline A", "id-a"),
          selectedList: outline("Outline A", "id-a"),
          isInitialized: true,
        },
      });
      const newOutline = outline("Outline B", "id-b");
      store.dispatch(
        updateItemLists([
          ...store.getState().itemLists.currentLists,
          newOutline,
        ]),
      );
      const state = store.getState().itemLists;
      expect(state.currentLists).toHaveLength(2);
      expect(state.currentLists[1].name).toBe("Outline B");
      expect(state.currentLists[1]._id).toBe("id-b");
    });

    it("updateItemLists edits an outline (e.g. rename)", () => {
      const store = createStore({
        itemLists: {
          currentLists: [
            outline("Sunday Morning", "id-1"),
            outline("Sunday Evening", "id-2"),
          ],
          activeList: outline("Sunday Morning", "id-1"),
          selectedList: outline("Sunday Morning", "id-1"),
          isInitialized: true,
        },
      });
      const edited = [
        outline("Sunday AM", "id-1"),
        outline("Sunday Evening", "id-2"),
      ];
      store.dispatch(updateItemLists(edited));
      const state = store.getState().itemLists;
      expect(state.currentLists[0].name).toBe("Sunday AM");
      expect(state.currentLists[0]._id).toBe("id-1");
    });

    it("removeFromItemLists deletes an outline", () => {
      const store = createStore({
        itemLists: {
          currentLists: [
            outline("Outline 1", "id-1"),
            outline("Outline 2", "id-2"),
            outline("Outline 3", "id-3"),
          ],
          activeList: outline("Outline 2", "id-2"),
          selectedList: outline("Outline 2", "id-2"),
          isInitialized: true,
        },
      });
      store.dispatch(removeFromItemLists("id-2"));
      const state = store.getState().itemLists;
      expect(state.currentLists).toHaveLength(2);
      expect(state.currentLists.map((l) => l._id)).toEqual(["id-1", "id-3"]);
      expect(state.activeList?._id).toBe("id-1");
      expect(state.selectedList?._id).toBe("id-1");
    });

    it("removeFromItemLists when deleting non-active outline leaves active unchanged", () => {
      const store = createStore({
        itemLists: {
          currentLists: [
            outline("Outline 1", "id-1"),
            outline("Outline 2", "id-2"),
          ],
          activeList: outline("Outline 1", "id-1"),
          selectedList: outline("Outline 1", "id-1"),
          isInitialized: true,
        },
      });
      store.dispatch(removeFromItemLists("id-2"));
      const state = store.getState().itemLists;
      expect(state.currentLists).toHaveLength(1);
      expect(state.activeList?._id).toBe("id-1");
      expect(state.selectedList?._id).toBe("id-1");
    });

    it("selectItemList and setActiveItemList update selected/active outline", () => {
      const store = createStore({
        itemLists: {
          currentLists: [outline("A", "id-a"), outline("B", "id-b")],
          activeList: outline("A", "id-a"),
          selectedList: outline("A", "id-a"),
          isInitialized: true,
        },
      });
      store.dispatch(selectItemList("id-b"));
      expect(store.getState().itemLists.selectedList?._id).toBe("id-b");
      store.dispatch(setActiveItemList("id-b"));
      expect(store.getState().itemLists.activeList?._id).toBe("id-b");
    });

    it("setInitialItemList sets both active and selected list", () => {
      const store = createStore({
        itemLists: {
          currentLists: [outline("A", "id-a"), outline("B", "id-b")],
          activeList: outline("B", "id-b"),
          selectedList: outline("B", "id-b"),
          isInitialized: true,
        },
      });
      store.dispatch(setInitialItemList("id-a"));
      const state = store.getState().itemLists;
      expect(state.activeList?._id).toBe("id-a");
      expect(state.selectedList?._id).toBe("id-a");
    });
  });
});
