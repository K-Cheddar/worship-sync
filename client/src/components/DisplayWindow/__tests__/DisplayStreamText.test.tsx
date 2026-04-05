import { render, screen } from "@testing-library/react";
import DisplayStreamText from "../DisplayStreamText";
import type { Box } from "../../../types";
import { useGSAP } from "@gsap/react";

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

const gsapFromToMock = jest.fn();
const timelineMock = {
  fromTo: (...args: any[]) => {
    gsapFromToMock(...args);
    return timelineMock;
  },
  clear: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: jest.fn(() => timelineMock),
  },
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
  const gsapCallbacks: Array<() => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
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

  it("uses a zero-duration text fade when the previous words match", () => {
    render(
      <DisplayStreamText
        box={{ ...baseBox, words: "Same words" }}
        prevBox={{ ...baseBox, words: "Same words" }}
        width={50}
        shouldAnimate
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapFromToMock.mock.calls.some(
        ([, , props]) => props?.opacity === 1 && props?.duration === 0,
      ),
    ).toBe(true);
  });

  it("fades previous text out when rendering the previous layer", () => {
    render(
      <DisplayStreamText
        box={{ ...baseBox, words: "Current words" }}
        prevBox={{ ...baseBox, words: "Older words" }}
        width={50}
        shouldAnimate
        isPrev
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(
      gsapFromToMock.mock.calls.some(
        ([, fromProps, toProps]) =>
          fromProps?.opacity === 1 &&
          toProps?.opacity === 0 &&
          toProps?.duration === 0.35,
      ),
    ).toBe(true);
  });
});
