import { render } from "@testing-library/react";
import { useGSAP } from "@gsap/react";
import DisplayBoardPostOverlay from "../DisplayBoardPostOverlay";

const gsapSetMock = jest.fn();
const gsapFromToMock = jest.fn();
const gsapToMock = jest.fn();
const timelineMock = {
  fromTo: (...args: any[]) => {
    gsapFromToMock(...args);
    return timelineMock;
  },
  to: (...args: any[]) => {
    gsapToMock(...args);
    return timelineMock;
  },
  clear: jest.fn(),
};

jest.mock("gsap", () => ({
  __esModule: true,
  default: {
    set: (...args: any[]) => gsapSetMock(...args),
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
    render(
      <DisplayBoardPostOverlay
        width={30}
        shouldAnimate
        boardPostStreamInfo={{
          author: "Taylor",
          authorHexColor: "#e7e5e4",
          text: "How can we pray this week?",
          duration: 7,
        }}
      />,
    );

    gsapCallbacks.forEach((cb) => cb());

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
});
