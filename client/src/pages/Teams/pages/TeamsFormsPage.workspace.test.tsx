import { useState, type ContextType } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { ToastProvider } from "../../../context/toastContext";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { emptyData } from "../teamsConstants";
import type {
  TeamIntakeRecipient,
  TeamIntakeSubmission,
  TeamIntakeForm,
  NotificationBatch,
  TeamService,
} from "../../../api/authTypes";
import {
  applyTeamIntakeSubmission,
  getTeamIntakeRecipientLink,
  prepareAvailabilityNotificationBatch,
  dispatchAvailabilityNotificationBatch,
  updateTeamIntakeForm,
  getTeamAvailabilityManagementData,
} from "../../../api/auth";
import { useTeamsPage } from "../TeamsPageContext";
import TeamsFormsPage from "./TeamsFormsPage";
import { setServerTimeOffset } from "../../../utils/serverTime";

beforeEach(() => {
  jest.clearAllMocks();
  setServerTimeOffset(new Date("2026-11-01T12:00:00Z").getTime() - Date.now());
});
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
  getTeamIntakeRecipientLink: jest.fn(),
  applyTeamIntakeSubmission: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
  dispatchAvailabilityNotificationBatch: jest.fn(),
  updateTeamIntakeForm: jest.fn(),
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

const mockUpsertData = jest.fn();

function Harness({
  scoped = false,
  formRecord = form,
  initialSubmissions = [],
  services = [],
}: {
  scoped?: boolean;
  formRecord?: TeamIntakeForm;
  initialSubmissions?: TeamIntakeSubmission[];
  services?: TeamService[];
}) {
  const [submitted, setSubmitted] = useState(false);
  jest.mocked(useTeamsPage).mockReturnValue({
    churchId: "church",
    serviceTimeZone: "UTC",
    canEditTeams: !scoped,
    canManageTeamAvailability: scoped,
    canEditTeam: () => true,
    upsertData: mockUpsertData,
    refresh: async () => {
      setSubmitted(true);
    },
    pageData: {
      ...emptyData,
      services,
      teams: [team],
      members: [member],
      intakeForms: [formRecord],
      smsEligibilityByMemberId: {
        member: { status: "enabled", eligible: true },
      },
      intakeRecipients: [
        {
          ...recipient,
          formId: formRecord.formId,
          ...(submitted
            ? { submissionId: "submission", respondedAt: submittedAt }
            : {}),
        },
      ],
      intakeSubmissions: submitted
        ? [
            {
              ...submission,
              formId: formRecord.formId,
              occurrenceAvailability: {
                [formRecord.availabilityOccurrences[0]?.occurrenceId ||
                "sunday"]: "unavailable",
              },
            },
          ]
        : initialSubmissions,
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  return (
    <MemoryRouter initialEntries={["/teams-and-services/forms"]}>
      <GlobalInfoContext.Provider
        value={
          { churchId: "church", role: "admin" } as ContextType<
            typeof GlobalInfoContext
          >
        }
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <Routes>
              <Route
                path="/teams-and-services/forms"
                element={<TeamsFormsPage />}
              />
            </Routes>
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
  expect(
    await screen.findByText("1 of 1 responded · 0 awaiting responses"),
  ).toBeInTheDocument();
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

const legacyOctober: TeamIntakeForm = {
  ...form,
  formId: "october-legacy",
  name: "October Availability",
  purpose: "general_intake",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  responseDeadline: "2026-10-31",
  // Same metadata shape as demo's legacy October form: three services, six saved dates,
  // general fields including availability, and no purpose in the legacy test case.
  availabilityServices: ["service", "evening", "midweek"].map((serviceId) => ({ serviceId, name: serviceId })),
  availabilityOccurrences: [
    ["service", "2026-10-04T10:00:00Z"], ["evening", "2026-10-04T18:00:00Z"],
    ["midweek", "2026-10-07T19:00:00Z"], ["service", "2026-10-11T10:00:00Z"],
    ["evening", "2026-10-11T18:00:00Z"], ["midweek", "2026-10-14T19:00:00Z"],
  ].map(([serviceId, startsAt]) => ({ occurrenceId: `${serviceId}@${startsAt}`, serviceId, name: serviceId, startsAt, serviceDate: startsAt.slice(0, 10) })),
  enabledFields: [
    "firstName",
    "lastName",
    "email",
    "positions",
    "availability",
    "blockoutDates",
    "notes",
  ],
  requireEmail: true,
  welcomeMessage: "Tell us about yourself",
  notesMessage: "Anything else?",
  publicUrl: "https://example.test/intake/october-public",
  submissionCount: 1,
};

const openOctober = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole("button", { name: "Edit October Availability" }),
  );
};

test.each([
  { label: "general_intake", purpose: "general_intake" as const, enabledFields: legacyOctober.enabledFields },
  { label: "missing purpose with saved fields", purpose: undefined, enabledFields: legacyOctober.enabledFields },
  { label: "missing purpose and fields", purpose: undefined, enabledFields: undefined },
])(
  "Forms route opens legacy $label in the workspace while preserving its general editor",
  async ({ purpose, enabledFields }) => {
    setServerTimeOffset(
      new Date("2026-10-01T12:00:00Z").getTime() - Date.now(),
    );
    const user = userEvent.setup();
    const record = {
      ...legacyOctober,
      purpose,
      enabledFields,
    };
    const original = JSON.stringify(record);
    jest
      .mocked(updateTeamIntakeForm)
      .mockResolvedValue({ success: true, form: record });
    render(<Harness formRecord={record} />);
    await openOctober(user);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText(/6 service dates/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recipients" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(
      screen.queryByText("Individual links and text messages"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send form" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send requests" }),
    ).toBeInTheDocument();
    expect(updateTeamIntakeForm).not.toHaveBeenCalled();
    expect(JSON.stringify(record)).toBe(original);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("group", { name: "Fields to include" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Welcome message/)).toHaveValue(
      record.welcomeMessage,
    );
    expect(screen.getByLabelText(/Notes message/)).toHaveValue(
      record.notesMessage,
    );
    await user.type(screen.getByLabelText(/^Name/), " updated");
    await user.click(screen.getByRole("button", { name: "Save form" }));
    await waitFor(() =>
      expect(updateTeamIntakeForm).toHaveBeenCalledWith(
        "church",
        record.formId,
        expect.objectContaining({
          purpose: "general_intake",
          enabledFields: expect.arrayContaining([
            "email",
            "availability",
            "notes",
          ]),
          requireEmail: true,
          welcomeMessage: record.welcomeMessage,
          notesMessage: record.notesMessage,
        }),
      ),
    );
    await screen.findByRole("tab", { name: "Recipients" });
  },
);

test("legacy Responses keeps public submissions, matching and member updates alongside personal tracking", async () => {
  setServerTimeOffset(new Date("2026-10-01T12:00:00Z").getTime() - Date.now());
  const user = userEvent.setup();
  const publicSubmission: TeamIntakeSubmission = {
    ...submission,
    formId: legacyOctober.formId,
    status: "new",
    email: "jane@example.test",
    notes: "Available after lunch",
    occurrenceAvailability: {
      [legacyOctober.availabilityOccurrences[0].occurrenceId]: "available",
    },
  };
  jest
    .mocked(applyTeamIntakeSubmission)
    .mockResolvedValue({
      success: true,
      submission: {
        ...publicSubmission,
        status: "applied",
        appliedMemberId: member.memberId,
      },
      member,
      teams: [team],
    });
  render(
    <Harness
      formRecord={legacyOctober}
      initialSubmissions={[publicSubmission]}
    />,
  );
  await openOctober(user);
  await user.click(screen.getByRole("tab", { name: "Responses" }));
  expect(
    screen.getByRole("table", { name: "Availability response matrix" }),
  ).toBeInTheDocument();
  await user.click(screen.getByText("Review intake submissions (1)"));
  await user.click(
    screen.getByRole("button", { name: "Expand submission from Jane Smith" }),
  );
  expect(screen.getByText("jane@example.test")).toBeInTheDocument();
  expect(screen.getAllByText("Available after lunch").length).toBeGreaterThan(
    0,
  );
  expect(
    screen.getByRole("combobox", { name: /Match member/ }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Link to member" }));
  await waitFor(() =>
    expect(applyTeamIntakeSubmission).toHaveBeenCalledWith(
      "church",
      publicSubmission.submissionId,
      { action: "applied", memberId: member.memberId, createMember: false },
    ),
  );
  expect(mockUpsertData).toHaveBeenCalledWith("members", "memberId", member);
  expect(mockUpsertData).toHaveBeenCalledWith("teams", "teamId", team);
});

test("legacy workspace keeps general and personal links distinct and requires final SMS confirmation", async () => {
  setServerTimeOffset(new Date("2026-10-01T12:00:00Z").getTime() - Date.now());
  const user = userEvent.setup();
  const privateRecipient = { ...recipient, formId: legacyOctober.formId };
  jest
    .mocked(getTeamIntakeRecipientLink)
    .mockResolvedValue({
      success: true,
      recipient: privateRecipient,
      publicUrl: "https://example.test/intake/private-october",
    });
  const batch: NotificationBatch = {
    batchId: "batch",
    churchId: "church",
    formId: legacyOctober.formId,
    intentType: "availability_request",
    reminderRound: 0,
    status: "prepared",
    selectedMemberIds: [member.memberId],
    intentIds: ["intent"],
    approvalVersion: "review-v1",
    recipients: [
      {
        memberId: member.memberId,
        memberName: "Jane Smith",
        recipientId: recipient.recipientId,
        eligible: true,
        status: "ready",
        segmentCount: 1,
        message: "Respond at https://example.test/intake/private-october",
      },
    ],
    summary: {
      requested: 1,
      selected: 1,
      eligible: 1,
      awaitingDispatch: 1,
      alreadySent: 0,
      excluded: 0,
      totalSegments: 1,
      sent: 0,
      delivered: 0,
      failed: 0,
      uncertain: 0,
      responded: 0,
      waiting: 1,
      optedOut: 0,
    },
  };
  jest
    .mocked(prepareAvailabilityNotificationBatch)
    .mockResolvedValue({ success: true, batch });
  jest
    .mocked(dispatchAvailabilityNotificationBatch)
    .mockResolvedValue({
      success: true,
      batch: {
        ...batch,
        status: "sent",
        summary: { ...batch.summary, sent: 1 },
      },
    });
  render(<Harness formRecord={legacyOctober} />);
  const writeText = jest.spyOn(navigator.clipboard, "writeText");
  await openOctober(user);
  await user.click(screen.getByRole("button", { name: "More form actions" }));
  await user.click(
    screen.getByRole("menuitem", { name: "Copy general form link" }),
  );
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(legacyOctober.publicUrl),
  );
  await user.click(
    screen.getByRole("button", { name: "Actions for Jane Smith" }),
  );
  await user.click(
    screen.getByRole("menuitem", { name: "Copy personal availability link" }),
  );
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      "https://example.test/intake/private-october",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Send requests" }));
  const selection = await screen.findByRole("dialog", {
    name: "Send requests",
  });
  expect(
    await within(selection).findByRole("checkbox", { name: "Jane Smith" }),
  ).toBeChecked();
  await user.click(
    within(selection).getByRole("button", {
      name: "Review and send 1 message",
    }),
  );
  const review = await screen.findByRole("dialog", {
    name: "Review text messages",
  });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
  await user.click(within(review).getByText("View message"));
  expect(
    within(review).getByText(batch.recipients[0].message!),
  ).toBeInTheDocument();
  await user.click(
    within(review).getByRole("button", { name: "Send 1 message" }),
  );
  await waitFor(() =>
    expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith(
      "church",
      batch.batchId,
      batch.approvalVersion,
    ),
  );
});

test("an onboarding form with no service-date availability retains the ordinary intake view", async () => {
  const user = userEvent.setup();
  render(
    <Harness
      formRecord={{
        ...form,
        name: "Volunteer onboarding",
        purpose: "general_intake",
        availabilityServices: [],
        availabilityOccurrences: [],
        enabledFields: ["firstName", "email", "notes"],
      }}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "Edit Volunteer onboarding" }),
  );
  expect(
    screen.queryByRole("tab", { name: "Recipients" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Individual links and text messages"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send form" })).toBeInTheDocument();
});

test("legacy personal response tracking refreshes from the recipient-linked submission", async () => {
  setServerTimeOffset(new Date("2026-10-01T12:00:00Z").getTime() - Date.now());
  const user = userEvent.setup();
  render(<Harness formRecord={legacyOctober} />);
  await openOctober(user);
  await user.click(screen.getByRole("tab", { name: "Responses" }));
  await user.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(
    await within(screen.getByRole("table")).findByText("Unavailable"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Personal-link responses: 1 of 1 responded/),
  ).toBeInTheDocument();
});

test("legacy service-selection-only forms derive readable service dates without writing a snapshot", async () => {
  setServerTimeOffset(new Date("2026-10-01T12:00:00Z").getTime() - Date.now());
  const user = userEvent.setup();
  const record = {
    ...legacyOctober,
    purpose: undefined,
    enabledFields: undefined,
    availabilityOccurrences: [],
  };
  render(
    <Harness
      formRecord={record}
      services={[
        {
          id: "service",
          serviceId: "service",
          churchId: "church",
          name: "Sunday",
          timerType: "countdown",
          reccurence: "one_time",
          dateTimeISO: "2026-10-04T10:00:00Z",
        },
      ]}
    />,
  );
  await openOctober(user);
  expect(screen.getByText(/1 service dates/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Responses" }));
  expect(
    within(screen.getByRole("table")).getByText("October 04, 2026"),
  ).toBeInTheDocument();
  expect(record.availabilityOccurrences).toEqual([]);
  expect(record.purpose).toBeUndefined();
  expect(updateTeamIntakeForm).not.toHaveBeenCalled();
});
