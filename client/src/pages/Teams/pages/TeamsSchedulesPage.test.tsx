import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getTeamAvailabilityManagementData } from "../../../api/auth";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsSchedulesPage from "./TeamsSchedulesPage";

jest.mock("../../../api/auth", () => ({ getTeamAvailabilityManagementData: jest.fn() }));
jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../schedule/ScheduleTab", () => ({
  __esModule: true,
  default: ({ data }: { data: { members: { memberId: string; serviceAvailability?: Record<string, string> }[] } }) => (
    <output data-testid="schedule-member-availability">
      {JSON.stringify(data.members.map(({ memberId, serviceAvailability }) => ({ memberId, serviceAvailability })))}
    </output>
  ),
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetTeamAvailabilityManagementData = jest.mocked(getTeamAvailabilityManagementData);

beforeEach(() => {
  jest.clearAllMocks();
});

test("loads scoped service-date answers into the existing schedule assignment view", async () => {
  mockUseTeamsPage.mockReturnValue({
    pageData: {
      teams: [{ teamId: "worship", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }],
      members: [{ memberId: "member-1", churchId: "church-1", firstName: "Rae", lastName: "Kim", positionIds: [], blockoutDates: [], serviceAvailability: {} }],
      schedules: [],
    },
    churchId: "church-1",
    selectedScheduleId: "",
    scheduleDrafts: {},
    upsertData: jest.fn(),
    removeData: jest.fn(),
    trackTeamsSave: jest.fn(),
    updateSelectedScheduleId: jest.fn(),
    updateScheduleDraft: jest.fn(),
    flushScheduleDraft: jest.fn(),
    clearScheduleDraft: jest.fn(),
    canEditTeams: false,
    canEditAnyTeam: true,
    canEditTeam: (teamId: string) => teamId === "worship",
    editableMemberIds: new Set(["member-1"]),
    refresh: jest.fn(),
    serviceTimeZone: "UTC",
  } as unknown as ReturnType<typeof useTeamsPage>);
  mockGetTeamAvailabilityManagementData.mockResolvedValue({
    success: true,
    teams: [],
    members: [{ memberId: "member-1", churchId: "church-1", firstName: "Rae", lastName: "Kim", positionIds: [], blockoutDates: [], teamMemberships: {}, serviceAvailability: { "service@2026-10-18T10:00:00.000Z": "available" } }],
    forms: [],
    intakeRecipients: [],
    availabilityResponses: [],
    smsEligibilityByMemberId: {},
  });

  render(<MemoryRouter><TeamsSchedulesPage /></MemoryRouter>);

  expect(await screen.findByTestId("schedule-member-availability")).toHaveTextContent(
    '"serviceAvailability":{"service@2026-10-18T10:00:00.000Z":"available"}',
  );
  expect(mockGetTeamAvailabilityManagementData).toHaveBeenCalledWith("church-1");
});
