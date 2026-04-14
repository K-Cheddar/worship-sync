import { renderHook, act } from "@testing-library/react";
import { useStuckDbProgress } from "./useStuckDbProgress";
import { STUCK_DB_PROGRESS_MS } from "../constants";

describe("useStuckDbProgress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns false when connection is failed regardless of idle time", () => {
    const { result, rerender } = renderHook(
      ({ progress, failed }: { progress: number; failed: boolean }) =>
        useStuckDbProgress(progress, failed),
      { initialProps: { progress: 0, failed: true } },
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS + 5_000);
    });
    expect(result.current).toBe(false);

    rerender({ progress: 5, failed: true });
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(result.current).toBe(false);
  });

  it("returns false at 100% progress", () => {
    const { result } = renderHook(
      ({ progress, failed }: { progress: number; failed: boolean }) =>
        useStuckDbProgress(progress, failed),
      { initialProps: { progress: 100, failed: false } },
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(result.current).toBe(false);
  });

  it("becomes true after idle threshold then false after progress changes", () => {
    const { result, rerender } = renderHook(
      ({ progress, failed }: { progress: number; failed: boolean }) =>
        useStuckDbProgress(progress, failed),
      { initialProps: { progress: 3, failed: false } },
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(result.current).toBe(true);

    rerender({ progress: 4, failed: false });
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(result.current).toBe(true);
  });

  it("resets idle timer when connection temporarily fails", () => {
    const { result, rerender } = renderHook(
      ({ progress, failed }: { progress: number; failed: boolean }) =>
        useStuckDbProgress(progress, failed),
      { initialProps: { progress: 8, failed: false } },
    );

    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS - 1_000);
    });
    rerender({ progress: 8, failed: true });
    expect(result.current).toBe(false);

    rerender({ progress: 8, failed: false });
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS - 2_000);
    });
    expect(result.current).toBe(true);
  });
});
