import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type CreateItemState = {
  name: string;
  type: string;
  text: string;
};

const initialState: CreateItemState = {
  name: "",
  type: "",
  text: "",
};

export const createItemSlice = createSlice({
  name: "createItem",
  initialState,
  reducers: {
    setCreateItem: (state, action: PayloadAction<CreateItemState>) => {
      state.name = action.payload.name;
      state.type = action.payload.type;
      state.text = action.payload.text;
    },
  },
});

export const { setCreateItem } = createItemSlice.actions;

export default createItemSlice.reducer;
