import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { OverlayInfo, Presentation } from '../types';


type PresentationState = {
  isProjectorTransmitting: boolean,
  isMonitorTransmitting: boolean,
  isStreamTransmitting: boolean,
  projectorInfo: Presentation,
  monitorInfo: Presentation,
  streamInfo: Presentation
}

const initialState: PresentationState = {
  isProjectorTransmitting: false,
  isMonitorTransmitting: false,
  isStreamTransmitting: false,
  projectorInfo: { type: '', name: '', slide: null },
  monitorInfo: { type: '', name: '', slide: null }, 
  streamInfo: { type: '', name: '', slide: null }
}

export const presentationSlice = createSlice({
  name: 'presentation',
  initialState,
  reducers: {
    updatePresentation: (state, action : PayloadAction<Presentation>) => {
      if (state.isProjectorTransmitting) {
        state.projectorInfo = {...action.payload}
        state.projectorInfo.displayType = 'projector'
      }
      if (state.isMonitorTransmitting) {
        state.monitorInfo = {...action.payload}
        state.monitorInfo.displayType = 'monitor'
      }
      if (state.isStreamTransmitting) {
        state.streamInfo = {...action.payload}
        state.streamInfo.displayType = 'stream'
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
        console.log(action.payload, 'streamInfo', state.streamInfo)
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