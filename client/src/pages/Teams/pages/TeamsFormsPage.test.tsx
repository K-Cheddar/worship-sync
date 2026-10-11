import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { TeamService } from "../../../api/authTypes";
import { setServerTimeOffset } from "../../../utils/serverTime";
import { getTeamAvailabilityManagementData } from "../../../api/auth";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsFormsPage from "./TeamsFormsPage";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
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
    submissions,
    positions,
    schedules,
  }: {
    listHeader: ReactNode;
    availabilityOnly?: boolean;
    managedTeamIds?: string[];
    forms: { formId: string }[];
    submissions: unknown[];
    positions?: { positionId: string; teamId: string }[];
    schedules?: { scheduleId: string; teamId: string }[];
  }) => <><output data-testid="intake-manager-mode">{availabilityOnly ? `availability:${managedTeamIds?.join(",")}:forms=${forms.length}:submissions=${submissions.length}` : "intake"}</output><output data-testid="authorized-scope-metadata">{`${positions?.map(({ positionId }) => positionId).join(",") || ""}|${schedules?.map(({ scheduleId }) => scheduleId).join(",") || ""}`}</output>{listHeader}</>,
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetTeamAvailabilityManagementData = jest.mocked(getTeamAvailabilityManagementData);

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
  jest.clearAllMocks();
});

describe("TeamsFormsPage period selection", () => {
  it("uses the server instant when it crosses into the next month", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 31, 23, 30));
    setServerTimeOffset(2 * 60 * 60 * 1000);
    const service: TeamService = {
      id: "late-october",
      serviceId: "late-october",
      churchId: "church-1",
      name: "Late October service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: new Date(2026, 9, 31, 23, 45).toISOString(),
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
});
