import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Presentation } from '../types';


type PresentationState = {
  isProjectorTransmitting: boolean,
  isMonitorTransmitting: boolean,
  isOverlayTransmitting: boolean,
  projectorInfo: Presentation,
  monitorInfo: Presentation,
  overlayInfo: Presentation
}

const initialState: PresentationState = {
  isProjectorTransmitting: false,
  isMonitorTransmitting: false,
  isOverlayTransmitting: false,
  projectorInfo: { type: '', name: '', slide: null },
  monitorInfo: { type: '', name: '', slide: null }, 
  overlayInfo: { type: '', name: '', slide: null }
}

export const presentationSlice = createSlice({
  name: 'user',
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
      if (state.isOverlayTransmitting) {
        state.overlayInfo = {...action.payload}
        state.overlayInfo.displayType = 'overlay'
      }
    },
    toggleProjectorTransmitting: (state) => {
      state.isProjectorTransmitting = !state.isProjectorTransmitting
    },
    toggleMonitorTransmitting: (state) => {
      state.isMonitorTransmitting = !state.isMonitorTransmitting
    },
    toggleOverlayTransmitting: (state) => {
      state.isOverlayTransmitting = !state.isOverlayTransmitting
    },
    setTransmitToAll: (state, action : PayloadAction<boolean>) => {
      state.isProjectorTransmitting = action.payload;
      state.isMonitorTransmitting = action.payload;
      state.isOverlayTransmitting = action.payload;
    }
  }
});

export const { 
  updatePresentation, 
  toggleProjectorTransmitting,
  toggleMonitorTransmitting,
  toggleOverlayTransmitting,
  setTransmitToAll
} = presentationSlice.actions;

export default presentationSlice.reducer;