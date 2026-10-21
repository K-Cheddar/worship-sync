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

  it("does not show a refresh warning after a prolonged outage when a confirmed time zone is available", () => {
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

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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

  it.each(["authentication", "permission", "configuration"] as const)(
    "shows a non-blocking %s refresh notice with a confirmed time zone",
    (kind) => {
      mockTimeZoneValue.status = "ready";
      mockTimeZoneValue.timeZone = "America/New_York";
      mockTimeZoneValue.isConfigured = true;
      mockTimeZoneValue.refreshIssue = { kind, since: Date.now() };

      render(
        <MemoryRouter>
          <ChurchServiceTimeZoneGate area="Schedules">
            <p>Schedule editor</p>
          </ChurchServiceTimeZoneGate>
        </MemoryRouter>,
      );

      expect(screen.getByText("Schedule editor")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(/confirmed church time zone is still available/i);
      expect(screen.getByRole("status")).toHaveTextContent(/could not be checked|needs a valid sign-in|could not be read/i);
      expect(Boolean(screen.queryByRole("button", { name: "Retry" }))).toBe(kind !== "configuration");
    },
  );
});
