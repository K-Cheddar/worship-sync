import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TimerControls from "./TimerControls";
import { GlobalInfoContext } from "../../context/globalInfo";
import { setServerTimeOffset } from "../../utils/serverTime";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("./TimerTypeSelector", () => ({
  __esModule: true,
  default: ({
    disabled,
  }: {
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      Timer Type Selector
    </button>
  ),
}));

jest.mock("./CountdownTimeInput", () => ({
  __esModule: true,
  default: ({
    disabled,
    onTimeChange,
    labelLayout,
  }: {
    disabled?: boolean;
    onTimeChange?: (time: string) => void;
    labelLayout?: "inline" | "stacked";
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-label-layout={labelLayout}
      onClick={() => onTimeChange?.("19:30")}
    >
      Countdown Input
    </button>
  ),
}));

jest.mock("./DurationInputs", () => ({
  __esModule: true,
  default: ({
    disabled,
    onDurationChange,
    labelLayout,
  }: {
    disabled?: boolean;
    onDurationChange?: (duration: number) => void;
    labelLayout?: "inline" | "stacked";
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-label-layout={labelLayout}
      onClick={() => onDurationChange?.(300)}
    >
      Duration Input
    </button>
  ),
}));

jest.mock("../RadioButton/RadioButton", () => ({
  __esModule: true,
  RadioGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  default: ({
    label,
    disabled,
  }: {
    label: string;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      {label}
    </button>
  ),
}));

jest.mock("./TimerControlButtons", () => ({
  __esModule: true,
  default: ({
    disabled,
    status,
    onPlay,
    onPause,
    onStop,
    className,
  }: {
    disabled?: boolean;
    status: "running" | "paused" | "stopped";
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    className?: string;
  }) => (
    <div className={className} data-testid="timer-control-buttons">
      <button
        type="button"
        disabled={disabled || status === "running"}
        onClick={onPlay}
      >
        Play
      </button>
      <button
        type="button"
        disabled={disabled || status !== "running"}
        onClick={onPause}
      >
        Pause
      </button>
      <button
        type="button"
        disabled={disabled || status === "stopped"}
        onClick={onStop}
      >
        Stop
      </button>
      <button type="button" disabled={disabled} onClick={onStop}>
        Reset
      </button>
    </div>
  ),
}));

const renderWithAccess = (
  access: "full" | "music" | "view",
  timerControlsProps?: {
    variant?: "full" | "controlsOnly";
    showTimeInput?: boolean;
    timeInputLayout?: "inline" | "stacked";
  },
) => {
  return render(
    <GlobalInfoContext.Provider value={{ access, hostId: "host-1" } as any}>
      <TimerControls {...timerControlsProps} />
    </GlobalInfoContext.Provider>,
  );
};

describe("TimerControls access gating", () => {
  beforeEach(() => {
    jest.useRealTimers();
    setServerTimeOffset(0);
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          item: {
            _id: "timer-1",
          },
        },
      },
      timers: {
        timers: [
          {
            id: "timer-1",
            status: "stopped",
            timerType: "timer",
            duration: 60,
            countdownTime: "00:00",
            showMinutesOnly: false,
          },
        ],
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    setServerTimeOffset(0);
  });

  it.each(["music", "view"] as const)(
    "disables timer controls for %s access",
    (access) => {
      renderWithAccess(access);

      expect(
        screen.getByRole("button", { name: "Timer Type Selector" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Duration Input" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Full timer" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Minutes only" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    },
  );

  it("allows timer controls for full access", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    setServerTimeOffset(90_000);

    renderWithAccess("full");

    const playButton = screen.getByRole("button", { name: "Play" });
    expect(playButton).not.toBeDisabled();

    fireEvent.click(playButton);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timers/updateTimer",
        payload: expect.objectContaining({
          id: "timer-1",
          timerInfo: expect.objectContaining({
            startedAt: "2026-01-01T12:01:30.000Z",
          }),
        }),
      }),
    );
  });

  it("controlsOnly variant renders only transport buttons, not settings", () => {
    renderWithAccess("full", { variant: "controlsOnly" });

    expect(
      screen.queryByRole("button", { name: "Timer Type Selector" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duration Input" })).not.toBeInTheDocument();
  });

  it("shows the duration input when compact time input is enabled", () => {
    renderWithAccess("full", {
      variant: "controlsOnly",
      showTimeInput: true,
    });

    expect(screen.getByRole("button", { name: "Duration Input" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Countdown Input" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duration Input" })).not.toHaveAttribute("data-label-layout");
    expect(screen.getByTestId("timer-time-input-container")).toHaveClass("hidden", "lg:block");
  });

  it("shows the countdown input for countdown timers", () => {
    mockState.timers.timers[0].timerType = "countdown";

    renderWithAccess("full", { variant: "controlsOnly", showTimeInput: true });

    expect(screen.getByRole("button", { name: "Countdown Input" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duration Input" })).not.toBeInTheDocument();
  });

  it.each([375, 1280])(
    "keeps stacked Present timer controls within the panel at %i px",
    (viewportWidth) => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: viewportWidth,
      });
      renderWithAccess("full", {
        variant: "controlsOnly",
        showTimeInput: true,
        timeInputLayout: "stacked",
      });

      const controls = screen.getByTestId("timer-controls-container");
      const input = screen.getByRole("button", { name: "Duration Input" });
      const inputContainer = screen.getByTestId("timer-time-input-container");

      expect(controls).toHaveClass("flex-col", "items-stretch", "min-w-0", "w-full");
      expect(inputContainer).toHaveClass("w-full", "min-w-0");
      expect(inputContainer).not.toHaveClass("hidden");
      expect(input).toHaveAttribute("data-label-layout", "stacked");
      expect(screen.getByTestId("timer-control-buttons")).toHaveClass("w-full");
    },
  );

  it("dispatches a duration edit through updateTimer", () => {
    renderWithAccess("full", {
      variant: "controlsOnly",
      showTimeInput: true,
      timeInputLayout: "stacked",
    });

    fireEvent.click(screen.getByRole("button", { name: "Duration Input" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timers/updateTimer",
        payload: expect.objectContaining({
          id: "timer-1",
          timerInfo: expect.objectContaining({
            duration: 300,
            status: "stopped",
          }),
        }),
      }),
    );
  });

  it("dispatches a countdown time edit through updateTimer", () => {
    mockState.timers.timers[0].timerType = "countdown";

    renderWithAccess("full", {
      variant: "controlsOnly",
      showTimeInput: true,
      timeInputLayout: "stacked",
    });

    fireEvent.click(screen.getByRole("button", { name: "Countdown Input" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timers/updateTimer",
        payload: expect.objectContaining({
          id: "timer-1",
          timerInfo: expect.objectContaining({
            countdownTime: "19:30",
            status: "stopped",
          }),
        }),
      }),
    );
  });

  it("preserves stop and reset behavior", () => {
    mockState.timers.timers[0].status = "running";

    renderWithAccess("full", { variant: "controlsOnly" });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(mockDispatch).toHaveBeenCalledTimes(2);
    for (const [action] of mockDispatch.mock.calls) {
      expect(action).toEqual(
        expect.objectContaining({
          type: "timers/updateTimer",
          payload: expect.objectContaining({
            timerInfo: expect.objectContaining({ status: "stopped" }),
          }),
        }),
      );
    }
  });

  it.each(["music", "view"] as const)(
    "does not allow %s access to edit the compact time input",
    (access) => {
      renderWithAccess(access, {
        variant: "controlsOnly",
        showTimeInput: true,
        timeInputLayout: "stacked",
      });

      const durationInput = screen.getByRole("button", { name: "Duration Input" });
      expect(durationInput).toBeDisabled();
      fireEvent.click(durationInput);
      expect(mockDispatch).not.toHaveBeenCalled();
    },
  );
});
