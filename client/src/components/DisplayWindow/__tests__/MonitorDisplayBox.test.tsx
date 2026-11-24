import { render, screen } from "@testing-library/react";
import MonitorDisplayBox from "../MonitorDisplayBox";
import type { Box } from "../../../types";

const mockTimelines: Array<{
  clear: jest.Mock;
  fromTo: jest.Mock;
  isActive: jest.Mock;
}> = [];

jest.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void) => {
    const React = require("react");
    React.useEffect(callback);
  },
}));

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: () => {
      const timeline = {
        clear: jest.fn(),
        fromTo: jest.fn(),
        isActive: jest.fn(() => true),
      };
      mockTimelines.push(timeline);
      return timeline;
    },
    set: jest.fn(),
  },
}));

const baseBox: Box = {
  id: "m1",
  words: "Hello monitor",
  width: 100,
  height: 100,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "",
  fontColor: "#fff",
  shouldKeepAspectRatio: false,
  transparent: false,
  excludeFromOverflow: false,
  align: "center",
  slideIndex: 0,
  label: "Main",
  isBold: false,
  isItalic: false,
};

describe("MonitorDisplayBox", () => {
  beforeEach(() => {
    mockTimelines.length = 0;
  });

  it("renders the box words for next, prev, and jump directions", () => {
    const { rerender } = render(
      <MonitorDisplayBox
        box={baseBox}
        shouldAnimate
        transitionDirection="next"
      />,
    );
    expect(screen.getByText("Hello monitor")).toBeInTheDocument();

    rerender(
      <MonitorDisplayBox
        box={{ ...baseBox, words: "Going back" }}
        shouldAnimate
        transitionDirection="prev"
      />,
    );
    expect(screen.getByText("Going back")).toBeInTheDocument();

    rerender(
      <MonitorDisplayBox
        box={{ ...baseBox, words: "Jump cut" }}
        isPrev
        shouldAnimate
        transitionDirection="jump"
      />,
    );
    expect(screen.getByText("Jump cut")).toBeInTheDocument();
  });

  it("clears an interrupted band animation before starting the latest slide", () => {
    const { rerender } = render(
      <MonitorDisplayBox
        box={baseBox}
        shouldAnimate
        transitionDirection="next"
      />,
    );
    const firstTimeline = mockTimelines[0];

    rerender(
      <MonitorDisplayBox
        box={{ ...baseBox, words: "Latest monitor slide" }}
        shouldAnimate
        transitionDirection="prev"
      />,
    );

    expect(firstTimeline.isActive).toHaveBeenCalled();
    expect(firstTimeline.clear).toHaveBeenCalledTimes(1);
    expect(mockTimelines).toHaveLength(2);
    expect(mockTimelines[1].fromTo).toHaveBeenCalled();
  });
});
