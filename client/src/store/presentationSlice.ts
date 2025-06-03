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
      time: Date.now(),
      id: generateRandomId(),
    },
    stbOverlayInfo: { heading: "", time: Date.now(), id: generateRandomId() },
    qrCodeOverlayInfo: { time: Date.now(), id: generateRandomId() },
    imageOverlayInfo: { time: Date.now(), id: generateRandomId() },
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
        state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.timerId = action.payload.timerId;
        state.projectorInfo.time = Date.now();
      }
      if (state.isMonitorTransmitting) {
        // set previous info for cross animation
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;
        state.prevMonitorInfo.timerId = state.monitorInfo.timerId;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.timerId = action.payload.timerId;
        state.monitorInfo.time = Date.now();
      }
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.slide = state.streamInfo.slide;
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;
        state.prevStreamInfo.timerId = state.streamInfo.timerId;
        if (action.payload.type !== "bible") {
          state.streamInfo.slide = action.payload.slide;
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.timerId = action.payload.timerId;
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
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.participantOverlayInfo =
          state.streamInfo.participantOverlayInfo;
        state.streamInfo.participantOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        if (
          action.payload.name ||
          action.payload.title ||
          action.payload.event
        ) {
          state.prevStreamInfo.bibleDisplayInfo =
            state.streamInfo.bibleDisplayInfo;
          state.prevStreamInfo.qrCodeOverlayInfo =
            state.streamInfo.qrCodeOverlayInfo;
          state.prevStreamInfo.imageOverlayInfo =
            state.streamInfo.imageOverlayInfo;
          state.prevStreamInfo.slide = state.streamInfo.slide;

          state.streamInfo.qrCodeOverlayInfo = {
            description: "",
            time: Date.now(),
            id: generateRandomId(),
          };
          state.streamInfo.slide = null;
          state.streamInfo.bibleDisplayInfo = {
            title: "",
            text: "",
            time: Date.now(),
          };
          state.streamInfo.imageOverlayInfo = {
            name: "",
            imageUrl: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
      }
    },
    updateStbOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
        state.prevStreamInfo.imageOverlayInfo =
          state.streamInfo.imageOverlayInfo;

        state.streamInfo.stbOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        state.streamInfo.imageOverlayInfo = {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        };
      }
    },
    updateQrCodeOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.qrCodeOverlayInfo =
          state.streamInfo.qrCodeOverlayInfo;
        state.streamInfo.qrCodeOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };
        if (action.payload.url || action.payload.description) {
          state.prevStreamInfo.bibleDisplayInfo =
            state.streamInfo.bibleDisplayInfo;
          state.prevStreamInfo.participantOverlayInfo =
            state.streamInfo.participantOverlayInfo;
          state.prevStreamInfo.imageOverlayInfo =
            state.streamInfo.imageOverlayInfo;
          state.prevStreamInfo.slide = state.streamInfo.slide;

          state.streamInfo.participantOverlayInfo = {
            name: "",
            time: Date.now(),
            id: generateRandomId(),
          };
          state.streamInfo.slide = null;
          state.streamInfo.bibleDisplayInfo = {
            title: "",
            text: "",
            time: Date.now(),
          };
          state.streamInfo.imageOverlayInfo = {
            name: "",
            imageUrl: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
      }
    },
    updateImageOverlayInfo: (state, action: PayloadAction<OverlayInfo>) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.imageOverlayInfo =
          state.streamInfo.imageOverlayInfo;
        state.streamInfo.imageOverlayInfo = {
          ...action.payload,
          time: Date.now(),
        };

        // clear other overlays
        if (action.payload.imageUrl) {
          state.prevStreamInfo.bibleDisplayInfo =
            state.streamInfo.bibleDisplayInfo;
          state.prevStreamInfo.participantOverlayInfo =
            state.streamInfo.participantOverlayInfo;
          state.prevStreamInfo.qrCodeOverlayInfo =
            state.streamInfo.qrCodeOverlayInfo;
          state.prevStreamInfo.slide = state.streamInfo.slide;

          state.streamInfo.participantOverlayInfo = {
            name: "",
            time: Date.now(),
            id: generateRandomId(),
          };
          state.streamInfo.slide = null;
          state.streamInfo.bibleDisplayInfo = {
            title: "",
            text: "",
            time: Date.now(),
          };
          state.streamInfo.qrCodeOverlayInfo = {
            description: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
      }
    },
    updateImageOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;
      state.streamInfo.imageOverlayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      // clear other overlays
      if (action.payload.url || action.payload.description) {
        state.prevStreamInfo.bibleDisplayInfo =
          state.streamInfo.bibleDisplayInfo;
        state.prevStreamInfo.participantOverlayInfo =
          state.streamInfo.participantOverlayInfo;
        state.prevStreamInfo.qrCodeOverlayInfo =
          state.streamInfo.qrCodeOverlayInfo;
        state.prevStreamInfo.slide = state.streamInfo.slide;

        state.streamInfo.participantOverlayInfo = {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        };
        state.streamInfo.slide = null;
        state.streamInfo.bibleDisplayInfo = {
          title: "",
          text: "",
          time: Date.now(),
        };
        state.streamInfo.qrCodeOverlayInfo = {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        };
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
      if (action.payload.name || action.payload.title || action.payload.event) {
        state.prevStreamInfo.bibleDisplayInfo =
          state.streamInfo.bibleDisplayInfo;
        state.prevStreamInfo.qrCodeOverlayInfo =
          state.streamInfo.qrCodeOverlayInfo;
        state.prevStreamInfo.imageOverlayInfo =
          state.streamInfo.imageOverlayInfo;
        state.prevStreamInfo.slide = state.streamInfo.slide;

        state.streamInfo.qrCodeOverlayInfo = {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        };
        state.streamInfo.slide = null;
        state.streamInfo.bibleDisplayInfo = {
          title: "",
          text: "",
          time: Date.now(),
        };
        state.streamInfo.imageOverlayInfo = {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        };
      }
    },
    updateStbOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;
      state.streamInfo.stbOverlayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      state.streamInfo.imageOverlayInfo = {
        name: "",
        imageUrl: "",
        time: Date.now(),
        id: generateRandomId(),
      };
    },
    updateQrCodeOverlayInfoFromRemote: (
      state,
      action: PayloadAction<OverlayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.streamInfo.qrCodeOverlayInfo = {
        ...action.payload,
        time: action.payload.time,
      };
      if (action.payload.url || action.payload.description) {
        state.prevStreamInfo.bibleDisplayInfo =
          state.streamInfo.bibleDisplayInfo;
        state.prevStreamInfo.participantOverlayInfo =
          state.streamInfo.participantOverlayInfo;
        state.prevStreamInfo.imageOverlayInfo =
          state.streamInfo.imageOverlayInfo;
        state.prevStreamInfo.slide = state.streamInfo.slide;

        state.streamInfo.participantOverlayInfo = {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        };
        state.streamInfo.slide = null;
        state.streamInfo.bibleDisplayInfo = {
          title: "",
          text: "",
          time: Date.now(),
        };
        state.streamInfo.imageOverlayInfo = {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        };
      }
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
        if (action.payload.text || action.payload.title) {
          state.prevStreamInfo.qrCodeOverlayInfo =
            state.streamInfo.qrCodeOverlayInfo;
          state.prevStreamInfo.participantOverlayInfo =
            state.streamInfo.participantOverlayInfo;
          state.prevStreamInfo.imageOverlayInfo =
            state.streamInfo.imageOverlayInfo;
          state.prevStreamInfo.slide = state.streamInfo.slide;

          state.streamInfo.participantOverlayInfo = {
            name: "",
            time: Date.now(),
            id: generateRandomId(),
          };
          state.streamInfo.slide = null;
          state.streamInfo.qrCodeOverlayInfo = {
            description: "",
            time: Date.now(),
            id: generateRandomId(),
          };
          state.streamInfo.imageOverlayInfo = {
            name: "",
            imageUrl: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
        state.streamInfo.time = Date.now();
      }
    },
    updateBibleDisplayInfoFromRemote: (
      state,
      action: PayloadAction<BibleDisplayInfo>
    ) => {
      // set previous info for cross animation
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.streamInfo.bibleDisplayInfo = { ...action.payload };
      if (action.payload.text || action.payload.title) {
        state.prevStreamInfo.qrCodeOverlayInfo =
          state.streamInfo.qrCodeOverlayInfo;
        state.prevStreamInfo.imageOverlayInfo =
          state.streamInfo.imageOverlayInfo;
        state.prevStreamInfo.participantOverlayInfo =
          state.streamInfo.participantOverlayInfo;
        state.prevStreamInfo.slide = state.streamInfo.slide;

        state.streamInfo.participantOverlayInfo = {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        };
        state.streamInfo.slide = null;
        state.streamInfo.qrCodeOverlayInfo = {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        };
        state.streamInfo.imageOverlayInfo = {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        };
      }
    },
    clearProjector: (state) => {
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

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
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;

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
      state.prevStreamInfo.timerId = state.streamInfo.timerId;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;

      state.streamInfo = {
        ...initialState.streamInfo,
        time: Date.now(),
        bibleDisplayInfo: { title: "", text: "", time: Date.now() },
        participantOverlayInfo: {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        stbOverlayInfo: {
          heading: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        qrCodeOverlayInfo: {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        imageOverlayInfo: {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        },
      };
    },
    clearAll: (state) => {
      // set previous info for fading out
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;

      state.prevStreamInfo.slide = state.streamInfo.slide;
      state.prevStreamInfo.name = state.streamInfo.name;
      state.prevStreamInfo.type = state.streamInfo.type;
      state.prevStreamInfo.time = state.streamInfo.time;
      state.prevStreamInfo.timerId = state.streamInfo.timerId;
      state.prevStreamInfo.participantOverlayInfo =
        state.streamInfo.participantOverlayInfo;
      state.prevStreamInfo.stbOverlayInfo = state.streamInfo.stbOverlayInfo;
      state.prevStreamInfo.bibleDisplayInfo = state.streamInfo.bibleDisplayInfo;
      state.prevStreamInfo.qrCodeOverlayInfo =
        state.streamInfo.qrCodeOverlayInfo;
      state.prevStreamInfo.imageOverlayInfo = state.streamInfo.imageOverlayInfo;

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
        participantOverlayInfo: {
          name: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        stbOverlayInfo: {
          heading: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        qrCodeOverlayInfo: {
          description: "",
          time: Date.now(),
          id: generateRandomId(),
        },
        imageOverlayInfo: {
          name: "",
          imageUrl: "",
          time: Date.now(),
          id: generateRandomId(),
        },
      };
    },
    updateProjector: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>
    ) => {
      // set previous info for cross animation
      if (
        state.isProjectorTransmitting ||
        action.payload.skipTransmissionCheck
      ) {
        state.prevProjectorInfo.slide = state.projectorInfo.slide;
        state.prevProjectorInfo.name = state.projectorInfo.name;
        state.prevProjectorInfo.type = state.projectorInfo.type;
        state.prevProjectorInfo.time = state.projectorInfo.time;
        state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

        state.projectorInfo.slide = action.payload.slide;
        state.projectorInfo.type = action.payload.type;
        state.projectorInfo.name = action.payload.name;
        state.projectorInfo.timerId = action.payload.timerId;
        state.projectorInfo.time = Date.now();
      }
    },
    updateProjectorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevProjectorInfo.slide = state.projectorInfo.slide;
      state.prevProjectorInfo.name = state.projectorInfo.name;
      state.prevProjectorInfo.type = state.projectorInfo.type;
      state.prevProjectorInfo.time = state.projectorInfo.time;
      state.prevProjectorInfo.timerId = state.projectorInfo.timerId;

      state.projectorInfo.slide = action.payload.slide;
      state.projectorInfo.name = action.payload.name;
      state.projectorInfo.type = action.payload.type;
      state.projectorInfo.time = action.payload.time;
      state.projectorInfo.timerId = action.payload.timerId;
    },
    updateMonitor: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>
    ) => {
      // set previous info for cross animation
      if (state.isMonitorTransmitting || action.payload.skipTransmissionCheck) {
        state.prevMonitorInfo.slide = state.monitorInfo.slide;
        state.prevMonitorInfo.name = state.monitorInfo.name;
        state.prevMonitorInfo.type = state.monitorInfo.type;
        state.prevMonitorInfo.time = state.monitorInfo.time;
        state.prevMonitorInfo.timerId = state.monitorInfo.timerId;

        state.monitorInfo.slide = action.payload.slide;
        state.monitorInfo.name = action.payload.name;
        state.monitorInfo.type = action.payload.type;
        state.monitorInfo.timerId = action.payload.timerId;
        state.monitorInfo.time = Date.now();
      }
    },
    updateMonitorFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevMonitorInfo.slide = state.monitorInfo.slide;
      state.prevMonitorInfo.name = state.monitorInfo.name;
      state.prevMonitorInfo.type = state.monitorInfo.type;
      state.prevMonitorInfo.time = state.monitorInfo.time;
      state.prevMonitorInfo.timerId = state.monitorInfo.timerId;

      state.monitorInfo.slide = action.payload.slide;
      state.monitorInfo.name = action.payload.name;
      state.monitorInfo.type = action.payload.type;
      state.monitorInfo.time = action.payload.time;
      state.monitorInfo.timerId = action.payload.timerId;
    },
    updateStream: (
      state,
      action: PayloadAction<Presentation & { skipTransmissionCheck?: boolean }>
    ) => {
      // set previous info for cross animation
      if (state.isStreamTransmitting || action.payload.skipTransmissionCheck) {
        state.prevStreamInfo.slide = state.streamInfo.slide;
        state.prevStreamInfo.name = state.streamInfo.name;
        state.prevStreamInfo.type = state.streamInfo.type;
        state.prevStreamInfo.time = state.streamInfo.time;
        state.prevStreamInfo.timerId = state.streamInfo.timerId;
        if (action.payload.type !== "bible") {
          state.streamInfo.slide = action.payload.slide;
        }
        if (action.payload.participantOverlayInfo) {
          state.streamInfo.participantOverlayInfo =
            action.payload.participantOverlayInfo;
        } else {
          state.streamInfo.participantOverlayInfo = {
            name: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
        if (action.payload.stbOverlayInfo) {
          state.streamInfo.stbOverlayInfo = action.payload.stbOverlayInfo;
        } else {
          state.streamInfo.stbOverlayInfo = {
            heading: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
        if (action.payload.qrCodeOverlayInfo) {
          state.streamInfo.qrCodeOverlayInfo = action.payload.qrCodeOverlayInfo;
        } else {
          state.streamInfo.qrCodeOverlayInfo = {
            description: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }
        if (action.payload.imageOverlayInfo) {
          state.streamInfo.imageOverlayInfo = action.payload.imageOverlayInfo;
        } else {
          state.streamInfo.imageOverlayInfo = {
            name: "",
            imageUrl: "",
            time: Date.now(),
            id: generateRandomId(),
          };
        }

        state.streamInfo.name = action.payload.name;
        state.streamInfo.type = action.payload.type;
        state.streamInfo.timerId = action.payload.timerId;
        state.streamInfo.time = Date.now();
      }
    },
    updateStreamFromRemote: (state, action: PayloadAction<Presentation>) => {
      // set previous info for cross animation
      state.prevStreamInfo = { ...state.streamInfo };

      if (action.payload.type !== "bible") {
        state.streamInfo.slide = action.payload.slide;
      }

      state.streamInfo.name = action.payload.name;
      state.streamInfo.type = action.payload.type;
      state.streamInfo.time = action.payload.time;
      state.streamInfo.timerId = action.payload.timerId;
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
  updateQrCodeOverlayInfo,
  updateBibleDisplayInfo,
  updateImageOverlayInfo,
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
  updateQrCodeOverlayInfoFromRemote,
  updateImageOverlayInfoFromRemote,
} = presentationSlice.actions;

export default presentationSlice.reducer;
