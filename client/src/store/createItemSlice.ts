import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { ItemType, SongMetadata, TimerType } from "../types";
import type { NormalizedLrclibTrack } from "../utils/lrclib";

export type CreateItemState = {
  /** Changes whenever a complete draft is replaced or reset. */
  draftId: number;
  name: string;
  type: ItemType;
  /**
   * True after the operator (or an explicit deep-link / import) chooses a type.
   * Blank drafts without this flag adopt the active controller's default type.
   */
  hasUserSelectedType: boolean;
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

let nextDraftId = 0;
const createDraftId = () => ++nextDraftId;

export const initialCreateItemState: CreateItemState = {
  draftId: 0,
  name: "",
  type: "song",
  hasUserSelectedType: false,
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
    setCreateItem: (
      state,
      action: PayloadAction<Omit<CreateItemState, "draftId">>,
    ) => {
      Object.assign(state, action.payload, { draftId: createDraftId() });
    },
    patchCreateItemDraft: (
      state,
      action: PayloadAction<Partial<Omit<CreateItemState, "draftId">>>,
    ) => {
      Object.assign(state, action.payload);
    },
    resetCreateItem: () => ({
      ...initialCreateItemState,
      draftId: createDraftId(),
    }),
  },
});

export const { setCreateItem, patchCreateItemDraft, resetCreateItem } =
  createItemSlice.actions;

export default createItemSlice.reducer;
