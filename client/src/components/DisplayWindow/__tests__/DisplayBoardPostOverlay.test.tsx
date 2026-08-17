import { render, screen } from "@testing-library/react";
import { useGSAP } from "@gsap/react";
import DisplayBoardPostOverlay from "../DisplayBoardPostOverlay";

const gsapSetMock = jest.fn();
const gsapFromToMock = jest.fn();
const gsapToMock = jest.fn();
const timelineMock = {
  fromTo: (...args: unknown[]) => {
    gsapFromToMock(...args);
    return timelineMock;
  },
  to: (...args: unknown[]) => {
    gsapToMock(...args);
    return timelineMock;
  },
  clear: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    set: (...args: unknown[]) => gsapSetMock(...args),
    timeline: jest.fn(() => timelineMock),
  },
}));

jest.mock("@gsap/react", () => ({
  useGSAP: jest.fn(),
}));

describe("DisplayBoardPostOverlay", () => {
  const gsapCallbacks: Array<() => void> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    gsapCallbacks.length = 0;
    (useGSAP as jest.Mock).mockImplementation((cb: () => void) => {
      gsapCallbacks.push(cb);
    });
  });

  it("builds current board post enter and duration-based fade-out animations", () => {
    const onLocalKeepAliveStart = jest.fn();
    render(
      <DisplayBoardPostOverlay
        width={30}
        shouldAnimate
        currentKeepAliveKey="board-current"
        currentKeepAliveMs={8000}
        onLocalKeepAliveStart={onLocalKeepAliveStart}
        boardPostStreamInfo={{
          author: "Taylor",
          authorHexColor: "#e7e5e4",
          text: "How can we pray this week?",
          duration: 7,
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(onLocalKeepAliveStart).toHaveBeenCalledWith(
      "board-current",
      8000,
      "max",
    );
    expect(gsapSetMock).toHaveBeenCalledWith(expect.any(HTMLElement), {
      opacity: 0,
    });
    expect(gsapFromToMock).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      { opacity: 0 },
      { opacity: 1, duration: 0.5, ease: "power1.inOut" },
    );
    expect(gsapToMock).toHaveBeenCalledWith(expect.any(HTMLElement), {
      opacity: 0,
      duration: 0.5,
      delay: 7,
      ease: "power1.inOut",
    });
  });

  it("animates the previous board post out and replaces keep-alive", () => {
    const onLocalKeepAliveStart = jest.fn();
    render(
      <DisplayBoardPostOverlay
        width={40}
        shouldAnimate
        prevKeepAliveKey="board-prev"
        prevKeepAliveMs={1200}
        onLocalKeepAliveStart={onLocalKeepAliveStart}
        boardPostStreamInfo={{
          author: "Current",
          text: "Current post",
          duration: 5,
        }}
        prevBoardPostStreamInfo={{
          author: "Previous",
          text: "Previous post",
          duration: 5,
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(onLocalKeepAliveStart).toHaveBeenCalledWith(
      "board-prev",
      1200,
      "replace",
    );
    expect(gsapFromToMock).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      { opacity: 1 },
      { opacity: 0, duration: 0.5, ease: "power1.inOut" },
    );
    expect(screen.getByText("Previous post")).toBeInTheDocument();
    expect(screen.getByText("Current post")).toBeInTheDocument();
  });

  it("uses default styling when overlay style fields are omitted", () => {
    render(
      <DisplayBoardPostOverlay
        width={50}
        boardPostStreamInfo={{
          author: "Alex",
          text: "  Default styles  ",
        }}
      />,
    );

    expect(screen.getByText("Default styles")).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("skips animation work when there is no text to show", () => {
    const onLocalKeepAliveStart = jest.fn();
    const { container } = render(
      <DisplayBoardPostOverlay
        width={30}
        shouldAnimate
        onLocalKeepAliveStart={onLocalKeepAliveStart}
        boardPostStreamInfo={{
          author: "Empty",
          text: "   ",
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

    expect(container).toBeEmptyDOMElement();
    expect(onLocalKeepAliveStart).not.toHaveBeenCalled();
    expect(gsapSetMock).not.toHaveBeenCalled();
  });
});
