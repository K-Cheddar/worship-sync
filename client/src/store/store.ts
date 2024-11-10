import { combineReducers, configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice";
import { itemSlice } from "./itemSlice";
import undoable from "redux-undo";
import { presentationSlice } from "./presentationSlice";
import { participantsSlice } from "./participantsSlice";
import { bibleSlice } from "./bibleSlice";
import { itemListSlice } from "./itemList";
import { allItemsSlice } from "./allItems";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";

const undoableReducers = undoable(
  combineReducers({
    item: itemSlice.reducer,
    participants: participantsSlice.reducer,
    itemList: itemListSlice.reducer,
  })
);

const store = configureStore({
  reducer: {
    user: undoable(userReducer),
    undoable: undoableReducers,
    // item: undoable(itemSlice.reducer),
    presentation: presentationSlice.reducer,
    // participants: undoable(participantsSlice.reducer),
    bible: bibleSlice.reducer,
    // itemList: undoable(itemListSlice.reducer),
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
