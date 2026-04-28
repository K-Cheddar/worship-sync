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
  afterEach(() => {
    jest.useRealTimers();
  });

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

    it("syncTimers applies persisted timer fields like color and display settings", () => {
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              color: "#ffffff",
              duration: 60,
              remainingTime: 60,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.syncTimers([
          createTimerInfo({
            id: "t1",
            hostId: "h1",
            color: "#12ab34",
            duration: 90,
            remainingTime: 90,
            showMinutesOnly: true,
          }),
        ]),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          color: "#12ab34",
          duration: 90,
          showMinutesOnly: true,
          remainingTime: 90,
        }),
      );
    });

    it("syncTimers preserves a live running timer when older persisted data says stopped", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const runningEndTime = new Date("2026-04-05T12:05:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "live-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 300,
              endTime: runningEndTime,
              time: 500,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.syncTimers([
          createTimerInfo({
            id: "t1",
            hostId: "db-host",
            status: "stopped",
            isActive: false,
            duration: 300,
            remainingTime: 300,
            color: "#00ff88",
          }),
        ]),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          color: "#00ff88",
          status: "running",
          isActive: true,
          endTime: runningEndTime,
        }),
      );
    });

    it("starts a stopped timer with a fresh end time when it has stale completed runtime", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const staleEndTime = new Date("2026-04-05T11:55:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 0,
              endTime: staleEndTime,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.updateTimer({
          id: "t1",
          timerInfo: {
            ...store.getState().timers.timers[0],
            status: "running",
            startedAt: new Date("2026-04-05T12:00:00.000Z").toISOString(),
          },
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          status: "running",
          isActive: true,
          remainingTime: 300,
          endTime: new Date("2026-04-05T12:05:00.000Z").toISOString(),
        }),
      );
    });

    it("keeps a restarted timer running on the first tick after stale completion", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 0,
              endTime: new Date("2026-04-05T11:55:00.000Z").toISOString(),
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.updateTimer({
          id: "t1",
          timerInfo: {
            ...store.getState().timers.timers[0],
            status: "running",
            startedAt: new Date("2026-04-05T12:00:00.000Z").toISOString(),
          },
        }),
      );

      jest.setSystemTime(new Date("2026-04-05T12:00:01.000Z"));
      store.dispatch(timersSlice.actions.tickTimers());

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          status: "running",
          isActive: true,
          remainingTime: 299,
        }),
      );
    });

    it("reconcileTimersFromRemote removes stale remote timers but keeps own timers", () => {
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "own-timer",
              hostId: "host-1",
              status: "running",
              isActive: true,
            }),
            createTimerInfo({
              id: "remote-stale",
              hostId: "host-2",
              status: "running",
              isActive: true,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "host-1",
          timers: [
            createTimerInfo({
              id: "remote-fresh",
              hostId: "host-3",
              status: "running",
              isActive: true,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers).toEqual([
        expect.objectContaining({ id: "own-timer", hostId: "host-1" }),
        expect.objectContaining({ id: "remote-fresh", hostId: "host-3" }),
      ]);
    });

    it("reconcileTimersFromDocs removes deleted item-backed timers and keeps unrelated timers", () => {
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-doc-1",
              hostId: "host-1",
            }),
            createTimerInfo({
              id: "next-service",
              hostId: "host-1",
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromDocs({
          knownDocIds: ["timer-doc-1"],
          timers: [],
        }),
      );

      expect(store.getState().timers.timers).toEqual([
        expect.objectContaining({ id: "next-service" }),
      ]);
    });
  });
});
