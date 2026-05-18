import { renderHook, act } from "@testing-library/react";
import useDebouncedEffect from "./useDebouncedEffect";

describe("useDebouncedEffect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not call the effect immediately by default", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, [], 200));
    expect(effect).not.toHaveBeenCalled();
  });

  it("calls the effect after the delay elapses", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, [], 200));
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not call the effect before the delay elapses", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, [], 500));
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("re-debounces when deps change before the delay fires", () => {
    const effect = jest.fn();
    let dep = 0;
    const { rerender } = renderHook(() =>
      useDebouncedEffect(effect, [dep], 300),
    );

    act(() => {
      jest.advanceTimersByTime(200);
    });
    dep = 1;
    rerender();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    // Not enough time has passed on the second timer yet
    expect(effect).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("calls the effect immediately on first render when runImmediately is true", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, [], 300, true));
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire on the trailing edge when runImmediately caused the first call", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, [], 300, true));
    expect(effect).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(300);
    });
    // The trailing debounce should not fire again for the same dep cycle
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("clears the pending timeout on unmount", () => {
    const effect = jest.fn();
    const { unmount } = renderHook(() =>
      useDebouncedEffect(effect, [], 500),
    );
    unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("uses the default delay of 500ms when no delay is specified", () => {
    const effect = jest.fn();
    renderHook(() => useDebouncedEffect(effect, []));
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(effect).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
