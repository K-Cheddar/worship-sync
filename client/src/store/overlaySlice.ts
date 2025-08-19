import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayInfo } from "../types";
import { getDefaultFormatting } from "../utils/overlayUtils";

type OverlayState = {
  selectedOverlay?: OverlayInfo;
  isOverlayLoading: boolean;
  hasPendingUpdate: boolean;
};

const initialState: OverlayState = {
  selectedOverlay: undefined,
  hasPendingUpdate: false,
  isOverlayLoading: false,
};

export const overlaySlice = createSlice({
  name: "overlay",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<OverlayInfo | undefined>) => {
      state.selectedOverlay = {
        id: action.payload?.id || "",
        name: action.payload?.name || "",
        type: action.payload?.type || "participant",
        duration: action.payload?.duration || 0,
        imageUrl: action.payload?.imageUrl || "",
        heading: action.payload?.heading || "",
        subHeading: action.payload?.subHeading || "",
        event: action.payload?.event || "",
        title: action.payload?.title || "",
        description: action.payload?.description || "",
        isHidden: action.payload?.isHidden || false,
        formatting:
          action.payload?.formatting ||
          getDefaultFormatting(action.payload?.type || "participant"),
      };
    },
    setIsOverlayLoading: (state, action: PayloadAction<boolean>) => {
      state.isOverlayLoading = action.payload;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    deleteOverlay: (state, action: PayloadAction<string>) => {
      if (state.selectedOverlay) {
        state.selectedOverlay.isHidden = true;
      }
      state.hasPendingUpdate = true;
    },
    updateOverlay: (state, action: PayloadAction<Partial<OverlayInfo>>) => {
      if (
        state.selectedOverlay?.id &&
        state.selectedOverlay.id === action.payload.id
      ) {
        state.selectedOverlay = {
          ...state.selectedOverlay,
          ...action.payload,
        };
      }
      state.hasPendingUpdate = true;
    },
  },
});

export const {
  selectOverlay,
  deleteOverlay,
  updateOverlay,
  setIsOverlayLoading,
  setHasPendingUpdate,
} = overlaySlice.actions;

export default overlaySlice.reducer;
