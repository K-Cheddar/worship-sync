import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FullscreenPresentation from "./FullscreenPresentation";

let displayWindowProps: any = null;

jest.mock("../components/DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: (props: any) => {
    displayWindowProps = props;
    return <div data-testid="display-window-mock" />;
  },
}));

describe("FullscreenPresentation", () => {
  beforeEach(() => {
    displayWindowProps = null;
    (window as any).electronAPI = {
      isElectron: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it("uses full monitor layout for monitor screens", async () => {
    render(
      <MemoryRouter>
        <FullscreenPresentation
          displayInfo={{
            displayType: "monitor",
            slide: { boxes: [{ words: "Current" }] },
            nextSlide: { boxes: [{ words: "Next" }] },
            bibleInfoBox: { words: "Reference" },
            transitionDirection: "next",
            localVideoInput: {
              sourceId: "source-1",
              deviceLabel: "USB Capture",
              ownerDeviceId: "workstation-1",
              ownerLabel: "Booth",
            },
          } as any}
          prevDisplayInfo={{
            displayType: "monitor",
            slide: { boxes: [{ words: "Previous" }] },
            nextSlide: { boxes: [{ words: "Prev Next" }] },
            localVideoInput: {
              sourceId: "source-previous",
              deviceLabel: "Previous USB Capture",
              ownerDeviceId: "workstation-1",
              ownerLabel: "Booth",
            },
          } as any}
          timerInfo={{ id: "timer-1" } as any}
          prevTimerInfo={{ id: "timer-2" } as any}
        />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(displayWindowProps?.monitorLayoutMode).toBe("full-monitor")
    );
    expect(displayWindowProps.displayType).toBe("monitor");
    expect(displayWindowProps.canCaptureLocalVideo).toBe(true);
    expect(displayWindowProps.localVideoInput?.sourceId).toBe("source-1");
    expect(displayWindowProps.prevLocalVideoInput?.sourceId).toBe(
      "source-previous",
    );
    expect(displayWindowProps.nextBoxes).toEqual([{ words: "Next" }]);
    expect(displayWindowProps.prevNextBoxes).toEqual([{ words: "Prev Next" }]);
    expect(displayWindowProps.bibleInfoBox).toEqual({ words: "Reference" });
    expect(displayWindowProps.transitionDirection).toBe("next");
  });

  it("keeps projector screens on content-only layout", async () => {
    render(
      <MemoryRouter>
        <FullscreenPresentation
          displayInfo={{
            displayType: "projector",
            slide: { boxes: [{ words: "Projected" }] },
          } as any}
          prevDisplayInfo={{
            displayType: "projector",
            slide: { boxes: [{ words: "Projected Prev" }] },
          } as any}
        />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(displayWindowProps?.monitorLayoutMode).toBe("content-only")
    );
    expect(displayWindowProps.displayType).toBe("projector");
    expect(displayWindowProps).not.toHaveProperty("playLocalVideoAudio");
  });
});

describe("headless screens", () => {
  beforeEach(() => {
    displayWindowProps = null;
    // Outside Electron the fullscreen gate is what a windowed screen shows.
    delete (window as any).electronAPI;
  });

  const info = {
    displayType: "monitor",
    slide: { boxes: [{ words: "Current" }] },
  } as any;

  it("shows the fullscreen gate on a windowed screen", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentation displayInfo={info} prevDisplayInfo={info} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("display-window-mock")).not.toBeInTheDocument();
    expect(screen.getByText(/Click to go Fullscreen/)).toBeInTheDocument();
  });

  it("renders bare output when the screen is headless", () => {
    render(
      <MemoryRouter>
        <FullscreenPresentation
          isHeadless
          displayInfo={info}
          prevDisplayInfo={info}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("display-window-mock")).toBeInTheDocument();
    expect(screen.queryByText(/Click to go Fullscreen/)).not.toBeInTheDocument();
  });
});
