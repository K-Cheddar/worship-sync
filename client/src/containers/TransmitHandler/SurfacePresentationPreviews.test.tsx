import { render, screen } from "@testing-library/react";
import ProjectorPresentationPreview from "./ProjectorPresentationPreview";
import MonitorPresentationPreview from "./MonitorPresentationPreview";
import StreamPresentationPreview from "./StreamPresentationPreview";

const mockState = {
  presentation: {
    projectorInfo: {
      name: "Proj Song",
      displayType: "projector",
      timerId: null,
      slide: null,
    },
    prevProjectorInfo: { name: "", timerId: null, slide: null },
    isProjectorTransmitting: true,
    monitorInfo: {
      name: "Mon Song",
      displayType: "monitor",
      timerId: null,
      slide: null,
    },
    prevMonitorInfo: { name: "", timerId: null, slide: null },
    isMonitorTransmitting: false,
    monitorBoardAliasId: "",
    streamInfo: {
      name: "Stream Song",
      displayType: "stream",
      timerId: null,
      slide: null,
      participantOverlayInfo: { id: "p1", name: "Alex", time: 1 },
    },
    prevStreamInfo: { name: "", timerId: null, slide: null },
    isStreamTransmitting: true,
    streamItemContentBlocked: true,
  },
  timers: { timers: [] },
};

let lastPreviewProps: Record<string, unknown> | null = null;

jest.mock("../../hooks", () => ({
  useSelector: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));

jest.mock("../../components/Presentation/PresentationPreview", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    lastPreviewProps = props;
    return (
      <div
        data-testid={`presentation-preview-${String(props.name).toLowerCase()}`}
        data-transmitting={props.isTransmitting ? "true" : "false"}
        data-hide-quick-links={props.hideQuickLinks ? "true" : "false"}
        data-item-blocked={props.streamItemContentBlocked ? "true" : "false"}
        data-show-monitor-clock={props.showMonitorClockTimer ? "true" : "false"}
      />
    );
  },
}));

jest.mock("../../boards/ScaledBoardPreview", () => ({
  __esModule: true,
  default: () => <div data-testid="scaled-board-preview-mock" />,
}));

describe("TransmitHandler surface previews", () => {
  const toggle = jest.fn();

  beforeEach(() => {
    lastPreviewProps = null;
    toggle.mockReset();
    mockState.presentation.monitorBoardAliasId = "";
    mockState.presentation.streamItemContentBlocked = true;
  });

  it("wires projector Redux state into PresentationPreview", () => {
    render(
      <ProjectorPresentationPreview
        quickLinks={[]}
        toggleIsTransmitting={toggle}
      />,
    );

    expect(screen.getByTestId("presentation-preview-projector")).toHaveAttribute(
      "data-transmitting",
      "true",
    );
    expect(lastPreviewProps?.info).toEqual(mockState.presentation.projectorInfo);
    expect(lastPreviewProps?.name).toBe("Projector");
  });

  it("wires monitor Redux state and shows monitor clock/timer band flag", () => {
    render(
      <MonitorPresentationPreview
        quickLinks={[]}
        toggleIsTransmitting={toggle}
        readOnly
      />,
    );

    const preview = screen.getByTestId("presentation-preview-monitor");
    expect(preview).toHaveAttribute("data-transmitting", "false");
    expect(preview).toHaveAttribute("data-show-monitor-clock", "true");
    expect(preview).toHaveAttribute("data-hide-quick-links", "true");
    expect(lastPreviewProps?.info).toEqual(mockState.presentation.monitorInfo);
  });

  it("wires stream overlay-only blocked flag and hides quick links in overlay focus", () => {
    render(
      <StreamPresentationPreview
        quickLinks={[{ id: "q1", label: "Link", action: "clear" } as never]}
        toggleIsTransmitting={toggle}
        variant="overlayStreamFocus"
        showFocusedStreamControls
      />,
    );

    const preview = screen.getByTestId("presentation-preview-stream");
    expect(preview).toHaveAttribute("data-transmitting", "true");
    expect(preview).toHaveAttribute("data-item-blocked", "true");
    expect(preview).toHaveAttribute("data-hide-quick-links", "true");
    expect(lastPreviewProps?.info).toEqual(mockState.presentation.streamInfo);
  });
});
