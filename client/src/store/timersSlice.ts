import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo } from "../types";
import { calculateRemainingTime } from "../utils/generalUtils";

interface TimersState {
  timers: TimerInfo[];
  timersFromDocs: TimerInfo[];
  shouldUpdateTimers: boolean;
}

const initialState: TimersState = {
  timers: [],
  timersFromDocs: [],
  shouldUpdateTimers: false,
};

export const timersSlice = createSlice({
  name: "timers",
  initialState,
  reducers: {
    setShouldUpdateTimers: (state, action: PayloadAction<boolean>) => {
      state.shouldUpdateTimers = action.payload;
    },
    setTimersFromDocs: (
      state,
      action: PayloadAction<(TimerInfo | undefined)[]>
    ) => {
      state.timersFromDocs = action.payload.filter(
        (timer) => timer !== undefined
      ) as TimerInfo[];
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
      state.shouldUpdateTimers = true;
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
            hostId: timerInfo.hostId,
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
      state.shouldUpdateTimers = true;
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
  },
});

export const {
  setTimersFromDocs,
  syncTimers,
  syncTimersFromRemote,
  addTimer,
  updateTimer,
  updateTimerFromRemote,
  tickTimers,
  setShouldUpdateTimers,
} = timersSlice.actions;

export default timersSlice.reducer;
