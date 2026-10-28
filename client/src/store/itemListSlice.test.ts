import { configureStore } from "@reduxjs/toolkit";
import itemListReducer, {
  updateItemList,
  setActiveItemInList,
  removeItemFromList,
  removeItemFromListById,
  addItemToItemList,
  ensureCanvaItemInItemList,
  initiateItemList,
  setItemListIsLoading,
  setHasPendingUpdate,
  updateItemListFromRemote,
  recordOutlineConflict,
  markItemListPersisted,
  resolveOutlineConflict,
} from "./itemListSlice";
import { createServiceItem } from "../test/fixtures";
import type { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";

jest.mock("../utils/generateRandomId");
const mockGenerateRandomId = jest.mocked(generateRandomId);

type TestRootState = { itemList: ReturnType<typeof itemListReducer> };

const createStore = (preloadedState?: any) =>
  configureStore({
    reducer: { itemList: itemListReducer },
    preloadedState: preloadedState as TestRootState | undefined,
  });

describe("itemListSlice", () => {
  describe("reducer only", () => {
    beforeEach(() => {
      let n = 0;
      mockGenerateRandomId.mockImplementation(() => `list-id-${++n}`);
    });

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
      expect(state.list[1].listId).toBe("list-id-1");
      expect(state.hasPendingUpdate).toBe(false);
    });

    it("merges independent remote row edits without clearing pending local work", () => {
      const baseline = [
        createServiceItem({ name: "A", _id: "a", listId: "l1" }),
        createServiceItem({ name: "B", _id: "b", listId: "l2" }),
      ];
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A local", _id: "a", listId: "l1" }),
            baseline[1],
          ],
          isLoading: false,
          selectedItemListId: "",
          insertPointIndex: 1,
          hasPendingUpdate: true,
          initialItems: ["l1", "l2"],
          isInitialized: true,
          syncBaseline: baseline,
          loadedOutlineId: "outline",
          remoteConflicts: {},
        },
      });
      store.dispatch(
        updateItemListFromRemote([
          baseline[0],
          createServiceItem({ name: "B remote", _id: "b", listId: "l2" }),
        ]),
      );
      const state = store.getState().itemList;
      expect(state.list.map((item) => item.name)).toEqual(["A local", "B remote"]);
      expect(state.list.map((item) => item.listId)).toEqual(["l1", "l2"]);
      expect(state.syncBaseline.map((item) => item.name)).toEqual(["A", "B remote"]);
      expect(state.hasPendingUpdate).toBe(true);
      expect(state.insertPointIndex).toBe(1);
    });

    it("retains both drafts when the same row changes concurrently and resolves explicitly", () => {
      const baseline = [createServiceItem({ name: "Base", _id: "a", listId: "l1" })];
      const local = createServiceItem({ name: "Local draft", _id: "a", listId: "l1" });
      const remote = createServiceItem({ name: "Remote draft", _id: "a", listId: "l1" });
      const store = createStore({
        itemList: {
          list: [local],
          isLoading: false,
          selectedItemListId: "l1",
          insertPointIndex: 0,
          hasPendingUpdate: true,
          initialItems: ["l1"],
          isInitialized: true,
          syncBaseline: baseline,
          loadedOutlineId: "outline",
          remoteConflicts: {},
        },
      });

      store.dispatch(updateItemListFromRemote([remote]));
      expect(store.getState().itemList.list[0].name).toBe("Local draft");
      expect(store.getState().itemList.remoteConflicts.outline.remoteItems[0].name).toBe("Remote draft");
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);

      const remoteAddition = createServiceItem({
        name: "Remote addition",
        _id: "b",
        listId: "l2",
      });
      store.dispatch(updateItemListFromRemote({
        outlineId: "outline",
        items: [remote, remoteAddition],
      }));
      expect(store.getState().itemList.remoteConflicts.outline.localItems).toEqual([
        expect.objectContaining({ name: "Local draft" }),
        expect.objectContaining({ name: "Remote addition" }),
      ]);
      expect(store.getState().itemList.remoteConflicts.outline.remoteItems).toEqual([
        remote,
        remoteAddition,
      ]);
      store.dispatch(markItemListPersisted({
        outlineId: "outline",
        submittedItems: [local],
        items: [remote, remoteAddition],
      }));
      expect(store.getState().itemList.remoteConflicts.outline).toBeDefined();
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);

      store.dispatch(resolveOutlineConflict({
        outlineId: "outline",
        choice: "use-remote",
      }));
      expect(store.getState().itemList.list.map((item) => item.name)).toEqual([
        "Remote draft",
        "Remote addition",
      ]);
      expect(store.getState().itemList.hasPendingUpdate).toBe(false);
    });

    it("keeps edits made after the conflict banner appeared", () => {
      const baseline = [createServiceItem({ name: "Base", _id: "a", listId: "l1" })];
      const firstDraft = createServiceItem({ name: "First draft", _id: "a", listId: "l1" });
      const remote = createServiceItem({ name: "Remote draft", _id: "a", listId: "l1" });
      const latestDraft = createServiceItem({ name: "Latest draft", _id: "a", listId: "l1" });
      const store = createStore({
        itemList: {
          list: [firstDraft],
          isLoading: false,
          selectedItemListId: "l1",
          insertPointIndex: 0,
          hasPendingUpdate: true,
          initialItems: ["l1"],
          isInitialized: true,
          syncBaseline: baseline,
          loadedOutlineId: "outline",
          remoteConflicts: {},
        },
      });

      store.dispatch(updateItemListFromRemote({ outlineId: "outline", items: [remote] }));
      store.dispatch(updateItemList([latestDraft]));
      store.dispatch(resolveOutlineConflict({ outlineId: "outline", choice: "keep-local" }));

      expect(store.getState().itemList.list).toEqual([latestDraft]);
      expect(store.getState().itemList.syncBaseline).toEqual([remote]);
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);
      expect(store.getState().itemList.remoteConflicts.outline?.resolutionChoice).toBe("keep-local");
    });

    it("rebases a newer local draft over remote rows included by an earlier save acknowledgment", () => {
      const submitted = [
        createServiceItem({ name: "A saved", _id: "a", listId: "l1" }),
      ];
      const newerLocal = [
        createServiceItem({ name: "A newer draft", _id: "a", listId: "l1" }),
      ];
      const persisted = [
        submitted[0],
        createServiceItem({ name: "Remote addition", _id: "b", listId: "l2" }),
      ];
      const store = createStore({
        itemList: {
          list: newerLocal,
          isLoading: false,
          selectedItemListId: "l1",
          insertPointIndex: 0,
          hasPendingUpdate: true,
          initialItems: ["l1"],
          isInitialized: true,
          syncBaseline: [createServiceItem({ name: "A", _id: "a", listId: "l1" })],
          loadedOutlineId: "outline",
          remoteConflicts: {},
        },
      });

      store.dispatch(markItemListPersisted({
        outlineId: "outline",
        submittedItems: submitted,
        items: persisted,
      }));

      expect(store.getState().itemList.list).toEqual([
        expect.objectContaining({ name: "A newer draft", listId: "l1" }),
        expect.objectContaining({ name: "Remote addition", listId: "l2" }),
      ]);
      expect(store.getState().itemList.syncBaseline).toEqual(persisted);
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);
    });

    it("retains latest conflict edits and remote baseline across navigation and repeated notifications", () => {
      const store = createStore();
      const base = createServiceItem({ name: "Base", listId: "row", _id: "base" });
      const remote = { ...base, name: "Remote" };
      store.dispatch(initiateItemList({ outlineId: "a", items: [base] }));
      store.dispatch(updateItemList([{ ...base, name: "Local" }]));
      store.dispatch(updateItemListFromRemote({ outlineId: "a", items: [remote] }));
      store.dispatch(addItemToItemList(createServiceItem({ name: "After conflict", _id: "later" })));
      const latest = store.getState().itemList.list;
      store.dispatch(initiateItemList({ outlineId: "b", items: [] }));
      store.dispatch(initiateItemList({ outlineId: "a", items: [remote] }));
      store.dispatch(updateItemListFromRemote({ outlineId: "a", items: [remote] }));
      store.dispatch(updateItemListFromRemote({ outlineId: "a", items: [remote] }));
      expect(store.getState().itemList.list).toEqual(latest);
      expect(store.getState().itemList.syncBaseline).toEqual([remote]);
      expect(store.getState().itemList.remoteConflicts.a.localItems).toEqual(latest);
      store.dispatch(resolveOutlineConflict({ outlineId: "a", choice: "keep-local" }));
      expect(store.getState().itemList.remoteConflicts.a).toBeDefined();
      store.dispatch(markItemListPersisted({ outlineId: "a", submittedItems: latest, items: latest }));
      expect(store.getState().itemList.remoteConflicts.a).toBeUndefined();
    });

    it("clears only the acknowledged outgoing resolution and explicitly discards later edits with Use remote", () => {
      const store = createStore();
      const base = createServiceItem({ name: "Base", listId: "row", _id: "base" });
      const conflict = (id: string) => {
        store.dispatch(initiateItemList({ outlineId: id, items: [base] }));
        store.dispatch(updateItemList([{ ...base, name: `Local ${id}` }]));
        store.dispatch(updateItemListFromRemote({ outlineId: id, items: [{ ...base, name: `Remote ${id}` }] }));
      };
      conflict("a");
      store.dispatch(addItemToItemList(createServiceItem({ name: "Later", _id: "later" })));
      store.dispatch(resolveOutlineConflict({ outlineId: "a", choice: "keep-local" }));
      const submitted = store.getState().itemList.list;
      conflict("b");
      store.dispatch(markItemListPersisted({ outlineId: "a", submittedItems: submitted, items: submitted }));
      expect(store.getState().itemList.remoteConflicts.a).toBeUndefined();
      expect(store.getState().itemList.remoteConflicts.b).toBeDefined();
      store.dispatch(addItemToItemList(createServiceItem({ name: "Later B", _id: "later-b" })));
      store.dispatch(resolveOutlineConflict({ outlineId: "b", choice: "use-remote" }));
      expect(store.getState().itemList.list.map((item) => item.name)).toEqual(["Remote b"]);
      expect(store.getState().itemList.remoteConflicts.b).toBeUndefined();
    });

    it("keeps a save conflict by outline when it arrives after switching outlines", () => {
      const baseline = [createServiceItem({ name: "Base", _id: "a", listId: "l1" })];
      const local = [createServiceItem({ name: "Local draft", _id: "a", listId: "l1" })];
      const remote = [createServiceItem({ name: "Remote draft", _id: "a", listId: "l1" })];
      const currentOutline = [createServiceItem({ name: "Other outline", _id: "b", listId: "l2" })];
      const store = createStore({
        itemList: {
          list: currentOutline,
          isLoading: false,
          selectedItemListId: "l2",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: ["l2"],
          isInitialized: true,
          syncBaseline: currentOutline,
          loadedOutlineId: "outline-b",
          remoteConflicts: {},
        },
      });

      store.dispatch(recordOutlineConflict({
        outlineId: "outline-a",
        baselineItems: baseline,
        localItems: local,
        remoteItems: remote,
      }));
      expect(store.getState().itemList.list).toEqual(currentOutline);
      expect(store.getState().itemList.remoteConflicts["outline-a"]).toEqual(
        expect.objectContaining({
          localItems: [expect.objectContaining({ name: "Local draft" })],
          remoteItems: [expect.objectContaining({ name: "Remote draft" })],
        }),
      );

      store.dispatch(initiateItemList({ outlineId: "outline-a", items: remote }));
      expect(store.getState().itemList.list[0].name).toBe("Local draft");
      expect(store.getState().itemList.hasPendingUpdate).toBe(true);
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

    it("setActiveItemInList updates selectedItemListId and insertPointIndex", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A", _id: "a", listId: "l1" }),
            createServiceItem({ name: "B", _id: "b", listId: "l2" }),
          ],
          isLoading: false,
          selectedItemListId: "",
          insertPointIndex: -1,
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      store.dispatch(setActiveItemInList("l2"));
      const state = store.getState().itemList;
      expect(state.selectedItemListId).toBe("l2");
      expect(state.insertPointIndex).toBe(1);
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
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: ["l1", "l2"],
          isInitialized: true,
        },
      });
      store.dispatch(removeItemFromList("l1"));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(1);
      expect(state.list[0].listId).toBe("l2");
      expect(state.insertPointIndex).toBe(-1);
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
          insertPointIndex: -1,
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

    it("addItemToItemList inserts after selected and sets selected and insertPoint", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "A", _id: "a", listId: "l1" }),
            createServiceItem({ name: "B", _id: "b", listId: "l2" }),
          ],
          isLoading: false,
          selectedItemListId: "l1",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const newItem = {
        ...createServiceItem({ name: "New", _id: "new" }),
        listId: undefined,
      } as unknown as ServiceItem;
      store.dispatch(addItemToItemList(newItem));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(3);
      expect(state.list[1].name).toBe("New");
      expect(state.selectedItemListId).toBe("list-id-1");
      expect(state.insertPointIndex).toBe(1);
    });

    it("addItemToItemList inserts directly under a selected heading", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({
              name: "Section",
              _id: "h1",
              listId: "lid-h",
              type: "heading",
            }),
            createServiceItem({ name: "Song", _id: "s1", listId: "l1" }),
          ],
          isLoading: false,
          selectedItemListId: "lid-h",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const newItem = {
        ...createServiceItem({ name: "New", _id: "new" }),
        listId: undefined,
      } as unknown as ServiceItem;
      store.dispatch(addItemToItemList(newItem));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(3);
      expect(state.list[0].type).toBe("heading");
      expect(state.list[1].name).toBe("New");
      expect(state.list[2].name).toBe("Song");
    });

    it("addItemToItemList always assigns a fresh listId (ignores payload listId)", () => {
      const store = createStore({
        itemList: {
          list: [createServiceItem({ name: "A", _id: "a", listId: "l1" })],
          isLoading: false,
          selectedItemListId: "l1",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const newItem = createServiceItem({
        name: "New",
        _id: "new",
        listId: "stale-list-id-from-payload",
      });
      store.dispatch(addItemToItemList(newItem));
      const state = store.getState().itemList;
      expect(state.list[1].listId).toBe("list-id-1");
      expect(state.list[1].listId).not.toBe("stale-list-id-from-payload");
      expect(state.selectedItemListId).toBe("list-id-1");
    });

    it("addItemToItemList gives distinct listIds when adding the same outline payload twice", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "Intro", _id: "intro", listId: "l0" }),
          ],
          isLoading: false,
          selectedItemListId: "l0",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: [],
          isInitialized: true,
        },
      });
      const duplicateAdd = createServiceItem({
        name: "Same Song",
        _id: "song-1",
        type: "song",
        listId: "duplicate-if-reused",
      });
      store.dispatch(addItemToItemList(duplicateAdd));
      store.dispatch(addItemToItemList(duplicateAdd));
      const state = store.getState().itemList;
      expect(state.list).toHaveLength(3);
      expect(state.list[1].listId).toBe("list-id-1");
      expect(state.list[2].listId).toBe("list-id-2");
      expect(state.list[1].listId).not.toBe(state.list[2].listId);
    });

    it("addItemToItemList adds existing song to outline", () => {
      const store = createStore({
        itemList: {
          list: [
            createServiceItem({ name: "Intro", _id: "intro", listId: "l0" }),
          ],
          isLoading: false,
          selectedItemListId: "l0",
          insertPointIndex: 0,
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
          insertPointIndex: 0,
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
          insertPointIndex: 0,
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
          insertPointIndex: 1,
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
          insertPointIndex: 1,
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

    it("keeps an existing Canva outline row and its path identity on retries", () => {
      const existing = createServiceItem({ name: "Custom deck", _id: "canva-op", listId: "stable-list-id" });
      const store = createStore({
        itemList: {
          list: [existing],
          isLoading: false,
          selectedItemListId: "stable-list-id",
          insertPointIndex: 0,
          hasPendingUpdate: false,
          initialItems: ["stable-list-id"],
          isInitialized: true,
        },
      });

      store.dispatch(ensureCanvaItemInItemList(createServiceItem({ name: "Retry", _id: "canva-op" })));
      store.dispatch(ensureCanvaItemInItemList(createServiceItem({ name: "Retry again", _id: "canva-op" })));

      expect(store.getState().itemList.list).toEqual([existing]);
      expect(store.getState().itemList.list[0].listId).toBe("stable-list-id");
    });

    it("adds one missing Canva outline row across repeated retries", () => {
      const store = createStore();
      const item = createServiceItem({ name: "Custom deck", _id: "canva-op" });

      store.dispatch(ensureCanvaItemInItemList(item));
      const listId = store.getState().itemList.list[0].listId;
      store.dispatch(ensureCanvaItemInItemList(item));

      expect(store.getState().itemList.list).toHaveLength(1);
      expect(store.getState().itemList.list[0].listId).toBe(listId);
    });
  });
});
