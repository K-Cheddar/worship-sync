import { renderHook, act, waitFor } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";

type FakeSentinel = WakeLockSentinel & { released: boolean };

const createSentinel = (): FakeSentinel => {
  const sentinel = {
    released: false,
    release: jest.fn(async () => {
      sentinel.released = true;
    }),
  } as unknown as FakeSentinel;
  return sentinel;
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
};

const fireVisibilityChange = () => {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

describe("useWakeLock", () => {
  let request: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    setVisibility("visible");
    request = jest.fn(async () => createSentinel());
    Object.defineProperty(window.navigator, "wakeLock", {
      value: { request },
      configurable: true,
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("acquires a screen wake lock on mount", async () => {
    renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
  });

  it("re-acquires after the document is hidden and shown again", async () => {
    const first = createSentinel();
    request.mockResolvedValueOnce(first);

    renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // The platform releases the sentinel when the document hides.
    first.released = true;
    setVisibility("hidden");
    fireVisibilityChange();

    setVisibility("visible");
    fireVisibilityChange();

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("does not request a second lock while one is still held", async () => {
    renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // Sentinel is still held, so a visibility bounce must not stack locks.
    fireVisibilityChange();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it("does not request while the document is hidden", async () => {
    setVisibility("hidden");
    renderHook(() => useWakeLock());

    await waitFor(() => expect(request).not.toHaveBeenCalled());
  });

  it("releases the lock on unmount", async () => {
    const sentinel = createSentinel();
    request.mockResolvedValueOnce(sentinel);

    const { unmount } = renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    unmount();
    await waitFor(() => expect(sentinel.release).toHaveBeenCalled());
  });

  it("stops listening after unmount", async () => {
    const { unmount } = renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    unmount();
    fireVisibilityChange();

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it("survives a rejected request and retries on the next visibility change", async () => {
    request.mockRejectedValueOnce(new Error("denied"));

    renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    fireVisibilityChange();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("re-acquires when a visibility change lands while a request is in flight", async () => {
    let rejectFirst: (reason: Error) => void = () => {};
    const inFlight = new Promise<WakeLockSentinel>((_, reject) => {
      rejectFirst = reject;
    });
    request.mockReturnValueOnce(inFlight);

    renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // Quick app switch while the first request is still pending.
    setVisibility("hidden");
    fireVisibilityChange();
    setVisibility("visible");
    fireVisibilityChange();

    // The in-flight request now rejects, as it does when the document was
    // hidden mid-request. Nothing must be left holding no lock.
    await act(async () => {
      rejectFirst(new Error("NotAllowedError"));
      await Promise.resolve();
    });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("does nothing when disabled", async () => {
    renderHook(() => useWakeLock(false));
    await waitFor(() => expect(request).not.toHaveBeenCalled());
  });

  it("no-ops when the browser has no Wake Lock API", async () => {
    Object.defineProperty(window.navigator, "wakeLock", {
      value: undefined,
      configurable: true,
    });

    expect(() => renderHook(() => useWakeLock())).not.toThrow();
  });
});
