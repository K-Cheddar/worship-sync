import {
  isFirebasePermissionDenied,
  setFirebaseDiagnosticContext,
  subscribeWithPermissionRetry,
} from "./firebaseListeners";

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

const latest = () => listeners[listeners.length - 1];

describe("isFirebasePermissionDenied", () => {
  it("detects code and message forms", () => {
    expect(isFirebasePermissionDenied({ code: "PERMISSION_DENIED" })).toBe(true);
    expect(
      isFirebasePermissionDenied(new Error("permission_denied at /x"))
    ).toBe(true);
    expect(
      isFirebasePermissionDenied(new Error("Client doesn't have permission to access"))
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isFirebasePermissionDenied(new Error("network error"))).toBe(false);
    expect(isFirebasePermissionDenied(null)).toBe(false);
  });
});

describe("subscribeWithPermissionRetry", () => {
  beforeEach(() => {
    listeners.length = 0;
    unsubscribe.mockClear();
    setFirebaseDiagnosticContext({});
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("delivers snapshots to onData", () => {
    const onData = jest.fn();
    subscribeWithPermissionRetry("db" as never, "path/a", onData);
    latest().success({ val: () => 42 });
    expect(onData).toHaveBeenCalledWith(expect.objectContaining({ val: expect.any(Function) }));
  });

  it("keeps re-attaching after repeated permission_denied (does not give up)", () => {
    subscribeWithPermissionRetry("db" as never, "path/a", jest.fn());
    expect(listeners).toHaveLength(1);

    // Fire many denials; each should schedule another attach. Advance past the
    // slow-poll interval so re-attaches keep happening beyond the warn threshold.
    for (let i = 0; i < 20; i += 1) {
      latest().error({ code: "PERMISSION_DENIED" });
      jest.advanceTimersByTime(60_000);
    }

    // Far more than the old 12-attempt cap — proves it never stops retrying.
    expect(listeners.length).toBeGreaterThan(15);
    // Each re-attach defensively tears down the previous listener.
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("logs when a permission-denied listener recovers", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const onData = jest.fn();
    subscribeWithPermissionRetry("db" as never, "path/a", onData, {
      label: "test listener",
    });

    latest().error({ code: "PERMISSION_DENIED" });
    jest.advanceTimersByTime(100);
    latest().success({ val: () => 42 });

    expect(warnSpy).toHaveBeenCalledWith(
      "[firebase diagnostic]",
      expect.stringContaining('"event":"firebase_listener_permission_recovered"'),
    );
    expect(onData).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("correlates a stale listener with the current renderer auth generation", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    setFirebaseDiagnosticContext({
      rendererId: "renderer-a",
      sessionKind: "workstation",
      access: "full",
      surface: "controller",
      authGeneration: 7,
      firebaseUserCorrelationId: "firebase-user-a",
      scopeReady: true,
    });
    subscribeWithPermissionRetry("db" as never, "path/a", jest.fn(), {
      label: "test listener",
    });

    setFirebaseDiagnosticContext({
      rendererId: "renderer-a",
      sessionKind: "human",
      access: "full",
      surface: "controller",
      authGeneration: 8,
      firebaseUserCorrelationId: "firebase-user-b",
      scopeReady: true,
    });
    latest().error({ code: "PERMISSION_DENIED" });

    const diagnosticCall = warnSpy.mock.calls.find(
      ([prefix, message]) =>
        prefix === "[firebase diagnostic]" &&
        String(message).includes("firebase_listener_permission_denied"),
    );
    expect(diagnosticCall).toBeDefined();
    const diagnostic = JSON.parse(String(diagnosticCall?.[1]));
    expect(diagnostic).toEqual(
      expect.objectContaining({
        rendererId: "renderer-a",
        sessionKind: "human",
        authGeneration: 8,
        firebaseUserCorrelationId: "firebase-user-b",
        listenerAuthGeneration: 7,
        listenerSessionKind: "workstation",
        listenerScopeMatchesCurrent: false,
      }),
    );
    expect(diagnostic).not.toHaveProperty("uid");
    warnSpy.mockRestore();
  });

  it("does not retry on non-permission errors", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const onError = jest.fn();
    subscribeWithPermissionRetry("db" as never, "path/a", jest.fn(), {
      onError,
    });

    latest().error(new Error("network blip"));
    jest.advanceTimersByTime(5000);

    expect(listeners).toHaveLength(1);
    expect(onError).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("stops retrying once unsubscribed", () => {
    const stop = subscribeWithPermissionRetry("db" as never, "path/a", jest.fn());
    latest().error({ code: "PERMISSION_DENIED" });
    stop();
    jest.advanceTimersByTime(5000);
    expect(listeners).toHaveLength(1);
  });
});
