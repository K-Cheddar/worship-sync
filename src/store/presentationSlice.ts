import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { OverlayInfo, Presentation } from '../types';


type PresentationState = {
  isProjectorTransmitting: boolean,
  isMonitorTransmitting: boolean,
  isStreamTransmitting: boolean,
  prevProjectorInfo: Presentation,
  prevMonitorInfo: Presentation,
  prevStreamInfo: Presentation,
  projectorInfo: Presentation,
  monitorInfo: Presentation,
  streamInfo: Presentation
}

const initialState: PresentationState = {
  isProjectorTransmitting: false,
  isMonitorTransmitting: false,
  isStreamTransmitting: false,
  prevProjectorInfo: { type: '', name: '', slide: null, displayType: 'projector' },
  prevMonitorInfo: { type: '', name: '', slide: null, displayType: 'monitor' },
  prevStreamInfo: { type: '', name: '', slide: null, displayType: 'stream' },
  projectorInfo: { type: '', name: '', slide: null, displayType: 'projector' },
  monitorInfo: { type: '', name: '', slide: null, displayType: 'monitor' }, 
  streamInfo: { type: '', name: '', slide: null, displayType: 'stream' }
}

export const presentationSlice = createSlice({
  name: 'presentation',
  initialState,
  reducers: {
    updatePresentation: (state, action : PayloadAction<Presentation>) => {
      if (state.isProjectorTransmitting) {
        // set previous info for cross animation
        state.prevProjectorInfo.slide = state.projectorInfo.slide
        state.prevProjectorInfo.name = state.projectorInfo.name
        state.prevProjectorInfo.type = state.projectorInfo.type

        state.projectorInfo.slide = action.payload.slide
        state.projectorInfo.name = action.payload.name
        state.projectorInfo.type = action.payload.type
      }
      if (state.isMonitorTransmitting) {
        // set previous info for cross animation
        state.prevMonitorInfo.slide = state.monitorInfo.slide
        state.prevMonitorInfo.name = state.monitorInfo.name
        state.prevMonitorInfo.type = state.monitorInfo.type

        state.monitorInfo.slide = action.payload.slide
        state.monitorInfo.name = action.payload.name
        state.monitorInfo.type = action.payload.type
      }
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.slide = state.streamInfo.slide
        state.prevStreamInfo.name = state.streamInfo.name
        state.prevStreamInfo.type = state.streamInfo.type

        state.streamInfo.slide = action.payload.slide
        state.streamInfo.name = action.payload.name
        state.streamInfo.type = action.payload.type
      }
    },
    toggleProjectorTransmitting: (state) => {
      state.isProjectorTransmitting = !state.isProjectorTransmitting
    },
    toggleMonitorTransmitting: (state) => {
      state.isMonitorTransmitting = !state.isMonitorTransmitting
    },
    toggleStreamTransmitting: (state) => {
      state.isStreamTransmitting = !state.isStreamTransmitting
    },
    setTransmitToAll: (state, action : PayloadAction<boolean>) => {
      state.isProjectorTransmitting = action.payload;
      state.isMonitorTransmitting = action.payload;
      state.isStreamTransmitting = action.payload;
    },
    updateOverlayInfo: (state, action : PayloadAction<OverlayInfo>) => {
      if (state.isStreamTransmitting) {
        // set previous info for cross animation
        state.prevStreamInfo.overlayInfo = state.streamInfo.overlayInfo
        state.streamInfo.overlayInfo = {...action.payload}
      }
    }
  }
});

export const { 
  updatePresentation, 
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleStreamTransmitting,
  setTransmitToAll,
  updateOverlayInfo
} = presentationSlice.actions;

export default presentationSlice.reducer;