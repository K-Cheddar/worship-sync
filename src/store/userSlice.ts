import { createSlice, PayloadAction } from '@reduxjs/toolkit';

type UserState = {
  value: string
}

const initialState: UserState = {
  value: 'Demo'
}

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    update: (state, action : PayloadAction<string>) => {
      state.value = action.payload
    }
  }
});

export const { update } = userSlice.actions;

export default userSlice.reducer;