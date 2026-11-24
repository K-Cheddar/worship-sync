import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import BootstrapLoadingScreen from "../BootstrapLoadingScreen";
import ControllerLoadingOverlay from "./ControllerLoadingOverlay";
import { SLOW_STARTUP_MESSAGE_DELAY_MS } from "../../constants";
import type { ControllerStartupInfo } from "../../context/controllerInfo";

const makeStartupInfo = (
  overrides: Partial<ControllerStartupInfo> = {},
): ControllerStartupInfo => {
  const now = Date.now();
  return {
    stage: "connecting-to-server",
    startedAt: now,
    lastMeaningfulActivityAt: now,
    failure: null,
    ...overrides,
  };
};

describe("ControllerLoadingOverlay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps a healthy 0% startup loading without a prominent retry action", () => {
    render(
      <StrictMode>
        <ControllerLoadingOverlay
          dbProgress={0}
          startupInfo={makeStartupInfo()}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.getByText("Database sync: 0%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reload|try again/i })).toBeNull();
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS));
    expect(
      screen.getByText(
        "This is taking a little longer than usual. Please keep this window open while WorshipSync gets everything ready.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Database sync: 0%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reload|try again/i })).toBeNull();
  });

  it("uses indeterminate progress when replication progress is unknown", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={null}
        startupInfo={makeStartupInfo()}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS));

    fireEvent.click(screen.getByTestId("startup-details-summary"));
    expect(screen.getByTestId("startup-details-progress")).toHaveTextContent(
      "Not yet measurable",
    );
    expect(screen.queryByText(/Database sync: 0%/)).toBeNull();
  });

  it("keeps valid progress visible during slow startup", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={42}
        startupInfo={makeStartupInfo({ stage: "synchronizing-database-content" })}
        connectionStatus={{ status: "connected", retryCount: 0 }}
      />,
    );
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS));

    expect(screen.getByText("Database sync: 42%")).toBeInTheDocument();
    expect(screen.getByTestId("startup-stage")).toHaveTextContent(
      "Synchronizing database content",
    );
  });

  it("clears the slow-startup note when delayed initialization succeeds", () => {
    const connectionStatus = { status: "connected" as const, retryCount: 0 };
    const { rerender } = render(
      <ControllerLoadingOverlay
        dbProgress={0}
        startupInfo={makeStartupInfo()}
        connectionStatus={connectionStatus}
      />,
    );
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS));
    expect(screen.getByText(/taking a little longer/)).toBeInTheDocument();

    rerender(
      <ControllerLoadingOverlay
        dbProgress={100}
        startupInfo={makeStartupInfo({ stage: "completed" })}
        connectionStatus={connectionStatus}
      />,
    );
    expect(screen.queryByTestId("controller-loading-overlay")).toBeNull();
    expect(screen.queryByText(/taking a little longer/)).toBeNull();
    expect(screen.queryByRole("button", { name: /reload|try again/i })).toBeNull();
  });

  it("resets slow messaging on replication activity even when rounded progress is unchanged", () => {
    let publishActivity: ((activityAt: number) => void) | undefined;
    const subscribeToStartupActivity = (listener: (activityAt: number) => void) => {
      publishActivity = listener;
      return () => {
        publishActivity = undefined;
      };
    };
    render(
      <ControllerLoadingOverlay
        dbProgress={42}
        startupInfo={makeStartupInfo()}
        subscribeToStartupActivity={subscribeToStartupActivity}
        connectionStatus={{ status: "connected", retryCount: 0 }}
      />,
    );

    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS - 1));
    act(() => publishActivity?.(Date.now()));
    expect(screen.queryByText(/taking a little longer/)).toBeNull();
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS - 1));
    expect(screen.queryByText(/taking a little longer/)).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByText(/taking a little longer/)).toBeInTheDocument();
    expect(screen.getByText("Database sync: 42%")).toBeInTheDocument();
  });

  it("explains automatic reconnection without offering a reload", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={null}
        startupInfo={makeStartupInfo({ stage: "reconnecting" })}
        connectionStatus={{ status: "retrying", retryCount: 3 }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Reconnecting to the server… WorshipSync will automatically try again.",
    );
    expect(screen.getByTestId("startup-details-summary")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("startup-details-summary"));
    expect(screen.getByTestId("startup-details-connection")).toHaveTextContent(
      "retrying (retries: 3)",
    );
    act(() => jest.advanceTimersByTime(SLOW_STARTUP_MESSAGE_DELAY_MS * 2));
    expect(screen.queryByRole("button", { name: /reload|try again/i })).toBeNull();
  });

  it("shows a recovery action only for a confirmed local database failure", () => {
    render(
      <ControllerLoadingOverlay
        dbProgress={null}
        startupInfo={makeStartupInfo({
          stage: "failed",
          failure: {
            kind: "local-storage",
            message: "WorshipSync couldn't open the local database.",
            diagnostic: "IndexedDBError",
          },
        })}
        connectionStatus={{ status: "connecting", retryCount: 0 }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't open the local database",
    );
    expect(screen.getByRole("button", { name: "Reload WorshipSync" })).toBeEnabled();
  });

  it("keeps post-startup connection warnings non-blocking", () => {
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

  it("keeps the logo and shared message rotation continuous across startup states", () => {
    const { rerender } = render(
      <StrictMode>
        <BootstrapLoadingScreen />
        <ControllerLoadingOverlay
          dbProgress={null}
          startupInfo={makeStartupInfo()}
          connectionStatus={{ status: "connecting", retryCount: 0 }}
        />
      </StrictMode>,
    );
    const logo = screen.getAllByTestId("loading-logo")[1];
    expect(screen.getAllByText("Preparing your workspace…")).toHaveLength(2);

    act(() => jest.advanceTimersByTime(4500));
    expect(screen.getAllByText("Getting everything in place…")).toHaveLength(2);
    rerender(
      <StrictMode>
        <BootstrapLoadingScreen />
        <ControllerLoadingOverlay
          dbProgress={null}
          startupInfo={makeStartupInfo({ stage: "synchronizing-database-content" })}
          connectionStatus={{ status: "connected", retryCount: 0 }}
        />
      </StrictMode>,
    );

    expect(screen.getAllByTestId("loading-logo")[1]).toBe(logo);
    expect(screen.getByTestId("startup-stage")).toHaveTextContent(
      "Synchronizing database content",
    );
  });
});
