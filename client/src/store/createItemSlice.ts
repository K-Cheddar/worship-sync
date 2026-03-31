import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemType, SongMetadata, TimerType } from "../types";

export type CreateItemState = {
  name: string;
  type: ItemType;
  text: string;
  songArtist: string;
  songAlbum: string;
  songMetadata: SongMetadata | null;
  hours: number;
  minutes: number;
  seconds: number;
  time: string;
  timerType: TimerType;
};

export const initialCreateItemState: CreateItemState = {
  name: "",
  type: "song",
  text: "",
  songArtist: "",
  songAlbum: "",
  songMetadata: null,
  hours: 0,
  minutes: 1,
  seconds: 0,
  time: "00:00",
  timerType: "timer",
};

export const createItemSlice = createSlice({
  name: "createItem",
  initialState: initialCreateItemState,
  reducers: {
    setCreateItem: (state, action: PayloadAction<CreateItemState>) => {
      Object.assign(state, action.payload);
    },
    resetCreateItem: () => initialCreateItemState,
  },
});

export const { setCreateItem, resetCreateItem } = createItemSlice.actions;

export default createItemSlice.reducer;
