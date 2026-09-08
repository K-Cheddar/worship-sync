import { renderHook } from "@testing-library/react";
import { type Database } from "firebase/database";
import { useSyncMonitorSettings } from "./useSyncMonitorSettings";
import {
  setMonitorClockFontSize,
  setMonitorShowClock,
  setMonitorShowNextSlide,
  setMonitorShowTimer,
  setMonitorTimerFontSize,
  setMonitorTimerId,
} from "../store/preferencesSlice";

const db = {} as Database;
const mockDispatch = jest.fn();
jest.mock("./reduxHooks", () => ({
  useDispatch: () => mockDispatch,
  // The hook reads the display registry to decide whether to seed settings onto
  // the monitor display.
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ displayOutputs: { list: [] } }),
}));

jest.mock("../utils/displayOutputsWriter", () => ({
  writeDisplayOutputs: jest.fn().mockResolvedValue(true),
}));

const onValueCallbacks = new Map<
  string,
  (snapshot: { val: () => unknown }) => void
>();
const refMock = jest.fn((_db: unknown, path: string) => ({ path }));
const onValueMock = jest.fn(
  (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
    _error?: (error: unknown) => void,
  ) => {
    onValueCallbacks.set(target.path, success);
    return jest.fn();
  },
);

jest.mock("firebase/database", () => ({
  ref: (db: unknown, path: string) => refMock(db, path),
  onValue: (
    target: { path: string },
    success: (snapshot: { val: () => unknown }) => void,
    error: (error: unknown) => void,
  ) => onValueMock(target, success, error),
}));

const SETTINGS_PATH = "churches/church-1/data/monitorSettings";

describe("useSyncMonitorSettings", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
  });

  it("does not subscribe until sharedDataReady is true", () => {
    renderHook(() => useSyncMonitorSettings(db, "church-1", false));
    expect(onValueMock).not.toHaveBeenCalled();
  });

  it("does not subscribe without a church id", () => {
    renderHook(() => useSyncMonitorSettings(db, null, true));
    expect(onValueMock).not.toHaveBeenCalled();
  });

  it("dispatches monitor settings fields from Firebase", () => {
    renderHook(() => useSyncMonitorSettings(db, "church-1", true));

    const success = onValueCallbacks.get(SETTINGS_PATH);
    expect(success).toBeDefined();

    success?.({
      val: () => ({
        showClock: true,
        showTimer: true,
        showNextSlide: false,
        clockFontSize: 60,
        timerFontSize: 70,
        timerId: "timer-1",
      }),
    });

    expect(mockDispatch).toHaveBeenCalledWith(setMonitorShowClock(true));
    expect(mockDispatch).toHaveBeenCalledWith(setMonitorShowTimer(true));
    expect(mockDispatch).toHaveBeenCalledWith(setMonitorShowNextSlide(false));
    expect(mockDispatch).toHaveBeenCalledWith(setMonitorClockFontSize(60));
    expect(mockDispatch).toHaveBeenCalledWith(setMonitorTimerFontSize(70));
    expect(mockDispatch).toHaveBeenCalledWith(setMonitorTimerId("timer-1"));
  });

  it("clears timerId when Firebase omits it", () => {
    renderHook(() => useSyncMonitorSettings(db, "church-1", true));
    onValueCallbacks.get(SETTINGS_PATH)?.({
      val: () => ({
        showClock: true,
        showTimer: true,
        clockFontSize: 75,
        timerFontSize: 75,
      }),
    });

    expect(mockDispatch).toHaveBeenCalledWith(setMonitorTimerId(null));
  });

  it("ignores null snapshots", () => {
    renderHook(() => useSyncMonitorSettings(db, "church-1", true));
    onValueCallbacks.get(SETTINGS_PATH)?.({ val: () => null });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
