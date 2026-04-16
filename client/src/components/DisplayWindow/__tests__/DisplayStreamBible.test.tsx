import { render, screen } from "@testing-library/react";
import DisplayStreamBible from "../DisplayStreamBible";

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

describe("DisplayStreamBible", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders current bible title and text when provided", () => {
    render(
      <DisplayStreamBible
        width={14}
        shouldAnimate
        bibleDisplayInfo={{
          title: "Jn 3:16",
          text: "For God so loved the world",
          time: 1,
        }}
      />,
    );

    expect(screen.getByText("Jn 3:16")).toBeInTheDocument();
    expect(screen.getByText("For God so loved the world")).toBeInTheDocument();
  });

  it("renders previous bible in prev layer for crossfade handoff", () => {
    render(
      <DisplayStreamBible
        width={14}
        shouldAnimate
        bibleDisplayInfo={{
          title: "New",
          text: "New passage",
          time: 2,
        }}
        prevBibleDisplayInfo={{
          title: "Old ref",
          text: "Outgoing verse",
          time: 1,
        }}
      />,
    );

    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Old ref")).toBeInTheDocument();
    expect(screen.getByText("Outgoing verse")).toBeInTheDocument();
  });
});
