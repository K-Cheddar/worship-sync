import { renderHook, act } from "@testing-library/react";
import { type Database } from "firebase/database";
import { useFirebaseValueWithRetry } from "./useFirebaseValueWithRetry";

type Listener = {
  success: (snapshot: { val: () => unknown }) => void;
  error: (error: unknown) => void;
};

const listeners: Listener[] = [];
const unsubscribe = jest.fn();

jest.mock("firebase/database", () => ({
  ref: (_db: unknown, path: string) => ({ path }),
  onValue: (
    _ref: { path: string },
    success: Listener["success"],
    error: Listener["error"]
  ) => {
    listeners.push({ success, error });
    return unsubscribe;
  },
}));

const flushSnapshot = (value: unknown) =>
  listeners[listeners.length - 1].success({ val: () => value });
const flushError = (error: unknown) =>
  listeners[listeners.length - 1].error(error);

describe("useFirebaseValueWithRetry", () => {
  beforeEach(() => {
    listeners.length = 0;
    unsubscribe.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const baseArgs = {
    db: {} as Database,
    path: "churches/c1/data/timers",
    enabled: true,
  };

  it("does not subscribe while disabled (auth not ready)", () => {
    const onData = jest.fn();
    renderHook(() =>
      useFirebaseValueWithRetry({ ...baseArgs, enabled: false, onData })
    );
    expect(listeners).toHaveLength(0);
    expect(onData).not.toHaveBeenCalled();
  });

  it("delivers values once enabled", () => {
    const onData = jest.fn();
    renderHook(() => useFirebaseValueWithRetry({ ...baseArgs, onData }));

    expect(listeners).toHaveLength(1);
    act(() => flushSnapshot([{ id: "t1" }]));
    expect(onData).toHaveBeenCalledWith([{ id: "t1" }], expect.anything());
  });

  it("ignores a late snapshot from a previous path after the scope changes", () => {
    const previousPathData = jest.fn();
    const currentPathData = jest.fn();
    const { rerender } = renderHook(
      ({ path, onData }: { path: string; onData: typeof previousPathData }) =>
        useFirebaseValueWithRetry({ ...baseArgs, path, onData }),
      { initialProps: { path: "churches/c1/data/timers", onData: previousPathData } },
    );
    const previousListener = listeners[0];

    rerender({ path: "churches/c2/data/timers", onData: currentPathData });
    act(() => previousListener.success({ val: () => [{ id: "church-1-timer" }] }));
    act(() => flushSnapshot([{ id: "church-2-timer" }]));

    expect(previousPathData).not.toHaveBeenCalled();
    expect(currentPathData).toHaveBeenCalledWith(
      [{ id: "church-2-timer" }],
      expect.anything(),
    );
  });

  it("re-attaches after a permission_denied cancellation", () => {
    const onData = jest.fn();
    renderHook(() => useFirebaseValueWithRetry({ ...baseArgs, onData }));

    expect(listeners).toHaveLength(1);
    // First listen is rejected by the rules (the startup race).
    act(() => flushError({ code: "PERMISSION_DENIED" }));
    // Backoff elapses -> a fresh listener attaches.
    act(() => {
      jest.advanceTimersByTime(2500);
    });
    expect(listeners.length).toBeGreaterThanOrEqual(2);

    // The retried listener now succeeds and data flows.
    act(() => flushSnapshot([{ id: "t1" }]));
    expect(onData).toHaveBeenCalledWith([{ id: "t1" }], expect.anything());
  });

  it("does not retry on non-permission errors", () => {
    const onData = jest.fn();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    renderHook(() => useFirebaseValueWithRetry({ ...baseArgs, onData }));

    act(() => flushError(new Error("network blip")));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(listeners).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
