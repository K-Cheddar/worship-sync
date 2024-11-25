import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { QuickLinkType } from "../types";

type UserState = {
  name: string;
  uploadPreset: string;
  defaultBackgrounds: {
    brightness: number;
    name: string;
    type: string;
  }[];
  quickLinks: QuickLinkType[];
};

const initialState: UserState = {
  name: "Demo",
  uploadPreset: "bpqu4ma5",
  defaultBackgrounds: [],
  quickLinks: [],
};

export const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    update: (state, action: PayloadAction<string>) => {
      state.name = action.payload;
    },
  },
});

export const { update } = userSlice.actions;

export default userSlice.reducer;
