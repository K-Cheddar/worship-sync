import { render, waitFor } from "@testing-library/react";
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
let fullscreenPresentationProps: any = null;

const refMock = jest.fn(
  (_db: unknown, path: string) =>
    ({
      path,
    }) as { path: string }
);
const onValueMock = jest.fn(
  (target: { path: string }, callback: (snapshot: any) => void) => {
    onValueCallbacks.set(target.path, callback);
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
  },
  timers: {
    timers: [
      { id: "timer-1", name: "Current Timer" },
      { id: "timer-2", name: "Previous Timer" },
    ],
  },
};

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("firebase/database", () => ({
  ref: (...args: unknown[]) => refMock(...args),
  onValue: (...args: unknown[]) => onValueMock(...args),
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

describe("Monitor page", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    fullscreenPresentationProps = null;
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
});
