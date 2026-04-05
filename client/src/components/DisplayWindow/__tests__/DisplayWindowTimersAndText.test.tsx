import { act, render, screen } from "@testing-library/react";
import DisplayClock from "../DisplayClock";
import DisplayTimer from "../DisplayTimer";
import NowDisplay from "../NowDisplay";
import TimerDisplay, { formatTime } from "../TimerDisplay";
import VerseDisplay from "../VerseDisplay";
import type { TimerInfo } from "../../../types";

let hooksState: any;
let reactReduxState: any;

jest.mock("react-redux", () => ({
  useSelector: (selector: (state: any) => unknown) => selector(reactReduxState),
}));

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: any) => unknown) => selector(hooksState),
  useSharedNow: () => new Date("2026-01-04T10:00:00.000Z").getTime(),
}));

const createTimer = (overrides: Partial<TimerInfo> = {}): TimerInfo => ({
  hostId: "host-1",
  id: "timer-1",
  name: "Main Timer",
  timerType: "countdown",
  status: "running",
  isActive: true,
  remainingTime: 61,
  color: "#00ff00",
  ...overrides,
});

describe("DisplayWindow timer and text helpers", () => {
  beforeEach(() => {
    reactReduxState = {
      timers: { timers: [] },
    };
    hooksState = {
      undoable: { present: { preferences: { monitorSettings: { timerId: "timer-1" } } } },
      timers: { timers: [] },
    };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("TimerDisplay", () => {
    it("formats minute-only values when requested", () => {
      expect(formatTime(125, true)).toBe("2");
    });

    it("renders split spans when formatting mm:ss sections", () => {
      const { container } = render(<>{formatTime(65, false, true)}</>);
      expect(container.textContent).toBe("01:05");
      expect(container.querySelectorAll("span")).toHaveLength(2);
    });

    it("renders split spans when formatting hh:mm:ss sections", () => {
      const { container } = render(<>{formatTime(3661, false, true)}</>);
      expect(container.textContent).toBe("01:01:01");
      expect(container.querySelectorAll("span")).toHaveLength(3);
    });

    it("removes timer token when timerInfo is not provided", () => {
      const { container } = render(<TimerDisplay words={"Starts {{timer}} now"} />);
      expect(container.textContent).toBe("Starts  now");
    });

    it("renders running timer from redux timer state and applies timer color", () => {
      const timer = createTimer({ remainingTime: 61, color: "#112233" });
      hooksState = {
        ...hooksState,
        timers: { timers: [timer] },
      };
      reactReduxState = { timers: { timers: [timer] } };

      render(<TimerDisplay timerInfo={timer} words={"Time: {{timer}}"} />);

      const timerSpan = screen.getByText("01:01", { selector: "span" });
      expect(timerSpan).toBeInTheDocument();
      expect(timerSpan).toHaveStyle({ color: "#112233" });
    });

    it("shows stopped countdown in 12-hour clock format", () => {
      const timerInfo = createTimer({
        status: "stopped",
        countdownTime: "13:05",
      });
      hooksState = {
        ...hooksState,
        timers: { timers: [timerInfo] },
      };
      reactReduxState = { timers: { timers: [timerInfo] } };

      render(<TimerDisplay timerInfo={timerInfo} words={"Service starts {{timer}}"} />);

      expect(screen.getByText("1:05 PM")).toBeInTheDocument();
    });
  });

  describe("DisplayTimer", () => {
    it("renders active monitor timer when running", () => {
      const timer = createTimer({ remainingTime: 3661, color: "#445566" });
      hooksState = {
        undoable: { present: { preferences: { monitorSettings: { timerId: "timer-1" } } } },
        timers: { timers: [timer] },
      };

      render(<DisplayTimer fontSize={20} />);

      expect(screen.getByText("01:01:01")).toBeInTheDocument();
      const timerEl = screen.getByText("01:01:01");
      expect(timerEl).toHaveStyle({ fontSize: "20px", color: "#445566" });
    });

    it("returns null when selected monitor timer is stopped", () => {
      const stopped = createTimer({ status: "stopped", countdownTime: "14:30" });
      hooksState = {
        undoable: { present: { preferences: { monitorSettings: { timerId: "timer-1" } } } },
        timers: { timers: [stopped] },
      };

      const { container } = render(
        <DisplayTimer fontSize={18} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null when the current timer is already displayed elsewhere", () => {
      const timer = createTimer({ remainingTime: 90 });
      hooksState = {
        undoable: { present: { preferences: { monitorSettings: { timerId: "timer-1" } } } },
        timers: { timers: [timer] },
      };

      const { container } = render(
        <DisplayTimer fontSize={18} currentTimerInfo={{ ...timer, id: "timer-1" }} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("renders minute-only timer text when monitor timer is configured that way", () => {
      const timer = createTimer({ remainingTime: 125, showMinutesOnly: true });
      hooksState = {
        undoable: { present: { preferences: { monitorSettings: { timerId: "timer-1" } } } },
        timers: { timers: [timer] },
      };

      render(<DisplayTimer fontSize={20} />);

      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("DisplayClock", () => {
    it("renders current time and updates every second", () => {
      jest.useFakeTimers();
      const toLocaleSpy = jest
        .spyOn(Date.prototype, "toLocaleTimeString")
        .mockReturnValueOnce("9:00 AM")
        .mockReturnValue("9:01 AM");

      render(<DisplayClock fontSize={16} />);

      expect(screen.getByText("9:00 AM")).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByText("9:01 AM")).toBeInTheDocument();
      expect(toLocaleSpy).toHaveBeenCalled();
    });
  });

  describe("inline text formatting", () => {
    it("styles NOW marker text with timer color", () => {
      render(
        <NowDisplay
          words={`Lead \u200CNOW\u200C text`}
          timerInfo={createTimer({ color: "#aa0000" })}
        />,
      );
      expect(screen.getByText("NOW")).toHaveStyle({ color: "#aa0000" });
      expect(screen.getByText(/Lead/)).toBeInTheDocument();
    });

    it("styles verse markers with provided class name", () => {
      render(<VerseDisplay words={`\u200B1\u200B In the beginning`} className="text-blue-300" />);
      const verse = screen.getByText("1");
      expect(verse).toHaveClass("text-blue-300");
      expect(screen.getByText(/In the beginning/)).toBeInTheDocument();
    });
  });
});
