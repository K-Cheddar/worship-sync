import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { useSlowStartupMessage } from "./useSlowStartupMessage";
import { SLOW_STARTUP_MESSAGE_DELAY_MS } from "../constants";

describe("useSlowStartupMessage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a secondary message after 15 seconds without meaningful activity", () => {
    const startedAt = Date.now();
    const { result } = renderHook(() => useSlowStartupMessage(startedAt, false));

    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS - 1));
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("resets the timer on real activity even when progress does not change", () => {
    let publishActivity: ((activityAt: number) => void) | undefined;
    const subscribe = (listener: (activityAt: number) => void) => {
      publishActivity = listener;
      return () => {
        publishActivity = undefined;
      };
    };
    const startedAt = Date.now();
    const { result } = renderHook(() =>
      useSlowStartupMessage(startedAt, false, subscribe),
    );

    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS - 1));
    act(() => publishActivity?.(Date.now()));
    expect(result.current).toBe(false);

    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS - 1));
    expect(result.current).toBe(false);
    act(() => jest.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("cleans up subscriptions and timers under Strict Mode and completion", () => {
    const unsubscribe = jest.fn();
    const subscribe = jest.fn(() => unsubscribe);
    const { rerender, unmount } = renderHook(
      ({ isComplete }: { isComplete: boolean }) =>
        useSlowStartupMessage(Date.now(), isComplete, subscribe),
      {
        initialProps: { isComplete: false },
        wrapper: StrictMode,
      },
    );

    expect(subscribe).toHaveBeenCalled();
    rerender({ isComplete: true });
    expect(unsubscribe).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
