import { act, render, screen, within } from "@testing-library/react";
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
      undoable: {
        present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
      },
      timers: { timers: [] },
    };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("TimerDisplay", () => {
    it("formats minute-only values when requested", () => {
      expect(formatTime(125, true)).toBe("2");
    });

    it("shows seconds only when under one minute (no leading 00:)", () => {
      expect(formatTime(58, false)).toBe("58");
      expect(formatTime(9, false)).toBe("9");
      expect(formatTime(0, false)).toBe("0");
      expect(formatTime(60, false)).toBe("1:00");
    });

    it("renders a single span for under-one-minute split formatting", () => {
      render(
        <div data-testid="format-root">{formatTime(45, false, true)}</div>,
      );
      const root = screen.getByTestId("format-root");
      expect(root).toHaveTextContent("45");
      expect(within(root).getByText("45")).toBeInTheDocument();
    });

    it("renders split spans when formatting mm:ss sections", () => {
      render(
        <div data-testid="format-root">{formatTime(65, false, true)}</div>,
      );
      const root = screen.getByTestId("format-root");
      expect(root).toHaveTextContent("1:05");
      expect(within(root).getAllByText(/^(1|:05)$/)).toHaveLength(2);
    });

    it("renders split spans when formatting hh:mm:ss sections", () => {
      render(
        <div data-testid="format-root">{formatTime(3661, false, true)}</div>,
      );
      const root = screen.getByTestId("format-root");
      expect(root).toHaveTextContent("1:01:01");
      expect(within(root).getAllByText(/^(1|:01)$/)).toHaveLength(3);
    });

    it("removes timer token when timerInfo is not provided", () => {
      const { container } = render(
        <TimerDisplay words={"Starts {{timer}} now"} />,
      );
      expect(container.textContent).toBe("Starts  now");
    });

    it("renders running timer from redux timer state and applies timer color", () => {
      const timer = createTimer({ remainingTime: 61, color: "#112233" });
      hooksState = {
        ...hooksState,
        timers: { timers: [timer] },
      };
      reactReduxState = {
        timers: { timers: [timer] },
      };

      render(<TimerDisplay timerInfo={timer} words={"Time: {{timer}}"} />);

      const timerSpan = screen.getByText("1:01", { selector: "span" });
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
      reactReduxState = {
        timers: { timers: [timerInfo] },
      };

      render(
        <TimerDisplay
          timerInfo={timerInfo}
          words={"Service starts {{timer}}"}
        />,
      );

      expect(screen.getByText("1:05 PM")).toBeInTheDocument();
    });

    it("shows a paused countdown as its target time, not a duration", () => {
      const timerInfo = createTimer({
        status: "paused",
        isActive: false,
        countdownTime: "11:00",
        remainingTime: 0,
      });
      hooksState = {
        ...hooksState,
        timers: { timers: [timerInfo] },
      };
      reactReduxState = {
        timers: { timers: [timerInfo] },
      };

      render(<TimerDisplay timerInfo={timerInfo} words={"Starts {{timer}}"} />);

      expect(screen.getByText("11:00 AM")).toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("shows the target time for a countdown left marked running from days ago", () => {
      // Captured from a real session: the timer sat in the store as `running`
      // with an endTime ~13 days past. Deriving remaining from that endTime
      // clamped to 0, so selecting the item painted "0" until tickTimers
      // auto-stopped it and the clock time took over.
      const stale = createTimer({
        id: "11 AM Timer",
        status: "running",
        isActive: true,
        countdownTime: "11:00",
        endTime: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
        remainingTime: 55101,
      });
      hooksState = {
        ...hooksState,
        timers: { timers: [stale] },
      };
      reactReduxState = {
        timers: { timers: [stale] },
      };

      render(<TimerDisplay timerInfo={stale} words={"Starts {{timer}}"} />);

      expect(screen.getByText("11:00 AM")).toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("still counts down a countdown that is genuinely running", () => {
      const live = createTimer({
        status: "running",
        isActive: true,
        countdownTime: "11:00",
        endTime: new Date(Date.now() + 65_900).toISOString(),
        remainingTime: 65,
      });
      hooksState = {
        ...hooksState,
        timers: { timers: [live] },
      };
      reactReduxState = {
        timers: { timers: [live] },
      };

      render(<TimerDisplay timerInfo={live} words={"Starts {{timer}}"} />);

      expect(
        screen.getByText("1:05", { selector: "span" }),
      ).toBeInTheDocument();
    });

    it("never renders 0 for a countdown whose slide snapshot is a stale run", () => {
      // The copy baked into a slide can say `running` with an endTime that has
      // long since passed. Selecting that item used to paint a bare "0" for a
      // frame before the synced timer landed and it settled to the clock time.
      const stale = createTimer({
        status: "running",
        isActive: true,
        countdownTime: "11:00",
        endTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        remainingTime: 0,
      });
      const synced = createTimer({
        status: "stopped",
        isActive: false,
        countdownTime: "11:00",
        remainingTime: 0,
      });
      hooksState = {
        ...hooksState,
        timers: { timers: [synced] },
      };
      reactReduxState = {
        timers: { timers: [synced] },
      };

      render(<TimerDisplay timerInfo={stale} words={"Starts {{timer}}"} />);

      expect(screen.getByText("11:00 AM")).toBeInTheDocument();
      expect(screen.queryByText("0")).not.toBeInTheDocument();
    });

    it("uses redux service times for service-time placeholders when available", async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-10T09:00:00.000Z"));
      const serviceTimes = [
        {
          id: "service-1",
          name: "First Service",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-01-10T09:01:00.000Z",
        },
      ];
      hooksState = {
        ...hooksState,
        undoable: {
          present: {
            ...hooksState.undoable?.present,
            serviceTimes: {
              list: serviceTimes,
              isInitialized: true,
            },
          },
        },
      };
      reactReduxState = {
        timers: { timers: [] },
        undoable: {
          present: {
            serviceTimes: {
              list: serviceTimes,
              isInitialized: true,
            },
          },
        },
      };

      render(<TimerDisplay words={"Starts in {{service-time}}"} />);

      expect(
        await screen.findByText("1:00", { selector: "span" }),
      ).toBeInTheDocument();
    });
  });

  describe("DisplayTimer", () => {
    it("renders active monitor timer when running", () => {
      const timer = createTimer({ remainingTime: 3661, color: "#445566" });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
        timers: { timers: [timer] },
      };

      render(<DisplayTimer fontSize={20} />);

      expect(screen.getByText("1:01:01")).toBeInTheDocument();
      const timerEl = screen.getByText("1:01:01");
      expect(timerEl).toHaveStyle({ fontSize: "20px", color: "#445566" });
    });

    it("inherits the church timer when a display passes null", () => {
      const timer = createTimer({ remainingTime: 3661 });
      hooksState = {
        undoable: {
          present: {
            preferences: { monitorSettings: { timerId: "timer-1" } },
          },
        },
        timers: { timers: [timer] },
      };

      render(<DisplayTimer fontSize={20} timerId={null} />);

      expect(screen.getByText("1:01:01")).toBeInTheDocument();
    });

    it("returns null when selected monitor timer is stopped", () => {
      const stopped = createTimer({
        status: "stopped",
        countdownTime: "14:30",
      });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
        timers: { timers: [stopped] },
      };

      const { container } = render(<DisplayTimer fontSize={18} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null when the selected monitor timer is paused", () => {
      const paused = createTimer({
        status: "paused",
        isActive: false,
        remainingTime: 90,
      });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
        timers: { timers: [paused] },
      };

      const { container } = render(<DisplayTimer fontSize={18} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null for a timer still flagged running with a long-past end", () => {
      const stale = createTimer({
        status: "running",
        isActive: true,
        countdownTime: "11:00",
        endTime: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
        remainingTime: 55101,
      });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
        timers: { timers: [stale] },
      };

      const { container } = render(<DisplayTimer fontSize={18} />);
      expect(container).toBeEmptyDOMElement();
    });

    it("returns null when the current timer is already displayed elsewhere", () => {
      const timer = createTimer({ remainingTime: 90 });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
        timers: { timers: [timer] },
      };

      const { container } = render(
        <DisplayTimer
          fontSize={18}
          currentTimerInfo={{ ...timer, id: "timer-1" }}
        />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it("renders minute-only timer text when monitor timer is configured that way", () => {
      const timer = createTimer({ remainingTime: 125, showMinutesOnly: true });
      hooksState = {
        undoable: {
          present: { preferences: { monitorSettings: { timerId: "timer-1" } } },
        },
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
      render(
        <VerseDisplay
          words={`\u200B1\u200B In the beginning`}
          className="text-blue-300"
        />,
      );
      const verse = screen.getByText("1");
      expect(verse).toHaveClass("text-blue-300");
      expect(screen.getByText(/In the beginning/)).toBeInTheDocument();
    });
  });
});
