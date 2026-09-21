import { renderHook, act } from "@testing-library/react";
import { useSyncOnReconnect } from "./useSyncOnReconnect";

describe("useSyncOnReconnect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not pull when pullFromRemote is undefined", () => {
    renderHook(() => useSyncOnReconnect(undefined));
    act(() => {
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(15_000);
      window.dispatchEvent(new Event("online"));
    });
  });

  it("pulls after returning online when away for at least 10 seconds", () => {
    const pullFromRemote = jest.fn();
    renderHook(() => useSyncOnReconnect(pullFromRemote));

    act(() => {
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(9_999);
      window.dispatchEvent(new Event("online"));
    });
    expect(pullFromRemote).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(10_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(pullFromRemote).toHaveBeenCalledTimes(1);
  });

  it("pulls after the tab becomes visible again after 10 seconds hidden", () => {
    const pullFromRemote = jest.fn();
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    renderHook(() => useSyncOnReconnect(pullFromRemote));

    act(() => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      jest.advanceTimersByTime(10_000);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(pullFromRemote).toHaveBeenCalledTimes(1);
  });

  it("reconciles bfcache/page resume signals once while a pull is in flight", async () => {
    let resolvePull!: () => void;
    const pullFromRemote = jest.fn(
      () => new Promise<void>((resolve) => {
        resolvePull = resolve;
      }),
    );
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    renderHook(() => useSyncOnReconnect(pullFromRemote));

    act(() => {
      visibility = "hidden";
      window.dispatchEvent(new Event("pagehide"));
      jest.advanceTimersByTime(10_000);
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(pullFromRemote).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePull();
    });
  });

  it("coalesces online with visibility, page, and focus resume signals", async () => {
    let resolvePull!: () => void;
    const pullFromRemote = jest.fn(
      () => new Promise<void>((resolve) => {
        resolvePull = resolve;
      }),
    );
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    renderHook(() => useSyncOnReconnect(pullFromRemote));

    act(() => {
      window.dispatchEvent(new Event("offline"));
      visibility = "hidden";
      window.dispatchEvent(new Event("pagehide"));
      jest.advanceTimersByTime(10_000);
      visibility = "visible";
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });

    expect(pullFromRemote).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePull();
    });
  });
});
