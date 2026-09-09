import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemList } from "../types";
import {
  DEFAULT_OUTLINE_SCOPE,
  filterOutlinesByScope,
  isOutlineInScope,
  resolveOutlineForScope,
} from "../utils/outlineScope";

type ItemListState = {
  currentLists: ItemList[];
  /**
   * The church-wide "live service" outline. Presentation-scoped only: credits,
   * service plan binding, and overlays all hang off it, and none of those mean
   * anything for an auxiliary controller's screen.
   */
  activeList: ItemList | undefined;
  /** The outline the operator is editing on this client, in the current scope. */
  selectedList: ItemList | undefined;
  /** Controller scope this client is currently working in. */
  scope: string;
  /**
   * Last outline opened per scope, so switching controllers returns the
   * operator to where they were instead of resetting to the first outline.
   * Also persisted on the ItemLists doc so reload restores each controller.
   */
  selectedIdByScope: Record<string, string>;
  isInitialized: boolean;
};

export type InitiateItemListsPayload =
  | ItemList[]
  | {
      itemLists: ItemList[];
      selectedIdByScope?: Record<string, string>;
    };

export type UpdateItemListsFromRemotePayload =
  | ItemList[]
  | {
      itemLists: ItemList[];
      /** Remote church-wide active outline id, when the ItemLists doc carried one. */
      activeListId?: string;
    };

const initialState: ItemListState = {
  currentLists: [],
  activeList: undefined,
  selectedList: undefined,
  scope: DEFAULT_OUTLINE_SCOPE,
  selectedIdByScope: {},
  isInitialized: false,
};

const normalizeItemListsPayload = (
  payload: InitiateItemListsPayload | UpdateItemListsFromRemotePayload,
): ItemList[] => (Array.isArray(payload) ? payload : payload.itemLists);

/**
 * Backfill the scope fields on state that predates them.
 *
 * Undo history and rehydrated snapshots are written by whichever build created
 * them, so a reducer can be handed a slice with neither field. Defaulting here
 * rather than trusting `initialState` keeps that from throwing on the first
 * remote outline update after an upgrade.
 */
const ensureScopeState = (state: ItemListState) => {
  if (!state.scope) state.scope = DEFAULT_OUTLINE_SCOPE;
  if (!state.selectedIdByScope) state.selectedIdByScope = {};
};

/**
 * Move `selectedList` to a sound outline within `state.scope`.
 *
 * Every fallback here has to stay inside the scope. Falling back across scopes
 * would drop an auxiliary controller into a sanctuary outline — silently, and
 * most likely mid-service, since the trigger is a remote update.
 */
const reselectWithinScope = (state: ItemListState) => {
  ensureScopeState(state);
  const next = resolveOutlineForScope(
    state.currentLists,
    state.scope,
    state.selectedIdByScope[state.scope],
  );
  state.selectedList = next;
  if (next) {
    state.selectedIdByScope[state.scope] = next._id;
  } else {
    delete state.selectedIdByScope[state.scope];
  }
};

/** Prefer a presentation-scoped outline when the church-wide active must move. */
const presentationActiveFallback = (lists: ItemList[]): ItemList | undefined =>
  filterOutlinesByScope(lists, DEFAULT_OUTLINE_SCOPE)[0] ?? lists[0];

export const itemListsSlice = createSlice({
  name: "itemLists",
  initialState,
  reducers: {
    updateItemLists: (state, action: PayloadAction<ItemList[]>) => {
      state.currentLists = action.payload;
    },

    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    initiateItemLists: (
      state,
      action: PayloadAction<InitiateItemListsPayload>,
    ) => {
      ensureScopeState(state);
      const lists = normalizeItemListsPayload(action.payload);
      if (!Array.isArray(action.payload) && action.payload.selectedIdByScope) {
        state.selectedIdByScope = { ...action.payload.selectedIdByScope };
      }
      state.currentLists = lists;
      state.activeList = presentationActiveFallback(lists);
      reselectWithinScope(state);
      state.isInitialized = true;
    },
    /**
     * Switch the controller scope this client is working in.
     *
     * Dispatched by each controller page on mount. Selection is remembered per
     * scope, so moving between controllers does not disturb either one's place.
     */
    setOutlineScope: (state, action: PayloadAction<string>) => {
      ensureScopeState(state);
      const scope = action.payload || DEFAULT_OUTLINE_SCOPE;
      if (state.scope === scope) return;
      state.scope = scope;
      reselectWithinScope(state);
    },
    updateItemListsFromRemote: (
      state,
      action: PayloadAction<UpdateItemListsFromRemotePayload>,
    ) => {
      ensureScopeState(state);
      const lists = normalizeItemListsPayload(action.payload);
      const remoteActiveId = Array.isArray(action.payload)
        ? undefined
        : action.payload.activeListId;
      state.currentLists = lists;
      if (lists.length === 0) {
        state.activeList = undefined;
        state.selectedList = undefined;
        return;
      }
      const ids = new Set(lists.map((l) => l._id));

      // Keep the current selection if it survived, otherwise fall back — but
      // only ever to an outline in the same scope.
      const selectedId = state.selectedList?._id;
      if (selectedId && ids.has(selectedId)) {
        const current = lists.find((l) => l._id === selectedId)!;
        if (isOutlineInScope(current, state.scope)) {
          state.selectedList = current;
          state.selectedIdByScope[state.scope] = current._id;
        } else {
          // The outline was rescoped elsewhere while we had it open.
          reselectWithinScope(state);
        }
      } else {
        reselectWithinScope(state);
      }

      if (remoteActiveId && ids.has(remoteActiveId)) {
        state.activeList = lists.find((l) => l._id === remoteActiveId)!;
      } else {
        const activeId = state.activeList?._id;
        state.activeList =
          activeId && ids.has(activeId)
            ? lists.find((l) => l._id === activeId)!
            : presentationActiveFallback(lists);
      }
    },
    removeFromItemLists: (state, action: PayloadAction<string>) => {
      state.currentLists = state.currentLists.filter((item) => {
        return item._id !== action.payload;
      });
      if (state.activeList?._id === action.payload) {
        state.activeList = presentationActiveFallback(state.currentLists);
      }
      if (state.selectedList?._id === action.payload) {
        reselectWithinScope(state);
      }
    },
    selectItemList: (state, action: PayloadAction<string>) => {
      ensureScopeState(state);
      const next = state.currentLists.find(
        (item) => item._id === action.payload,
      );
      state.selectedList = next;
      if (next) state.selectedIdByScope[state.scope] = next._id;
    },
    setActiveItemList: (state, action: PayloadAction<string>) => {
      state.activeList = state.currentLists.find(
        (item) => item._id === action.payload,
      );
    },
    setInitialItemList: (state, action: PayloadAction<string>) => {
      ensureScopeState(state);
      state.activeList = state.currentLists.find(
        (item) => item._id === action.payload,
      );
      // Only follow the active list into the selection when it belongs to this
      // scope. The stored active list is the church's live service, which an
      // auxiliary controller must not be dropped into.
      if (isOutlineInScope(state.activeList, state.scope)) {
        state.selectedList = state.activeList;
        if (state.activeList) {
          state.selectedIdByScope[state.scope] = state.activeList._id;
        }
      } else {
        reselectWithinScope(state);
      }
    },
    forceUpdate: () => {},
  },
});

export const {
  updateItemLists,
  removeFromItemLists,
  initiateItemLists,
  setIsInitialized,
  selectItemList,
  setActiveItemList,
  setInitialItemList,
  setOutlineScope,
  updateItemListsFromRemote,
  forceUpdate,
} = itemListsSlice.actions;

export default itemListsSlice.reducer;
