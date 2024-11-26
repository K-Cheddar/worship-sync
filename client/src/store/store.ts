import {
  Action,
  combineReducers,
  configureStore,
  createListenerMiddleware,
  Reducer,
} from "@reduxjs/toolkit";
import { itemSlice } from "./itemSlice";
import undoable, { excludeAction } from "redux-undo";
import { presentationSlice } from "./presentationSlice";
import { overlaysSlice } from "./overlaysSlice";
import { bibleSlice } from "./bibleSlice";
import { itemListSlice } from "./itemListSlice";
import { allItemsSlice } from "./allItemsSlice";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";
import { itemListsSlice } from "./itemListsSlice";
import { mediaItemsSlice } from "./mediaSlice";
import { globalDb as db } from "../context/globalInfo";
import {
  DBAllItems,
  DBItem,
  DBItemListDetails,
  DBItemLists,
  DBMedia,
} from "../types";

const undoableReducers = undoable(
  combineReducers({
    item: itemSlice.reducer,
    overlays: overlaysSlice.reducer,
    itemList: itemListSlice.reducer,
    itemLists: itemListsSlice.reducer,
  }),
  {
    filter: excludeAction([
      itemSlice.actions.toggleEditMode.toString(),
      itemSlice.actions.setSelectedSlide.toString(),
      overlaysSlice.actions.selectOverlay.toString(),
      itemListSlice.actions.initiateItemList.toString(),
    ]),
    limit: 100,
  }
);

const listenerMiddleware = createListenerMiddleware();

// handle item updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.item !==
        (previousState as RootState).undoable.present.item &&
      action.type !== "item/setSelectedSlide" &&
      action.type !== "item/toggleEditMode" &&
      action.type !== "item/setActiveItem" &&
      action.type !== "item/setItemIsLoading"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update Item
    const item = (listenerApi.getState() as RootState).undoable.present.item;
    console.log({ item });
    if (!db) return;
    let db_item: DBItem = await db.get(item._id);

    db_item = {
      ...db_item,
      name: item.name,
      background: item.background,
      slides: item.slides,
      arrangements: item.arrangements,
      selectedArrangement: item.selectedArrangement,
      bibleInfo: item.bibleInfo,
    };
    db.put(db_item);
  },
});

// handle ItemList updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.itemList !==
        (previousState as RootState).undoable.present.itemList &&
      action.type !== "itemList/initiateItemList" &&
      action.type !== "itemList/setItemListIsLoading"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).undoable.present
      .itemList;
    const { selectedList } = (listenerApi.getState() as RootState).undoable
      .present.itemLists;
    if (!db || !selectedList) return;
    let db_itemList: DBItemListDetails = await db.get(selectedList.id);
    db_itemList.items = [...list];
    db.put(db_itemList);
  },
});

// handle itemLists updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.itemLists !==
        (previousState as RootState).undoable.present.itemLists &&
      action.type !== "itemLists/initiateItemLists"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update ItemList
    const { currentLists, selectedList } = (listenerApi.getState() as RootState)
      .undoable.present.itemLists;

    if (!db || !selectedList) return;
    const db_itemLists: DBItemLists = await db.get("ItemLists");
    db_itemLists.itemLists = [...currentLists];
    db_itemLists.selectedList = selectedList;
    db.put(db_itemLists);
  },
});

// handle allItems updates
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).allItems !==
        (previousState as RootState).allItems &&
      action.type !== "allItems/initiateAllItemsList"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).allItems;

    if (!db) return;
    const db_allItems: DBAllItems = await db.get("allItems");
    db_allItems.items = [...list];
    db.put(db_allItems);
  },
});

// handle updating overlays
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).undoable.present.overlays !==
        (previousState as RootState).undoable.present.overlays &&
      action.type !== "overlays/initiateOverlayList"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).undoable.present
      .overlays;
    const { selectedList } = (listenerApi.getState() as RootState).undoable
      .present.itemLists;

    if (!db || !selectedList) return;
    const db_itemList: DBItemListDetails = await db.get(selectedList.id);
    db_itemList.overlays = [...list];
    db.put(db_itemList);
  },
});

// handle updating media
listenerMiddleware.startListening({
  predicate: (action, currentState, previousState) => {
    return (
      (currentState as RootState).media !==
        (previousState as RootState).media &&
      action.type !== "media/initiateMediaList"
    );
  },

  effect: async (action, listenerApi) => {
    console.log("action", action);
    listenerApi.cancelActiveListeners();
    await listenerApi.delay(10);

    // update ItemList
    const { list } = (listenerApi.getState() as RootState).media;

    if (!db) return;
    const db_backgrounds: DBMedia = await db.get("images");
    db_backgrounds.backgrounds = [...list];
    db.put(db_backgrounds);
  },
});

const combinedReducers = combineReducers({
  media: mediaItemsSlice.reducer,
  undoable: undoableReducers,
  presentation: presentationSlice.reducer,
  bible: bibleSlice.reducer,
  allItems: allItemsSlice.reducer,
  createItem: createItemSlice.reducer,
  preferences: preferencesSlice.reducer,
});

const rootReducer: Reducer = (state: RootState, action: Action) => {
  if (action.type === "RESET") {
    state = {} as RootState;
  }
  return combinedReducers(state, action);
};

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof combinedReducers>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
