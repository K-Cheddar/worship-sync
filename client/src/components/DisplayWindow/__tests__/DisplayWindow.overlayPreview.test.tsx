import { render, screen } from "@testing-library/react";
import DisplayWindow from "../DisplayWindow";

const mockMonitorSettings = {
  showClock: false,
  showTimer: false,
  clockFontSize: 15,
  timerFontSize: 15,
};

jest.mock("../../../hooks", () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      undoable: {
        present: {
          preferences: { monitorSettings: mockMonitorSettings },
        },
      },
    }),
}));

describe("DisplayWindow overlay preview mode", () => {
  it("renders only participant overlay when only participantOverlayInfo is passed in overlayPreviewMode", () => {
    render(
      <DisplayWindow
        displayType="stream"
        overlayPreviewMode
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Alice",
          title: "Host",
          event: "Sunday Service",
          duration: 5,
          formatting: {},
        }}
      />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Sunday Service")).toBeInTheDocument();
  });

  it("uses fill wrapper (inset 0, full size) when overlayPreviewMode is true", () => {
    const { container } = render(
      <DisplayWindow
        displayType="stream"
        overlayPreviewMode
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Bob",
          formatting: {},
        }}
      />
    );
    const fillWrapper = container.querySelector(
      '[style*="inset: 0px"], [style*="inset: 0"]'
    );
    expect(fillWrapper).toBeInTheDocument();
    expect((fillWrapper as HTMLElement)?.style?.width).toBe("100%");
    expect((fillWrapper as HTMLElement)?.style?.height).toBe("100%");
  });

  it("does not render participant overlay when participantOverlayInfo is undefined in overlayPreviewMode", () => {
    render(
      <DisplayWindow
        displayType="stream"
        overlayPreviewMode
        stbOverlayInfo={{
          id: "s1",
          type: "stick-to-bottom",
          heading: "Welcome",
          subHeading: "Guest",
          duration: 3,
          formatting: {},
        }}
      />
    );
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("renders only the overlay type that has info in overlayPreviewMode", () => {
    const { container } = render(
      <DisplayWindow
        displayType="stream"
        overlayPreviewMode
        participantOverlayInfo={{
          id: "p1",
          type: "participant",
          name: "Solo",
          formatting: {},
        }}
      />
    );
    expect(screen.getByText("Solo")).toBeInTheDocument();
    const overlayWrappers = container.querySelectorAll(
      '[style*="position: absolute"]'
    );
    expect(overlayWrappers.length).toBeGreaterThan(0);
  });
});
