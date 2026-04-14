import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";
import { STUCK_DB_PROGRESS_MS } from "../../constants";

describe("ControllerLoadingOverlay", () => {
  const reloadMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    reloadMock.mockReset();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders nothing when dbProgress is 100", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={100}
        connectionStatus={{ status: "connected", retryCount: 0 }}
      />,
    );
    expect(screen.queryByText(/Worship/)).not.toBeInTheDocument();
  });

  it("stays on normal welcome copy while progress keeps moving before 15s elapse", () => {
    const { rerender } = render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
        user="Pat"
      />,
    );
    expect(screen.getByText("Pat")).toBeInTheDocument();
    expect(
      screen.queryByText(/Startup is taking longer than expected/),
    ).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    rerender(
      <ControllerLoadingOverlay
        dbProgress={1}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
        user="Pat"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    rerender(
      <ControllerLoadingOverlay
        dbProgress={2}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
        user="Pat"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(
      screen.queryByText(/Startup is taking longer than expected/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Pat")).toBeInTheDocument();
  });

  it("shows stuck recovery after 15s with no progress change", async () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(
      await screen.findByText(/Startup is taking longer than expected/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try Again" }),
    ).toBeInTheDocument();
  });

  it("clears stuck state when dbProgress changes and resets the timer", async () => {
    const { rerender } = render(
      <ControllerLoadingOverlay
        dbProgress={10}
        connectionStatus={{ status: "connected", retryCount: 0 }}
        user="Alex"
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(
      await screen.findByText(/Startup is taking longer than expected/),
    ).toBeInTheDocument();

    rerender(
      <ControllerLoadingOverlay
        dbProgress={11}
        connectionStatus={{ status: "connected", retryCount: 0 }}
        user="Alex"
      />,
    );
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(
      screen.queryByText(/Startup is taking longer than expected/),
    ).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS - 1);
    });
    expect(
      screen.queryByText(/Startup is taking longer than expected/),
    ).not.toBeInTheDocument();
  });

  it("shows failed UI instead of stuck when connectionStatus is failed", async () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{ status: "failed", retryCount: 3 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS + 5_000);
    });
    expect(screen.getByText(/Unable to connect to the server/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Startup is taking longer than expected/),
    ).not.toBeInTheDocument();
  });

  it("shows retrying line alongside stuck recovery when status is retrying", async () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={5}
        connectionStatus={{ status: "retrying", retryCount: 2 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    expect(
      await screen.findByText(/Startup is taking longer than expected/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Connection failed\. Retrying\.\.\./),
    ).toBeInTheDocument();
  });

  it("renders details with current progress and connection status", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ControllerLoadingOverlay
        dbProgress={42}
        connectionStatus={{ status: "retrying", retryCount: 7 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    await screen.findByText(/Startup is taking longer than expected/);

    await user.click(screen.getByText("Show details"));
    expect(screen.getByTestId("startup-details-progress")).toHaveTextContent(
      "42%",
    );
    expect(screen.getByTestId("startup-details-connection")).toHaveTextContent(
      "retrying",
    );
    expect(screen.getByTestId("startup-details-connection")).toHaveTextContent(
      "retries: 7",
    );
  });

  it("Try Again triggers window.location.reload", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS);
    });
    await screen.findByText(/Startup is taking longer than expected/);
    await user.click(screen.getByRole("button", { name: "Try Again" }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
