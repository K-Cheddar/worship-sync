import { type ContextType } from "react";
import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import IntakeManager from "./IntakeManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type {
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamIntakeSubmission,
  TeamRosterMember,
  TeamService,
} from "../../../api/authTypes";
import {
  createTeamIntakeForm,
  dispatchAvailabilityNotificationBatch,
  getNotificationIntents,
  getTeamIntakeSmsAttempts,
  prepareAvailabilityNotificationBatch,
  revokeTeamIntakeRecipient,
  updateTeamIntakeForm,
} from "../../../api/auth";

const mockGetRecipientLink = jest.fn();
const mockPrepareSms = jest.fn();
const mockSendIntent = jest.fn();

jest.mock("../../../api/auth", () => ({
  applyTeamIntakeSubmission: jest.fn(),
  createTeamIntakeForm: jest.fn(),
  createTeamIntakeRecipients: jest.fn(),
  getTeamIntakeFormLink: jest.fn(),
  getTeamIntakeSmsAttempts: jest.fn().mockResolvedValue({
    success: true,
    attempts: [],
  }),
  getNotificationIntents: jest.fn().mockResolvedValue({ success: true, intents: [] }),
  prepareAvailabilityNotificationBatch: jest.fn(),
  dispatchAvailabilityNotificationBatch: jest.fn(),
  prepareTeamIntakeRecipientSms: (...args: unknown[]) => mockPrepareSms(...args),
  sendNotificationIntent: (...args: unknown[]) => mockSendIntent(...args),
  getTeamIntakeRecipientLink: (...args: unknown[]) => mockGetRecipientLink(...args),
  revokeTeamIntakeRecipient: jest.fn(),
  updateTeamIntakeForm: jest.fn(),
}));

const member: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  positionIds: [],
  blockoutDates: [],
  teamMemberships: { "team-1": { teamId: "team-1" } },
  phoneNumber: "+19545551234",
};

const form = {
  formId: "form-1",
  churchId: "church-1",
  name: "October availability",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: ["team-1"],
  active: true,
  enabledFields: [],
} as TeamIntakeForm;

const recipient: TeamIntakeRecipient = {
  recipientId: "recipient-1",
  churchId: "church-1",
  formId: "form-1",
  memberId: "member-1",
  createdAt: "2026-09-23T00:00:00.000Z",
};

const renderManager = ({
  eligibilityStatus = "consent_needed",
  forms = [form],
  services = [],
  submissions = [],
  intakeRecipients = [recipient],
}: {
  eligibilityStatus?: "no_mobile" | "consent_needed" | "enabled" | "opted_out";
  forms?: TeamIntakeForm[];
  services?: TeamService[];
  submissions?: TeamIntakeSubmission[];
  intakeRecipients?: TeamIntakeRecipient[];
} = {}) => {
  const onSmsDeliveryAttemptSaved = jest.fn();
  const onRecipientSaved = jest.fn();
  render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={{ churchId: "church-1", role: "admin" } as ContextType<
          typeof GlobalInfoContext
        >}
      >
        <ToastProvider>
          <TeamsNavigationGuardProvider>
            <IntakeManager
              forms={forms}
              submissions={submissions}
              intakeRecipients={intakeRecipients}
              services={services}
              members={[member]}
              positions={[]}
              teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }]}
              canEdit
              onFormSaved={jest.fn()}
              onSubmissionSaved={jest.fn()}
              onMemberSaved={jest.fn()}
              onTeamSaved={jest.fn()}
              onRecipientSaved={onRecipientSaved}
              onSmsDeliveryAttemptSaved={onSmsDeliveryAttemptSaved}
              smsEligibilityByMemberId={{
                "member-1": {
                  status: eligibilityStatus,
                  eligible: eligibilityStatus === "enabled",
                },
              }}
              smsDeliveryAttempts={[]}
            />
          </TeamsNavigationGuardProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );
  return { onSmsDeliveryAttemptSaved, onRecipientSaved };
};

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: `Edit ${form.name}` }));
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("shows the consent reason and keeps Copy link available when SMS is ineligible", async () => {
  const user = userEvent.setup();
  renderManager();
  await openForm(user);

  expect(screen.getByText(/SMS consent needed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send SMS" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "More" }));
  const copyItem = within(screen.getByRole("menu")).getByRole("menuitem", { name: "Copy private link" });
  expect(copyItem).not.toHaveAttribute("data-disabled");
  mockGetRecipientLink.mockResolvedValue({
    success: true,
    recipient,
    publicUrl: "https://example.test/a/r_test",
  });
  await user.click(copyItem);
  await waitFor(() => expect(mockGetRecipientLink).toHaveBeenCalledTimes(1));
  expect(mockGetRecipientLink).toHaveBeenCalledWith("church-1", recipient.recipientId, { markCopied: true });
  await waitFor(() => expect(navigator.clipboard.writeText).toBeDefined());
  expect(await navigator.clipboard.readText()).toBe("https://example.test/a/r_test");
  expect(mockSendIntent).not.toHaveBeenCalled();
});

test("More preserves history, keyboard focus, Open form, and pending action feedback", async () => {
  const user = userEvent.setup();
  const openWindow = jest.spyOn(window, "open").mockImplementation(() => null);
  let finish!: (value: unknown) => void;
  mockGetRecipientLink.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  jest.mocked(getNotificationIntents).mockResolvedValueOnce({ success: true, nextCursor: "", limit: 100, intents: [{
    intentId: "history-1", churchId: "church-1", intentType: "availability_request", sourceType: "team_intake_recipient",
    sourceId: recipient.recipientId, sourceVersion: "", memberId: member.memberId, formId: form.formId,
    recipientId: recipient.recipientId, occurrenceId: "", channel: "sms", status: "sent", attemptStatus: "delivered",
    createdAt: "2026-10-01", updatedAt: "2026-10-01",
  }] });
  renderManager();
  await openForm(user);
  await waitFor(() => expect(getNotificationIntents).toHaveBeenCalled());
  const more = screen.getByRole("button", { name: "More" });
  await user.click(more);
  const menu = screen.getByRole("menu");
  expect(within(menu).getByText("Message history")).toBeInTheDocument();
  expect(within(menu).getByText(/Form request · Sent · delivered/)).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(more).toHaveFocus());
  await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Copy private link" })).toHaveFocus());
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(mockGetRecipientLink).toHaveBeenCalledWith("church-1", recipient.recipientId, { markCopied: false }));
  expect(more).toBeEnabled();
  expect(more).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Send SMS" })).toBeDisabled();
  await waitFor(() => expect(more).toHaveFocus());
  await user.click(more);
  expect(screen.getByRole("menuitem", { name: "Copy private link" })).toHaveAttribute("data-disabled");
  expect(screen.getByRole("menuitem", { name: "Open form" })).toHaveAttribute("data-disabled");
  expect(screen.getByRole("menuitem", { name: "Revoke request" })).toHaveAttribute("data-disabled");
  expect(within(screen.getByRole("menu")).getByText("Message history")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(more).toHaveFocus());
  await act(async () => finish({ success: true, recipient, publicUrl: "https://example.test/private" }));
  expect(openWindow).toHaveBeenCalledWith("https://example.test/private", "_blank", "noopener,noreferrer");
  expect(more).toBeEnabled();
  openWindow.mockRestore();
});

test("More revokes a request and reports the saved recipient", async () => {
  const user = userEvent.setup();
  const revoked = { ...recipient, revokedAt: "2026-10-05" };
  jest.mocked(revokeTeamIntakeRecipient).mockResolvedValue({ success: true, recipient: revoked });
  const { onRecipientSaved } = renderManager();
  await openForm(user);
  await user.click(screen.getByRole("button", { name: "More" }));
  const revoke = screen.getByRole("menuitem", { name: "Revoke request" });
  expect(revoke).toHaveAttribute("data-variant", "destructive");
  await user.click(revoke);
  await waitFor(() => expect(onRecipientSaved).toHaveBeenCalledWith(revoked));
  expect(revokeTeamIntakeRecipient).toHaveBeenCalledWith("church-1", recipient.recipientId);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("prevents duplicate SMS activation while the send is pending and updates the attempt", async () => {
  const user = userEvent.setup();
  let resolveSend!: (value: unknown) => void;
  mockPrepareSms.mockResolvedValue({
    success: true,
    recipient,
    preview: {
      intentId: "intent-1",
      message: "First Church: respond at https://example.test/a/secure-token. Reply STOP to opt out.",
      approvalVersion: "review-v1",
      eligible: true,
      eligibilityStatus: "enabled",
      characterCount: 92,
      segmentCount: 1,
      maskedPhoneNumber: "••• ••• 1234",
      phoneNumberSnapshot: "+19545551234",
    },
  });
  mockSendIntent.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
  );
  const { onSmsDeliveryAttemptSaved } = renderManager({
    eligibilityStatus: "enabled",
  });
  await openForm(user);

  const sendButton = screen.getByRole("button", { name: "Send SMS" });
  await user.click(sendButton);
  expect(await screen.findByRole("dialog", { name: "Send this SMS?" })).toBeInTheDocument();
  const dialog = screen.getByRole("dialog", { name: "Send this SMS?" });
  expect(within(dialog).getByText("+19545551234")).toBeInTheDocument();
  expect(within(dialog).getByText(/First Church: respond at/)).toBeInTheDocument();
  expect(mockSendIntent).not.toHaveBeenCalled();
  expect(sendButton).toBeDisabled();
  expect(mockPrepareSms).toHaveBeenCalledWith("church-1", form.formId, recipient.recipientId);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));
  expect(mockSendIntent).toHaveBeenCalledWith("church-1", "intent-1", "review-v1");
  expect(sendButton).toBeDisabled();

  resolveSend({
    success: true,
    attempt: {
      attemptId: "attempt-1",
      churchId: "church-1",
      recipientType: "team_intake",
      recipientId: recipient.recipientId,
      memberId: member.memberId,
      provider: "twilio",
      purpose: "initial",
      status: "accepted",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
    },
  });
  await waitFor(() => expect(onSmsDeliveryAttemptSaved).toHaveBeenCalledTimes(1));
});

test("a newly created form offers Send form without sending anything during save", async () => {
  const user = userEvent.setup();
  const service: TeamService = {
    id: "sunday",
    serviceId: "sunday",
    churchId: "church-1",
    name: "Sunday service",
    timerType: "countdown",
    reccurence: "weekly",
    dayOfWeek: 0,
    time: "10:00",
  };
  const createdForm = { ...form, formId: "new-form", name: "October Availability", startDate: "2026-10-01", endDate: "2026-10-31" };
  jest.mocked(createTeamIntakeForm).mockResolvedValue({ success: true, form: createdForm, publicToken: "new-public-token", publicUrl: "https://example.test/new-form" });
  renderManager({ forms: [], services: [service], eligibilityStatus: "enabled" });

  await user.click(screen.getByRole("button", { name: "Review form" }));
  await user.click(screen.getByRole("button", { name: "Create form" }));
  await screen.findByRole("button", { name: "Send form" });

  expect(createTeamIntakeForm).toHaveBeenCalledTimes(1);
  expect(jest.mocked(createTeamIntakeForm).mock.calls[0][1].availabilityServices).toEqual([{ serviceId: "sunday", name: "Sunday service" }]);
  expect(jest.mocked(createTeamIntakeForm).mock.calls[0][1].availabilityOccurrences.length).toBeGreaterThan(0);
  expect(mockPrepareSms).not.toHaveBeenCalled();
  expect(mockSendIntent).not.toHaveBeenCalled();
});

const submittedAvailability: TeamIntakeSubmission = {
  submissionId: "submission-1",
  formId: "form-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  normalizedName: "rae kim",
  positionIds: [],
  occurrenceAvailability: {},
  blockoutRanges: [],
  status: "new",
  submittedAt: "2026-10-03T12:00:00.000Z",
};

test.each([
  {
    issuedBy: "recipient",
    intakeRecipients: [recipient],
    submissions: [] as TeamIntakeSubmission[],
    submissionCount: 0,
  },
  {
    issuedBy: "submission",
    intakeRecipients: [] as TeamIntakeRecipient[],
    submissions: [submittedAvailability],
    submissionCount: 1,
  },
])("reviewing an availability gap opens and updates the existing form with a $issuedBy", async ({
  intakeRecipients,
  submissions,
  submissionCount,
}) => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-04T16:00:00.000Z"));
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const existingOccurrence = {
    occurrenceId: "saved-october-occurrence",
    serviceId: "saved-service",
    name: "Saved service",
    startsAt: "2026-10-11T14:00:00.000Z",
  };
  const existingForm = {
    ...form,
    name: "October Availability",
    availabilityServices: [{ serviceId: "saved-service", name: "Saved service" }],
    availabilityOccurrences: [existingOccurrence],
    enabledFields: ["firstName", "availability"],
    availabilityMessage: "Mark the dates you can serve.",
    submissionCount,
  } as TeamIntakeForm;
  const powerUpService: TeamService = {
    id: "power-up",
    serviceId: "power-up",
    churchId: "church-1",
    name: "Power Up",
    timerType: "countdown",
    reccurence: "one_time",
    dateTimeISO: "2026-10-14T14:00:00.000Z",
  };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: existingForm });
  renderManager({ forms: [existingForm], services: [powerUpService], intakeRecipients, submissions });

  expect(screen.getByRole("heading", { name: "October Availability needs updating" })).toBeInTheDocument();
  expect(screen.getByText("1 upcoming service isn’t included.")).toBeInTheDocument();
  expect(screen.getByText("Power Up · Oct 14")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review form" }));
  expect(screen.getByRole("button", { name: "Save form" })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name/i)).toHaveValue("October Availability");
  expect(screen.getByText(/newly suggested dates will be added when you save/)).toBeInTheDocument();
  expect(screen.getByText(/Availability services: Saved service, Power Up/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith(
    "church-1",
    existingForm.formId,
    expect.objectContaining({
      name: existingForm.name,
      teamIds: existingForm.teamIds,
      enabledFields: existingForm.enabledFields,
      availabilityMessage: existingForm.availabilityMessage,
      availabilityServices: [
        { serviceId: "saved-service", name: "Saved service" },
        { serviceId: "power-up", name: "Power Up" },
      ],
      availabilityOccurrences: [
        existingOccurrence,
        expect.objectContaining({
          occurrenceId: "power-up@2026-10-14T14:00:00.000Z",
          serviceId: "power-up",
          startsAt: "2026-10-14T14:00:00.000Z",
        }),
      ],
    }),
  ));
  expect(createTeamIntakeForm).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test("an existing form view exposes Send form", async () => {
  const user = userEvent.setup();
  renderManager({ eligibilityStatus: "enabled" });
  await openForm(user);

  await user.click(screen.getByRole("button", { name: "Send form" }));
  expect(screen.getByRole("heading", { name: "Send form" })).toBeInTheDocument();
  expect(updateTeamIntakeForm).not.toHaveBeenCalled();
  expect(mockSendIntent).not.toHaveBeenCalled();
});

test("a sent batch updates recipients and delivery counts in Forms without reloading", async () => {
  const user = userEvent.setup();
  const deliveredAttempt = {
    attemptId: "attempt-batch-1", churchId: "church-1", recipientType: "notification_intent" as const,
    recipientId: recipient.recipientId, memberId: member.memberId, formId: form.formId,
    provider: "twilio", purpose: "availability_request" as const, status: "delivered" as const,
    createdAt: "2026-09-29T12:00:00.000Z", updatedAt: "2026-09-29T12:00:00.000Z",
  };
  const invitedRecipient = { ...recipient };
  const batch = {
    batchId: "batch-1", churchId: "church-1", formId: form.formId, intentType: "availability_request" as const,
    reminderRound: 0, status: "prepared" as const, selectedMemberIds: [member.memberId],
    recipients: [{ memberId: member.memberId, memberName: "Rae Kim", recipientId: invitedRecipient.recipientId, eligible: true, status: "ready" as const, segmentCount: 1 }],
    intakeRecipients: [invitedRecipient], intentIds: ["intent-batch-1"], approvalVersion: "approval-v1",
    summary: { requested: 1, selected: 1, eligible: 1, awaitingDispatch: 1, alreadySent: 0, excluded: 0, totalSegments: 1, sent: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0, waiting: 1, optedOut: 0 },
  };
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: { ...batch, status: "sent", summary: { ...batch.summary, sent: 1, delivered: 1 } } });
  let resolveStaleAttempts!: (value: Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>) => void;
  let resolveStaleIntents!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  jest.mocked(getTeamIntakeSmsAttempts)
    .mockResolvedValueOnce({ success: true, attempts: [] })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleAttempts = resolve; }))
    .mockResolvedValueOnce({ success: true, attempts: [deliveredAttempt] });
  const notificationIntent = {
    intentId: "intent-batch-1", churchId: "church-1", intentType: "availability_request", sourceType: "team_intake_recipient",
    sourceId: invitedRecipient.recipientId, sourceVersion: "", memberId: member.memberId, formId: form.formId,
    recipientId: invitedRecipient.recipientId, occurrenceId: "", channel: "sms", status: "sent", attemptStatus: "delivered",
    createdAt: "2026-09-29T12:00:00.000Z", updatedAt: "2026-09-29T12:00:00.000Z",
  } as const;
  jest.mocked(getNotificationIntents)
    .mockResolvedValueOnce({ success: true, intents: [], nextCursor: "", limit: 50 })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleIntents = resolve; }))
    .mockResolvedValueOnce({ success: true, intents: [notificationIntent], nextCursor: "", limit: 50 });

  const StatefulManager = () => {
    const [recipients, setRecipients] = useState([recipient]);
    return <MemoryRouter>
      <GlobalInfoContext.Provider value={{ churchId: "church-1", role: "admin" } as ContextType<typeof GlobalInfoContext>}>
        <ToastProvider><TeamsNavigationGuardProvider>
          <IntakeManager
            forms={[form]} submissions={[]} intakeRecipients={recipients} services={[]} members={[member]} positions={[]}
            teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: [member.memberId] }]}
            canEdit onFormSaved={jest.fn()} onSubmissionSaved={jest.fn()} onMemberSaved={jest.fn()} onTeamSaved={jest.fn()}
            onRecipientSaved={(nextRecipient) => setRecipients((current) => [...current.filter((item) => item.recipientId !== nextRecipient.recipientId), nextRecipient])}
            smsEligibilityByMemberId={{ [member.memberId]: { status: "enabled", eligible: true } }}
          />
        </TeamsNavigationGuardProvider></ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>;
  };
  render(<StatefulManager />);
  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Send form" }));
  await user.click(within(screen.getByRole("region", { name: "Send form" })).getByRole("checkbox", { name: "Rae Kim" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await screen.findByRole("button", { name: "Send 1 message" });
  await user.click(screen.getAllByRole("button", { name: "Send 1 message" }).at(-1)!);
  await user.click(screen.getAllByRole("button", { name: "Send 1 message" }).at(-1)!);
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church-1", "batch-1", "approval-v1"));
  const counts = screen.getByLabelText("Intake message and response counts");
  await waitFor(() => expect(within(counts).getAllByText("1")).toHaveLength(3));
  resolveStaleAttempts({ success: true, attempts: [] });
  resolveStaleIntents({ success: true, intents: [{ ...notificationIntent, status: "ready", attemptStatus: undefined }], nextCursor: "", limit: 50 });
  await waitFor(() => expect(within(counts).getAllByText("1")).toHaveLength(3));
  await user.click(screen.getByRole("button", { name: "Close" }));

  expect(within(counts).getAllByText("1")).toHaveLength(3);
  expect(screen.getAllByText("Waiting").length).toBeGreaterThan(1);
  expect(screen.queryByText("Not requested")).not.toBeInTheDocument();
  expect(getNotificationIntents).toHaveBeenCalledWith("church-1", { formId: form.formId });
  expect(getTeamIntakeSmsAttempts).toHaveBeenCalledWith("church-1", form.formId);
});

test("successful form edits return to the form view with Send form available", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form });
  renderManager();
  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByLabelText(/^Name/i), " updated");
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await screen.findByRole("button", { name: "Send form" });
  expect(updateTeamIntakeForm).toHaveBeenCalledTimes(1);
  expect(mockSendIntent).not.toHaveBeenCalled();
});

test("saving a form with existing recipients preserves its covered occurrence snapshot", async () => {
  const user = userEvent.setup();
  const savedOccurrence = { occurrenceId: "saved-occurrence", serviceId: "old-service", name: "Saved service", startsAt: "2026-10-11T14:00:00.000Z" };
  const issuedForm = { ...form, availabilityServices: [{ serviceId: "old-service", name: "Saved service" }], availabilityOccurrences: [savedOccurrence] };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: issuedForm });
  renderManager({ forms: [issuedForm], services: [{ id: "old-service", serviceId: "old-service", churchId: "church-1", name: "Changed service", timerType: "countdown", reccurence: "weekly", dayOfWeek: 0, time: "10:00" }] });
  await user.click(screen.getByRole("button", { name: `Edit ${issuedForm.name}` }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByText(/already has private links or responses/)).toBeInTheDocument();
  await user.type(screen.getByLabelText(/^Name/i), " updated");
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith("church-1", issuedForm.formId, expect.objectContaining({ availabilityOccurrences: [savedOccurrence] })));
});
