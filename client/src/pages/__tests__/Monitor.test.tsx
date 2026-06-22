import { act, render, screen, waitFor } from "@testing-library/react";
import Monitor from "../Monitor";
import { GlobalInfoContext } from "../../context/globalInfo";
import {
  setMonitorClockFontSize,
  setMonitorShowClock,
  setMonitorShowNextSlide,
  setMonitorShowTimer,
  setMonitorTimerFontSize,
  setMonitorTimerId,
} from "../../store/preferencesSlice";

const mockDispatch = jest.fn();
const onValueCallbacks = new Map<string, (snapshot: any) => void>();
const onValueErrorCallbacks = new Map<string, (error: unknown) => void>();
let fullscreenPresentationProps: any = null;
let monitorBoardViewProps: any = null;

const refMock = jest.fn(
  (_db: unknown, path: string) =>
    ({
      path,
    }) as { path: string }
);
const onValueMock = jest.fn(
  (
    target: { path: string },
    callback: (snapshot: any) => void,
    errorCallback?: (error: unknown) => void
  ) => {
    onValueCallbacks.set(target.path, callback);
    if (errorCallback) onValueErrorCallbacks.set(target.path, errorCallback);
    return jest.fn();
  }
);

const mockState = {
  presentation: {
    monitorInfo: {
      displayType: "monitor",
      name: "Current Monitor",
      slide: { boxes: [{ words: "Current" }] },
      timerId: "timer-1",
    },
    prevMonitorInfo: {
      displayType: "monitor",
      name: "Previous Monitor",
      slide: { boxes: [{ words: "Previous" }] },
      timerId: "timer-2",
    },
    monitorBoardAliasId: "",
  },
  timers: {
    timers: [
      { id: "timer-1", name: "Current Timer" },
      { id: "timer-2", name: "Previous Timer" },
    ],
  },
  undoable: {
    present: {
      preferences: {
        monitorSettings: {
          showClock: true,
          showTimer: true,
          clockFontSize: 75,
          timerFontSize: 75,
          timerId: "timer-1",
        },
      },
    },
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
  useFirebaseValueWithRetry: jest.requireActual(
    "../../hooks/useFirebaseValueWithRetry"
  ).useFirebaseValueWithRetry,
}));

jest.mock("firebase/database", () => ({
  ref: (db: unknown, path: string) => refMock(db, path),
  onValue: (
    target: { path: string },
    callback: (snapshot: unknown) => void,
    errorCallback?: (error: unknown) => void,
  ) => onValueMock(target, callback, errorCallback),
}));

jest.mock("../../hooks/useCloseOnEscape", () => ({
  useCloseOnEscape: jest.fn(),
}));

jest.mock("../../containers/FullscreenPresentation", () => ({
  __esModule: true,
  default: (props: any) => {
    fullscreenPresentationProps = props;
    return <div data-testid="fullscreen-presentation-mock" />;
  },
}));

jest.mock("../../components/DisplayWindow/MonitorBoardView", () => ({
  __esModule: true,
  default: (props: any) => {
    monitorBoardViewProps = props;
    return <div data-testid="monitor-board-view-mock" />;
  },
}));

describe("Monitor page", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    onValueErrorCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    fullscreenPresentationProps = null;
    monitorBoardViewProps = null;
    mockState.presentation.monitorBoardAliasId = "";
    Object.defineProperty(window.navigator, "wakeLock", {
      configurable: true,
      value: { request: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it("subscribes to monitor settings and dispatches the current monitor settings actions", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: "firebase-db",
            churchId: "church-main",
            sharedDataReady: true,
          } as any
        }
      >
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    await waitFor(() =>
      expect(refMock).toHaveBeenCalledWith(
        "firebase-db",
        "churches/church-main/data/monitorSettings"
      )
    );

    onValueCallbacks
      .get("churches/church-main/data/monitorSettings")
      ?.({
        val: () => ({
          showClock: false,
          showTimer: true,
          showNextSlide: true,
          clockFontSize: 90,
          timerFontSize: 110,
          timerId: "timer-1",
        }),
      });

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [setMonitorShowClock(false)],
          [setMonitorShowTimer(true)],
          [setMonitorShowNextSlide(true)],
          [setMonitorClockFontSize(90)],
          [setMonitorTimerFontSize(110)],
          [setMonitorTimerId("timer-1")],
        ])
      )
    );
  });

  it("keeps support for legacy monitor settings payloads without showNextSlide", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: "firebase-db",
            churchId: "church-main",
            sharedDataReady: true,
          } as any
        }
      >
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    await waitFor(() =>
      expect(onValueCallbacks.has("churches/church-main/data/monitorSettings")).toBe(true)
    );

    mockDispatch.mockClear();

    onValueCallbacks
      .get("churches/church-main/data/monitorSettings")
      ?.({
        val: () => ({
          showClock: true,
          showTimer: false,
          clockFontSize: 80,
          timerFontSize: 95,
        }),
      });

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [setMonitorShowClock(true)],
          [setMonitorShowTimer(false)],
          [setMonitorClockFontSize(80)],
          [setMonitorTimerFontSize(95)],
          [setMonitorTimerId(null)],
        ])
      )
    );
    expect(mockDispatch.mock.calls).not.toEqual(
      expect.arrayContaining([[setMonitorShowNextSlide(true)]])
    );
    expect(mockDispatch.mock.calls).not.toEqual(
      expect.arrayContaining([[setMonitorShowNextSlide(false)]])
    );
  });

  it("does not subscribe to monitor settings until shared data is ready", () => {
    render(
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: "firebase-db",
            churchId: "church-main",
            sharedDataReady: false,
          } as any
        }
      >
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    expect(
      onValueCallbacks.has("churches/church-main/data/monitorSettings")
    ).toBe(false);
  });

  it("re-attaches the monitor settings listener after a permission_denied error", async () => {
    render(
      <GlobalInfoContext.Provider
        value={
          {
            firebaseDb: "firebase-db",
            churchId: "church-main",
            sharedDataReady: true,
          } as any
        }
      >
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    const path = "churches/church-main/data/monitorSettings";
    await waitFor(() => expect(onValueErrorCallbacks.has(path)).toBe(true));

    const countSubscriptions = () =>
      onValueMock.mock.calls.filter(([target]) => target.path === path).length;
    const before = countSubscriptions();

    // A startup-race permission_denied must re-attach, not stay cancelled.
    act(() => {
      onValueErrorCallbacks.get(path)?.({ code: "PERMISSION_DENIED" });
    });

    await waitFor(() => expect(countSubscriptions()).toBeGreaterThan(before));
  });

  it("passes current and previous monitor presentation info into FullscreenPresentation", () => {
    render(
      <GlobalInfoContext.Provider value={{} as any}>
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    expect(fullscreenPresentationProps.displayInfo).toEqual(
      mockState.presentation.monitorInfo
    );
    expect(fullscreenPresentationProps.prevDisplayInfo).toEqual(
      mockState.presentation.prevMonitorInfo
    );
    expect(fullscreenPresentationProps.timerInfo).toEqual(
      mockState.timers.timers[0]
    );
    expect(fullscreenPresentationProps.prevTimerInfo).toEqual(
      mockState.timers.timers[1]
    );
  });

  it("renders the discussion board view (not the presentation) when board mode is on", () => {
    mockState.presentation.monitorBoardAliasId = "board-alias-1";

    render(
      <GlobalInfoContext.Provider value={{} as any}>
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    expect(screen.getByTestId("monitor-board-view-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("fullscreen-presentation-mock")).toBeNull();
    expect(monitorBoardViewProps.aliasId).toBe("board-alias-1");
  });

  it("renders the presentation (not the board) when board mode is off", () => {
    render(
      <GlobalInfoContext.Provider value={{} as any}>
        <Monitor />
      </GlobalInfoContext.Provider>
    );

    expect(screen.getByTestId("fullscreen-presentation-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-board-view-mock")).toBeNull();
  });
});
