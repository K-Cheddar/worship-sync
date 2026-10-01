import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getNotificationIntentPreview,
  getNotificationIntents,
  prepareAvailabilityNotificationBatch,
  sendNotificationIntent,
} from "../../../api/auth";
import type { NotificationBatch } from "../../../api/authTypes";

jest.mock("../TeamsPageContext", () => ({ useTeamsPage: jest.fn() }));
jest.mock("../../../api/auth", () => ({
  dispatchAvailabilityNotificationBatch: jest.fn(),
  getAvailabilityNotificationBatch: jest.fn(),
  getNotificationIntentPreview: jest.fn(),
  getNotificationIntents: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
  sendNotificationIntent: jest.fn(),
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetBatch = jest.mocked(getAvailabilityNotificationBatch);
const mockGetIntents = jest.mocked(getNotificationIntents);
const mockGetIntentPreview = jest.mocked(getNotificationIntentPreview);
const mockPrepare = jest.mocked(prepareAvailabilityNotificationBatch);
const mockDispatch = jest.mocked(dispatchAvailabilityNotificationBatch);
const mockSendIntent = jest.mocked(sendNotificationIntent);

const batch: NotificationBatch = {
  batchId: "batch_1",
  churchId: "church_1",
  formId: "form_1",
  intentType: "availability_request",
  reminderRound: 0,
  status: "prepared",
  selectedMemberIds: ["member_1"],
  intentIds: ["intent_1"],
  approvalVersion: "batch-review-v1",
  recipients: [{
    memberId: "member_1", memberName: "Rae Rivera", recipientId: "recipient_1",
    maskedPhoneNumber: "••• ••• 0123", eligibilityStatus: "", eligible: true,
    intentId: "intent_1", status: "preview", segmentCount: 2,
    approvalVersion: "intent-review-v1",
    message: "Church: please respond at https://example.test/a/private-token. Reply STOP to opt out.",
  }],
  summary: {
    requested: 1, selected: 1, eligible: 1, awaitingDispatch: 1, alreadySent: 0, excluded: 0, totalSegments: 2,
    sent: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0,
    waiting: 0, optedOut: 0,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1",
    canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true }],
      schedules: [],
      teams: [], positions: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true } },
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  mockGetIntents.mockResolvedValue({ success: true, intents: [], nextCursor: "", limit: 50 });
  mockGetIntentPreview.mockResolvedValue({
    success: true,
    preview: {
      intentId: "intent_1", intentType: "availability_request", memberId: "member_1",
      message: "Exact server message for Rae.", approvalVersion: "fresh-approval-v3", expiresAt: 100,
      eligible: true, eligibilityStatus: "enabled", phoneNumberSnapshot: "+15555550987",
      characterCount: 31, segmentCount: 2, maskedPhoneNumber: "••• ••• 0987",
    },
  });
  mockSendIntent.mockResolvedValue({ success: true });
  mockGetBatch.mockResolvedValue({ success: true, batch });
  mockPrepare.mockResolvedValue({ success: true, batch });
  mockDispatch.mockResolvedValue({ success: true, batch: { ...batch, status: "sent", summary: { ...batch.summary, sent: 1 } } });
});

const recentIntent = {
  intentId: "intent_1", churchId: "church_1", intentType: "availability_request" as const,
  sourceType: "team_intake_recipient" as const, sourceId: "recipient_1", sourceVersion: "v1",
  memberId: "member_1", formId: "form_1", recipientId: "recipient_1", occurrenceId: "occurrence_1",
  channel: "sms" as const, status: "ready" as const, createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z", previewEligible: true,
};

async function openRecentMessages(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await screen.findByRole("button", { name: "Send one SMS" });
  await user.click(screen.getByRole("button", { name: "Send one SMS" }));
  expect(mockGetIntentPreview).toHaveBeenCalledWith("church_1", "intent_1");
  await screen.findByRole("dialog", { name: "Send this SMS?" });
}

test("recent message SMS review shows the fresh server snapshot and Cancel does not send", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  const dialog = screen.getByRole("dialog", { name: "Send this SMS?" });
  expect(within(dialog).getByText("Rae Rivera")).toBeInTheDocument();
  expect(within(dialog).getByText("+15555550987")).toBeInTheDocument();
  expect(within(dialog).getByText("Exact server message for Rae.")).toBeInTheDocument();
  expect(within(dialog).getByText("2 SMS segments.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "Send this SMS?" })).not.toBeInTheDocument();
  expect(mockSendIntent).not.toHaveBeenCalled();
});

test("recent message send uses the fresh preview approval version and refreshes history", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  await waitFor(() => expect(mockSendIntent).toHaveBeenCalledWith("church_1", "intent_1", "fresh-approval-v3"));
  await waitFor(() => expect(mockGetIntents.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(await screen.findByRole("status")).toHaveTextContent("SMS accepted by the provider.");
});

test("recent message send keeps an uncertain provider outcome visible", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  mockSendIntent.mockResolvedValue({
    success: false,
    errorMessage: "The provider outcome is uncertain. Review SMS history before retrying.",
  });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("status")).toHaveTextContent("The provider outcome is uncertain.");
  await waitFor(() => expect(mockGetIntents.mock.calls.length).toBeGreaterThanOrEqual(2));
});

test("recent message confirmation ignores duplicate Send activation", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  mockSendIntent.mockImplementation(() => new Promise(() => {}));
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  const sendButton = within(screen.getByRole("dialog", { name: "Send this SMS?" })).getByRole("button", { name: /^Send$/ });
  fireEvent.click(sendButton);
  fireEvent.click(sendButton);

  expect(mockSendIntent).toHaveBeenCalledTimes(1);
  expect(mockSendIntent).toHaveBeenCalledWith("church_1", "intent_1", "fresh-approval-v3");
});

test("only sends after confirmation and dispatches the explicitly prepared batch", async () => {
  const user = userEvent.setup();
  render(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));

  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({
    intentType: "availability_request", formId: "form_1", memberIds: ["member_1"],
  })));
  expect(await screen.findByText(/secure response/)).toBeInTheDocument();
  await user.click(await screen.findByText("View message"));
  expect(await screen.findByText(/Church: please respond at/)).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Send 1 message" }));
  expect(await screen.findByRole("dialog", { name: "Send this form?" })).toBeInTheDocument();
  expect(screen.getByText(/Send exactly 1 selected message/)).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole("button", { name: "Send 1 message" }).at(-1)!);
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith("church_1", "batch_1", "batch-review-v1"));
});

test("team and name filters compose, and selection survives filter changes", async () => {
  const user = userEvent.setup();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1", canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true, teamIds: [] }],
      teams: [{ teamId: "worship", churchId: "church_1", name: "Worship", memberIds: ["member_1", "member_2"] }, { teamId: "care", churchId: "church_1", name: "Care", memberIds: ["member_1", "member_3"] }],
      positions: [], schedules: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true }, member_2: { status: "enabled", eligible: true }, member_3: { status: "no_mobile", eligible: false } },
      members: [
        { memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] },
        { memberId: "member_2", firstName: "Sam", lastName: "Smith", churchId: "church_1", phoneNumber: "+15555550124", positionIds: [] },
        { memberId: "member_3", firstName: "Terry", lastName: "Taylor", churchId: "church_1", positionIds: [] },
      ],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "Worship" }));
  await user.type(screen.getByRole("textbox", { name: /Search volunteers/ }), "sam");
  expect(screen.getByText("Sam Smith")).toBeInTheDocument();
  expect(screen.queryByText("Rae Rivera")).not.toBeInTheDocument();
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: /Search volunteers/ }));
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "All teams" }));
  await user.click(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ }));
  expect(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ })).toHaveAttribute("data-state", "checked");
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByText("0 selected")).toBeInTheDocument();
  expect(screen.getByText("No mobile number")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Terry Taylor" })).toBeDisabled();
});

test("changing recipients closes confirmation and invalidates the reviewed batch", async () => {
  const user = userEvent.setup();
  mockPrepare.mockResolvedValue({ success: true, batch });
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send 1 message" }));
  expect(screen.getByRole("dialog", { name: "Send this form?" })).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  expect(screen.queryByRole("dialog", { name: "Send this form?" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Recipients changed");
});

test("changing the intake form invalidates the active batch", async () => {
  const user = userEvent.setup();
  mockPrepare.mockResolvedValue({ success: true, batch });
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1", canEditTeams: true,
    pageData: {
      intakeForms: [
        { formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true },
        { formId: "form_2", name: "November availability", startDate: "2026-11-01", endDate: "2026-11-30", active: true },
      ],
      schedules: [], teams: [], positions: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true } },
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /November availability/ }));
  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Form changed");
});

test("changing the message type invalidates the active batch", async () => {
  const user = userEvent.setup();
  mockPrepare.mockResolvedValue({ success: true, batch });
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: /Message/ }));
  await user.click(screen.getByRole("option", { name: "Remind nonresponders" }));
  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Message type changed");
});

test("select all is indeterminate for some visible selections and prepares only eligible selected volunteers", async () => {
  const user = userEvent.setup();
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1", canEditTeams: true,
    pageData: {
      intakeForms: [{ formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true, teamIds: [] }],
      teams: [{ teamId: "worship", churchId: "church_1", name: "Worship", memberIds: ["member_1", "member_2"] }], positions: [], schedules: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true }, member_2: { status: "enabled", eligible: true } },
      members: [
        { memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] },
        { memberId: "member_2", firstName: "Terry", lastName: "Taylor", churchId: "church_1", phoneNumber: "+15555550124", positionIds: [] },
      ],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  render(<TeamsMessagesPage />);
  expect(screen.getByRole("button", { name: "Review 0 messages" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  expect(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ })).toHaveAttribute("data-state", "indeterminate");
  expect(screen.getByRole("button", { name: "Review 1 message" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({ memberIds: ["member_1"] })));
});
