import { render, screen, waitFor } from "@testing-library/react";
import StreamInfo from "./StreamInfo";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

jest.mock("../hooks/useDisplayedUpcomingService", () => ({
  __esModule: true,
  default: (services: Array<{ id: string; name: string }>) =>
    services[0]
      ? {
          service: services[0],
          nextAt: new Date("2026-05-15T10:00:00.000Z"),
        }
      : null,
}));

jest.mock("../hooks/useNextServiceCountdownText", () => ({
  __esModule: true,
  default: () => "1:00",
}));

jest.mock("../components/StreamInfo/StreamInfo", () => ({
  __esModule: true,
  default: ({
    upcomingService,
    timeText,
  }: {
    upcomingService?: { name?: string } | null;
    timeText: string | null;
  }) => (
    <div data-testid="stream-info">
      {upcomingService?.name ?? "none"} - {timeText ?? "none"}
    </div>
  ),
}));

describe("StreamInfo page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [],
          },
        },
      },
    };
  });

  it("renders from shared redux service times", () => {
    mockState.undoable.present.serviceTimes.list = [
      {
        id: "service-1",
        name: "Sunday 9 AM",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-05-15T10:00:00.000Z",
      },
    ];

    render(<StreamInfo />);

    expect(screen.getByTestId("stream-info")).toHaveTextContent(
      "Sunday 9 AM - 1:00",
    );
  });

  it("clears expired overrides from shared redux service times", async () => {
    mockState.undoable.present.serviceTimes.list = [
      {
        id: "service-2",
        name: "Override Service",
        timerType: "countdown",
        reccurence: "one_time",
        dateTimeISO: "2026-05-15T11:00:00.000Z",
        overrideDateTimeISO: "2026-05-15T09:00:00.000Z",
      },
    ];

    render(<StreamInfo />);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "serviceTimes/updateService",
          payload: {
            id: "service-2",
            changes: { overrideDateTimeISO: undefined },
          },
        }),
      );
    });
  });
});
