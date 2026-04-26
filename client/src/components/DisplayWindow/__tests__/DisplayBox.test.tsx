import { render, screen } from "@testing-library/react";
import gsap from "gsap";
import DisplayBox from "../DisplayBox";
import type { Box } from "../../../types";

const mockTimeline = {
  clear: jest.fn(),
  addLabel: jest.fn(),
  set: jest.fn(),
  fromTo: jest.fn(),
  to: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: jest.fn(),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: (callback: () => void) => {
    const React = jest.requireActual("react");
    React.useLayoutEffect(() => {
      callback();
    });
  },
}));

jest.mock("../../../hooks/useCachedMediaUrl", () => ({
  useCachedMediaUrl: (url?: string) => url,
}));

const baseBox: Box = {
  id: "box-1",
  words: "Same lyric",
  width: 100,
  height: 100,
  fontSize: 40,
  brightness: 100,
  topMargin: 0,
  sideMargin: 0,
  x: 0,
  y: 0,
  background: "current.jpg",
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

describe("DisplayBox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(gsap.timeline).mockReturnValue(mockTimeline as any);
  });

  it("keeps matching text visible while the background crossfades out", () => {
    render(
      <DisplayBox
        box={baseBox}
        prevBox={{ ...baseBox, background: "next.jpg" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
        isPrev
      />,
    );

    expect(mockTimeline.set).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeOut",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalledWith(
      ".display-box-text",
      expect.anything(),
      expect.objectContaining({ opacity: 0 }),
      "fadeOut",
    );
  });

  it("keeps matching text visible while the background crossfades in", () => {
    render(
      <DisplayBox
        box={baseBox}
        prevBox={{ ...baseBox, background: "previous.jpg" }}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    expect(mockTimeline.set).toHaveBeenCalledWith(
      ".display-box-text",
      { opacity: 1 },
      "fadeIn",
    );
    expect(mockTimeline.fromTo).not.toHaveBeenCalledWith(
      ".display-box-text",
      expect.objectContaining({ opacity: 0 }),
      expect.anything(),
      "fadeIn",
    );
  });

  it("renders incoming background and text hidden before the fade-in starts", () => {
    render(
      <DisplayBox
        box={baseBox}
        width={100}
        showBackground
        index={0}
        shouldAnimate
      />,
    );

    expect(screen.getByAltText("Main")).toHaveStyle({ opacity: "0" });
    expect(screen.getByText("Same lyric")).toHaveStyle({ opacity: "0" });
  });
});
