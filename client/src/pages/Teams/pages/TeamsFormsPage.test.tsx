import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import type { TeamService } from "../../../api/authTypes";
import { setServerTimeOffset } from "../../../utils/serverTime";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsFormsPage from "./TeamsFormsPage";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../components/RangeSelector", () => ({
  __esModule: true,
  default: ({ range }: { range: { start: string; end: string } }) => (
    <output>{`${range.start}:${range.end}`}</output>
  ),
}));
jest.mock("../managers/IntakeManager", () => ({
  __esModule: true,
  default: ({ listHeader }: { listHeader: ReactNode }) => <>{listHeader}</>,
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);

afterEach(() => {
  jest.useRealTimers();
  setServerTimeOffset(0);
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
        positions: [],
        teams: [],
      },
      canEditTeams: false,
      upsertData: jest.fn(),
    } as unknown as ReturnType<typeof useTeamsPage>);

    render(<TeamsFormsPage />);

    expect(screen.getByText("2026-11-01:2026-11-30")).toBeInTheDocument();
  });
});
