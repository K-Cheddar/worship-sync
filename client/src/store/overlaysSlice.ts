import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayFormatting, OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";
import {
  defaultImageOverlayStyles,
  defaultParticipantOverlayStyles,
  defaultQrCodeOverlayStyles,
  defaultStbOverlayStyles,
} from "../components/DisplayWindow/defaultOverlayStyles";

const getDefaultFormatting = (type?: string): OverlayFormatting => {
  switch (type) {
    case "participant":
      return defaultParticipantOverlayStyles;
    case "stick-to-bottom":
      return defaultStbOverlayStyles;
    case "qr-code":
      return defaultQrCodeOverlayStyles;
    case "image":
      return defaultImageOverlayStyles;
  }

  return defaultParticipantOverlayStyles;
};

type OverlaysState = {
  list: OverlayInfo[];
  hasPendingUpdate: boolean;
  initialList: string[];
  selectedId: string;
};

const initialState: OverlaysState = {
  selectedId: "",
  hasPendingUpdate: false,
  list: [],
  initialList: [],
};

export const overlaysSlice = createSlice({
  name: "overlays",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<string>) => {
      state.selectedId = action.payload;
    },
    addOverlay: (state, action: PayloadAction<OverlayInfo>) => {
      // get index of selected overlay
      const existingIndex = state.list.findIndex(
        (overlay) => overlay.id === state.selectedId
      );
      const newItem = {
        formatting: getDefaultFormatting(action.payload.type),
        ...action.payload,
      };
      if (existingIndex !== -1) {
        state.list.splice(existingIndex + 1, 0, newItem);
      } else {
        state.list.push(newItem);
      }
      state.hasPendingUpdate = true;
    },
    updateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      state.list = action.payload;
      state.hasPendingUpdate = true;
    },
    initiateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      // reset state when loading an item list
      state.selectedId = "";

      if (action.payload.length === 0) {
        state.list = [];
        return;
      }
      state.list = action.payload.map((overlay) => {
        return {
          ...overlay,
          id: overlay.id || generateRandomId(),
          formatting: {
            ...getDefaultFormatting(overlay.type),
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
    deleteOverlay: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter(
        (overlay) => overlay.id !== action.payload
      );
      if (state.selectedId === action.payload) {
        state.selectedId = "";
      }
      state.hasPendingUpdate = true;
    },
    updateOverlay: (state, action: PayloadAction<Partial<OverlayInfo>>) => {
      state.list = state.list.map((overlay) => {
        if (overlay.id === action.payload.id) {
          return { ...overlay, ...action.payload };
        }
        return overlay;
      });
      state.hasPendingUpdate = true;
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
  selectOverlay,
  addOverlay,
  updateOverlayList: updateList,
  deleteOverlay,
  updateOverlay,
  initiateOverlayList,
  updateOverlayListFromRemote,
  setHasPendingUpdate,
  updateInitialList,
  addToInitialList,
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
