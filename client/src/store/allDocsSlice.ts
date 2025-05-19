import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { DBItem } from "../types";

type UserState = {
  allSongDocs: DBItem[];
  allFreeFormDocs: DBItem[];
  allTimerDocs: DBItem[];
};

const initialState: UserState = {
  allSongDocs: [],
  allFreeFormDocs: [],
  allTimerDocs: [],
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
    updateAllTimerDocs: (state, action: PayloadAction<DBItem[]>) => {
      state.allTimerDocs = action.payload;
    },
  },
});

export const { updateAllSongDocs, updateAllFreeFormDocs, updateAllTimerDocs } =
  allDocsSlice.actions;

export default allDocsSlice.reducer;
