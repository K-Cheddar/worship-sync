import { render, screen } from "@testing-library/react";
import MonitorDisplayBox from "../MonitorDisplayBox";
import type { Box } from "../../../types";

jest.mock("@gsap/react", () => ({
  useGSAP: () => { },
}));

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: () => ({
      clear: jest.fn(),
      fromTo: jest.fn(),
    }),
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
});
