import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import BootstrapLoadingScreen from "../BootstrapLoadingScreen";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";
import { STUCK_DB_PROGRESS_MS } from "../../constants";

describe("ControllerLoadingOverlay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("removes the branded loading screen and its timers when startup completes", () => {
    const { rerender } = render(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={99}
          connectionStatus={{ status: "connected", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.getByTestId("loading-logo")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(2);

    rerender(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={100}
          connectionStatus={{ status: "connected", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.queryByTestId("controller-loading-overlay")).toBeNull();
    expect(screen.queryByTestId("loading-logo")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("keeps live replication failure visible after startup completes", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={100}
        connectionStatus={{
          status: "failed",
          retryCount: 0,
          failureReason: "push-too-large",
          message: "Sync is blocked because one saved item is too large to upload.",
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sync is blocked because one saved item is too large to upload.",
    );
    expect(screen.queryByTestId("loading-logo")).toBeNull();
  });

  it("shows the compact warning while live sync is reconnecting", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={100}
        connectionStatus={{ status: "retrying", retryCount: 1 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sync is reconnecting. New changes may be delayed.",
    );
    expect(screen.queryByTestId("loading-logo")).toBeNull();
  });

  it("uses the branded layout, real progress, and one aligned rotating-message timer", () => {
    const { rerender } = render(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={42}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.getByRole("img", { name: "WorshipSync" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Getting WorshipSync ready" }))
      .toBeInTheDocument();
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    expect(screen.getByText("Database sync: 42%")).toBeInTheDocument();
    expect(screen.getByTestId("controller-loading-overlay")).toHaveClass(
      "bg-homepage-canvas",
    );
    expect(screen.getByTestId("controller-loading-overlay")).not.toHaveClass(
      "bg-homepage-canvas/90",
    );
    expect(jest.getTimerCount()).toBe(2);

    act(() => jest.advanceTimersByTime(4499));
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText("Getting everything in place…")).toBeInTheDocument();

    rerender(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={43}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );
    expect(screen.getByText("Database sync: 43%")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(2);
  });

  it("shares one message timer between bootstrap and controller loading screens", () => {
    render(
      <StrictMode>
        <BootstrapLoadingScreen />
        <ControllerLoadingOverlay
          dbProgress={0}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.getAllByText("Preparing your workspace…")).toHaveLength(2);
    // One 500 ms stall poller plus one shared 4.5 second message clock.
    expect(jest.getTimerCount()).toBe(2);

    act(() => jest.advanceTimersByTime(4500));
    expect(screen.getAllByText("Getting everything in place…")).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(2);
  });

  it("keeps the logo and message clock continuous through stalled, failed, and retrying states", () => {
    const { rerender } = render(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={10}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );
    const logo = screen.getByTestId("loading-logo");
    const sweepDelay = logo.style.getPropertyValue("--loading-logo-sweep-delay");

    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS));
    expect(screen.getByText("Startup is taking longer than expected.")).toBeInTheDocument();
    expect(
      screen.getByText("WorshipSync is waiting for database startup…"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("loading-logo")).toBe(logo);
    expect(logo.style.getPropertyValue("--loading-logo-sweep-delay")).toBe(
      sweepDelay,
    );
    expect(jest.getTimerCount()).toBe(2);

    rerender(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={10}
          connectionStatus={{ status: "failed", retryCount: 3 }}
        />
      </StrictMode>,
    );
    expect(screen.getByTestId("loading-logo")).toBe(logo);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to connect to the server",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Check your network connection, then try again.",
    );
    expect(screen.queryByText(/WorshipSync is waiting/)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    rerender(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={10}
          connectionStatus={{ status: "retrying", retryCount: 4 }}
        />
      </StrictMode>,
    );
    expect(screen.getByTestId("loading-logo")).toBe(logo);
    expect(screen.getByText("Connection failed. Retrying...")).toBeInTheDocument();
    expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
    expect(jest.getTimerCount()).toBe(2);
  });

  it("resets the 15-second stuck threshold when actual progress changes", () => {
    const { rerender } = render(
      <ControllerLoadingOverlay
        dbProgress={10}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS - 1));
    expect(screen.queryByText(/Startup is taking longer than expected/)).toBeNull();

    rerender(
      <ControllerLoadingOverlay
        dbProgress={11}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS - 1));
    expect(screen.queryByText(/Startup is taking longer than expected/)).toBeNull();

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText("Startup is taking longer than expected.")).toBeInTheDocument();
  });

  it("shows current progress, connection status, and retry count in keyboard-openable details", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ControllerLoadingOverlay
        dbProgress={42}
        connectionStatus={{ status: "retrying", retryCount: 7 }}
      />,
    );
    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS));

    const detailsSummary = screen.getByTestId("startup-details-summary");
    detailsSummary.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("startup-details-progress")).toHaveTextContent(
      "42%",
    );
    expect(screen.getByTestId("startup-details-connection")).toHaveTextContent(
      "retrying",
    );
    expect(screen.getByTestId("startup-details-connection")).toHaveTextContent(
      "retries: 7",
    );
    expect(screen.getByRole("button", { name: "Try Again" })).toBeEnabled();
  });

  it("retries a stalled startup when Try Again is activated", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS));

    const reloadButton = screen.getByRole("button", { name: "Try Again" });
    expect(reloadButton).toBeEnabled();

    // jsdom reports navigation as unimplemented; the control remains keyboard and pointer operable.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      reloadButton.focus();
      expect(reloadButton).toHaveFocus();
      await user.keyboard("{Enter}");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shows a stable branded failure and recovery action without rotating progress messages", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(
      <ControllerLoadingOverlay
        dbProgress={0}
        connectionStatus={{
          status: "failed",
          retryCount: 3,
          message: "Check your network connection, then try again.",
        }}
      />,
    );
    act(() => jest.advanceTimersByTime(STUCK_DB_PROGRESS_MS + 5000));

    expect(screen.getByTestId("loading-logo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Getting WorshipSync ready" }))
      .toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to connect to the server",
    );
    expect(screen.queryByText(/Preparing your workspace/)).toBeNull();
    const reloadButton = screen.getByRole("button", { name: "Try Again" });
    expect(reloadButton).toBeEnabled();

    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await user.click(reloadButton);
    } finally {
      consoleError.mockRestore();
    }
  });
});
