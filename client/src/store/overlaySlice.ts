import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import _ from "lodash";
import { OverlayInfo } from "../types";
import { normalizeOverlayForSync } from "../utils/overlayUtils";

export type OverlayState = {
  selectedOverlay?: OverlayInfo;
  isOverlayLoading: boolean;
  hasPendingUpdate: boolean;
  /** Last persisted snapshot for remote conflict detection (aligned with items `baseItem`). */
  baseOverlay: OverlayInfo | null;
  pendingRemoteOverlay: OverlayInfo | null;
  hasRemoteUpdate: boolean;
};

const initialState: OverlayState = {
  selectedOverlay: undefined,
  hasPendingUpdate: false,
  isOverlayLoading: false,
  baseOverlay: null,
  pendingRemoteOverlay: null,
  hasRemoteUpdate: false,
};

export const overlaySlice = createSlice({
  name: "overlay",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<OverlayInfo | undefined>) => {
      if (!action.payload?.id) {
        state.selectedOverlay = undefined;
        state.baseOverlay = null;
        state.pendingRemoteOverlay = null;
        state.hasRemoteUpdate = false;
        return;
      }
      const normalized = normalizeOverlayForSync(action.payload);
      state.selectedOverlay = normalized;
      state.baseOverlay = normalized;
      state.pendingRemoteOverlay = null;
      state.hasRemoteUpdate = false;
    },
    setIsOverlayLoading: (state, action: PayloadAction<boolean>) => {
      state.isOverlayLoading = action.payload;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    forceUpdate: (state) => {
      state.hasPendingUpdate = true;
    },
    deleteOverlay: (state, action: PayloadAction<string>) => {
      if (state.selectedOverlay?.id === action.payload) {
        state.selectedOverlay = undefined;
        state.baseOverlay = null;
        state.pendingRemoteOverlay = null;
        state.hasRemoteUpdate = false;
        // No selected overlay remains to persist; list deletion is handled by overlays slice.
        state.hasPendingUpdate = false;
        return;
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
    markOverlayPersisted: (state, action: PayloadAction<OverlayInfo>) => {
      if (
        !state.selectedOverlay ||
        state.selectedOverlay.id !== action.payload.id
      ) {
        return;
      }
      const committed = normalizeOverlayForSync(action.payload);
      state.baseOverlay = committed;
      if (state.hasRemoteUpdate && state.pendingRemoteOverlay) {
        const pending = normalizeOverlayForSync(state.pendingRemoteOverlay);
        if (!_.isEqual(pending, committed)) {
          return;
        }
      }
      state.pendingRemoteOverlay = null;
      state.hasRemoteUpdate = false;
    },
    bufferRemoteOverlayUpdate: (state, action: PayloadAction<OverlayInfo>) => {
      if (
        !state.selectedOverlay ||
        state.selectedOverlay.id !== action.payload.id
      ) {
        return;
      }
      state.pendingRemoteOverlay = action.payload;
      state.hasRemoteUpdate = true;
    },
    discardPendingRemoteOverlay: (state) => {
      state.pendingRemoteOverlay = null;
      state.hasRemoteUpdate = false;
    },
    applyPendingRemoteOverlay: (state) => {
      if (!state.pendingRemoteOverlay || !state.selectedOverlay) return;
      if (state.selectedOverlay.id !== state.pendingRemoteOverlay.id) return;
      const merged = normalizeOverlayForSync(state.pendingRemoteOverlay);
      state.selectedOverlay = merged;
      state.baseOverlay = merged;
      state.pendingRemoteOverlay = null;
      state.hasRemoteUpdate = false;
      /** Must persist their version to local DB + replication; overlay listener keys off this. */
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
  forceUpdate,
  markOverlayPersisted,
  bufferRemoteOverlayUpdate,
  discardPendingRemoteOverlay,
  applyPendingRemoteOverlay,
} = overlaySlice.actions;

export default overlaySlice.reducer;
