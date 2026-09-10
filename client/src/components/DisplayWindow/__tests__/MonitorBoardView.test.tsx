import { render, screen } from "@testing-library/react";
import MonitorBoardView from "../MonitorBoardView";

const mockUseSelector = jest.fn();

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) => mockUseSelector(selector),
}));

jest.mock("../../../boards/BoardPresentationScreen", () => ({
  __esModule: true,
  default: ({ aliasId }: { aliasId: string }) => (
    <div data-testid="board-presentation-mock" data-alias-id={aliasId} />
  ),
}));

jest.mock("../DisplayClock", () => ({
  __esModule: true,
  default: () => <div data-testid="display-clock-mock" />,
}));

jest.mock("../DisplayTimer", () => ({
  __esModule: true,
  default: () => <div data-testid="display-timer-mock" />,
}));

describe("MonitorBoardView", () => {
  beforeEach(() => {
    mockUseSelector.mockReset();
  });

  const loadedState = (monitorSettings: {
    showClock: boolean;
    showTimer: boolean;
    clockFontSize: number;
    timerFontSize: number;
  }) => ({
    displayOutputs: {
      list: [
        {
          id: "monitor",
          type: "monitor",
          name: "Monitor",
          order: 0,
          enabled: true,
        },
      ],
      isLoaded: true,
    },
    undoable: {
      present: {
        preferences: {
          monitorSettings,
        },
      },
    },
  });

  it("hides the clock/timer band when both settings are off", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector(
        loadedState({
          showClock: false,
          showTimer: false,
          clockFontSize: 16,
          timerFontSize: 18,
        }),
      ),
    );

    render(<MonitorBoardView aliasId="board-1" scale={1} />);

    expect(screen.getByTestId("board-presentation-mock")).toHaveAttribute(
      "data-alias-id",
      "board-1",
    );
    expect(screen.queryByTestId("display-clock-mock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("display-timer-mock")).not.toBeInTheDocument();
  });

  it("shows the clock and timer band when enabled", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector(
        loadedState({
          showClock: true,
          showTimer: true,
          clockFontSize: 16,
          timerFontSize: 18,
        }),
      ),
    );

    render(<MonitorBoardView aliasId="board-2" scale={0.5} />);

    expect(screen.getByTestId("display-clock-mock")).toBeInTheDocument();
    expect(screen.getByTestId("display-timer-mock")).toBeInTheDocument();
  });

  it("keeps the band off until the registry has loaded", () => {
    mockUseSelector.mockImplementation((selector) =>
      selector({
        displayOutputs: {
          list: [
            {
              id: "monitor",
              type: "monitor",
              name: "Monitor",
              order: 0,
              enabled: true,
            },
          ],
          isLoaded: false,
        },
        undoable: {
          present: {
            preferences: {
              monitorSettings: {
                showClock: true,
                showTimer: true,
                clockFontSize: 16,
                timerFontSize: 18,
              },
            },
          },
        },
      }),
    );

    render(<MonitorBoardView aliasId="board-3" scale={1} />);

    expect(screen.queryByTestId("display-clock-mock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("display-timer-mock")).not.toBeInTheDocument();
  });
});
