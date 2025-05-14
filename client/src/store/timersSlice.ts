import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo, TimerStatus, DBItem } from "../types";
import { getTimeDifference } from "../utils/generalUtils";

interface TimerState {
  id: string;
  name: string;
  timerInfo?: TimerInfo;
  isActive: boolean;
  remainingTime: number;
}

interface TimersState {
  timers: TimerState[];
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
    syncTimers: (state, action: PayloadAction<DBItem[]>) => {
      // Convert payload items to timer states
      const newTimers = action.payload
        .filter((item) => item.type === "timer")
        .map((item) => {
          return {
            id: item._id,
            name: item.name,
            timerInfo: item.timerInfo,
            isActive: item.timerInfo?.status === "running",
            remainingTime: (() => {
              if (item.timerInfo?.timerType === "timer") {
                return item.timerInfo?.duration || 0;
              }
              if (item.timerInfo?.countdownTime) {
                return getTimeDifference(item.timerInfo?.countdownTime);
              }
              return 0;
            })(),
          };
        });

      // Create a map of existing timers for quick lookup
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );

      // Update or add new timers
      newTimers.forEach((newTimer) => {
        existingTimersMap.set(newTimer.id, newTimer);
      });

      // Convert map back to array
      state.timers = Array.from(existingTimersMap.values());
    },
    updateTimer: (
      state,
      action: PayloadAction<{ id: string; status: TimerStatus }>
    ) => {
      state.timers = state.timers.map((timer) => {
        if (timer.id === action.payload.id) {
          return {
            ...timer,
            timerInfo: {
              ...timer.timerInfo!,
              status: action.payload.status,
            },
            isActive: action.payload.status === "running",
            remainingTime: (() => {
              if (timer.timerInfo!.timerType === "timer") {
                return action.payload.status === "stopped"
                  ? timer.timerInfo!.duration || 0
                  : timer.remainingTime;
              } else {
                // For countdown timers, always recalculate when status changes
                return getTimeDifference(
                  timer.timerInfo?.countdownTime || "00:00"
                );
              }
            })(),
          };
        }
        return timer;
      });
    },
    tickTimers: (state) => {
      state.timers.forEach((timer) => {
        if (timer.isActive && timer.timerInfo!.status === "running") {
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
