import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemType } from "../types";
type CreateItemState = {
  name: string;
  type: ItemType;
  text: string;
  duration?: number;
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
      state.duration = action.payload.duration;
    },
  },
});

export const { setCreateItem } = createItemSlice.actions;

export default createItemSlice.reducer;
