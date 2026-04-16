import { render, screen } from "@testing-library/react";
import DisplayStreamFormattedText from "../DisplayStreamFormattedText";

const timelineMock = {
  fromTo: jest.fn(() => timelineMock),
  clear: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    timeline: jest.fn(() => timelineMock),
    set: jest.fn(),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: (cb: () => void) => {
    cb();
  },
}));

describe("DisplayStreamFormattedText", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders current formatted text when provided", () => {
    render(
      <DisplayStreamFormattedText
        width={14}
        shouldAnimate
        formattedTextDisplayInfo={{
          text: "Welcome everyone",
          time: 1,
        }}
      />,
    );

    expect(screen.getByText("Welcome everyone")).toBeInTheDocument();
  });

  it("renders previous formatted text in prev layer for crossfade handoff", () => {
    render(
      <DisplayStreamFormattedText
        width={14}
        shouldAnimate
        formattedTextDisplayInfo={{
          text: "New announcement",
          time: 2,
        }}
        prevFormattedTextDisplayInfo={{
          text: "Old announcement body",
          time: 1,
        }}
      />,
    );

    expect(screen.getByText("New announcement")).toBeInTheDocument();
    expect(screen.getByText("Old announcement body")).toBeInTheDocument();
  });
});
