import { configureStore } from "@reduxjs/toolkit";
import itemListsReducer, {
  updateItemLists,
  initiateItemLists,
  removeFromItemLists,
  selectItemList,
  setActiveItemList,
  setInitialItemList,
  setOutlineScope,
  updateItemListsFromRemote,
} from "./itemListsSlice";
import type { ItemList } from "../types";

type ItemListsSliceState = {
  itemLists: {
    currentLists: ItemList[];
    activeList: ItemList | undefined;
    selectedList: ItemList | undefined;
    isInitialized: boolean;
    // Scope fields are omitted by most preloaded states here on purpose: the
    // reducers must tolerate slices written before scoping existed.
    scope?: string;
    selectedIdByScope?: Record<string, string>;
  };
};

const createStore = (preloadedState?: Partial<ItemListsSliceState>) =>
  configureStore({
    reducer: { itemLists: itemListsReducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as never,
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

    it("updateItemListsFromRemote keeps selected/active ids when still present", () => {
      const store = createStore({
        itemLists: {
          currentLists: [outline("A", "id-a"), outline("B", "id-b")],
          activeList: outline("A", "id-a"),
          selectedList: outline("B", "id-b"),
          isInitialized: true,
        },
      });
      const refreshed = [
        outline("A renamed", "id-a"),
        outline("B", "id-b"),
      ];
      store.dispatch(updateItemListsFromRemote(refreshed));
      const state = store.getState().itemLists;
      expect(state.selectedList?._id).toBe("id-b");
      expect(state.selectedList?.name).toBe("B");
      expect(state.activeList?._id).toBe("id-a");
      expect(state.activeList?.name).toBe("A renamed");
    });
  });

  describe("controller scoping", () => {
    const scoped = (name: string, _id: string, controllerScope?: string): ItemList => ({
      name,
      _id,
      ...(controllerScope ? { controllerScope } : {}),
    });

    const mixed = [
      scoped("Sunday AM", "sun-am"),
      scoped("Lobby Loop", "lobby-1", "ctrl_lobby"),
      scoped("Sunday PM", "sun-pm"),
    ];

    it("opens an unscoped outline for the presentation controller", () => {
      const store = createStore();
      store.dispatch(initiateItemLists(mixed));
      expect(store.getState().itemLists.selectedList?._id).toBe("sun-am");
    });

    it("opens the auxiliary controller in its own outline, never the sanctuary's", () => {
      const store = createStore();
      store.dispatch(setOutlineScope("ctrl_lobby"));
      store.dispatch(initiateItemLists(mixed));
      expect(store.getState().itemLists.selectedList?._id).toBe("lobby-1");
    });

    it("leaves the active list church-wide even in an auxiliary scope", () => {
      const store = createStore();
      store.dispatch(setOutlineScope("ctrl_lobby"));
      store.dispatch(initiateItemLists(mixed));
      expect(store.getState().itemLists.activeList?._id).toBe("sun-am");
    });

    it("remembers each controller's place when switching between them", () => {
      const store = createStore();
      store.dispatch(initiateItemLists(mixed));
      store.dispatch(selectItemList("sun-pm"));
      store.dispatch(setOutlineScope("ctrl_lobby"));
      expect(store.getState().itemLists.selectedList?._id).toBe("lobby-1");
      store.dispatch(setOutlineScope("presentation"));
      expect(store.getState().itemLists.selectedList?._id).toBe("sun-pm");
    });

    it("keeps a remote update from dropping an auxiliary controller into a presentation outline", () => {
      // The named risk: the old fallback was lists[0], which crosses scopes.
      const store = createStore();
      store.dispatch(setOutlineScope("ctrl_lobby"));
      store.dispatch(initiateItemLists(mixed));
      store.dispatch(
        updateItemListsFromRemote([scoped("Sunday AM", "sun-am"), scoped("Sunday PM", "sun-pm")]),
      );
      expect(store.getState().itemLists.selectedList).toBeUndefined();
    });

    it("reselects within scope when the open outline is deleted", () => {
      const store = createStore();
      const twoLobby = [
        scoped("Sunday AM", "sun-am"),
        scoped("Lobby A", "lobby-1", "ctrl_lobby"),
        scoped("Lobby B", "lobby-2", "ctrl_lobby"),
      ];
      store.dispatch(setOutlineScope("ctrl_lobby"));
      store.dispatch(initiateItemLists(twoLobby));
      store.dispatch(selectItemList("lobby-2"));
      store.dispatch(removeFromItemLists("lobby-2"));
      expect(store.getState().itemLists.selectedList?._id).toBe("lobby-1");
    });

    it("does not follow the stored active list across scopes on startup", () => {
      const store = createStore();
      store.dispatch(setOutlineScope("ctrl_lobby"));
      store.dispatch(initiateItemLists(mixed));
      store.dispatch(setInitialItemList("sun-am"));
      const state = store.getState().itemLists;
      expect(state.activeList?._id).toBe("sun-am");
      expect(state.selectedList?._id).toBe("lobby-1");
    });
  });
});
