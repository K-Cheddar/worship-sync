import { type ContextType } from "react";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import IntakeManager from "./IntakeManager";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import { ToastProvider } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { TeamsNavigationGuardProvider } from "../TeamsNavigationGuardContext";
import { CurrentMemberIdentityProvider } from "../components/CurrentUserMemberIndicator";
import type {
  NotificationIntent,
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamIntakeSubmission,
  TeamRosterMember,
  TeamPosition,
  TeamRecord,
  TeamSchedule,
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

let mockServiceTimeZone = "UTC";
jest.mock("../TeamsPageContext", () => ({
  useTeamsPage: () => ({ serviceTimeZone: mockServiceTimeZone }),
}));

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
jest.mock("../../../utils/apiErrorToast", () => ({ showApiErrorToast: jest.fn() }));

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
  positions = [],
  schedules = [],
  submissions = [],
  intakeRecipients = [recipient],
  availabilityOnly = false,
  managedTeamIds = ["team-1"],
  teams = [{ teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: ["member-1"] }],
  members = [member],
  serviceTimeZone = "UTC",
  smsEligibilityByMemberId,
  selfMemberId = null,
}: {
  eligibilityStatus?: "no_mobile" | "consent_needed" | "enabled" | "opted_out";
  forms?: TeamIntakeForm[];
  services?: TeamService[];
  positions?: TeamPosition[];
  schedules?: TeamSchedule[];
  submissions?: TeamIntakeSubmission[];
  intakeRecipients?: TeamIntakeRecipient[];
  availabilityOnly?: boolean;
  managedTeamIds?: string[];
  teams?: TeamRecord[];
  members?: TeamRosterMember[];
  serviceTimeZone?: string;
  selfMemberId?: string | null;
  smsEligibilityByMemberId?: Record<string, { eligible: boolean; status?: "no_mobile" | "consent_needed" | "enabled" | "opted_out" }>;
} = {}) => {
  mockServiceTimeZone = serviceTimeZone;
  const onSmsDeliveryAttemptSaved = jest.fn();
  const onRecipientSaved = jest.fn();
  const view = render(
    <MemoryRouter>
      <GlobalInfoContext.Provider
        value={{ churchId: "church-1", role: "admin" } as ContextType<
          typeof GlobalInfoContext
        >}
      >
        <ToastProvider>
          <CurrentMemberIdentityProvider memberId={selfMemberId}>
            <TeamsNavigationGuardProvider>
              <IntakeManager
              availabilityOnly={availabilityOnly}
              managedTeamIds={managedTeamIds}
              forms={forms}
              submissions={submissions}
              intakeRecipients={intakeRecipients}
              services={services}
              schedules={schedules}
              members={members}
              positions={positions}
              teams={teams}
              canEdit
              onFormSaved={jest.fn()}
              onSubmissionSaved={jest.fn()}
              onMemberSaved={jest.fn()}
              onTeamSaved={jest.fn()}
              onRecipientSaved={onRecipientSaved}
              onSmsDeliveryAttemptSaved={onSmsDeliveryAttemptSaved}
              smsEligibilityByMemberId={smsEligibilityByMemberId || {
                "member-1": {
                  status: eligibilityStatus,
                  eligible: eligibilityStatus === "enabled",
                },
              }}
              smsDeliveryAttempts={[]}
              />
            </TeamsNavigationGuardProvider>
          </CurrentMemberIdentityProvider>
        </ToastProvider>
      </GlobalInfoContext.Provider>
    </MemoryRouter>,
  );
  return { ...view, onSmsDeliveryAttemptSaved, onRecipientSaved };
};

const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: `Edit ${form.name}` }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockServiceTimeZone = "UTC";
});

afterEach(() => {
  jest.useRealTimers();
});

test("late form history failures do not publish an error toast after Forms unmounts", async () => {
  const user = userEvent.setup();
  let rejectHistory!: (error: Error) => void;
  jest.mocked(getNotificationIntents).mockReturnValueOnce(new Promise((_, reject) => { rejectHistory = reject; }));
  const view = renderManager();
  await openForm(user);
  await waitFor(() => expect(getNotificationIntents).toHaveBeenCalled());

  view.unmount();
  await act(async () => rejectHistory(new Error("History failed after navigation.")));

  expect(showApiErrorToast).not.toHaveBeenCalled();
});

test("shows the consent reason and keeps Copy link available when SMS is ineligible", async () => {
  const user = userEvent.setup();
  renderManager();
  await openForm(user);

  expect(screen.getByText(/Text message consent needed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send text message" })).toBeDisabled();
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

test("availability-only manager hides member intake and consent details", async () => {
  const user = userEvent.setup();
  const safeMember: TeamRosterMember = {
    memberId: member.memberId,
    churchId: member.churchId,
    firstName: member.firstName,
    lastName: member.lastName,
    positionIds: [],
    blockoutDates: [],
    teamMemberships: { "team-1": { teamId: "team-1" } },
    serviceAvailability: {},
  };
  renderManager({
    availabilityOnly: true,
    members: [safeMember],
    smsEligibilityByMemberId: { "member-1": { eligible: false } },
    forms: [{ ...form, purpose: "team_availability", enabledFields: ["availability"], availabilityOccurrences: [{ occurrenceId: "service@2026-10-18T10:00:00.000Z", serviceId: "service", name: "Sunday", serviceDate: "2026-10-18", startsAt: "2026-10-18T10:00:00.000Z" }] }],
  });

  await openForm(user);

  expect(screen.getByText("Availability responses")).toBeInTheDocument();
  expect(screen.queryByText("Not eligible to receive text messages")).not.toBeInTheDocument();
  expect(screen.queryByText(/Text message consent needed|This phone number opted out|No mobile number/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send text message" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send form" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.queryByRole("group", { name: "Fields to include" })).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Teams to collect for" })).toBeInTheDocument();
  expect(screen.getByText("Availability services: None")).toBeInTheDocument();
  expect(screen.queryByText("Form wording")).not.toBeInTheDocument();
  expect(screen.queryByText("Fields to collect")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /public form link/i })).not.toBeInTheDocument();
});

test("a church-wide editor gets the restricted editor and immutable payload for a Team availability form", async () => {
  const user = userEvent.setup();
  const savedOccurrence = {
    occurrenceId: "saved-service@2026-10-18T14:00:00.000Z",
    serviceId: "saved-service",
    name: "Saved service",
    startsAt: "2026-10-18T14:00:00.000Z",
    serviceDate: "2026-10-18",
  };
  const availabilityForm: TeamIntakeForm = {
    ...form,
    purpose: "team_availability",
    enabledFields: ["firstName", "email", "birthDate", "notes", "availability"],
    availabilityServices: [{ serviceId: "saved-service", name: "Saved service" }],
    availabilityOccurrences: [savedOccurrence],
  };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: availabilityForm });
  renderManager({
    forms: [availabilityForm],
    intakeRecipients: [],
    services: [{
      id: "saved-service",
      serviceId: "saved-service",
      churchId: "church-1",
      name: "Saved service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: savedOccurrence.startsAt,
    }],
  });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(screen.queryByRole("group", { name: "Fields to include" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Welcome message")).not.toBeInTheDocument();
  expect(screen.queryByText("Birthday (year optional)")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Notes message")).not.toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Service dates" })).toBeInTheDocument();
  await user.type(screen.getByLabelText(/^Name/i), " updated");
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith(
    "church-1",
    availabilityForm.formId,
    expect.objectContaining({
      purpose: "team_availability",
      enabledFields: ["availability"],
      teamIds: ["team-1"],
      availabilityOccurrences: [savedOccurrence],
    }),
  ));
});

test("saved availability forms stay readable and keep their dates when the church time zone is unavailable", async () => {
  const user = userEvent.setup();
  const savedOccurrence = {
    occurrenceId: "saved-service@2026-10-18T14:00:00.000Z",
    serviceId: "saved-service",
    name: "Saved service",
    startsAt: "2026-10-18T14:00:00.000Z",
    serviceDate: "2026-10-18",
  };
  const availabilityForm: TeamIntakeForm = {
    ...form,
    purpose: "team_availability",
    enabledFields: ["availability"],
    availabilityServices: [{ serviceId: "saved-service", name: "Saved service" }],
    availabilityOccurrences: [savedOccurrence],
  };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: availabilityForm });
  renderManager({
    forms: [availabilityForm],
    intakeRecipients: [],
    serviceTimeZone: "",
  });

  await openForm(user);
  expect(screen.getByRole("heading", { name: availabilityForm.name })).toBeInTheDocument();
  expect(screen.getByText(/October 01, 2026 – October 31, 2026/)).toBeInTheDocument();
  expect(screen.getByText(/1 availability dates/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("note")).toHaveTextContent(/review this form and edit its wording/i);
  expect(screen.getByText("Load the church time zone before choosing service dates.")).toBeInTheDocument();

  await user.clear(screen.getByLabelText(/^Name/i));
  await user.type(screen.getByLabelText(/^Name/i), "October availability updated");
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith(
    "church-1",
    availabilityForm.formId,
    expect.objectContaining({
      name: "October availability updated",
      availabilityOccurrences: [savedOccurrence],
    }),
  ));
});

test("editing a saved availability form keeps service selections visible after its requirements change", async () => {
  const user = userEvent.setup();
  const availabilityForm: TeamIntakeForm = {
    ...form,
    purpose: "team_availability",
    enabledFields: ["availability"],
    availabilityServices: [{ serviceId: "legacy-service", name: "Legacy service" }],
    availabilityOccurrences: [],
  };
  renderManager({
    forms: [availabilityForm],
    intakeRecipients: [],
    positions: [{ positionId: "vocal", churchId: "church-1", teamId: "team-1", name: "Vocal" }],
    services: [{
      id: "legacy-service",
      serviceId: "legacy-service",
      churchId: "church-1",
      name: "Legacy service",
      timerType: "countdown",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    }],
  });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(screen.getByRole("checkbox", { name: /Legacy service/ })).toBeChecked();
});

test("changing an unsent availability form's Teams reconciles its selected service dates", async () => {
  const user = userEvent.setup();
  const unsentForm: TeamIntakeForm = {
    ...form,
    purpose: "team_availability",
    enabledFields: ["availability"],
    availabilityServices: [],
    availabilityOccurrences: [],
  };
  const services: TeamService[] = [
    {
      id: "worship-service",
      serviceId: "worship-service",
      churchId: "church-1",
      name: "Worship service",
      timerType: "countdown",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
      positionRequirements: [{ positionId: "vocal", count: 1 }],
    },
    {
      id: "av-service",
      serviceId: "av-service",
      churchId: "church-1",
      name: "AV service",
      timerType: "countdown",
      reccurence: "weekly",
      dayOfWeek: 0,
      time: "10:00",
      positionRequirements: [{ positionId: "camera", count: 1 }],
    },
  ];
  const editedForm = { ...unsentForm, teamIds: ["team-2"] };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: editedForm });
  renderManager({
    forms: [unsentForm],
    intakeRecipients: [],
    teams: [
      { teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: ["member-1"] },
      { teamId: "team-2", churchId: "church-1", name: "AV", memberIds: [] },
    ],
    positions: [
      { positionId: "vocal", churchId: "church-1", teamId: "team-1", name: "Vocal" },
      { positionId: "camera", churchId: "church-1", teamId: "team-2", name: "Camera" },
    ],
    services,
  });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("checkbox", { name: /Worship service/ }));
  const teamScope = screen.getByRole("group", { name: "Teams to collect for" });
  await user.click(within(teamScope).getByRole("checkbox", { name: "AV" }));
  await user.click(within(teamScope).getByRole("checkbox", { name: "Worship" }));

  expect(screen.queryByRole("checkbox", { name: /Worship service/ })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /AV service/ })).not.toBeChecked();

  await user.click(screen.getByRole("checkbox", { name: /AV service/ }));
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith(
    "church-1",
    unsentForm.formId,
    expect.objectContaining({
      teamIds: ["team-2"],
      availabilityServices: [{ serviceId: "av-service", name: "AV service" }],
      availabilityOccurrences: expect.arrayContaining([expect.objectContaining({ serviceId: "av-service" })]),
    }),
  ));
  expect(jest.mocked(updateTeamIntakeForm).mock.calls[0][2].availabilityOccurrences).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ serviceId: "worship-service" })]),
  );
});

test("an issued availability request locks Team selection but allows name and deadline edits", async () => {
  const user = userEvent.setup();
  const savedOccurrence = {
    occurrenceId: "saved-service@2026-10-18T14:00:00.000Z",
    serviceId: "saved-service",
    name: "Saved service",
    startsAt: "2026-10-18T14:00:00.000Z",
    serviceDate: "2026-10-18",
  };
  const issuedForm: TeamIntakeForm = {
    ...form,
    purpose: "team_availability",
    hasIssuedRecipientRequests: true,
    availabilityServices: [{ serviceId: "saved-service", name: "Saved service" }],
    availabilityOccurrences: [savedOccurrence],
  };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({
    success: true,
    form: { ...issuedForm, name: "October availability updated", responseDeadline: "2026-10-20" },
  });
  renderManager({
    availabilityOnly: true,
    forms: [issuedForm],
    intakeRecipients: [],
    services: [{
      id: "saved-service",
      serviceId: "saved-service",
      churchId: "church-1",
      name: "Saved service",
      timerType: "countdown",
      reccurence: "one_time",
      dateTimeISO: savedOccurrence.startsAt,
    }],
  });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));

  const teamScope = screen.getByRole("group", { name: "Teams to collect for" });
  expect(within(teamScope).getByText("Team selection is locked because availability requests have already been issued.")).toBeInTheDocument();
  expect(within(teamScope).getByText("Worship")).toBeInTheDocument();
  expect(within(teamScope).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText("Availability services: Saved service")).toBeInTheDocument();

  await user.type(screen.getByLabelText(/^Name/i), " updated");
  fireEvent.change(screen.getByLabelText(/^Response deadline/i), {
    target: { value: "2026-10-20" },
  });
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith(
    "church-1",
    issuedForm.formId,
    expect.objectContaining({
      name: "October availability updated",
      responseDeadline: "2026-10-20",
      teamIds: ["team-1"],
      availabilityOccurrences: [savedOccurrence],
    }),
  ));

  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByText("Team selection is locked because availability requests have already been issued.")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Teams to collect for" })).toHaveTextContent("Worship");
});

test("general intake editing still shows its supported fields and wording", async () => {
  const user = userEvent.setup();
  const generalForm: TeamIntakeForm = {
    ...form,
    purpose: "general_intake",
    enabledFields: ["firstName", "availability", "notes"],
  };
  renderManager({ forms: [generalForm], intakeRecipients: [] });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));

  expect(screen.getByRole("group", { name: "Fields to include" })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Welcome message/)).toBeInTheDocument();
  expect(screen.getByLabelText(/^Notes message/)).toBeInTheDocument();
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
  expect(within(menu).getByText(/Form request · Sent · Delivered/)).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(more).toHaveFocus());
  await user.keyboard("{ArrowDown}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Copy private link" })).toHaveFocus());
  await user.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(mockGetRecipientLink).toHaveBeenCalledWith("church-1", recipient.recipientId, { markCopied: false }));
  expect(more).toBeEnabled();
  expect(more).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Send text message" })).toBeDisabled();
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

  const sendButton = screen.getByRole("button", { name: "Send text message" });
  await user.click(sendButton);
  expect(await screen.findByRole("dialog", { name: "Send this text message?" })).toBeInTheDocument();
  const dialog = screen.getByRole("dialog", { name: "Send this text message?" });
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
    positionRequirements: [{ positionId: "vocal", count: 1 }],
  };
  const createdForm = { ...form, formId: "new-form", name: "October Availability", startDate: "2026-10-01", endDate: "2026-10-31" };
  jest.mocked(createTeamIntakeForm).mockResolvedValue({ success: true, form: createdForm, publicToken: "new-public-token", publicUrl: "https://example.test/new-form" });
  renderManager({
    forms: [], services: [service], eligibilityStatus: "enabled",
    positions: [{ positionId: "vocal", churchId: "church-1", teamId: "team-1", name: "Vocal" }],
  });

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

test("does not mark an unmatched intake submission by name", async () => {
  const user = userEvent.setup();
  renderManager({ submissions: [submittedAvailability], selfMemberId: member.memberId });
  await openForm(user);

  const submissionCard = screen.getByRole("button", {
    name: "Expand submission from Rae Kim",
  });
  expect(within(submissionCard).queryByText("You")).not.toBeInTheDocument();
});

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
])("reviewing an availability gap with a $issuedBy request creates a separate draft", async ({
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
    teamIds: ["team-1"],
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
    positionRequirements: [{ positionId: "vocal", count: 1 }],
  };
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: existingForm });
  renderManager({
    forms: [existingForm],
    services: [powerUpService],
    positions: [{ positionId: "vocal", churchId: "church-1", teamId: "team-1", name: "Vocal" }],
    intakeRecipients,
    submissions,
  });

  expect(screen.getByText("Availability needed for Worship")).toBeInTheDocument();
  expect(screen.getByText(/1 upcoming date missing/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review form" }));
  expect(screen.getByRole("button", { name: "Create form" })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name/i)).toHaveValue("October Availability");
  expect(screen.getByText("Power Up")).toBeInTheDocument();
  expect(updateTeamIntakeForm).not.toHaveBeenCalled();
  expect(createTeamIntakeForm).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test("closed future availability coverage opens for review without creating another form", async () => {
  const user = userEvent.setup();
  const serviceDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const startsAt = `${serviceDate}T14:00:00.000Z`;
  const upcoming = {
    id: "upcoming-service",
    serviceId: "upcoming-service",
    churchId: "church-1",
    name: "Sunday service",
    timerType: "countdown" as const,
    reccurence: "one_time" as const,
    dateTimeISO: startsAt,
    positionRequirements: [{ positionId: "vocal", count: 1 }],
  };
  const closedForm = {
    ...form,
    purpose: "team_availability" as const,
    active: false,
    enabledFields: ["availability" as const],
    availabilityServices: [{ serviceId: upcoming.serviceId, name: upcoming.name }],
    availabilityOccurrences: [{
      occurrenceId: `upcoming-service@${serviceDate}`,
      serviceId: upcoming.serviceId,
      name: upcoming.name,
      serviceDate,
      startsAt,
    }],
  } as TeamIntakeForm;
  renderManager({
    forms: [closedForm],
    services: [upcoming],
    positions: [{ positionId: "vocal", churchId: "church-1", teamId: "team-1", name: "Vocal" }],
  });

  expect(screen.getByText(/This form is closed/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review form" }));
  expect(screen.getByRole("button", { name: "Save form" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create form" })).not.toBeInTheDocument();
  expect(createTeamIntakeForm).not.toHaveBeenCalled();
});

test("a delayed form save cannot close a different form opened before it settles", async () => {
  const user = userEvent.setup();
  const otherForm = { ...form, formId: "form-2", name: "Other form" };
  const savedForm = { ...form, name: "Updated availability" };
  let resolveUpdate: (value: { success: true; form: TeamIntakeForm }) => void = () => undefined;
  jest.mocked(updateTeamIntakeForm).mockImplementation(
    () => new Promise((resolve) => { resolveUpdate = resolve; }),
  );
  renderManager({ forms: [form, otherForm] });

  await openForm(user);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText(/^Name/i));
  await user.type(screen.getByLabelText(/^Name/i), "Updated availability");
  await user.click(screen.getByRole("button", { name: "Save form" }));
  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: "Edit Other form" }));
  expect(screen.getByRole("heading", { name: "Other form" })).toBeInTheDocument();
  await act(async () => resolveUpdate({ success: true, form: savedForm }));

  expect(screen.getByRole("heading", { name: "Other form" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
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

test("refreshes history on every Send form open and ignores older history responses", async () => {
  const user = userEvent.setup();
  const sentIntent: NotificationIntent = {
    intentId: "sent-request", churchId: "church-1", intentType: "availability_request", sourceType: "team_intake_recipient",
    sourceId: recipient.recipientId, sourceVersion: "", memberId: member.memberId, formId: form.formId,
    recipientId: recipient.recipientId, occurrenceId: "", channel: "sms", status: "sent",
    createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
  };
  const historyPage = (intents: NotificationIntent[]) => ({ success: true, intents, nextCursor: "", limit: 100 }) as Awaited<ReturnType<typeof getNotificationIntents>>;
  const attemptsPage = { success: true, attempts: [] } as Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>;
  let resolveOlderIntents!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  let resolveOlderAttempts!: (value: Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>) => void;
  let resolveReopenIntents!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  let resolveReopenAttempts!: (value: Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>) => void;
  jest.mocked(getNotificationIntents)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOlderIntents = resolve; }))
    .mockResolvedValueOnce(historyPage([sentIntent]))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveReopenIntents = resolve; }));
  jest.mocked(getTeamIntakeSmsAttempts)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOlderAttempts = resolve; }))
    .mockResolvedValueOnce(attemptsPage)
    .mockImplementationOnce(() => new Promise((resolve) => { resolveReopenAttempts = resolve; }));
  renderManager({ eligibilityStatus: "enabled" });
  await openForm(user);
  await waitFor(() => expect(getNotificationIntents).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: "Send form" }));
  const sendRegion = screen.getByRole("region", { name: "Send form" });
  expect(within(sendRegion).getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
  await waitFor(() => expect(within(sendRegion).getAllByText("Already sent").length).toBeGreaterThan(0));
  expect(getNotificationIntents).toHaveBeenCalledTimes(2);

  await act(async () => {
    resolveOlderIntents(historyPage([]));
    resolveOlderAttempts(attemptsPage);
  });
  expect(within(sendRegion).getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
  expect(within(sendRegion).getAllByText("Already sent").length).toBeGreaterThan(0);

  await user.click(within(sendRegion).getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Send form" }));
  const reopenedRegion = screen.getByRole("region", { name: "Send form" });
  expect(within(reopenedRegion).getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
  await waitFor(() => expect(getNotificationIntents).toHaveBeenCalledTimes(3));
  await act(async () => {
    resolveReopenIntents(historyPage([sentIntent]));
    resolveReopenAttempts(attemptsPage);
  });
  expect(within(reopenedRegion).getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
  expect(within(reopenedRegion).getAllByText("Already sent").length).toBeGreaterThan(0);
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
  jest.mocked(getTeamIntakeSmsAttempts)
    .mockResolvedValueOnce({ success: true, attempts: [] })
    .mockResolvedValueOnce({ success: true, attempts: [] })
    .mockResolvedValueOnce({ success: true, attempts: [deliveredAttempt] });
  const notificationIntent = {
    intentId: "intent-batch-1", churchId: "church-1", intentType: "availability_request", sourceType: "team_intake_recipient",
    sourceId: invitedRecipient.recipientId, sourceVersion: "", memberId: member.memberId, formId: form.formId,
    recipientId: invitedRecipient.recipientId, occurrenceId: "", channel: "sms", status: "sent", attemptStatus: "delivered",
    createdAt: "2026-09-29T12:00:00.000Z", updatedAt: "2026-09-29T12:00:00.000Z",
  } as const;
  jest.mocked(getNotificationIntents)
    .mockResolvedValueOnce({ success: true, intents: [], nextCursor: "", limit: 50 })
    .mockResolvedValueOnce({ success: true, intents: [], nextCursor: "", limit: 50 })
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
  expect(within(screen.getByRole("region", { name: "Send form" })).getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  const confirmation = await screen.findByRole("dialog", { name: "Review text messages" });
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
  await user.click(within(confirmation).getByRole("button", { name: "Send 1 message" }));
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church-1", "batch-1", "approval-v1"));
  const counts = screen.getByLabelText("Intake message and response counts");
  await waitFor(() => expect(within(counts).getAllByText("1")).toHaveLength(3));
  await user.click(screen.getByRole("button", { name: "Close" }));

  expect(within(counts).getAllByText("1")).toHaveLength(3);
  expect(screen.getByText("Waiting for a response")).toBeInTheDocument();
  expect(screen.queryByText("Not requested")).not.toBeInTheDocument();
  expect(getNotificationIntents).toHaveBeenCalledWith("church-1", { formId: form.formId, limit: 100 });
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

test("saving an availability form with issued requests preserves its Team scope and occurrence snapshot", async () => {
  const user = userEvent.setup();
  const savedOccurrence = { occurrenceId: "saved-occurrence", serviceId: "old-service", name: "Saved service", startsAt: "2026-10-11T14:00:00.000Z" };
  const issuedForm = { ...form, purpose: "team_availability", enabledFields: ["availability"], availabilityServices: [{ serviceId: "old-service", name: "Saved service" }], availabilityOccurrences: [savedOccurrence] } as TeamIntakeForm;
  jest.mocked(updateTeamIntakeForm).mockResolvedValue({ success: true, form: issuedForm });
  renderManager({
    forms: [issuedForm],
    teams: [
      { teamId: "team-1", churchId: "church-1", name: "Worship", memberIds: ["member-1"] },
      { teamId: "team-2", churchId: "church-1", name: "AV", memberIds: [] },
    ],
    services: [{ id: "old-service", serviceId: "old-service", churchId: "church-1", name: "Changed service", timerType: "countdown", reccurence: "weekly", dayOfWeek: 0, time: "10:00" }],
  });
  await user.click(screen.getByRole("button", { name: `Edit ${issuedForm.name}` }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByText(/already has private links or responses/)).toBeInTheDocument();
  const teamScope = screen.getByRole("group", { name: "Teams to collect for" });
  expect(within(teamScope).getByText("Team selection is locked because availability requests have already been issued.")).toBeInTheDocument();
  expect(within(teamScope).getByText("Worship")).toBeInTheDocument();
  expect(within(teamScope).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText("Availability services: Saved service")).toBeInTheDocument();
  await user.type(screen.getByLabelText(/^Name/i), " updated");
  await user.click(screen.getByRole("button", { name: "Save form" }));

  await waitFor(() => expect(updateTeamIntakeForm).toHaveBeenCalledWith("church-1", issuedForm.formId, expect.objectContaining({
    teamIds: ["team-1"],
    availabilityServices: [{ serviceId: "old-service", name: "Saved service" }],
    availabilityOccurrences: [savedOccurrence],
  })));
});
