import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TimerControls from "./TimerControls";
import { GlobalInfoContext } from "../../context/globalInfo";

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
  }: {
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
      Countdown Input
    </button>
  ),
}));

jest.mock("./DurationInputs", () => ({
  __esModule: true,
  default: ({
    disabled,
  }: {
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled}>
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
    onPlay,
  }: {
    disabled?: boolean;
    onPlay: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPlay}>
      Play
    </button>
  ),
}));

const renderWithAccess = (access: "full" | "music" | "view") => {
  return render(
    <GlobalInfoContext.Provider value={{ access, hostId: "host-1" } as any}>
      <TimerControls />
    </GlobalInfoContext.Provider>,
  );
};

describe("TimerControls access gating", () => {
  beforeEach(() => {
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
    renderWithAccess("full");

    const playButton = screen.getByRole("button", { name: "Play" });
    expect(playButton).not.toBeDisabled();

    fireEvent.click(playButton);

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timers/updateTimer",
        payload: expect.objectContaining({
          id: "timer-1",
        }),
      }),
    );
  });
});
