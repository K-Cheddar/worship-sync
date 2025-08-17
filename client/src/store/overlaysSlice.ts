import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";
import { getDefaultFormatting } from "../utils/overlayUtils";

type OverlaysState = {
  list: OverlayInfo[];
  hasPendingUpdate: boolean;
  initialList: string[];
};

const initialState: OverlaysState = {
  hasPendingUpdate: false,
  list: [],
  initialList: [],
};

export const overlaysSlice = createSlice({
  name: "overlays",
  initialState,
  reducers: {
    addOverlayToList: (
      state,
      action: PayloadAction<{
        newOverlay: OverlayInfo;
        selectedOverlayId: string;
      }>
    ) => {
      // get index of selected overlay
      const existingIndex = state.list.findIndex(
        (overlay) => overlay.id === action.payload.selectedOverlayId
      );

      if (existingIndex !== -1) {
        state.list.splice(existingIndex + 1, 0, action.payload.newOverlay);
      } else {
        state.list.push(action.payload.newOverlay);
      }
      state.hasPendingUpdate = true;
    },
    updateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      state.list = action.payload;
      state.hasPendingUpdate = true;
    },
    initiateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      // reset state when loading an item list

      if (action.payload.length === 0) {
        state.list = [];
        return;
      }
      state.list = action.payload.map((overlay) => {
        return {
          ...overlay,
          id: overlay.id || generateRandomId(),
          formatting: {
            ...getDefaultFormatting(overlay.type || "participant"),
            ...overlay.formatting,
          },
        };
      });
      state.initialList = state.list.map((overlay) => overlay.id);
    },
    updateOverlayListFromRemote: (
      state,
      action: PayloadAction<OverlayInfo[]>
    ) => {
      if (action.payload.length === 0) {
        state.list = [];
        return;
      }
      state.list = action.payload.map((overlay) => ({
        ...overlay,
        id: overlay.id || generateRandomId(),
      }));
    },
    deleteOverlayFromList: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter(
        (overlay) => overlay.id !== action.payload
      );
      state.hasPendingUpdate = true;
    },
    updateOverlayInList: (
      state,
      action: PayloadAction<Partial<OverlayInfo>>
    ) => {
      state.list = state.list.map((overlay) => {
        if (overlay.id === action.payload.id) {
          return { ...overlay, ...action.payload };
        }
        return overlay;
      });
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    updateInitialList: (state) => {
      state.initialList = state.list.map((overlay) => overlay.id);
    },
    addToInitialList: (state, action: PayloadAction<string[]>) => {
      state.initialList = [...state.initialList, ...action.payload];
    },
  },
});

export const {
  addOverlayToList,
  updateOverlayList: updateList,
  deleteOverlayFromList,
  updateOverlayInList,
  initiateOverlayList,
  updateOverlayListFromRemote,
  setHasPendingUpdate: setHasPendingListUpdate,
  updateInitialList,
  addToInitialList,
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
