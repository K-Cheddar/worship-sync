import { act, renderHook } from "@testing-library/react";
import {
  getNextCountdownDelayMs,
  getRemainingSecondsFromTarget,
  resetCountdownTickerForTests,
  subscribeCountdownTicker,
  useNextServiceCountdownText,
} from "./useNextServiceCountdownText";
import { setServerTimeOffset } from "../utils/serverTime";

describe("useNextServiceCountdownText scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    setServerTimeOffset(0);
    resetCountdownTickerForTests();
  });

  afterEach(() => {
    resetCountdownTickerForTests();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    setServerTimeOffset(0);
  });

  it("derives remaining seconds from targetIso and serverNow()", () => {
    setServerTimeOffset(2_500);
    const targetIso = new Date(Date.now() + 10_000).toISOString();
    // serverNow = Date.now()+2500 → remaining floor((10000-2500)/1000)=7
    expect(getRemainingSecondsFromTarget(targetIso, Date.now() + 2_500)).toBe(
      7,
    );

    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("7");
  });

  it("does not fire on the previous 100 ms cadence", () => {
    const ticks: number[] = [];
    const unsubscribe = subscribeCountdownTicker(() => {
      ticks.push(Date.now());
    });

    act(() => {
      jest.advanceTimersByTime(900);
    });
    expect(ticks).toHaveLength(0);

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(ticks).toHaveLength(1);

    unsubscribe();
  });

  it("aligns wakeups to whole-second boundaries", () => {
    jest.setSystemTime(new Date("2026-01-01T00:00:00.350Z"));
    expect(getNextCountdownDelayMs(Date.now())).toBe(650);

    const targetIso = new Date(Date.now() + 5_000).toISOString();
    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("5");

    act(() => {
      jest.advanceTimersByTime(649);
    });
    expect(result.current).toBe("5");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    // At 00:00:01.000: floor((05.350 − 01.000) / 1000) = 4
    expect(result.current).toBe("4");
  });

  it("self-corrects from serverNow when a callback fires late (no drift)", () => {
    const targetIso = new Date(
      Date.parse("2026-01-01T00:00:10.000Z"),
    ).toISOString();

    // Absolute derivation does not depend on how many ticks already ran.
    expect(
      getRemainingSecondsFromTarget(
        targetIso,
        Date.parse("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(10);
    expect(
      getRemainingSecondsFromTarget(
        targetIso,
        Date.parse("2026-01-01T00:00:02.400Z"),
      ),
    ).toBe(7);

    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("10");

    // Jump past the scheduled boundary, then let the delayed timeout run.
    // Fake timers also advance Date, so assert against absolute remaining —
    // never a naive local decrement from the previous display value.
    act(() => {
      jest.setSystemTime(new Date("2026-01-01T00:00:02.400Z"));
      jest.advanceTimersByTime(1_000);
    });

    const expected = String(
      getRemainingSecondsFromTarget(targetIso, Date.now()),
    );
    expect(result.current).toBe(expected);
    expect(result.current).not.toBe("9");
    expect(Number(result.current)).toBeLessThanOrEqual(7);
  });

  it("resolves the same whole-second value for clients with different callback timing", () => {
    const targetIso = new Date(
      Date.parse("2026-01-01T00:01:00.000Z"),
    ).toISOString();
    const nowA = Date.parse("2026-01-01T00:00:30.050Z");
    const nowB = Date.parse("2026-01-01T00:00:30.900Z");

    expect(getRemainingSecondsFromTarget(targetIso, nowA)).toBe(29);
    expect(getRemainingSecondsFromTarget(targetIso, nowB)).toBe(29);
  });

  it("stops the scheduler when no countdown subscribers remain", () => {
    const targetIso = new Date(Date.now() + 20_000).toISOString();
    expect(jest.getTimerCount()).toBe(0);

    const { unmount: unmountA } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    const { unmount: unmountB } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    expect(jest.getTimerCount()).toBe(1);

    unmountA();
    expect(jest.getTimerCount()).toBe(1);

    unmountB();
    expect(jest.getTimerCount()).toBe(0);
  });
});
