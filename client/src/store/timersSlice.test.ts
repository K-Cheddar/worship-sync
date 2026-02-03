import { configureStore } from "@reduxjs/toolkit";
import { timersSlice } from "./timersSlice";
import type { TimerInfo } from "../types";
import { createTimerInfo } from "../test/fixtures";

type TimersState = ReturnType<typeof timersSlice.reducer>;
type TimersSliceState = { timers: TimersState };

const createStore = (preloadedState?: Partial<TimersSliceState>) =>
  configureStore({
    reducer: { timers: timersSlice.reducer },
    ...(preloadedState != null &&
      Object.keys(preloadedState).length > 0 && {
        preloadedState: preloadedState as TimersSliceState,
      }),
  });

describe("timersSlice", () => {
  describe("reducer only", () => {
    it("setShouldUpdateTimers sets shouldUpdateTimers", () => {
      const store = createStore();
      store.dispatch(timersSlice.actions.setShouldUpdateTimers(true));
      expect(store.getState().timers.shouldUpdateTimers).toBe(true);
      store.dispatch(timersSlice.actions.setShouldUpdateTimers(false));
      expect(store.getState().timers.shouldUpdateTimers).toBe(false);
    });

    it("syncTimers adds/updates timers from payload", () => {
      const store = createStore();
      const timers: TimerInfo[] = [
        createTimerInfo({
          id: "t1",
          hostId: "h1",
          name: "Timer 1",
          status: "running",
          isActive: true,
        }),
      ];
      store.dispatch(timersSlice.actions.syncTimers(timers));
      const state = store.getState().timers;
      expect(state.timers).toHaveLength(1);
      expect(state.timers[0].id).toBe("t1");
      expect(state.timers[0].name).toBe("Timer 1");
      expect(state.timers[0].status).toBe("running");
    });

    it("syncTimers filters out null/undefined from payload", () => {
      const store = createStore();
      store.dispatch(
        timersSlice.actions.syncTimers([
          createTimerInfo({ id: "t1", hostId: "h1" }),
          undefined,
          null as any,
        ]),
      );
      expect(store.getState().timers.timers).toHaveLength(1);
    });

    it("initial state has empty timers and shouldUpdateTimers false", () => {
      const store = createStore();
      expect(store.getState().timers.timers).toEqual([]);
      expect(store.getState().timers.shouldUpdateTimers).toBe(false);
    });
  });
});
