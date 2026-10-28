import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import isEqual from "lodash/isEqual";
import { ServiceItem } from "../types";
import generateRandomId from "../utils/generateRandomId";
import {
  isLocalImageUrl,
  type LocalImageReferencePatch,
} from "../utils/localImageAssets";
import { reconcileOutlineItems } from "../utils/outlineSync";

export type OutlineRemoteConflict = {
  baselineItems: ServiceItem[];
  localItems: ServiceItem[];
  remoteItems: ServiceItem[];
};

type InitiateItemListPayload =
  | ServiceItem[]
  | { items: ServiceItem[]; outlineId?: string | null };

type UpdateItemListFromRemotePayload =
  | ServiceItem[]
  | { items: ServiceItem[]; outlineId?: string };

type ItemListState = {
  list: ServiceItem[];
  isLoading: boolean;
  selectedItemListId: string; // each item has a unique listId even if their ids are the same
  insertPointIndex: number; // index of item after which new items are inserted (-1 = none)
  hasPendingUpdate: boolean;
  initialItems: string[];
  isInitialized: boolean;
  /** Last content baseline that was loaded or acknowledged by PouchDB. */
  syncBaseline: ServiceItem[];
  /** Outline whose content currently occupies list. */
  loadedOutlineId?: string;
  /** Remote draft retained until an operator resolves a genuine edit conflict. */
  remoteConflicts: Record<string, OutlineRemoteConflict>;
};

const initialState: ItemListState = {
  list: [],
  isLoading: true,
  selectedItemListId: "",
  insertPointIndex: -1,
  hasPendingUpdate: false,
  initialItems: [],
  isInitialized: false,
  syncBaseline: [],
  loadedOutlineId: undefined,
  remoteConflicts: {},
};

const normalizeRows = (items: ServiceItem[]) =>
  items.map((item) => ({
    ...item,
    listId: item.listId || generateRandomId(),
  }));

const preserveCursor = (state: ItemListState) => {
  if (
    state.selectedItemListId &&
    !state.list.some((item) => item.listId === state.selectedItemListId)
  ) {
    state.selectedItemListId = "";
  }
  state.insertPointIndex = Math.max(
    -1,
    Math.min(state.insertPointIndex, state.list.length - 1),
  );
};

export const itemListSlice = createSlice({
  name: "itemList",
  initialState,
  reducers: {
    updateItemList: (state, action: PayloadAction<ServiceItem[]>) => {
      state.list = action.payload;
      state.insertPointIndex = Math.max(
        -1,
        Math.min(state.insertPointIndex, action.payload.length - 1),
      );
      state.hasPendingUpdate = true;
    },
    setActiveItemInList: (state, action: PayloadAction<string>) => {
      state.selectedItemListId = action.payload;
      const idx = state.list.findIndex((e) => e.listId === action.payload);
      state.insertPointIndex = idx >= 0 ? idx : -1;
    },
    initiateItemList: (state, action: PayloadAction<InitiateItemListPayload>) => {
      if (!state.syncBaseline) state.syncBaseline = [];
      if (!state.remoteConflicts) state.remoteConflicts = {};
      const payload = Array.isArray(action.payload)
        ? { items: action.payload }
        : action.payload;
      state.list = normalizeRows(payload.items);
      state.initialItems = state.list.map((item) => item.listId);
      state.syncBaseline = state.list.map((item) => ({ ...item }));
      if (payload.outlineId !== undefined) {
        state.loadedOutlineId = payload.outlineId ?? undefined;
      }
      state.insertPointIndex = -1;
      state.isInitialized = true;
      const conflict = payload.outlineId
        ? state.remoteConflicts[payload.outlineId]
        : undefined;
      if (conflict) {
        state.list = conflict.localItems.map((item) => ({ ...item }));
        state.syncBaseline = conflict.baselineItems.map((item) => ({ ...item }));
        state.initialItems = state.list.map((item) => item.listId);
        state.hasPendingUpdate = true;
      } else {
        state.hasPendingUpdate = false;
      }
    },
    updateItemListFromRemote: (
      state,
      action: PayloadAction<UpdateItemListFromRemotePayload>,
    ) => {
      if (!state.syncBaseline) state.syncBaseline = [];
      if (!state.remoteConflicts) state.remoteConflicts = {};
      const payload = Array.isArray(action.payload)
        ? { items: action.payload }
        : action.payload;
      if (payload.outlineId && state.loadedOutlineId !== payload.outlineId) return;
      const remoteItems = payload.items;
      const result = reconcileOutlineItems(
        state.syncBaseline,
        state.list,
        remoteItems,
      );
      state.list = result.items;
      const outlineId = state.loadedOutlineId;
      const unresolvedConflict = outlineId
        ? state.remoteConflicts[outlineId]
        : undefined;
      if (unresolvedConflict && outlineId) {
        state.remoteConflicts[outlineId] = {
          baselineItems: result.remoteItems.map((item) => ({ ...item })),
          localItems: result.items,
          remoteItems: result.remoteItems,
        };
        state.syncBaseline = result.remoteItems.map((item) => ({ ...item }));
        state.hasPendingUpdate = true;
      } else if (result.kind === "conflict" && outlineId) {
        state.remoteConflicts[outlineId] = {
          baselineItems: result.remoteItems.map((item) => ({ ...item })),
          localItems: result.items,
          remoteItems: result.remoteItems,
        };
        state.syncBaseline = result.remoteItems.map((item) => ({ ...item }));
        state.hasPendingUpdate = true;
      } else {
        state.syncBaseline = result.remoteItems.map((item) => ({ ...item }));
        if (outlineId) delete state.remoteConflicts[outlineId];
        state.hasPendingUpdate = !isSameRows(result.items, result.remoteItems);
      }
      preserveCursor(state);
    },
    resolveOutlineConflict: (
      state,
      action: PayloadAction<{ outlineId: string; choice: "keep-local" | "use-remote" }>,
    ) => {
      if (!state.remoteConflicts) state.remoteConflicts = {};
      const conflict = state.remoteConflicts[action.payload.outlineId];
      if (!conflict || state.loadedOutlineId !== action.payload.outlineId) return;
      if (action.payload.choice === "keep-local") {
        state.list = conflict.localItems.map((item) => ({ ...item }));
        state.syncBaseline = conflict.remoteItems.map((item) => ({ ...item }));
        state.hasPendingUpdate = true;
      } else {
        state.list = conflict.remoteItems.map((item) => ({ ...item }));
        state.syncBaseline = conflict.remoteItems.map((item) => ({ ...item }));
        state.hasPendingUpdate = false;
      }
      delete state.remoteConflicts[action.payload.outlineId];
      preserveCursor(state);
    },
    recordOutlineConflict: (
      state,
      action: PayloadAction<{
        outlineId: string;
        baselineItems: ServiceItem[];
        localItems: ServiceItem[];
        remoteItems: ServiceItem[];
      }>,
    ) => {
      if (!state.syncBaseline) state.syncBaseline = [];
      if (!state.remoteConflicts) state.remoteConflicts = {};
      const remoteItems = normalizeRows(action.payload.remoteItems);
      const localItems =
        state.loadedOutlineId === action.payload.outlineId
          ? state.list
          : action.payload.localItems;
      const result = reconcileOutlineItems(
        action.payload.baselineItems,
        localItems,
        remoteItems,
      );
      if (result.kind === "conflict") {
        state.remoteConflicts[action.payload.outlineId] = {
          baselineItems: result.remoteItems.map((item) => ({ ...item })),
          localItems: result.items,
          remoteItems: result.remoteItems,
        };
        if (state.loadedOutlineId === action.payload.outlineId) {
          state.list = result.items;
          state.syncBaseline = result.remoteItems.map((item) => ({ ...item }));
          state.hasPendingUpdate = true;
          preserveCursor(state);
        }
      } else if (state.loadedOutlineId === action.payload.outlineId) {
        state.list = result.items;
        state.syncBaseline = result.remoteItems.map((item) => ({ ...item }));
        state.hasPendingUpdate = !isSameRows(result.items, result.remoteItems);
        preserveCursor(state);
      }
    },
    markItemListPersisted: (
      state,
      action: PayloadAction<{
        outlineId: string;
        items: ServiceItem[];
        submittedItems: ServiceItem[];
      }>,
    ) => {
      if (!state.remoteConflicts) state.remoteConflicts = {};
      if (state.loadedOutlineId && state.loadedOutlineId !== action.payload.outlineId) {
        return;
      }
      if (state.remoteConflicts[action.payload.outlineId]) return;
      const persistedItems = normalizeRows(action.payload.items);
      const result = reconcileOutlineItems(
        action.payload.submittedItems,
        state.list,
        persistedItems,
      );
      state.syncBaseline = persistedItems.map((item) => ({ ...item }));
      state.list = result.items;
      if (result.kind === "conflict") {
        state.remoteConflicts[action.payload.outlineId] = {
          baselineItems: persistedItems.map((item) => ({ ...item })),
          localItems: result.items,
          remoteItems: persistedItems.map((item) => ({ ...item })),
        };
        state.hasPendingUpdate = true;
      } else {
        delete state.remoteConflicts[action.payload.outlineId];
        state.hasPendingUpdate = !isSameRows(result.items, persistedItems);
      }
      preserveCursor(state);
    },
    attachCloudCopyToLocalImageInItemList: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        mediaId: string;
        url: string;
      }>,
    ) => {
      state.list.forEach((item) => {
        if (
          item._id === action.payload.itemId &&
          item.localImage?.id === action.payload.assetId
        ) {
          item.localImage.storagePolicy = "local-and-cloud";
          item.localImage.cloudMediaId = action.payload.mediaId;
          item.localImage.cloudUrl = action.payload.url;
          // Outline thumbnails use `background` as an <img src>; keep it loadable.
          if (!item.background || isLocalImageUrl(item.background)) {
            item.background = action.payload.url;
          }
        }
      });
      state.hasPendingUpdate = true;
    },
    updateLocalImageReferenceInItemList: (
      state,
      action: PayloadAction<{
        itemId: string;
        assetId: string;
        patch: LocalImageReferencePatch;
      }>,
    ) => {
      state.list.forEach((item) => {
        if (
          item._id === action.payload.itemId &&
          item.localImage?.id === action.payload.assetId &&
          action.payload.patch.reference
        ) {
          item.localImage = {
            ...item.localImage,
            ...action.payload.patch.reference,
            id: action.payload.assetId,
          };
        }
      });
      state.hasPendingUpdate = true;
    },
    removeItemFromList: (state, action: PayloadAction<string>) => {
      const idx = state.list.findIndex(
        (item) => item.listId === action.payload,
      );
      if (idx >= 0) {
        if (state.insertPointIndex > idx) {
          state.insertPointIndex -= 1;
        } else if (state.insertPointIndex === idx) {
          state.insertPointIndex = idx > 0 ? idx - 1 : -1;
        }
      }
      state.list = state.list.filter((item) => item.listId !== action.payload);
      state.hasPendingUpdate = true;
    },
    removeItemsFromList: (state, action: PayloadAction<string[]>) => {
      const ids = new Set(action.payload);
      const indicesToRemove = state.list
        .map((item, i) => (ids.has(item.listId) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      let shift = 0;
      for (const i of indicesToRemove) {
        const adjusted = i - shift;
        if (state.insertPointIndex > adjusted) {
          state.insertPointIndex -= 1;
        } else if (state.insertPointIndex === adjusted) {
          state.insertPointIndex = adjusted > 0 ? adjusted - 1 : -1;
        }
        shift += 1;
      }
      state.list = state.list.filter((item) => !ids.has(item.listId));
      state.hasPendingUpdate = true;
    },
    removeItemFromListById: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((item) => item._id !== action.payload);
      state.insertPointIndex = Math.max(
        -1,
        Math.min(state.insertPointIndex, state.list.length - 1),
      );
      state.hasPendingUpdate = true;
    },
    addItemToItemList: {
      prepare: (item: ServiceItem) => ({
        payload: {
          ...item,
          // Always assign a new listId: each outline row is a distinct instance
          // even when the same underlying item (_id) appears more than once.
          listId: generateRandomId(),
        },
      }),
      reducer: (state, action: PayloadAction<ServiceItem>) => {
        const newItem = action.payload;
        const anchorIndex =
          state.insertPointIndex >= 0
            ? state.insertPointIndex
            : state.list.findIndex(
                (e) => e.listId === state.selectedItemListId,
              );
        let insertAt: number;
        if (anchorIndex >= 0) {
          insertAt = newItem.type === "heading" ? anchorIndex : anchorIndex + 1;
        } else {
          insertAt = newItem.type === "heading" ? 0 : state.list.length;
        }
        const index = Math.max(0, Math.min(insertAt, state.list.length));
        state.list.splice(index, 0, newItem);
        if (newItem.type !== "heading") {
          state.selectedItemListId = newItem.listId;
          state.insertPointIndex = index;
        }
        state.hasPendingUpdate = true;
      },
    },
    ensureCanvaItemInItemList: {
      prepare: (item: ServiceItem) => ({
        payload: { ...item, listId: generateRandomId() },
      }),
      reducer: (state, action: PayloadAction<ServiceItem>) => {
        const newItem = action.payload;
        if (state.list.some((item) => item._id === newItem._id)) return;
        const anchorIndex = state.insertPointIndex >= 0
          ? state.insertPointIndex
          : state.list.findIndex((item) => item.listId === state.selectedItemListId);
        const insertAt = anchorIndex >= 0
          ? newItem.type === "heading" ? anchorIndex : anchorIndex + 1
          : newItem.type === "heading" ? 0 : state.list.length;
        const index = Math.max(0, Math.min(insertAt, state.list.length));
        state.list.splice(index, 0, newItem);
        if (newItem.type !== "heading") {
          state.selectedItemListId = newItem.listId;
          state.insertPointIndex = index;
        }
        state.hasPendingUpdate = true;
      },
    },
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    setItemListIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    forceUpdate: (state) => {
      state.hasPendingUpdate = true;
    },
    addToInitialItems: (state, action: PayloadAction<string[]>) => {
      state.initialItems = [...state.initialItems, ...action.payload];
    },
  },
});

const isSameRows = (left: ServiceItem[], right: ServiceItem[]) =>
  left.length === right.length &&
  left.every((item, index) => isEqual(item, right[index]));

export const {
  updateItemList,
  removeItemFromList,
  removeItemsFromList,
  addItemToItemList,
  ensureCanvaItemInItemList,
  initiateItemList,
  setIsInitialized,
  setActiveItemInList,
  setItemListIsLoading,
  removeItemFromListById,
  updateItemListFromRemote,
  resolveOutlineConflict,
  recordOutlineConflict,
  markItemListPersisted,
  setHasPendingUpdate,
  addToInitialItems,
  forceUpdate,
  attachCloudCopyToLocalImageInItemList,
  updateLocalImageReferenceInItemList,
} = itemListSlice.actions;

export default itemListSlice.reducer;
