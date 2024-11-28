import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { BibleDisplayInfo, OverlayInfo, Presentation } from "../types";
import generateRandomId from "../utils/generateRandomId";

type PresentationState = {
  isProjectorTransmitting: boolean;
  isMonitorTransmitting: boolean;
  isStreamTransmitting: boolean;
  prevProjectorInfo: Presentation;
  prevMonitorInfo: Presentation;
  prevStreamInfo: Presentation;
  projectorInfo: Presentation;
  monitorInfo: Presentation;
  streamInfo: Presentation;
};

const initialState: PresentationState = {
  isProjectorTransmitting: false,
  isMonitorTransmitting: false,
  isStreamTransmitting: false,
  prevProjectorInfo: {
    type: "",
    name: "",
    slide: null,
    displayType: "projector",
  },
  prevMonitorInfo: { type: "", name: "", slide: null, displayType: "monitor" },
  prevStreamInfo: { type: "", name: "", slide: null, displayType: "stream" },
  projectorInfo: { type: "", name: "", slide: null, displayType: "projector" },
  monitorInfo: { type: "", name: "", slide: null, displayType: "monitor" },
  streamInfo: {
    type: "",
    name: "",
    slide: null,
    displayType: "stream",
    participantOverlayInfo: {
      name: "",
      event: "",
      title: "",
      time: Date.now(),
      id: generateRandomId(),
    },
    stbOverlayInfo: { name: "", time: Date.now(), id: generateRandomId() },
  },
};

export const presentationSlice = createSlice({
  name: "presentation",
  initialState,
  reducers: {
    updatePresentation: (state, action: PayloadAction<Presentation>) => {
      if (state.isProjectorTransmitting) {
        // set previous info for cross animation
        state.prevProjectorInfo.slide = state.projectorInfo.slide;
        state.prevProjectorInfo.name = state.projectorInfo.name;
        state.prevProjectorInfo.type = state.projectorInfo.type;
        state.prevProjectorInfo.time = state.projectorInfo.time;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.time = Date.now();
      }
      if (state.isMonitorTransmitting) {
        // set previous info for cross animation
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.time = Date.now();
      }
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.slide = state.streamInfo.slide;
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;

        if (action.payload.type !== "bible") {
          state.streamInfo.slide = action.payload.slide;
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.time = Date.now();
      }
    },
    toggleProjectorTransmitting: (state) => {
      state.isProjectorTransmitting = !state.isProjectorTransmitting;
    },
    toggleMonitorTransmitting: (state) => {
      state.isMonitorTransmitting = !state.isMonitorTransmitting;
    },
    toggleStreamTransmitting: (state) => {
      state.isStreamTransmitting = !state.isStreamTransmitting;
    },
    setTransmitToAll: (state, action: PayloadAction<boolean>) => {
      state.isProjectorTransmitting = action.payload;
      state.isMonitorTransmitting = action.payload;
      state.isStreamTransmitting = action.payload;
    },
    updateParticipantOverlayInfo: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      console.log({ action });

      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.participantOverlayInfo =
          state.streamInfo.participantOverlayInfo;
        state.streamInfo.participantOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        state.streamInfo.time = Date.now();
      }
    },
    updateStbOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
        state.streamInfo.stbOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        state.streamInfo.time = Date.now();
      }
    },
    updateParticipantOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.streamInfo.participantOverlayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      state.streamInfo.time = action.payload.time;
    },
    updateStbOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.streamInfo.stbOverlayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      state.streamInfo.time = action.payload.time;
    },
    updateBibleDisplayInfo: (
      state,
      action: PayloadAction<BibleDisplayInfo>
    ) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.bibleDisplayInfo =
          state.streamInfo.bibleDisplayInfo;
        state.streamInfo.bibleDisplayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        state.streamInfo.slide = null;
        state.streamInfo.time = Date.now();
        // state.prevStreamInfo.slide = null;
      }
    },
    updateBibleDisplayInfoFromRemote: (
      state,
      action: PayloadAction<BibleDisplayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.streamInfo.bibleDisplayInfo = { ...action.payload };
      state.streamInfo.slide = null;
      state.streamInfo.time = action.payload.time;
      // state.prevStreamInfo.slide = null;
    },
    clearProjector: (state) => {
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;

      state.projectorInfo = {
        ...initialState.projectorInfo,
        time: Date.now(),
      };
    },
    clearMonitor: (state) => {
      // set previous info for fading out
      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;

      state.monitorInfo = {
        ...initialState.monitorInfo,
        time: Date.now(),
      };
    },
    clearStream: (state) => {
      // set previous info for fading out
      state.prevStreamInfo.slide = state.streamInfo.slide;
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;

      state.streamInfo = {
        ...initialState.streamInfo,
        time: Date.now(),
        bibleDisplayInfo: { title: "", text: "", time: Date.now() },
      };
    },
    clearAll: (state) => {
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;

      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;

      state.prevStreamInfo.slide = state.streamInfo.slide;
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;

      state.projectorInfo = {
        ...initialState.projectorInfo,
        time: Date.now(),
      };
      state.monitorInfo = {
        ...initialState.monitorInfo,
        time: Date.now(),
      };
      state.streamInfo = {
        ...initialState.streamInfo,
        time: Date.now(),
        bibleDisplayInfo: { title: "", text: "", time: Date.now() },
      };
    },
    updateProjector: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      if (state.isProjectorTransmitting) {
        state.prevProjectorInfo.slide = state.projectorInfo.slide;
        state.prevProjectorInfo.name = state.projectorInfo.name;
        state.prevProjectorInfo.type = state.projectorInfo.type;
        state.prevProjectorInfo.time = state.projectorInfo.time;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.time = Date.now();
      }
    },
    updateProjectorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;

      state.projectorInfo.slide = action.payload.slide;
      state.projectorInfo.name = action.payload.name;
      state.projectorInfo.type = action.payload.type;
      state.projectorInfo.time = action.payload.time;
    },
    updateMonitor: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      if (state.isMonitorTransmitting) {
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.time = Date.now();
      }
    },
    updateMonitorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;

      state.monitorInfo.slide = action.payload.slide;
      state.monitorInfo.name = action.payload.name;
      state.monitorInfo.type = action.payload.type;
      state.monitorInfo.time = action.payload.time;
    },
    updateStream: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      if (state.isStreamTransmitting) {
        state.prevStreamInfo.slide = state.streamInfo.slide;
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;

        if (action.payload.type !== "bible") {
          state.streamInfo.slide = action.payload.slide;
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.time = Date.now();
      }
    },
    updateStreamFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevStreamInfo.slide = state.streamInfo.slide;
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;

      if (action.payload.type !== "bible") {
        state.streamInfo.slide = action.payload.slide;
      }

      state.streamInfo.name = action.payload.name;
      state.streamInfo.type = action.payload.type;
      state.streamInfo.time = action.payload.time;
    },
  },
});

export const {
  updatePresentation,
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  setTransmitToAll,
  updateParticipantOverlayInfo,
  updateStbOverlayInfo,
  updateBibleDisplayInfo,
  clearProjector,
  clearMonitor,
  clearStream,
  clearAll,
  updateProjector,
  updateMonitor,
  updateStream,
  updateProjectorFromRemote,
  updateMonitorFromRemote,
  updateStreamFromRemote,
  updateBibleDisplayInfoFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
} = presentationSlice.actions;

export default presentationSlice.reducer;
