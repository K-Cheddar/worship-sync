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
