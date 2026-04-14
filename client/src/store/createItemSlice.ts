import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemType, SongMetadata, TimerType } from "../types";
import type { NormalizedLrclibTrack } from "../utils/lrclib";

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
  /** Persists across navigation so the import panel can reopen on return to Create Item. */
  lyricsImportCandidates: NormalizedLrclibTrack[];
  lyricsImportError: string;
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
  lyricsImportCandidates: [],
  lyricsImportError: "",
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
