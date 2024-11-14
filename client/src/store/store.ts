import { combineReducers, configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice";
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

const store = configureStore({
  reducer: {
    user: undoable(userReducer),
    media: mediaItemsSlice.reducer,
    undoable: undoableReducers,
    presentation: presentationSlice.reducer,
    bible: bibleSlice.reducer,
    allItems: allItemsSlice.reducer,
    createItem: createItemSlice.reducer,
    preferences: preferencesSlice.reducer,
  },
});

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
