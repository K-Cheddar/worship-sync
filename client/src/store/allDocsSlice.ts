import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBItem } from "../types";

type UserState = {
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
};

const initialState: UserState = {
  allSongDocs: [],
  allFreeFormDocs: [],
};

export const allDocsSlice = createSlice({
  name: "allDocs",
  initialState,
  reducers: {
    updateAllSongDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allSongDocs = action.payload;
    },
    updateAllFreeFormDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allFreeFormDocs = action.payload;
    },
  },
});

export const { updateAllSongDocs, updateAllFreeFormDocs } =
  allDocsSlice.actions;

export default allDocsSlice.reducer;
