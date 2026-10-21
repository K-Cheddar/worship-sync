import { useState, type ContextType } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { emptyData } from "../teamsConstants";
import type {
  TeamIntakeRecipient,
  TeamIntakeSubmission,
} from "../../../api/authTypes";
import { getTeamAvailabilityManagementData } from "../../../api/auth";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsFormsPage from "./TeamsFormsPage";
import { setServerTimeOffset } from "../../../utils/serverTime";

beforeEach(() => setServerTimeOffset(new Date("2026-11-01T12:00:00Z").getTime() - Date.now()));
afterEach(() => setServerTimeOffset(0));

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../api/auth", () => ({
  getNotificationIntents: jest
    .fn()
    .mockResolvedValue({ success: true, intents: [] }),
  getTeamIntakeSmsAttempts: jest
    .fn()
    .mockResolvedValue({ success: true, attempts: [] }),
  getTeamAvailabilityManagementData: jest.fn(),
}));
jest.mock("../../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({
    status: "ready",
    timeZone: "UTC",
    isConfigured: true,
  }),
}));

const form = {
  formId: "form",
  churchId: "church",
  name: "November availability",
  purpose: "team_availability" as const,
  active: true,
  startDate: "2026-11-01",
  endDate: "2026-11-30",
  availabilityServices: [],
  availabilityOccurrences: [
    {
      occurrenceId: "sunday",
      serviceId: "service",
      name: "Sunday",
      serviceDate: "2026-11-01",
      startsAt: "2026-11-01T10:00:00Z",
    },
  ],
  teamIds: ["team"],
};
const member = {
  memberId: "member",
  churchId: "church",
  firstName: "Jane",
  lastName: "Smith",
  positionIds: [],
  blockoutDates: [],
  teamMemberships: { team: { teamId: "team" } },
};
const team = {
  teamId: "team",
  churchId: "church",
  name: "Praise Team",
  memberIds: ["member"],
};
const recipient: TeamIntakeRecipient = {
  recipientId: "recipient",
  churchId: "church",
  formId: "form",
  memberId: "member",
  createdAt: "2026-10-01T00:00:00Z",
};
const submittedAt = "2026-10-21T12:00:00Z";
const submission: TeamIntakeSubmission = {
  submissionId: "submission",
  churchId: "church",
  formId: "form",
  firstName: "Jane",
  lastName: "Smith",
  normalizedName: "jane smith",
  positionIds: [],
  blockoutRanges: [],
  occurrenceAvailability: { sunday: "unavailable" },
  status: "applied",
  submittedAt,
};

function Harness({ scoped = false }: { scoped?: boolean }) {
  const [submitted, setSubmitted] = useState(false);
  jest.mocked(useTeamsPage).mockReturnValue({
    churchId: "church",
    serviceTimeZone: "UTC",
    canEditTeams: !scoped,
    canManageTeamAvailability: scoped,
    canEditTeam: () => true,
    upsertData: jest.fn(),
    refresh: async () => {
      setSubmitted(true);
    },
    pageData: {
      ...emptyData,
      teams: [team],
      members: [member],
      intakeForms: [form],
      intakeRecipients: [
        {
          ...recipient,
          ...(submitted
            ? { submissionId: "submission", respondedAt: submittedAt }
            : {}),
        },
      ],
      intakeSubmissions: submitted ? [submission] : [],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  return (
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={
          { churchId: "church", role: "admin" } as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <TeamsFormsPage />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>
  );
}

test("administrator Forms refresh displays recipient-linked answers through the real page composition", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(
    screen.getByRole("button", { name: "Edit November availability" }),
  );
  await user.click(screen.getByRole("tab", { name: "Responses" }));
  expect(screen.getByText(/No responses received yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByText("1 of 1 responded · 0 awaiting responses")).toBeInTheDocument();
  expect(
    within(screen.getByRole("table")).getByText("Unavailable"),
  ).toBeInTheDocument();
});

test("scoped Forms refresh uses restricted response data and exposes no general-link action", async () => {
  const user = userEvent.setup();
  const data = {
    teams: [team],
    members: [member],
    forms: [form],
    intakeRecipients: [recipient],
    availabilityResponses: [],
    smsEligibilityByMemberId: { member: { eligible: true } },
  };
  jest
    .mocked(getTeamAvailabilityManagementData)
    .mockResolvedValueOnce({ success: true, ...data })
    .mockResolvedValueOnce({
      success: true,
      ...data,
      intakeRecipients: [{ ...recipient, respondedAt: submittedAt }],
      availabilityResponses: [
        {
          formId: "form",
          recipientId: "recipient",
          memberId: "member",
          submittedAt,
          respondedAt: submittedAt,
          occurrenceAvailability: { sunday: "available" },
        },
      ],
    });
  render(<Harness scoped />);
  await user.click(
    await screen.findByRole("button", { name: "Edit November availability" }),
  );
  expect(
    screen.queryByRole("button", { name: "More form actions" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Responses" }));
  expect(screen.getByText(/No responses received yet/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table")).getByText("Available"),
    ).toBeInTheDocument(),
  );
  expect(getTeamAvailabilityManagementData).toHaveBeenCalledWith("church");
});
