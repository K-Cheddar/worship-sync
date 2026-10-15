import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChurchServiceTimeZoneGate from "./ChurchServiceTimeZoneGate";

const mockTimeZoneValue = {
  status: "error" as "loading" | "ready" | "error",
  timeZone: null as string | null,
  isConfigured: false,
  legacyTimeZoneSuggestion: null,
  refreshIssue: null as { kind: "unavailable" | "authentication" | "permission" | "configuration"; since: number } | null,
  refresh: jest.fn().mockResolvedValue(undefined),
};

jest.mock("../../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => mockTimeZoneValue,
}));

describe("ChurchServiceTimeZoneGate", () => {
  beforeEach(() => {
    mockTimeZoneValue.status = "error";
    mockTimeZoneValue.timeZone = null;
    mockTimeZoneValue.isConfigured = false;
    mockTimeZoneValue.refreshIssue = { kind: "unavailable", since: Date.now() };
    mockTimeZoneValue.refresh.mockClear();
  });

  it("blocks date-dependent children when no church time zone has loaded", () => {
    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Schedule editor")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/date-based Schedules actions are unavailable/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Service setup" })).not.toBeInTheDocument();
  });

  it("keeps children available without a warning after a transient failure with a confirmed church time zone", () => {
    mockTimeZoneValue.status = "ready";
    mockTimeZoneValue.timeZone = "America/New_York";
    mockTimeZoneValue.isConfigured = true;
    mockTimeZoneValue.refreshIssue = { kind: "unavailable", since: Date.now() };

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.getByText("Schedule editor")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows a small status after a prolonged refresh outage without blocking children or offering retry", async () => {
    mockTimeZoneValue.status = "ready";
    mockTimeZoneValue.timeZone = "America/New_York";
    mockTimeZoneValue.isConfigured = true;
    mockTimeZoneValue.refreshIssue = { kind: "unavailable", since: Date.now() - 6 * 60_000 };

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent(/last confirmed church time zone is still in use/i);
    expect(screen.getByText("Schedule editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps actionable setup guidance for a confirmed unconfigured church", () => {
    mockTimeZoneValue.status = "ready";
    mockTimeZoneValue.refreshIssue = null;

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Schedule editor")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/choose a church time zone/i);
    expect(screen.getByRole("link", { name: "Open Service setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("reports permission failures separately while retaining usable cached schedules", () => {
    mockTimeZoneValue.status = "ready";
    mockTimeZoneValue.timeZone = "America/New_York";
    mockTimeZoneValue.isConfigured = true;
    mockTimeZoneValue.refreshIssue = { kind: "permission", since: Date.now() };

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/ask a church administrator to check your access/i);
    expect(screen.getByText("Schedule editor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
