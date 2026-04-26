import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { TimerInfo } from "../types";
import { calculateRemainingTime, calculateEndTime } from "../utils/timerUtils";

interface TimersState {
  timers: TimerInfo[];
  shouldUpdateTimers: boolean;
}

const initialState: TimersState = {
  timers: [],
  shouldUpdateTimers: false,
};

const buildBaseTimer = (
  timerInfo: Partial<TimerInfo>,
  existingTimer?: TimerInfo
): TimerInfo => ({
  hostId: timerInfo.hostId ?? existingTimer?.hostId ?? "",
  id: timerInfo.id ?? existingTimer?.id ?? "",
  name: timerInfo.name ?? existingTimer?.name ?? "",
  color: timerInfo.color ?? existingTimer?.color,
  duration: timerInfo.duration ?? existingTimer?.duration,
  countdownTime:
    timerInfo.countdownTime ?? existingTimer?.countdownTime ?? "00:00",
  timerType: timerInfo.timerType ?? existingTimer?.timerType ?? "timer",
  status: timerInfo.status ?? existingTimer?.status ?? "stopped",
  isActive:
    timerInfo.status !== undefined
      ? timerInfo.status === "running"
      : (existingTimer?.isActive ?? false),
  remainingTime:
    timerInfo.remainingTime ??
    existingTimer?.remainingTime ??
    timerInfo.duration ??
    existingTimer?.duration ??
    0,
  startedAt: timerInfo.startedAt ?? existingTimer?.startedAt,
  endTime: timerInfo.endTime ?? existingTimer?.endTime,
  showMinutesOnly:
    timerInfo.showMinutesOnly ?? existingTimer?.showMinutesOnly ?? false,
  time: timerInfo.time ?? existingTimer?.time,
});

const finalizeTimerState = (
  timerInfo: TimerInfo,
  existingTimer?: TimerInfo,
  options: { ignoreExistingEndTimeOnStart?: boolean } = {}
): TimerInfo => {
  const previousStatus = existingTimer?.status;
  const hasExplicitEndTime =
    timerInfo.endTime !== undefined &&
    !(
      options.ignoreExistingEndTimeOnStart &&
      timerInfo.status === "running" &&
      previousStatus === "stopped" &&
      timerInfo.endTime === existingTimer?.endTime
    );
  const isStarting =
    timerInfo.status === "running" &&
    previousStatus === "stopped" &&
    !hasExplicitEndTime;
  const isResuming =
    timerInfo.status === "running" &&
    previousStatus === "paused" &&
    !hasExplicitEndTime;

  const endTime = calculateEndTime(
    timerInfo,
    isStarting,
    isResuming,
    existingTimer
  );

  return {
    ...timerInfo,
    isActive: timerInfo.status === "running",
    endTime,
    remainingTime: calculateRemainingTime({
      timerInfo: { ...timerInfo, endTime },
      previousStatus,
    }),
  };
};

const shouldPreserveExistingRuntime = (
  existingTimer: TimerInfo | undefined,
  timerInfo: Partial<TimerInfo>
) => {
  if (!existingTimer) return false;

  const existingTime = existingTimer.time ?? -1;
  const incomingTime = timerInfo.time ?? -1;
  if (existingTime > incomingTime) return true;

  return (
    timerInfo.time === undefined &&
    existingTimer.status !== "stopped" &&
    timerInfo.status === "stopped"
  );
};

const hydrateTimer = (
  timerInfo: Partial<TimerInfo>,
  existingTimer?: TimerInfo
): TimerInfo => {
  const preserveExistingRuntime = shouldPreserveExistingRuntime(
    existingTimer,
    timerInfo
  );
  const runtimeSource = preserveExistingRuntime ? existingTimer : timerInfo;

  return finalizeTimerState(
    buildBaseTimer(
      {
        ...timerInfo,
        status: runtimeSource?.status ?? timerInfo.status,
        remainingTime: runtimeSource?.remainingTime ?? timerInfo.remainingTime,
        startedAt: runtimeSource?.startedAt ?? timerInfo.startedAt,
        endTime: runtimeSource?.endTime ?? timerInfo.endTime,
      },
      existingTimer
    ),
    existingTimer
  );
};

const applyTimerUpdate = (
  timerInfo: Partial<TimerInfo>,
  existingTimer: TimerInfo
) =>
  finalizeTimerState(
    buildBaseTimer(
      {
        ...existingTimer,
        ...timerInfo,
      },
      existingTimer
    ),
    existingTimer,
    { ignoreExistingEndTimeOnStart: true }
  );

export const timersSlice = createSlice({
  name: "timers",
  initialState,
  reducers: {
    setShouldUpdateTimers: (state, action: PayloadAction<boolean>) => {
      state.shouldUpdateTimers = action.payload;
    },
    syncTimers: (state, action: PayloadAction<(TimerInfo | undefined)[]>) => {
      // Create a map of existing timers for quick lookup
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );

      const newTimers = action.payload.map((timerInfo) => {
        if (!timerInfo) return null;
        const existingTimer = existingTimersMap.get(timerInfo.id);
        return hydrateTimer(timerInfo, existingTimer);
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
    reconcileTimersFromRemote: (
      state,
      action: PayloadAction<{ timers: TimerInfo[]; hostId: string }>
    ) => {
      const { timers: remoteTimers, hostId } = action.payload;
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );
      const nextTimers = state.timers.filter((timer) => timer.hostId === hostId);

      remoteTimers.forEach((timerInfo) => {
        const existingTimer = existingTimersMap.get(timerInfo.id);
        nextTimers.push(hydrateTimer(timerInfo, existingTimer));
      });

      state.timers = nextTimers;
    },
    reconcileTimersFromDocs: (
      state,
      action: PayloadAction<{
        timers: TimerInfo[];
        knownDocIds: string[];
      }>
    ) => {
      const { timers, knownDocIds } = action.payload;
      const docIds = new Set(timers.map((timer) => timer.id));
      const knownDocIdSet = new Set(knownDocIds);
      const existingTimersMap = new Map(
        state.timers.map((timer) => [timer.id, timer])
      );

      const nextTimers = state.timers.filter(
        (timer) => !knownDocIdSet.has(timer.id) || docIds.has(timer.id)
      );
      const nextTimersMap = new Map(nextTimers.map((timer) => [timer.id, timer]));

      timers.forEach((timerInfo) => {
        const existingTimer =
          nextTimersMap.get(timerInfo.id) || existingTimersMap.get(timerInfo.id);
        nextTimersMap.set(timerInfo.id, hydrateTimer(timerInfo, existingTimer));
      });

      state.timers = Array.from(nextTimersMap.values());
    },
    addTimer: (state, action: PayloadAction<TimerInfo>) => {
      const timerInfo = {
        ...action.payload,
        time: action.payload.time ?? Date.now(),
      };
      const existingTimer = state.timers.find((timer) => timer.id === timerInfo.id);
      const nextTimer = hydrateTimer(timerInfo, existingTimer);

      if (existingTimer) {
        state.timers = state.timers.map((timer) =>
          timer.id === nextTimer.id ? nextTimer : timer
        );
      } else {
        state.timers.push(nextTimer);
      }
      state.shouldUpdateTimers = true;
    },
    updateTimer: (
      state,
      action: PayloadAction<{ id: string; timerInfo: TimerInfo }>
    ) => {
      const { id, timerInfo } = action.payload;
      state.timers = state.timers.map((timer) => {
        if (timer.id === id) {
          return applyTimerUpdate(
            {
              ...timerInfo,
              time: Date.now(),
            },
            timer
          );
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
          return applyTimerUpdate(
            {
              ...timer,
              color,
              hostId: hostId || timer.hostId,
              time: Date.now(),
            },
            timer
          );
        }
        return timer;
      });
      state.shouldUpdateTimers = true;
    },

    updateTimerFromRemote: (state, action: PayloadAction<TimerInfo>) => {
      const { id, ...timerInfo } = action.payload;
      state.timers = state.timers.map((timer) => {
        if (timer.id === id) {
          return hydrateTimer({ id, ...timerInfo }, timer);
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
  syncTimers,
  reconcileTimersFromRemote,
  reconcileTimersFromDocs,
  addTimer,
  updateTimer,
  updateTimerFromRemote,
  tickTimers,
  setShouldUpdateTimers,
  updateTimerColor,
  deleteTimer,
} = timersSlice.actions;

export default timersSlice.reducer;
