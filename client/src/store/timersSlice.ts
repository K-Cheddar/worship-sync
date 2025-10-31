import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo } from "../types";
import { calculateRemainingTime, calculateEndTime } from "../utils/timerUtils";

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

        const isStarting =
          timerInfo.status === "running" &&
          (!existingTimer || existingTimer.status === "stopped");
        const isResuming =
          timerInfo.status === "running" && existingTimer?.status === "paused";

        const endTime = calculateEndTime(
          timerInfo,
          isStarting,
          isResuming,
          existingTimer
        );

        // Preserve existing timer state if available
        const timerState = existingTimer || {
          hostId: timerInfo.hostId,
          id: timerInfo.id,
          name: timerInfo.name,
          timerType: timerInfo.timerType || "timer",
          status: timerInfo.status || "stopped",
          isActive: timerInfo.status === "running",
          countdownTime: timerInfo.countdownTime || "00:00",
          duration: timerInfo.duration || 0,
          startedAt: timerInfo.startedAt,
          endTime,
          showMinutesOnly: timerInfo.showMinutesOnly || false,
        };

        return {
          ...timerState,
          remainingTime: calculateRemainingTime({
            timerInfo: { ...timerInfo, endTime },
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
          const isStarting =
            timerInfo.status === "running" && timer.status === "stopped";
          const isResuming =
            timerInfo.status === "running" && timer.status === "paused";

          const endTime = calculateEndTime(
            timerInfo,
            isStarting,
            isResuming,
            timer
          );

          return {
            ...timer,
            hostId: timerInfo.hostId,
            status: timerInfo.status,
            isActive: timerInfo.status === "running",
            countdownTime: timerInfo.countdownTime,
            duration: timerInfo.duration,
            timerType: timerInfo.timerType,
            startedAt: timerInfo.startedAt,
            endTime,
            showMinutesOnly: timerInfo.showMinutesOnly,
            remainingTime: calculateRemainingTime({
              timerInfo: { ...timerInfo, endTime },
              previousStatus: timer.status,
            }),
          };
        }
        return timer;
      });
      state.shouldUpdateTimers = true;
    },
    updateTimerColor: (
      state,
      action: PayloadAction<{ id: string; color: string; hostId?: string }>
    ) => {
      const { id, color, hostId } = action.payload;
      state.timers = state.timers.map((timer) => {
        if (timer.id === id) {
          return { ...timer, color, hostId: hostId || timer.hostId };
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
        if (timer.isActive && timer.status === "running" && timer.endTime) {
          const endTime = new Date(timer.endTime).getTime();
          const now = Date.now();
          const remainingSeconds = Math.floor((endTime - now) / 1000);
          timer.remainingTime = Math.max(0, remainingSeconds);

          // Auto-stop timer when it completes (remainingTime reaches 0)
          if (timer.remainingTime === 0) {
            timer.status = "stopped";
            timer.isActive = false;
          }
        }
      });
      state.shouldUpdateTimers = true;
    },
    deleteTimer: (state, action: PayloadAction<string>) => {
      state.timers = state.timers.filter(
        (timer) => timer.id !== action.payload
      );
      state.shouldUpdateTimers = true;
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
  updateTimerColor,
  deleteTimer,
} = timersSlice.actions;

export default timersSlice.reducer;
