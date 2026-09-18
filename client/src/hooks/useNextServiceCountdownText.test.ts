import { act, renderHook } from "@testing-library/react";
import {
  COUNTDOWN_TICK_MS,
  getRemainingSecondsFromTarget,
  resetCountdownTickerForTests,
  subscribeCountdownTicker,
  useNextServiceCountdownText,
} from "./useNextServiceCountdownText";
import { setServerTimeOffset } from "../utils/serverTime";

describe("useNextServiceCountdownText ticker", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    setServerTimeOffset(0);
    resetCountdownTickerForTests();
  });

  afterEach(() => {
    resetCountdownTickerForTests();
    jest.useRealTimers();
    setServerTimeOffset(0);
  });

  it("uses one shared timer and refreshes on a 250 ms cadence", () => {
    const ticks: number[] = [];
    const unsubscribeA = subscribeCountdownTicker(() => ticks.push(Date.now()));
    const unsubscribeB = subscribeCountdownTicker(() => ticks.push(Date.now()));

    expect(COUNTDOWN_TICK_MS).toBe(250);
    expect(jest.getTimerCount()).toBe(1);
    act(() => jest.advanceTimersByTime(249));
    expect(ticks).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(ticks).toHaveLength(2);
    act(() => jest.advanceTimersByTime(500));
    expect(ticks).toHaveLength(6);

    unsubscribeA();
    unsubscribeB();
  });

  it("derives every displayed value from targetIso and serverNow", () => {
    const targetIso = "2026-01-01T00:00:10.000Z";
    setServerTimeOffset(2_500);
    expect(
      getRemainingSecondsFromTarget(targetIso, Date.parse("2026-01-01T00:00:02.500Z")),
    ).toBe(7);

    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("7");
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe("6");
  });

  it("exposes consecutive whole-second values during normal operation", () => {
    const targetIso = "2026-01-01T00:00:03.900Z";
    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("3");

    act(() => jest.advanceTimersByTime(750));
    expect(result.current).toBe("3");

    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe("2");
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe("1");
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe("0");
  });

  it("gives multiple subscribers the same absolute-time value", () => {
    const targetIso = "2026-01-01T00:00:03.200Z";
    const { result: firstResult } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    const { result: secondResult } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    expect(firstResult.current).toBe(secondResult.current);
    act(() => jest.advanceTimersByTime(1_250));
    expect(firstResult.current).toBe("1");
    expect(secondResult.current).toBe("1");
  });

  it("clears the shared ticker when the final consumer unsubscribes", () => {
    const targetIso = "2026-01-01T00:00:20.000Z";
    const { unmount: unmountFirst } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    const { unmount: unmountSecond } = renderHook(() =>
      useNextServiceCountdownText(targetIso),
    );
    expect(jest.getTimerCount()).toBe(1);
    unmountFirst();
    expect(jest.getTimerCount()).toBe(1);
    unmountSecond();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("respects server-time offset changes", () => {
    const targetIso = "2026-01-01T00:00:10.000Z";
    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("10");
    setServerTimeOffset(2_500);
    act(() => jest.advanceTimersByTime(COUNTDOWN_TICK_MS));
    expect(result.current).toBe("7");
  });

  it("self-corrects after a delayed callback without cumulative drift", () => {
    const targetIso = "2026-01-01T00:00:10.000Z";
    const { result } = renderHook(() => useNextServiceCountdownText(targetIso));
    expect(result.current).toBe("10");

    // Simulate a delayed foreground callback: the value catches up to the
    // absolute clock, then subsequent cadence ticks continue from that time.
    jest.setSystemTime(new Date("2026-01-01T00:00:02.400Z"));
    act(() => jest.advanceTimersByTime(COUNTDOWN_TICK_MS));
    expect(result.current).toBe("7");
    jest.setSystemTime(new Date("2026-01-01T00:00:03.400Z"));
    act(() => jest.advanceTimersByTime(COUNTDOWN_TICK_MS));
    expect(result.current).toBe("6");
  });
});
