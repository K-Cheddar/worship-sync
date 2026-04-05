import { render, waitFor } from "@testing-library/react";
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
          } as any}
          prevDisplayInfo={{
            displayType: "monitor",
            slide: { boxes: [{ words: "Previous" }] },
            nextSlide: { boxes: [{ words: "Prev Next" }] },
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
  });
});
