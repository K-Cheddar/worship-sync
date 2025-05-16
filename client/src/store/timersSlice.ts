import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo } from "../types";
import { calculateRemainingTime } from "../utils/generalUtils";

interface TimersState {
  timers: TimerInfo[];
  intervalId: NodeJS.Timeout | null;
  hostId: string;
}

const initialState: TimersState = {
  timers: [],
  intervalId: null,
  hostId: "",
};

export const timersSlice = createSlice({
  name: "timers",
  initialState,
  reducers: {
    setHostId: (state, action: PayloadAction<string>) => {
      state.hostId = action.payload;
    },
    syncTimers: (state, action: PayloadAction<(TimerInfo | undefined)[]>) => {
      // Create a map of existing timers for quick lookup
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );

      const newTimers = action.payload.map((timerInfo) => {
        const existingTimer = state.timers.find(
          (timer) => timer.id === timerInfo?.id
        );
        if (!timerInfo) return null;

        return {
          hostId: timerInfo.hostId,
          id: timerInfo.id,
          name: timerInfo.name,
          timerType: timerInfo.timerType || "timer",
          status: timerInfo.status || "stopped",
          isActive: timerInfo.status === "running",
          countdownTime: timerInfo.countdownTime || "00:00",
          duration: timerInfo.duration || 0,
          startedAt: timerInfo.startedAt,
          remainingTime: calculateRemainingTime({
            timerInfo,
            previousStatus: existingTimer?.status,
          }),
        };
      });

      // Update or add new timers
      newTimers.forEach((newTimer) => {
        if (newTimer) {
          existingTimersMap.set(newTimer.id, newTimer);
        }
      });

      // Convert map back to array
      state.timers = Array.from(existingTimersMap.values());
    },
    syncTimersFromRemote: (state, action: PayloadAction<TimerInfo[]>) => {
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );
      action.payload.forEach((timerInfo) => {
        existingTimersMap.set(timerInfo.id, timerInfo);
      });
      state.timers = Array.from(existingTimersMap.values());
    },
    addTimer: (state, action: PayloadAction<TimerInfo>) => {
      state.timers.push(action.payload);
    },
    updateTimer: (
      state,
      action: PayloadAction<{ id: string; timerInfo: TimerInfo }>
    ) => {
      const { id, timerInfo } = action.payload;
      state.timers = state.timers.map((timer) => {
        if (timer.id === id) {
          return {
            ...timer,
            hostId: state.hostId,
            status: timerInfo.status,
            isActive: timerInfo.status === "running",
            countdownTime: timerInfo.countdownTime,
            duration: timerInfo.duration,
            timerType: timerInfo.timerType,
            startedAt: timerInfo.startedAt,
            remainingTime: calculateRemainingTime({
              timerInfo,
              previousStatus: timer.status,
            }),
          };
        }
        return timer;
      });
    },
    updateTimerFromRemote: (state, action: PayloadAction<TimerInfo>) => {
      const { id, ...timerInfo } = action.payload;
      state.timers = state.timers.map((timer) => {
        if (timer.id === id) {
          return {
            ...timer,
            ...timerInfo,
            remainingTime: calculateRemainingTime({
              timerInfo,
              previousStatus: timer.status,
            }),
          };
        }
        return timer;
      });
    },
    tickTimers: (state) => {
      state.timers.forEach((timer) => {
        if (timer.isActive && timer.status === "running") {
          if (timer.remainingTime > 0) {
            timer.remainingTime -= 1;
          }
        }
      });
    },
    setIntervalId: (state, action: PayloadAction<NodeJS.Timeout | null>) => {
      state.intervalId = action.payload;
    },
  },
});

export const {
  setHostId,
  syncTimers,
  syncTimersFromRemote,
  addTimer,
  updateTimer,
  updateTimerFromRemote,
  tickTimers,
  setIntervalId,
} = timersSlice.actions;

export default timersSlice.reducer;
