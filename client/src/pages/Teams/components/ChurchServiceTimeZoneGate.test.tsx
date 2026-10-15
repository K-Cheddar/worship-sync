import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ChurchServiceTimeZoneGate from "./ChurchServiceTimeZoneGate";

const mockTimeZoneValue = {
  status: "error" as "loading" | "ready" | "error",
  timeZone: null as string | null,
  isConfigured: false,
  legacyTimeZoneSuggestion: null,
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
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Service setup" })).not.toBeInTheDocument();
  });

  it("keeps children available with this church's last confirmed time zone during a failed refresh", () => {
    mockTimeZoneValue.timeZone = "America/New_York";
    mockTimeZoneValue.isConfigured = true;

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.getByText("Schedule editor")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/last confirmed time zone/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Service setup" })).not.toBeInTheDocument();
  });

  it("offers Service setup after the server confirms the church has no configured time zone", () => {
    mockTimeZoneValue.status = "ready";
    mockTimeZoneValue.timeZone = "UTC";

    render(
      <MemoryRouter>
        <ChurchServiceTimeZoneGate area="Schedules">
          <p>Schedule editor</p>
        </ChurchServiceTimeZoneGate>
      </MemoryRouter>,
    );

    expect(screen.queryByText("Schedule editor")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Service setup" })).toHaveAttribute(
      "href",
      "/teams-and-services/service-setup",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
