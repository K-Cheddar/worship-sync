import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TeamService } from "../../../api/authTypes";
import { setServerTimeOffset } from "../../../utils/serverTime";
import { getTeamAvailabilityManagementData } from "../../../api/auth";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsFormsPage from "./TeamsFormsPage";

const mockChurchServiceTimeZone = {
  status: "ready" as "loading" | "ready" | "error",
  timeZone: "America/New_York" as string | null,
  isConfigured: true,
  legacyTimeZoneSuggestion: null,
  refreshIssue: null as { kind: "unavailable" | "authentication" | "permission" | "configuration"; since: number } | null,
  refresh: jest.fn().mockResolvedValue(undefined),
};

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => mockChurchServiceTimeZone,
}));
jest.mock("../../../api/auth", () => ({ getTeamAvailabilityManagementData: jest.fn() }));
jest.mock("../components/RangeSelector", () => ({
  __esModule: true,
  default: ({ range }: { range: { start: string; end: string } }) => (
    <output>{`${range.start}:${range.end}`}</output>
  ),
}));
jest.mock("../managers/IntakeManager", () => ({
  __esModule: true,
  default: ({
    listHeader,
    availabilityOnly,
    managedTeamIds,
    forms,
    displayForms,
    submissions,
    positions,
    schedules,
  }: {
    listHeader: ReactNode;
    availabilityOnly?: boolean;
    managedTeamIds?: string[];
    forms: { formId: string }[];
    displayForms?: { formId: string }[];
    submissions: unknown[];
    positions?: { positionId: string; teamId: string }[];
    schedules?: { scheduleId: string; teamId: string }[];
  }) => <><output data-testid="intake-manager-mode">{availabilityOnly ? `availability:${managedTeamIds?.join(",")}:forms=${forms.length}:submissions=${submissions.length}` : "intake"}</output><output data-testid="displayed-form-count">{displayForms?.length ?? forms.length}</output><output data-testid="authorized-scope-metadata">{`${positions?.map(({ positionId }) => positionId).join(",") || ""}|${schedules?.map(({ scheduleId }) => scheduleId).join(",") || ""}`}</output>{listHeader}</>,
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetTeamAvailabilityManagementData = jest.mocked(getTeamAvailabilityManagementData);

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
  jest.clearAllMocks();
  mockChurchServiceTimeZone.status = "ready";
  mockChurchServiceTimeZone.timeZone = "America/New_York";
  mockChurchServiceTimeZone.isConfigured = true;
  mockChurchServiceTimeZone.refreshIssue = null;
});

describe("TeamsFormsPage period selection", () => {
  it("uses the server instant when it crosses into the next month", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T23:30:00-04:00"));
    setServerTimeOffset(2 * 60 * 60 * 1000);
    const service: TeamService = {
      id: "late-october",
      serviceId: "late-october",
      churchId: "church-1",
      name: "Late October service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: new Date("2026-10-31T23:45:00-04:00").toISOString(),
    };
    mockUseTeamsPage.mockReturnValue({
      pageData: {
        services: [service],
        intakeForms: [],
        intakeSubmissions: [],
        intakeRecipients: [],
        smsEligibilityByMemberId: {},
        smsDeliveryAttempts: [],
        members: [],
        positions: [
          { positionId: "worship-vocal", churchId: "church-1", teamId: "worship", name: "Vocal" },
          { positionId: "av-camera", churchId: "church-1", teamId: "av", name: "Camera" },
        ],
        schedules: [
          { scheduleId: "worship-schedule", churchId: "church-1", teamId: "worship", name: "Worship" },
          { scheduleId: "av-schedule", churchId: "church-1", teamId: "av", name: "AV" },
        ],
        teams: [],
      },
      canEditTeams: false,
      serviceTimeZone: "America/New_York",
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);

    render(<TeamsFormsPage />);

    expect(screen.getByText("2026-11-01:2026-11-30")).toBeInTheDocument();
  });

  it("loads the purpose-built read for a selected-Team manager", async () => {
    mockUseTeamsPage.mockReturnValue({
      churchId: "church-1",
      pageData: {
        services: [],
        intakeForms: [],
        intakeSubmissions: [],
        intakeRecipients: [],
        smsEligibilityByMemberId: {},
        smsDeliveryAttempts: [],
        members: [],
        positions: [
          { positionId: "worship-vocal", churchId: "church-1", teamId: "worship", name: "Vocal" },
          { positionId: "av-camera", churchId: "church-1", teamId: "av", name: "Camera" },
        ],
        schedules: [
          { scheduleId: "worship-schedule", churchId: "church-1", teamId: "worship", name: "Worship" },
          { scheduleId: "av-schedule", churchId: "church-1", teamId: "av", name: "AV" },
        ],
        teams: [{ teamId: "worship", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }],
      },
      canEditTeams: false,
      serviceTimeZone: "America/New_York",
      canEditTeam: (teamId: string) => teamId === "worship",
      canManageTeamAvailability: true,
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);
    mockGetTeamAvailabilityManagementData.mockResolvedValue({
      success: true,
      teams: [{ teamId: "worship", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }],
      members: [{ memberId: "member-1", churchId: "church-1", firstName: "Rae", lastName: "Kim", positionIds: [], blockoutDates: [], teamMemberships: { worship: { teamId: "worship" } }, serviceAvailability: {} }],
      forms: [{ formId: "availability-form", churchId: "church-1", purpose: "team_availability", name: "Upcoming", teamIds: ["worship"], startDate: "2026-10-11", endDate: "2026-10-25", responseDeadline: "2026-10-25", availabilityOccurrences: [], availabilityServices: [], active: true, enabledFields: ["availability"] }],
      intakeRecipients: [],
      availabilityResponses: [],
      smsEligibilityByMemberId: { "member-1": { eligible: true } },
    });

    render(<TeamsFormsPage />);

    expect(await screen.findByTestId("intake-manager-mode")).toHaveTextContent(
      "availability:worship:forms=1:submissions=0",
    );
    expect(screen.getByTestId("authorized-scope-metadata")).toHaveTextContent("worship-vocal|worship-schedule");
    expect(mockGetTeamAvailabilityManagementData).toHaveBeenCalledWith("church-1");
  });

  it("keeps saved forms visible and offers retry when the initial time zone request fails", () => {
    mockChurchServiceTimeZone.status = "error";
    mockChurchServiceTimeZone.timeZone = null;
    mockChurchServiceTimeZone.isConfigured = false;
    mockChurchServiceTimeZone.refreshIssue = { kind: "unavailable", since: Date.now() };
    mockUseTeamsPage.mockReturnValue({
      churchId: "church-1",
      pageData: {
        services: [],
        intakeForms: [{ formId: "saved-form", churchId: "church-1", name: "Saved form", active: true }],
        intakeSubmissions: [],
        intakeRecipients: [],
        smsEligibilityByMemberId: {},
        smsDeliveryAttempts: [],
        members: [],
        positions: [],
        schedules: [],
        teams: [],
      },
      canEditTeams: false,
      serviceTimeZone: "",
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);

    render(<MemoryRouter><TeamsFormsPage /></MemoryRouter>);

    expect(screen.getByTestId("displayed-form-count")).toHaveTextContent("1");
    expect(screen.getByRole("alert")).toHaveTextContent(/date-based Availability forms actions are unavailable/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Service setup" })).not.toBeInTheDocument();
  });

  it("uses the last confirmed time zone after a temporary refresh failure", () => {
    mockChurchServiceTimeZone.status = "error";
    mockChurchServiceTimeZone.timeZone = "America/New_York";
    mockChurchServiceTimeZone.isConfigured = true;
    mockChurchServiceTimeZone.refreshIssue = { kind: "unavailable", since: Date.now() };
    mockUseTeamsPage.mockReturnValue({
      churchId: "church-1",
      pageData: {
        services: [],
        intakeForms: [{ formId: "saved-form", churchId: "church-1", name: "Saved form", active: true }],
        intakeSubmissions: [],
        intakeRecipients: [],
        smsEligibilityByMemberId: {},
        smsDeliveryAttempts: [],
        members: [],
        positions: [],
        schedules: [],
        teams: [],
      },
      canEditTeams: false,
      serviceTimeZone: "America/New_York",
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);

    render(<MemoryRouter><TeamsFormsPage /></MemoryRouter>);

    expect(screen.getByTestId("displayed-form-count")).toHaveTextContent("1");
    expect(screen.getByText("2026-10-01:2026-10-31")).toBeInTheDocument();
  });

  it("offers Service setup only when the church time zone is confirmed unconfigured", () => {
    mockChurchServiceTimeZone.status = "ready";
    mockChurchServiceTimeZone.timeZone = "UTC";
    mockChurchServiceTimeZone.isConfigured = false;
    mockUseTeamsPage.mockReturnValue({
      churchId: "church-1",
      pageData: {
        services: [],
        intakeForms: [{ formId: "saved-form", churchId: "church-1", name: "Saved form", active: true }],
        intakeSubmissions: [],
        intakeRecipients: [],
        smsEligibilityByMemberId: {},
        smsDeliveryAttempts: [],
        members: [],
        positions: [],
        schedules: [],
        teams: [],
      },
      canEditTeams: false,
      serviceTimeZone: "",
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);

    render(<MemoryRouter><TeamsFormsPage /></MemoryRouter>);

    expect(screen.getByTestId("displayed-form-count")).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: "Choose a church time zone" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Service setup" })).toHaveAttribute(
      "href",
      "/teams-and-services/service-setup",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});
