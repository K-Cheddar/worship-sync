import { configureStore } from "@reduxjs/toolkit";
import { timersSlice } from "./timersSlice";
import type { TimerInfo } from "../types";
import { createTimerInfo } from "../test/fixtures";
import { setServerTimeOffset } from "../utils/serverTime";

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
    setServerTimeOffset(0);
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

    it("captures the accurate remainingTime when pausing a running timer", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              timerType: "timer",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 300,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      // Start: endTime = 12:05:00, remainingTime 300 (no longer ticked in Redux).
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

      // 120s elapse, then pause — remainingTime must be 180, not the stale 300.
      jest.setSystemTime(new Date("2026-04-05T12:02:00.000Z"));
      store.dispatch(
        timersSlice.actions.updateTimer({
          id: "t1",
          timerInfo: {
            ...store.getState().timers.timers[0],
            status: "paused",
          },
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({ status: "paused", remainingTime: 180 }),
      );
    });

    it("resuming a paused timer does not subtract the paused duration", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              timerType: "timer",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 300,
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

      // Pause at 12:02 with 180s remaining.
      jest.setSystemTime(new Date("2026-04-05T12:02:00.000Z"));
      store.dispatch(
        timersSlice.actions.updateTimer({
          id: "t1",
          timerInfo: {
            ...store.getState().timers.timers[0],
            status: "paused",
          },
        }),
      );
      expect(store.getState().timers.timers[0].remainingTime).toBe(180);

      // Stay paused 60s, then resume at 12:03.
      jest.setSystemTime(new Date("2026-04-05T12:03:00.000Z"));
      store.dispatch(
        timersSlice.actions.updateTimer({
          id: "t1",
          timerInfo: {
            ...store.getState().timers.timers[0],
            status: "running",
            startedAt: new Date("2026-04-05T12:03:00.000Z").toISOString(),
          },
        }),
      );

      // endTime is rebuilt as now + 180s = 12:06:00 (the 60s pause is NOT
      // subtracted), and remainingTime stays 180.
      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          status: "running",
          isActive: true,
          remainingTime: 180,
          endTime: new Date("2026-04-05T12:06:00.000Z").toISOString(),
        }),
      );
    });

    it("tickTimers does NOT mark dirty on a non-expiry tick", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:01.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 300,
              endTime: new Date("2026-04-05T12:05:00.000Z").toISOString(),
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(timersSlice.actions.tickTimers());

      // No per-second Firebase write for an ordinary tick.
      expect(store.getState().timers.shouldUpdateTimers).toBe(false);
      expect(store.getState().timers.timers[0].status).toBe("running");
    });

    it("tickTimers marks dirty and stops the timer on expiry", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:05:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 5,
              endTime: new Date("2026-04-05T12:05:00.000Z").toISOString(),
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(timersSlice.actions.tickTimers());

      // Expiry is a real state change that must propagate.
      expect(store.getState().timers.shouldUpdateTimers).toBe(true);
      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          status: "stopped",
          isActive: false,
          remainingTime: 0,
        }),
      );
    });

    it("stamps timer updates with the shared server-aligned clock", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));
      setServerTimeOffset(8_000);

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "t1",
              hostId: "h1",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 300,
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
          time: new Date("2026-04-05T12:00:08.000Z").getTime(),
          endTime: new Date("2026-04-05T12:05:08.000Z").toISOString(),
          status: "running",
          isActive: true,
          remainingTime: 300,
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

    it("reconcileTimersFromRemote replaces a stale local copy with fresher remote timer data for the same id", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "monitor-host",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 0,
              countdownTime: "10:50",
              time: 100,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "monitor-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 300,
              countdownTime: "10:50",
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers).toHaveLength(1);
      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          hostId: "controller-host",
          status: "running",
          isActive: true,
          remainingTime: 300,
          endTime: "2026-04-05T12:05:00.000Z",
        }),
      );
    });

    it("reconcileTimersFromRemote preserves newer local timer host and timestamp over an older remote copy", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:01:00.000Z"));

      const runningEndTime = new Date("2026-04-05T12:05:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 240,
              endTime: runningEndTime,
              time: 500,
            }),
          ],
          shouldUpdateTimers: true,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "remote-host",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 300,
              time: 100,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers).toHaveLength(1);
      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          hostId: "controller-host",
          status: "running",
          isActive: true,
          remainingTime: 240,
          endTime: runningEndTime,
          time: 500,
        }),
      );
    });

    it("reconcileTimersFromRemote adopts a fresher running copy of an OWN timer (post-refresh recovery)", () => {
      // After a controller refresh, the controller's own timer is rebuilt from
      // the stale PouchDB doc (stopped). The live running state only exists in
      // Firebase under the SAME hostId, so it must not be filtered out.
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 0,
              time: 100,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 300,
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers).toHaveLength(1);
      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          hostId: "controller-host",
          status: "running",
          isActive: true,
          endTime: "2026-04-05T12:05:00.000Z",
        }),
      );
    });

    it("reconcileTimersFromRemote keeps a fresher local OWN timer over a stale own echo", () => {
      // A stale echo of our own earlier write must not revert a newer local edit.
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:01:00.000Z"));

      const runningEndTime = new Date("2026-04-05T12:05:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 240,
              endTime: runningEndTime,
              time: 500,
            }),
          ],
          shouldUpdateTimers: true,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 300,
              time: 100,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          hostId: "controller-host",
          status: "running",
          isActive: true,
          remainingTime: 240,
          endTime: runningEndTime,
          time: 500,
        }),
      );
    });

    it("reconcileTimersFromRemote does not let a stale own echo revert edited metadata", () => {
      // Local edit bumped name/color/duration and the `time` stamp. A late echo
      // of the pre-edit timer (older `time`) must not revert the metadata.
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Closing",
              color: "#00ff00",
              duration: 600,
              showMinutesOnly: true,
              status: "stopped",
              isActive: false,
              time: 500,
            }),
          ],
          shouldUpdateTimers: true,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Offering",
              color: "#ff0000",
              duration: 300,
              showMinutesOnly: false,
              status: "stopped",
              isActive: false,
              time: 100,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          name: "Closing",
          color: "#00ff00",
          duration: 600,
          showMinutesOnly: true,
          time: 500,
        }),
      );
    });

    it("reconcileTimersFromRemote adopts metadata from a fresher remote copy", () => {
      // A genuinely newer remote copy (higher `time`) should still win, so edits
      // made on another window/device propagate.
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Closing",
              duration: 600,
              status: "stopped",
              isActive: false,
              time: 100,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Renamed",
              duration: 900,
              status: "stopped",
              isActive: false,
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({ name: "Renamed", duration: 900, time: 200 }),
      );
    });

    it("reconcileTimersFromRemote: a time-less echo cannot revert a stamped local copy", () => {
      // An echo without a `time` can't be proven fresher than a stamped local
      // edit, so it must NOT overwrite local metadata.
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Local",
              status: "stopped",
              isActive: false,
              time: 500,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      const remote = createTimerInfo({
        id: "timer-1",
        hostId: "controller-host",
        name: "Remote",
        status: "stopped",
        isActive: false,
      });
      delete (remote as { time?: number }).time;

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [remote],
        }),
      );

      expect(store.getState().timers.timers[0].name).toBe("Local");
    });

    it("reconcileTimersFromRemote keeps local metadata when the echo has an equal timestamp", () => {
      // A tie is our own echo or a same-millisecond/reordered write — it must
      // not revert a local edit's metadata.
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Local",
              color: "#00ff00",
              status: "stopped",
              isActive: false,
              time: 200,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              name: "Echo",
              color: "#ff0000",
              status: "stopped",
              isActive: false,
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({ name: "Local", color: "#00ff00", time: 200 }),
      );
    });

    it("reconcileTimersFromRemote recovers live runtime on a tie when local is stopped but remote is running", () => {
      // Edge: a refreshed controller's doc copy can share the timestamp with the
      // live Firebase state. On that tie we must still adopt the remote's running
      // runtime (it has an endTime, local is stopped) so the countdown resumes —
      // otherwise the controller is stuck stopped during a live timer.
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

      const runningEndTime = new Date("2026-04-05T12:05:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "stopped",
              isActive: false,
              duration: 300,
              remainingTime: 0,
              time: 200,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              duration: 300,
              remainingTime: 300,
              endTime: runningEndTime,
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({
          id: "timer-1",
          status: "running",
          isActive: true,
          endTime: runningEndTime,
        }),
      );
    });

    it("reconcileTimersFromRemote does NOT let a stopped echo stop a running local timer on a tie", () => {
      // The inverse guard: a same-timestamp echo that is stopped must not stop a
      // locally running timer.
      const runningEndTime = new Date("2026-04-05T12:05:00.000Z").toISOString();
      const store = createStore({
        timers: {
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "running",
              isActive: true,
              endTime: runningEndTime,
              time: 200,
            }),
          ],
          shouldUpdateTimers: false,
        },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [
            createTimerInfo({
              id: "timer-1",
              hostId: "controller-host",
              status: "stopped",
              isActive: false,
              time: 200,
            }),
          ],
        }),
      );

      expect(store.getState().timers.timers[0]).toEqual(
        expect.objectContaining({ status: "running", isActive: true }),
      );
    });

    it("reconcileTimersFromRemote applies a time-less echo when the local copy is also unstamped", () => {
      // Neither copy has a timestamp (e.g. legacy data) — fall through and take
      // the incoming copy rather than blocking it.
      const local = createTimerInfo({
        id: "timer-1",
        hostId: "controller-host",
        name: "Local",
        status: "stopped",
        isActive: false,
      });
      const remote = createTimerInfo({
        id: "timer-1",
        hostId: "controller-host",
        name: "Remote",
        status: "stopped",
        isActive: false,
      });

      const store = createStore({
        timers: { timers: [local], shouldUpdateTimers: false },
      });

      store.dispatch(
        timersSlice.actions.reconcileTimersFromRemote({
          hostId: "controller-host",
          timers: [remote],
        }),
      );

      expect(store.getState().timers.timers[0].name).toBe("Remote");
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
