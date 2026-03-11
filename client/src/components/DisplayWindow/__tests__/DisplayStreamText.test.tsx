import { render, screen } from "@testing-library/react";
import DisplayStreamText from "../DisplayStreamText";
import type { Box } from "../../../types";

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

const timerDisplayMock = jest.fn(({ words }) => (
  <span data-testid="timer-display-mock">{words}</span>
));

jest.mock("../TimerDisplay", () => ({
  __esModule: true,
  default: (props: any) => timerDisplayMock(props),
}));

const baseBox: Box = {
  id: "box-1",
  words: "Line one\n\nLine two",
  width: 70,
  height: 20,
  fontSize: 40,
  brightness: 90,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "#ffffff",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

describe("DisplayStreamText", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders normalized plain text when no timer token is present", () => {
    render(<DisplayStreamText box={baseBox} width={50} />);

    expect(screen.getByText(/Line one\s+Line two/)).toBeInTheDocument();
  });

  it("renders TimerDisplay when timer token is present", () => {
    render(
      <DisplayStreamText
        box={{ ...baseBox, words: "Starts in {{timer}}" }}
        width={50}
        timerInfo={{
          hostId: "h1",
          id: "t1",
          name: "Timer",
          timerType: "countdown",
          status: "running",
          isActive: true,
          remainingTime: 120,
        }}
      />,
    );

    expect(screen.getByTestId("timer-display-mock")).toBeInTheDocument();
    expect(timerDisplayMock).toHaveBeenCalled();
  });
});
