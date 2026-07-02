import { fireEvent, render, screen } from "@testing-library/react";
import TimeAdjuster from "./TimeAdjuster";
import { setServerTimeOffset } from "../../utils/serverTime";

const mockDispatch = jest.fn();
let mockState: any;

jest.mock("../../hooks", () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) => selector(mockState),
}));

describe("TimeAdjuster", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    setServerTimeOffset(90_000);
    mockDispatch.mockClear();
    mockState = {
      undoable: {
        present: {
          serviceTimes: {
            list: [
              {
                id: "service-1",
                name: "Sunday Service",
                timerType: "countdown",
                reccurence: "one_time",
                dateTimeISO: "2026-01-01T13:00:00.000Z",
              },
            ],
          },
        },
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    setServerTimeOffset(0);
  });

  it("sets exact remaining time from the Firebase-aligned clock", () => {
    render(<TimeAdjuster serviceId="service-1" />);

    fireEvent.change(screen.getByLabelText("Minutes"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set to 10:00" }));

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "serviceTimes/updateService",
        payload: {
          id: "service-1",
          changes: {
            overrideDateTimeISO: "2026-01-01T12:11:30.000Z",
          },
        },
      }),
    );
  });
});
