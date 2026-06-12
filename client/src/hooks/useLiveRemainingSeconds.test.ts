import { renderHook, act } from "@testing-library/react";
import { useLiveRemainingSeconds } from "./useLiveRemainingSeconds";
import { setServerTimeOffset } from "../utils/serverTime";
import { createTimerInfo } from "../test/fixtures";
import type { TimerInfo } from "../types";

const runningTimer = (msUntilEnd: number): TimerInfo =>
  createTimerInfo({
    id: "t1",
    hostId: "h1",
    status: "running",
    isActive: true,
    endTime: new Date(Date.now() + msUntilEnd).toISOString(),
    remainingTime: Math.floor(msUntilEnd / 1000),
  });

describe("useLiveRemainingSeconds", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    setServerTimeOffset(0);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    setServerTimeOffset(0);
  });

  it("returns the live remaining seconds for a running timer", () => {
    const timer = runningTimer(10_000);
    const { result } = renderHook(() => useLiveRemainingSeconds(timer));
    expect(result.current).toBe(10);
  });

  it("decrements as the clock advances via the shared ticker", () => {
    const timer = runningTimer(10_000);
    const { result } = renderHook(() => useLiveRemainingSeconds(timer));
    expect(result.current).toBe(10);
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    expect(result.current).toBe(7);
  });

  it("uses the server-aligned clock (offset)", () => {
    setServerTimeOffset(5_000);
    const timer = runningTimer(10_000);
    const { result } = renderHook(() => useLiveRemainingSeconds(timer));
    // endTime is now+10s, but serverNow is now+5s, so remaining = 5.
    expect(result.current).toBe(5);
  });

  it("clamps at 0 and never goes negative", () => {
    const timer = runningTimer(1_000);
    const { result } = renderHook(() => useLiveRemainingSeconds(timer));
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(0);
  });

  it("returns the stored remainingTime for a paused timer and does not tick", () => {
    const paused = createTimerInfo({
      id: "t1",
      hostId: "h1",
      status: "paused",
      isActive: false,
      remainingTime: 42,
    });
    const { result } = renderHook(() => useLiveRemainingSeconds(paused));
    expect(result.current).toBe(42);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(42);
  });

  it("falls back to remainingTime when running without an endTime", () => {
    const noEnd = createTimerInfo({
      id: "t1",
      hostId: "h1",
      status: "running",
      isActive: true,
      remainingTime: 33,
    });
    delete (noEnd as { endTime?: string }).endTime;
    const { result } = renderHook(() => useLiveRemainingSeconds(noEnd));
    expect(result.current).toBe(33);
  });

  it("returns 0 for an undefined timer", () => {
    const { result } = renderHook(() => useLiveRemainingSeconds(undefined));
    expect(result.current).toBe(0);
  });

  it("shares a single interval across timers and clears it when all unmount", () => {
    const timerA = runningTimer(10_000);
    const timerB = runningTimer(20_000);
    expect(jest.getTimerCount()).toBe(0);

    const { unmount: unmountA } = renderHook(() =>
      useLiveRemainingSeconds(timerA)
    );
    const { unmount: unmountB } = renderHook(() =>
      useLiveRemainingSeconds(timerB)
    );
    expect(jest.getTimerCount()).toBe(1); // one shared ticker

    unmountA();
    expect(jest.getTimerCount()).toBe(1);
    unmountB();
    expect(jest.getTimerCount()).toBe(0);
  });
});
