import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo } from "../types";
import { getTimeDifference } from "../utils/generalUtils";

interface TimersState {
  timers: TimerInfo[];
  intervalId: NodeJS.Timeout | null;
}

const initialState: TimersState = {
  timers: [],
  intervalId: null,
};

export const timersSlice = createSlice({
  name: "timers",
  initialState,
  reducers: {
    syncTimers: (state, action: PayloadAction<(TimerInfo | undefined)[]>) => {
      // Create a map of existing timers for quick lookup
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );

      const newTimers = action.payload.map((timerInfo) => {
        if (!timerInfo) return null;
        return {
          id: timerInfo.id,
          name: timerInfo.name,
          timerType: timerInfo.timerType || "timer",
          status: timerInfo.status || "stopped",
          isActive: timerInfo.status === "running",
          countdownTime: timerInfo.countdownTime || "00:00",
          duration: timerInfo.duration || 0,
          startedAt: timerInfo.startedAt,
          remainingTime: (() => {
            if (timerInfo.timerType === "timer") {
              return timerInfo.duration || 0;
            }
            if (timerInfo.countdownTime) {
              return getTimeDifference(timerInfo.countdownTime);
            }
            return 0;
          })(),
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
    updateTimer: (
      state,
      action: PayloadAction<{ id: string; timerInfo: TimerInfo }>
    ) => {
      state.timers = state.timers.map((timer) => {
        if (timer.id === action.payload.id) {
          return {
            ...timer,
            status: action.payload.timerInfo.status,
            isActive: action.payload.timerInfo.status === "running",
            countdownTime: action.payload.timerInfo.countdownTime,
            duration: action.payload.timerInfo.duration,
            timerType: action.payload.timerInfo.timerType,
            startedAt:
              action.payload.timerInfo.status === "running"
                ? new Date().toISOString()
                : timer.startedAt,
            remainingTime: (() => {
              if (timer.timerType === "timer") {
                const isStopping =
                  action.payload.timerInfo.status === "stopped";
                const isStartingFromStopped =
                  action.payload.timerInfo.status === "running" &&
                  timer.status === "stopped";

                // Reset timer to full duration when:
                // 1. Timer is explicitly stopped
                // 2. Timer is started from a stopped state
                if (isStopping || isStartingFromStopped) {
                  return timer.duration || 0;
                }

                // Keep current time when:
                // 1. Pausing the timer
                // 2. Resuming from paused state
                return timer.remainingTime;
              } else {
                // For countdown timers, always recalculate based on target time
                return getTimeDifference(timer.countdownTime || "00:00");
              }
            })(),
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

export const { syncTimers, updateTimer, tickTimers, setIntervalId } =
  timersSlice.actions;

export default timersSlice.reducer;
