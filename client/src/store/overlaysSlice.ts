import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";

type OverlaysState = OverlayInfo & {
  list: OverlayInfo[];
  hasPendingUpdate: boolean;
  initialList: string[];
};

const initialState: OverlaysState = {
  name: "",
  title: "",
  event: "",
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  color: "#16a34a",
  id: "",
  duration: 7,
  type: "participant",
  imageUrl: "",
  hasPendingUpdate: false,
  list: [],
  initialList: [],
};

export const overlaysSlice = createSlice({
  name: "overlays",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<OverlayInfo>) => {
      state.name = action.payload.name;
      state.title = action.payload.title;
      state.event = action.payload.event;
      state.heading = action.payload.heading;
      state.subHeading = action.payload.subHeading;
      state.url = action.payload.url;
      state.description = action.payload.description;
      state.color = action.payload.color;
      state.id = action.payload.id;
      state.duration = action.payload.duration;
      state.type = action.payload.type;
      state.imageUrl = action.payload.imageUrl;
    },
    addOverlay: (state, action: PayloadAction<OverlayInfo>) => {
      // get index of selected overlay
      const existingIndex = state.list.findIndex(
        (overlay) => overlay.id === state.id
      );
      const newItem = { ...action.payload };
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
      state.id = "";
      state.color = "#16a34a";
      state.name = "";
      state.title = "";
      state.event = "";
      state.heading = "";
      state.subHeading = "";
      state.url = "";
      state.description = "";
      state.duration = 7;
      state.type = "participant";
      state.imageUrl = "";

      if (action.payload.length === 0) {
        state.list = [];
        return;
      }
      state.list = action.payload.map((overlay) => ({
        ...overlay,
        id: generateRandomId(),
      }));
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
      if (state.id === action.payload) {
        state.id = "";
        state.color = "#16a34a";
        state.name = "";
        state.title = "";
        state.event = "";
        state.heading = "";
        state.subHeading = "";
        state.url = "";
        state.description = "";
        state.duration = 7;
        state.type = "participant";
        state.imageUrl = "";
      }
      state.hasPendingUpdate = true;
    },
    updateOverlay: (state, action: PayloadAction<Partial<OverlayInfo>>) => {
      const updatedOverlayInfo = {
        id: action.payload.id || state.id,
        name: action.payload.name || state.name,
        title: action.payload.title || state.title,
        event: action.payload.event || state.event,
        heading: action.payload.heading || state.heading,
        subHeading: action.payload.subHeading || state.subHeading,
        url: action.payload.url || state.url,
        description: action.payload.description || state.description,
        color: action.payload.color || state.color,
        duration: action.payload.duration || state.duration,
        type: action.payload.type || state.type,
        imageUrl: action.payload.imageUrl || state.imageUrl,
      };
      state.imageUrl = updatedOverlayInfo.imageUrl;
      state.list = state.list.map((overlay) => {
        if (overlay.id === action.payload.id) {
          return { ...updatedOverlayInfo };
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
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
