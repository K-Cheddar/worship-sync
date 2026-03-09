import { fireEvent, render, screen } from "@testing-library/react";
import QuickLink from "../QuickLink";

const mockDispatch = jest.fn();
const mockClearMonitor = jest.fn(() => ({ type: "presentation/clearMonitor" }));
const mockClearProjector = jest.fn(() => ({ type: "presentation/clearProjector" }));
const mockClearStream = jest.fn(() => ({ type: "presentation/clearStream" }));
const mockUpdateProjector = jest.fn((payload: any) => ({
  type: "presentation/updateProjector",
  payload,
}));
const mockUpdateMonitor = jest.fn((payload: any) => ({
  type: "presentation/updateMonitor",
  payload,
}));
const mockUpdateStream = jest.fn((payload: any) => ({
  type: "presentation/updateStream",
  payload,
}));
const mockUpdateBibleDisplayInfo = jest.fn((payload: any) => ({
  type: "presentation/updateBibleDisplayInfo",
  payload,
}));
const mockUpdateParticipantOverlayInfo = jest.fn((payload: any) => ({
  type: "presentation/updateParticipantOverlayInfo",
  payload,
}));
const mockUpdateStbOverlayInfo = jest.fn((payload: any) => ({
  type: "presentation/updateStbOverlayInfo",
  payload,
}));
const mockUpdateImageOverlayInfo = jest.fn((payload: any) => ({
  type: "presentation/updateImageOverlayInfo",
  payload,
}));
const mockUpdateQrCodeOverlayInfo = jest.fn((payload: any) => ({
  type: "presentation/updateQrCodeOverlayInfo",
  payload,
}));
const mockSetMonitorTimerId = jest.fn((payload: string | null) => ({
  type: "preferences/setMonitorTimerId",
  payload,
}));

jest.mock("../../../hooks", () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock("../../../store/presentationSlice", () => ({
  clearMonitor: () => mockClearMonitor(),
  clearProjector: () => mockClearProjector(),
  clearStream: () => mockClearStream(),
  updateProjector: (payload: any) => mockUpdateProjector(payload),
  updateMonitor: (payload: any) => mockUpdateMonitor(payload),
  updateStream: (payload: any) => mockUpdateStream(payload),
  updateBibleDisplayInfo: (payload: any) => mockUpdateBibleDisplayInfo(payload),
  updateParticipantOverlayInfo: (payload: any) =>
    mockUpdateParticipantOverlayInfo(payload),
  updateStbOverlayInfo: (payload: any) => mockUpdateStbOverlayInfo(payload),
  updateImageOverlayInfo: (payload: any) => mockUpdateImageOverlayInfo(payload),
  updateQrCodeOverlayInfo: (payload: any) => mockUpdateQrCodeOverlayInfo(payload),
}));

jest.mock("../../../store/preferencesSlice", () => ({
  setMonitorTimerId: (payload: string | null) => mockSetMonitorTimerId(payload),
}));

jest.mock("../../DisplayWindow/DisplayWindow", () => ({
  __esModule: true,
  default: () => <div data-testid="quick-link-preview" />,
}));

describe("QuickLink", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets monitor timerId when clicking a timer quick link", () => {
    const presentationInfo = {
      type: "slide",
      name: "Main Timer",
      timerId: "timer-1",
      slide: null,
      displayType: "monitor",
    } as any;

    render(
      <QuickLink
        label="Timer Link"
        displayType="monitor"
        presentationInfo={presentationInfo}
        timers={[]}
      />
    );

    fireEvent.click(screen.getByRole("button"));

    expect(mockUpdateMonitor).toHaveBeenCalledWith(presentationInfo);
    expect(mockSetMonitorTimerId).toHaveBeenCalledWith("timer-1");
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "preferences/setMonitorTimerId",
      payload: "timer-1",
    });
  });

  it("returns null when there is no presentationInfo and no action", () => {
    const { container } = render(
      <QuickLink label="Empty" displayType="stream" timers={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("dispatches clear action by display type", () => {
    const { rerender } = render(
      <QuickLink label="Clear stream" displayType="stream" action="clear" timers={[]} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockClearStream).toHaveBeenCalled();

    rerender(
      <QuickLink label="Clear monitor" displayType="monitor" action="clear" timers={[]} />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockClearMonitor).toHaveBeenCalled();

    rerender(
      <QuickLink
        label="Clear projector"
        displayType="projector"
        action="clear"
        timers={[]}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockClearProjector).toHaveBeenCalled();
  });

  it("updates projector presentation payload", () => {
    const presentationInfo = {
      type: "song",
      name: "Projected Song",
      slide: { id: "s1", boxes: [] },
      displayType: "projector",
    } as any;
    render(
      <QuickLink
        label="Projector Link"
        displayType="projector"
        presentationInfo={presentationInfo}
        timers={[]}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockUpdateProjector).toHaveBeenCalledWith(presentationInfo);
  });

  it("updates stream and applies bible payload precedence", () => {
    const presentationInfo = {
      type: "stream",
      name: "Stream Bible",
      slide: { id: "s1", boxes: [] },
      displayType: "stream",
      bibleDisplayInfo: { title: "John 3", text: "For God so loved" },
      imageOverlayInfo: { id: "img-1", imageUrl: "https://img.jpg" },
    } as any;
    render(
      <QuickLink
        label="Stream Link"
        displayType="stream"
        presentationInfo={presentationInfo}
        timers={[]}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockUpdateStream).toHaveBeenCalledWith(presentationInfo);
    expect(mockUpdateBibleDisplayInfo).toHaveBeenCalledWith(
      presentationInfo.bibleDisplayInfo
    );
    expect(mockUpdateImageOverlayInfo).not.toHaveBeenCalled();
  });

  it("dispatches stream clear payload when presentation has no slide", () => {
    const presentationInfo = {
      type: "participant",
      name: "No slide",
      slide: null,
      displayType: "stream",
      participantOverlayInfo: { id: "p1", name: "Alex" },
    } as any;
    render(
      <QuickLink
        label="Stream no slide"
        displayType="stream"
        presentationInfo={presentationInfo}
        timers={[]}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(mockUpdateStream).toHaveBeenCalledWith({
      slide: null,
      type: "clear",
      name: "",
    });
    expect(mockUpdateParticipantOverlayInfo).toHaveBeenCalledWith(
      presentationInfo.participantOverlayInfo
    );
  });
});
