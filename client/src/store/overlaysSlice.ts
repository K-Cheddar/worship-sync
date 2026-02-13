import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayHistoryKey, OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";
import { getDefaultFormatting } from "../utils/overlayUtils";

/** Map of overlay type + field to list of unique values for history/suggestions. Keys are OverlayHistoryKey. */
export type OverlayHistoryState = Record<string, string[]>;

const OVERLAY_HISTORY_ENTRIES: { type: OverlayInfo["type"]; key: OverlayHistoryKey; getValue: (o: OverlayInfo) => string | undefined }[] = [
  { type: "participant", key: "participant.name", getValue: (o) => o.name?.trim() },
  { type: "participant", key: "participant.title", getValue: (o) => o.title?.trim() },
  { type: "participant", key: "participant.event", getValue: (o) => o.event?.trim() },
  { type: "stick-to-bottom", key: "stick-to-bottom.heading", getValue: (o) => o.heading?.trim() },
  { type: "stick-to-bottom", key: "stick-to-bottom.subHeading", getValue: (o) => o.subHeading?.trim() },
  { type: "qr-code", key: "qr-code.url", getValue: (o) => o.url?.trim() },
  { type: "qr-code", key: "qr-code.description", getValue: (o) => o.description?.trim() },
  { type: "image", key: "image.name", getValue: (o) => o.name?.trim() },
];

/** Keys to persist for an overlay type when merging into history. */
export function getOverlayHistoryKeysForType(
  type: OverlayInfo["type"]
): OverlayHistoryKey[] {
  const t = type ?? "participant";
  return OVERLAY_HISTORY_ENTRIES.filter((e) => e.type === t).map((e) => e.key);
}

const historySort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base" });

function sortHistoryValues(values: string[]): string[] {
  return [...values].sort(historySort);
}

/** Pure merge of overlay(s) field values into history. Used when user switches away or when persisting. */
export function mergeOverlaysIntoHistory(
  overlayHistory: OverlayHistoryState,
  overlays: OverlayInfo[]
): OverlayHistoryState {
  const next = { ...overlayHistory };
  for (const overlay of overlays) {
    const t = overlay.type || "participant";
    for (const { type, key, getValue } of OVERLAY_HISTORY_ENTRIES) {
      if (type !== t) continue;
      const val = getValue(overlay);
      if (!val) continue;
      const existing = next[key] ?? [];
      if (existing.includes(val)) continue;
      next[key] = sortHistoryValues([...existing, val]);
    }
  }
  return next;
}

type OverlaysState = {
  list: OverlayInfo[];
  hasPendingUpdate: boolean;
  initialList: string[];
  isInitialized: boolean;
  /** Per-field history for overlay suggestions. */
  overlayHistory: OverlayHistoryState;
};

const initialState: OverlaysState = {
  hasPendingUpdate: false,
  list: [],
  initialList: [],
  isInitialized: false,
  overlayHistory: {},
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
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
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
      state.isInitialized = true;
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
    forceUpdate: (state) => {
      state.hasPendingUpdate = true;
    },
    updateInitialList: (state) => {
      state.initialList = state.list.map((overlay) => overlay.id);
    },
    addToInitialList: (state, action: PayloadAction<string[]>) => {
      state.initialList = [...state.initialList, ...action.payload];
    },
    addExistingOverlayToList: (
      state,
      action: PayloadAction<{
        overlay: OverlayInfo;
        insertAfterId?: string;
      }>
    ) => {
      const normalized: OverlayInfo = {
        ...action.payload.overlay,
        id: action.payload.overlay.id || generateRandomId(),
        formatting: {
          ...getDefaultFormatting(
            action.payload.overlay.type || "participant"
          ),
          ...action.payload.overlay.formatting,
        },
      };
      const insertAfterId = action.payload.insertAfterId;
      const existingIndex =
        insertAfterId !== undefined
          ? state.list.findIndex((o) => o.id === insertAfterId)
          : -1;
      if (existingIndex !== -1) {
        state.list.splice(existingIndex + 1, 0, normalized);
      } else {
        state.list.push(normalized);
      }
      state.hasPendingUpdate = true;
    },
    initiateOverlayHistory: (
      state,
      action: PayloadAction<OverlayHistoryState>
    ) => {
      const raw = action.payload ?? {};
      state.overlayHistory = Object.fromEntries(
        Object.entries(raw).map(([k, values]) => [k, sortHistoryValues(values)])
      );
    },
    /** Merge fetched overlay history from DB into current state. Keeps existing keys when fetch returns empty or partial. */
    mergeOverlayHistoryFromDb: (
      state,
      action: PayloadAction<OverlayHistoryState>
    ) => {
      const raw = action.payload ?? {};
      const next = { ...state.overlayHistory };
      for (const [k, values] of Object.entries(raw)) {
        if (Array.isArray(values)) next[k] = sortHistoryValues(values);
      }
      state.overlayHistory = next;
    },
    deleteOverlayHistoryEntry: (state, action: PayloadAction<string>) => {
      delete state.overlayHistory[action.payload];
    },
    updateOverlayHistoryEntry: (
      state,
      action: PayloadAction<{ key: string; values: string[] }>
    ) => {
      const { key, values } = action.payload;
      state.overlayHistory[key] = sortHistoryValues(values);
    },
    /** Merge a single overlay into history (e.g. when user switches away and there are changes). */
    mergeOverlayIntoHistory: (state, action: PayloadAction<OverlayInfo>) => {
      state.overlayHistory = mergeOverlaysIntoHistory(
        state.overlayHistory,
        [action.payload]
      );
    },
  },
});

export const {
  addOverlayToList,
  addExistingOverlayToList,
  updateOverlayList: updateList,
  deleteOverlayFromList,
  updateOverlayInList,
  initiateOverlayList,
  setIsInitialized,
  updateOverlayListFromRemote,
  setHasPendingUpdate: setHasPendingListUpdate,
  updateInitialList,
  addToInitialList,
  forceUpdate,
  initiateOverlayHistory,
  mergeOverlayHistoryFromDb,
  deleteOverlayHistoryEntry,
  updateOverlayHistoryEntry,
  mergeOverlayIntoHistory,
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
