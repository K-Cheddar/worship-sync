import { combineReducers, configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice";
import { itemSlice } from "./itemSlice";
import undoable, { excludeAction } from "redux-undo";
import { presentationSlice } from "./presentationSlice";
import { participantsSlice } from "./participantsSlice";
import { bibleSlice } from "./bibleSlice";
import { itemListSlice } from "./itemList";
import { allItemsSlice } from "./allItems";
import { createItemSlice } from "./createItemSlice";
import { preferencesSlice } from "./preferencesSlice";
import { itemListsSlice } from "./itemLists";

const undoableReducers = undoable(
  combineReducers({
    item: itemSlice.reducer,
    participants: participantsSlice.reducer,
    itemList: itemListSlice.reducer,
    itemLists: itemListsSlice.reducer,
  }),
  {
    filter: excludeAction([
      itemSlice.actions.toggleEditMode.toString(),
      itemSlice.actions.setSelectedSlide.toString(),
      participantsSlice.actions.selectParticipant.toString(),
      itemListSlice.actions.initiateItemList.toString(),
    ]),
    limit: 100,
  }
);

const store = configureStore({
  reducer: {
    user: undoable(userReducer),
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
