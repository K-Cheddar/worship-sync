import { configureStore } from '@reduxjs/toolkit'
import userReducer from './userSlice'
import { itemSlice } from './itemSlice';
import undoable from 'redux-undo';
import { presentationSlice } from './presentationSlice';
import { participantsSlice } from './participantsSlice';

const store = configureStore({
  reducer: {
    user: undoable(userReducer),
    item: itemSlice.reducer,
    presentation: presentationSlice.reducer,
    participants: participantsSlice.reducer
  },
})

export default store;

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch