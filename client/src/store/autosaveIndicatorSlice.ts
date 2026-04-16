import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "./store";

/** Keys for debounced Pouch/Firebase listeners in `store.ts` (no `hasPendingUpdate` on those slices). */
export const AUTOSAVE_DEBOUNCE_KEYS = {
  credits: "debounced/credits",
  media: "debounced/media",
  preferences: "debounced/preferences",
  serviceTimes: "debounced/serviceTimes",
  itemLists: "debounced/itemLists",
  allItems: "debounced/allItems",
} as const;

type AutosaveIndicatorState = {
  debouncedSaveDepth: Record<string, number>;
};

const initialState: AutosaveIndicatorState = {
  debouncedSaveDepth: {},
};

export const autosaveIndicatorSlice = createSlice({
  name: "autosaveIndicator",
  initialState,
  reducers: {
    beginKeyedDebouncedSave(state, action: PayloadAction<string>) {
      const k = action.payload;
      state.debouncedSaveDepth[k] = (state.debouncedSaveDepth[k] ?? 0) + 1;
    },
    endKeyedDebouncedSave(state, action: PayloadAction<string>) {
      const k = action.payload;
      const next = (state.debouncedSaveDepth[k] ?? 0) - 1;
      if (next <= 0) {
        delete state.debouncedSaveDepth[k];
      } else {
        state.debouncedSaveDepth[k] = next;
      }
    },
  },
});

const selectKeyedDebouncedSaveInFlight = (state: RootState) =>
  Object.values(state.autosaveIndicator.debouncedSaveDepth).some((n) => n > 0);

const selectUndoableDocAutosavePending = (state: RootState) => {
  const p = state.undoable.present;
  return (
    !!p.item.hasPendingUpdate ||
    !!p.itemList.hasPendingUpdate ||
    !!p.overlay.hasPendingUpdate ||
    !!p.overlays.hasPendingUpdate ||
    !!p.overlayTemplates.hasPendingUpdate
  );
};

/** True while any Pouch-debounced doc save is in progress (including the 1500ms debounce window). */
export const selectAnyAutosavePending = (state: RootState) =>
  selectKeyedDebouncedSaveInFlight(state) ||
  selectUndoableDocAutosavePending(state);
