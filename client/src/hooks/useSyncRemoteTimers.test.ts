import { renderHook } from "@testing-library/react";
import { type Database } from "firebase/database";
import { useSyncRemoteTimers } from "./useSyncRemoteTimers";
import { reconcileTimersFromRemote } from "../store/timersSlice";
import type { TimerInfo } from "../types";

const db = {} as Database;
const mockDispatch = jest.fn();
jest.mock("./reduxHooks", () => ({
  useDispatch: () => mockDispatch,
}));

const onValueCallbacks = new Map<string, (snapshot: { val: () => unknown }) => void>();
const refMock = jest.fn((_db: unknown, path: string) => ({ path }));
const onValueMock = jest.fn(
  (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
    _error?: (error: unknown) => void
  ) => {
    onValueCallbacks.set(target.path, success);
    return jest.fn();
  }
);

jest.mock("firebase/database", () => ({
  ref: (db: unknown, path: string) => refMock(db, path),
  onValue: (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
    error: (error: unknown) => void
  ) => onValueMock(target, success, error),
}));

const TIMERS_PATH = "churches/church-1/data/timers";

describe("useSyncRemoteTimers", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
  });

  it("does not subscribe until sharedDataReady is true", () => {
    renderHook(() =>
      useSyncRemoteTimers(db, "church-1", false, "host-A", false)
    );
    expect(onValueMock).not.toHaveBeenCalled();
  });

  it("does not subscribe in guest mode", () => {
    renderHook(() =>
      useSyncRemoteTimers(db, "church-1", true, "host-A", true)
    );
    expect(onValueMock).not.toHaveBeenCalled();
  });

  it("passes the FULL timers payload (including own-host) to the reducer", () => {
    renderHook(() =>
      useSyncRemoteTimers(db, "church-1", false, "host-A", true)
    );

    const success = onValueCallbacks.get(TIMERS_PATH);
    expect(success).toBeDefined();

    const timers = [
      { id: "t1", hostId: "host-A" }, // own host — must NOT be filtered out
      { id: "t2", hostId: "host-B" }, // another host
    ] as unknown as TimerInfo[];
    success?.({ val: () => timers });

    expect(mockDispatch).toHaveBeenCalledWith(
      reconcileTimersFromRemote({ timers, hostId: "host-A" })
    );
  });

  it("treats a null snapshot as an empty timers list", () => {
    renderHook(() =>
      useSyncRemoteTimers(db, "church-1", false, "host-A", true)
    );
    onValueCallbacks.get(TIMERS_PATH)?.({ val: () => null });

    expect(mockDispatch).toHaveBeenCalledWith(
      reconcileTimersFromRemote({ timers: [], hostId: "host-A" })
    );
  });
});
