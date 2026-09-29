import { type ContextType } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import IntakeManager from "./IntakeManager";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import type {
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamRosterMember,
  TeamService,
} from "../../../api/authTypes";
import { createTeamIntakeForm, updateTeamIntakeForm } from "../../../api/auth";

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
}: {
  eligibilityStatus?: "no_mobile" | "consent_needed" | "enabled" | "opted_out";
  forms?: TeamIntakeForm[];
  services?: TeamService[];
} = {}) => {
  const onSmsDeliveryAttemptSaved = jest.fn();
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
              submissions={[]}
              intakeRecipients={[recipient]}
              services={services}
              members={[member]}
              positions={[]}
              teams={[{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }]}
              canEdit
              onFormSaved={jest.fn()}
              onSubmissionSaved={jest.fn()}
              onMemberSaved={jest.fn()}
              onTeamSaved={jest.fn()}
              onRecipientSaved={jest.fn()}
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
  return { onSmsDeliveryAttemptSaved };
};

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: `Edit ${form.name}` }));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, "confirm").mockReturnValue(true);
});

test("shows the consent reason and keeps Copy link available when SMS is ineligible", async () => {
  const user = userEvent.setup();
  renderManager();
  await openForm(user);

  expect(screen.getByText(/SMS consent needed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send SMS" })).toBeDisabled();
  await user.click(screen.getByText("More"));
  const copyButtons = screen.getAllByRole("button", { name: "Copy private link" });
  expect(copyButtons.at(-1)).toBeEnabled();
  mockGetRecipientLink.mockResolvedValue({
    success: true,
    recipient,
    publicUrl: "https://example.test/a/r_test",
  });
  await user.click(copyButtons.at(-1)!);
  await waitFor(() => expect(mockGetRecipientLink).toHaveBeenCalledTimes(1));
  expect(mockSendIntent).not.toHaveBeenCalled();
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
  expect(window.confirm).toHaveBeenCalledTimes(1);
  await user.click(sendButton);
  expect(mockPrepareSms).toHaveBeenCalledWith("church-1", form.formId, recipient.recipientId);
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

test("an existing form view exposes Send form", async () => {
  const user = userEvent.setup();
  renderManager({ eligibilityStatus: "enabled" });
  await openForm(user);

  await user.click(screen.getByRole("button", { name: "Send form" }));
  expect(screen.getByRole("heading", { name: "Send form" })).toBeInTheDocument();
  expect(updateTeamIntakeForm).not.toHaveBeenCalled();
  expect(mockSendIntent).not.toHaveBeenCalled();
});

test("successful form edits return to the form view with Send form available", async () => {
  const user = userEvent.setup();
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form });
  renderManager();
  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));
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
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith("church-1", issuedForm.formId, expect.objectContaining({ availabilityOccurrences: [savedOccurrence] })));
});
