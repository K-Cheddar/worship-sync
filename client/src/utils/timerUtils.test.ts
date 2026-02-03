import {
  mergeTimers,
  getTimeDifference,
  calculateEndTime,
  calculateRemainingTime,
} from "./timerUtils";
import { TimerInfo } from "../types";

describe("timerUtils", () => {
  describe("mergeTimers", () => {
    const hostA = "host-a";
    const hostB = "host-b";

    it("returns empty array when both inputs are empty", () => {
      expect(mergeTimers([], [], hostA)).toEqual([]);
    });

    it("returns own timers when currentTimers is empty", () => {
      const own: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostA,
          name: "Timer 1",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 60,
        },
      ];
      expect(mergeTimers([], own, hostA)).toEqual(own);
    });

    it("keeps other hosts' timers and overrides with own for same id", () => {
      const current: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostB,
          name: "Old",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 30,
        },
      ];
      const own: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostA,
          name: "New",
          timerType: "timer",
          status: "running",
          isActive: true,
          remainingTime: 45,
        },
      ];
      const result = mergeTimers(current, own, hostA);
      expect(result).toHaveLength(1);
      expect(result[0].hostId).toBe(hostA);
      expect(result[0].name).toBe("New");
    });

    it("merges multiple timers from both sources", () => {
      const current: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostB,
          name: "B1",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 10,
        },
        {
          id: "t2",
          hostId: hostB,
          name: "B2",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 20,
        },
      ];
      const own: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostA,
          name: "A1",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 15,
        },
      ];
      const result = mergeTimers(current, own, hostA);
      expect(result).toHaveLength(2);
      const byId = Object.fromEntries(result.map((t) => [t.id, t]));
      expect(byId.t1.hostId).toBe(hostA);
      expect(byId.t2.hostId).toBe(hostB);
    });

    it("excludes current host's timers from currentTimers", () => {
      const current: TimerInfo[] = [
        {
          id: "t1",
          hostId: hostA,
          name: "Mine",
          timerType: "timer",
          status: "stopped",
          isActive: false,
          remainingTime: 10,
        },
      ];
      const own: TimerInfo[] = [];
      const result = mergeTimers(current, own, hostA);
      expect(result).toHaveLength(0);
    });
  });

  describe("getTimeDifference", () => {
    it("returns positive seconds when target time is in the future today", () => {
      const now = new Date();
      // Target 30 minutes from now so diff is ~1800s and always <= 3660s
      const future = new Date(now.getTime() + 30 * 60 * 1000);
      const timeString = `${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}`;
      const diff = getTimeDifference(timeString);
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(3600 + 60);
    });

    it("returns a number for valid time string", () => {
      const diff = getTimeDifference("12:00");
      expect(typeof diff).toBe("number");
    });
  });

  describe("calculateEndTime", () => {
    it("preserves endTime when existing timer is running", () => {
      const existing: TimerInfo = {
        id: "t1",
        hostId: "h",
        name: "T",
        timerType: "timer",
        status: "running",
        isActive: true,
        remainingTime: 30,
        endTime: "2025-01-01T12:00:00.000Z",
      };
      const result = calculateEndTime(existing, false, false, existing);
      expect(result).toBe("2025-01-01T12:00:00.000Z");
    });

    it("returns ISO string when resuming with remainingTime", () => {
      const existing: TimerInfo = {
        id: "t1",
        hostId: "h",
        name: "T",
        timerType: "timer",
        status: "paused",
        isActive: false,
        remainingTime: 90,
        endTime: undefined,
      };
      const result = calculateEndTime(existing, false, true, existing);
      expect(result).toBeDefined();
      expect(new Date(result!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("calculateRemainingTime", () => {
    it("returns full duration when stopping timer", () => {
      const result = calculateRemainingTime({
        timerInfo: {
          timerType: "timer",
          status: "stopped",
          duration: 120,
          remainingTime: 60,
        },
        previousStatus: "running",
      });
      expect(result).toBe(120);
    });

    it("returns full duration when starting from stopped", () => {
      const result = calculateRemainingTime({
        timerInfo: {
          timerType: "timer",
          status: "running",
          duration: 60,
          remainingTime: 0,
        },
        previousStatus: "stopped",
      });
      expect(result).toBe(60);
    });

    it("returns stored remainingTime when pausing", () => {
      const result = calculateRemainingTime({
        timerInfo: {
          timerType: "timer",
          status: "paused",
          remainingTime: 45,
        },
        previousStatus: "running",
      });
      expect(result).toBe(45);
    });

    it("returns stored remainingTime when resuming from paused (timer)", () => {
      const result = calculateRemainingTime({
        timerInfo: {
          timerType: "timer",
          status: "running",
          remainingTime: 30,
        },
        previousStatus: "paused",
      });
      expect(result).toBe(30);
    });
  });
});
