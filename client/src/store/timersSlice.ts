import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo, TimerStatus, TimerType, ItemState } from "../types";

interface TimerState {
  id: string;
  name: string;
  timerInfo: TimerInfo;
  isActive: boolean;
}

interface TimersState {
  timers: TimerState[];
}

const initialState: TimersState = {
  timers: [],
};

export const timersSlice = createSlice({
  name: "timers",
  initialState,
  reducers: {
    syncTimers: (state, action: PayloadAction<ItemState[]>) => {
      // Filter items of type timer and map them to timer state
      state.timers = action.payload
        .filter((item) => item.type === "timer" && item.timerInfo)
        .map((item) => ({
          id: item._id,
          name: item.name,
          timerInfo: item.timerInfo!,
          isActive: item.timerInfo?.status === "running",
        }));
    },
    updateTimer: (
      state,
      action: PayloadAction<{ id: string; timerInfo: TimerInfo }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.timerInfo = action.payload.timerInfo;
        timer.isActive = action.payload.timerInfo.status === "running";
      }
    },
    setTimerActive: (
      state,
      action: PayloadAction<{ id: string; isActive: boolean }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.isActive = action.payload.isActive;
        if (!action.payload.isActive) {
          timer.timerInfo.status = "stopped";
        }
      }
    },
    updateTimerStatus: (
      state,
      action: PayloadAction<{ id: string; status: TimerStatus }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.timerInfo.status = action.payload.status;
        timer.isActive = action.payload.status === "running";
      }
    },
    updateTimerDuration: (
      state,
      action: PayloadAction<{ id: string; duration: number }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.timerInfo.duration = action.payload.duration;
      }
    },
    updateTimerCountdownTime: (
      state,
      action: PayloadAction<{ id: string; countdownTime: string }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.timerInfo.countdownTime = action.payload.countdownTime;
      }
    },
    updateTimerType: (
      state,
      action: PayloadAction<{ id: string; timerType: TimerType }>
    ) => {
      const timer = state.timers.find((t) => t.id === action.payload.id);
      if (timer) {
        timer.timerInfo.timerType = action.payload.timerType;
      }
    },
  },
});

export const {
  syncTimers,
  updateTimer,
  setTimerActive,
  updateTimerStatus,
  updateTimerDuration,
  updateTimerCountdownTime,
  updateTimerType,
} = timersSlice.actions;

export default timersSlice.reducer;
