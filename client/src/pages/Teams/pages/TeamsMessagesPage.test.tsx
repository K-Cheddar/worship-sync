import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TeamsMessagesPage from "./TeamsMessagesPage";
import { useTeamsPage } from "../TeamsPageContext";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getNotificationIntentPreview,
  getNotificationIntents,
  getTeamIntakeSmsAttempts,
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
  getTeamIntakeSmsAttempts: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
  sendNotificationIntent: jest.fn(),
}));

const mockUseTeamsPage = jest.mocked(useTeamsPage);
const mockGetBatch = jest.mocked(getAvailabilityNotificationBatch);
const mockGetIntents = jest.mocked(getNotificationIntents);
const mockGetSmsAttempts = jest.mocked(getTeamIntakeSmsAttempts);
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
  mockGetSmsAttempts.mockResolvedValue({ success: true, attempts: [] });
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
  await screen.findByRole("button", { name: "Send individually" });
  await user.click(screen.getByRole("button", { name: "Send individually" }));
  expect(mockGetIntentPreview).toHaveBeenCalledWith("church_1", "intent_1");
  await screen.findByRole("dialog", { name: "Send this text message?" });
}

test("recent message SMS review shows the fresh server snapshot and Cancel does not send", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  const dialog = screen.getByRole("dialog", { name: "Send this text message?" });
  expect(within(dialog).getByText("Rae Rivera")).toBeInTheDocument();
  expect(within(dialog).getByText("+15555550987")).toBeInTheDocument();
  expect(within(dialog).getByText("Exact server message for Rae.")).toBeInTheDocument();
  expect(within(dialog).getByText("This longer message counts as 2 texts.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog", { name: "Send this text message?" })).not.toBeInTheDocument();
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
  expect(await screen.findByText("Your text message was sent. Delivery updates may take a moment.")).toBeInTheDocument();
});

test("a confirmed send stays successful when message history cannot be refreshed", async () => {
  const user = userEvent.setup();
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockRejectedValueOnce(new Error("History temporarily unavailable."));
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your text message was sent, but we couldn't refresh message history. Try refreshing it.",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not verify consent and message history");
  expect(screen.getByRole("alert")).not.toHaveTextContent(/wasn't sent|could not send/i);
  expect(screen.queryByRole("button", { name: "Send individually" })).not.toBeInTheDocument();
});

test("recent message send keeps an uncertain provider outcome visible", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  mockSendIntent.mockResolvedValue({
    success: false,
    outcome: "unknown",
  });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't confirm whether this text was sent. Check message history before trying again.");
  await waitFor(() => expect(mockGetIntents.mock.calls.length).toBeGreaterThanOrEqual(2));
});

test("a definitive provider rejection stays a failure when the API rejects the send request", async () => {
  const user = userEvent.setup();
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockResolvedValueOnce({ success: true, intents: [{ ...recentIntent, status: "failed", attemptOutcome: "failed" }], nextCursor: "", limit: 50 });
  mockSendIntent.mockRejectedValue(Object.assign(new Error("The SMS provider rejected this message."), {
    status: 502,
    details: { success: false, outcome: "failed", errorMessage: "The SMS provider rejected this message." },
  }));
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The SMS provider rejected this message.");
  await waitFor(() => expect(mockGetIntents.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(screen.getByRole("alert")).not.toHaveTextContent("We couldn't confirm whether this text was sent");
  expect(screen.queryByRole("button", { name: "Send individually" })).not.toBeInTheDocument();
});

test("recent message confirmation ignores duplicate Send activation", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockResolvedValue({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  mockSendIntent.mockImplementation(() => new Promise(() => {}));
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  const sendButton = within(screen.getByRole("dialog", { name: "Send this text message?" })).getByRole("button", { name: /^Send$/ });
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
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));

  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({
    intentType: "availability_request", formId: "form_1", memberIds: ["member_1"],
  })));
  const confirmation = await screen.findByRole("dialog", { name: "Review text messages" });
  expect(within(confirmation).getByText("October availability")).toBeInTheDocument();
  expect(within(confirmation).getByText("1 volunteer will receive a text message.")).toBeInTheDocument();
  expect(within(confirmation).getByText("This longer message counts as 2 texts.")).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();
  await user.click(within(confirmation).getByText("View message"));
  expect(await within(confirmation).findByText(/Church: please respond at/)).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();

  expect(within(confirmation).getByRole("button", { name: "Send 1 message" })).toBeInTheDocument();
  await user.click(within(confirmation).getByRole("button", { name: "Send 1 message" }));
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith("church_1", "batch_1", "batch-review-v1"));
});

test("cancelling the group confirmation sends nothing and allows a fresh review", async () => {
  const user = userEvent.setup();
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  const confirmation = await screen.findByRole("dialog", { name: "Review text messages" });
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));

  expect(mockDispatch).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Review text messages" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  expect(await screen.findByRole("dialog", { name: "Review text messages" })).toBeInTheDocument();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test("a pending preparation cannot open a review from a previous church", async () => {
  const user = userEvent.setup();
  let resolvePreparation!: (value: Awaited<ReturnType<typeof prepareAvailabilityNotificationBatch>>) => void;
  mockPrepare.mockReturnValueOnce(new Promise((resolve) => { resolvePreparation = resolve; }));
  const view = render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(1));

  const initialContext = mockUseTeamsPage.mock.results[mockUseTeamsPage.mock.results.length - 1].value as ReturnType<typeof useTeamsPage>;
  mockUseTeamsPage.mockReturnValue({ ...initialContext, churchId: "church_2" });
  view.rerender(<TeamsMessagesPage />);
  await act(async () => resolvePreparation({ success: true, batch }));

  expect(screen.queryByRole("dialog", { name: "Review text messages" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Message status/ })).not.toBeInTheDocument();
});

test("rapid group confirmation sends the reviewed batch once", async () => {
  const user = userEvent.setup();
  mockDispatch.mockImplementation(() => new Promise(() => {}));
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  const send = within(await screen.findByRole("dialog", { name: "Review text messages" })).getByRole("button", { name: "Send 1 message" });
  fireEvent.click(send);
  fireEvent.click(send);

  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith("church_1", "batch_1", "batch-review-v1");
});

test("restored batch status refreshes after an individual send and removes the old send action", async () => {
  const user = userEvent.setup();
  const sentIntent = { ...recentIntent, status: "sent" as const, attemptId: "attempt-1", attemptStatus: "accepted" as const };
  const sentBatch: NotificationBatch = {
    ...batch,
    status: "sent",
    summary: { ...batch.summary, sent: 1, awaitingDispatch: 0 },
    recipients: batch.recipients.map((recipient) => ({ ...recipient, status: "sent", attemptStatus: "accepted" })),
  };
  window.localStorage.setItem("worshipsync:last-notification-batch:church_1:form_1", "batch_1");
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockResolvedValueOnce({ success: true, intents: [sentIntent], nextCursor: "", limit: 50 });
  mockGetBatch
    .mockResolvedValueOnce({ success: true, batch })
    .mockResolvedValueOnce({ success: true, batch: sentBatch });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("heading", { name: "Message status · October availability" })).toBeInTheDocument();
  expect(await screen.findAllByText(/Sent · Waiting for delivery confirmation/)).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Send individually" })).not.toBeInTheDocument();
  expect(await screen.findByText("Your text message was sent. Delivery updates may take a moment.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mockGetBatch).toHaveBeenCalledTimes(2);
});

test("an unknown send outcome remains visible while its related batch refreshes", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("worshipsync:last-notification-batch:church_1:form_1", "batch_1");
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockRejectedValueOnce(new Error("History temporarily unavailable."));
  mockGetBatch
    .mockResolvedValueOnce({ success: true, batch })
    .mockResolvedValueOnce({ success: true, batch });
  mockSendIntent.mockResolvedValue({ success: false, outcome: "unknown" });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByText(/We couldn't confirm whether this text was sent/)).toBeInTheDocument();
  await waitFor(() => expect(mockGetBatch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", { name: "Send individually" })).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("a failed batch refresh does not replace confirmed send feedback", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("worshipsync:last-notification-batch:church_1:form_1", "batch_1");
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockResolvedValueOnce({ success: true, intents: [{ ...recentIntent, status: "sent" }], nextCursor: "", limit: 50 });
  mockGetBatch
    .mockResolvedValueOnce({ success: true, batch })
    .mockRejectedValueOnce(new Error("Batch status temporarily unavailable."));
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Your text message was sent. Delivery updates may take a moment. Batch status couldn't be refreshed. Refresh the page to check it.",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await waitFor(() => expect(mockGetBatch).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("heading", { name: "Message status · October availability" })).not.toBeInTheDocument();
});

test("a delayed related-batch refresh from a previous form cannot replace the current form state", async () => {
  const user = userEvent.setup();
  const novemberForm = {
    formId: "form_2", name: "November availability", startDate: "2026-11-01", endDate: "2026-11-30", active: true,
  };
  mockUseTeamsPage.mockReturnValue({
    churchId: "church_1",
    canEditTeams: true,
    pageData: {
      intakeForms: [
        { formId: "form_1", name: "October availability", startDate: "2026-10-01", endDate: "2026-10-31", active: true },
        novemberForm,
      ],
      schedules: [], teams: [], positions: [], intakeRecipients: [],
      smsEligibilityByMemberId: { member_1: { status: "enabled", eligible: true } },
      members: [{ memberId: "member_1", firstName: "Rae", lastName: "Rivera", churchId: "church_1", phoneNumber: "+15555550123", positionIds: [] }],
    },
  } as unknown as ReturnType<typeof useTeamsPage>);
  window.localStorage.setItem("worshipsync:last-notification-batch:church_1:form_1", "batch_1");
  let resolveRelatedBatch!: (value: Awaited<ReturnType<typeof getAvailabilityNotificationBatch>>) => void;
  let resolveHistoryRefresh!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  mockGetBatch
    .mockResolvedValueOnce({ success: true, batch })
    .mockReturnValueOnce(new Promise((resolve) => { resolveRelatedBatch = resolve; }));
  mockGetIntents
    .mockResolvedValueOnce({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 })
    .mockReturnValueOnce(new Promise((resolve) => { resolveHistoryRefresh = resolve; }))
    .mockResolvedValue({ success: true, intents: [], nextCursor: "", limit: 50 });
  render(<TeamsMessagesPage />);

  await openRecentMessages(user);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));
  await waitFor(() => expect(mockSendIntent).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(mockGetBatch).toHaveBeenCalledTimes(2));

  const formSelect = screen.getByRole("combobox", { name: /Intake form/ });
  fireEvent.change(formSelect, { target: { value: "form_2" } });
  await waitFor(() => expect(formSelect).toHaveValue("form_2"));
  await act(async () => {
    resolveRelatedBatch({ success: true, batch: { ...batch, status: "sent" } });
    resolveHistoryRefresh({ success: true, intents: [recentIntent], nextCursor: "", limit: 50 });
  });

  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).not.toBeChecked();
  expect(screen.queryByRole("heading", { name: "Message status · November availability" })).not.toBeInTheDocument();
});

test("Messages waits for complete history before enabling recipient selection", async () => {
  const user = userEvent.setup();
  let resolveHistory!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  mockGetIntents.mockReturnValueOnce(new Promise((resolve) => { resolveHistory = resolve; }));
  render(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review and send 0 messages" })).toBeDisabled();

  await act(async () => resolveHistory({ success: true, intents: [], nextCursor: "", limit: 100 }));
  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled();
});

test("a history response from the previous church cannot block the same form in the new church", async () => {
  const user = userEvent.setup();
  let resolveOldIntents!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  let resolveOldAttempts!: (value: Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>) => void;
  mockGetIntents
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldIntents = resolve; }))
    .mockResolvedValueOnce({ success: true, intents: [], nextCursor: "", limit: 100 });
  mockGetSmsAttempts
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldAttempts = resolve; }))
    .mockResolvedValueOnce({ success: true, attempts: [] });
  const view = render(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  const initialContext = mockUseTeamsPage.mock.results[mockUseTeamsPage.mock.results.length - 1].value as ReturnType<typeof useTeamsPage>;
  const recipient = { recipientId: "recipient_1", churchId: "church_1", formId: "form_1", memberId: "member_1", createdAt: "2026-09-01" };
  mockUseTeamsPage.mockReturnValue({
    ...initialContext,
    churchId: "church_2",
    pageData: { ...initialContext.pageData, intakeRecipients: [recipient] },
  });
  view.rerender(<TeamsMessagesPage />);
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled());

  await act(async () => {
    resolveOldIntents({ success: true, intents: [{ ...recentIntent, recipientId: recipient.recipientId, status: "sent" }], nextCursor: "", limit: 100 });
    resolveOldAttempts({ success: true, attempts: [] });
  });
  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled();
  expect(screen.queryByText("Already sent")).not.toBeInTheDocument();
  expect(mockGetIntents.mock.calls.map(([church]) => church)).toEqual(["church_1", "church_2"]);
});

test("a failed Messages history load blocks selection until status check succeeds", async () => {
  const user = userEvent.setup();
  mockGetIntents.mockRejectedValueOnce(new Error("History temporarily unavailable."));
  render(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  expect(await screen.findByText("Could not verify consent and message history: History temporarily unavailable.")).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByText("No volunteer messages for this form yet.")).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Retry status check" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled());
});

test("a delayed retry for one form cannot replace the new form's loaded history", async () => {
  const user = userEvent.setup();
  let resolveOldIntents!: (value: Awaited<ReturnType<typeof getNotificationIntents>>) => void;
  let resolveOldAttempts!: (value: Awaited<ReturnType<typeof getTeamIntakeSmsAttempts>>) => void;
  mockGetIntents
    .mockRejectedValueOnce(new Error("Initial history unavailable."))
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldIntents = resolve; }))
    .mockResolvedValueOnce({ success: true, intents: [], nextCursor: "", limit: 100 });
  mockGetSmsAttempts
    .mockResolvedValueOnce({ success: true, attempts: [] })
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldAttempts = resolve; }))
    .mockResolvedValueOnce({ success: true, attempts: [] });
  const view = render(<TeamsMessagesPage />);
  const initialContext = mockUseTeamsPage.mock.results[mockUseTeamsPage.mock.results.length - 1].value as ReturnType<typeof useTeamsPage>;
  const secondForm = { formId: "form_2", churchId: "church_1", name: "November availability", startDate: "2026-11-01", endDate: "2026-11-30", availabilityServices: [], availabilityOccurrences: [], teamIds: [], active: true };
  mockUseTeamsPage.mockReturnValue({
    ...initialContext,
    pageData: { ...initialContext.pageData, intakeForms: [...initialContext.pageData.intakeForms, secondForm] },
  });
  view.rerender(<TeamsMessagesPage />);

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  expect(await screen.findByText(/Initial history unavailable/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry status check" }));
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /November availability/ }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled());

  await act(async () => {
    resolveOldIntents({ success: true, intents: [], nextCursor: "", limit: 100 });
    resolveOldAttempts({ success: true, attempts: [] });
  });
  expect(screen.getByRole("checkbox", { name: "Rae Rivera" })).toBeEnabled();
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

test("changing recipients after cancelling confirmation invalidates the reviewed batch", async () => {
  const user = userEvent.setup();
  mockPrepare.mockResolvedValue({ success: true, batch });
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  expect(await screen.findByRole("dialog", { name: "Review text messages" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  expect(screen.queryByRole("dialog", { name: "Review text messages" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Message status/ })).not.toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  expect(await screen.findByRole("dialog", { name: "Review text messages" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /November availability/ }));
  expect(screen.queryByRole("dialog", { name: "Review text messages" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Form changed");
});

test("changing the message type invalidates the active batch", async () => {
  const user = userEvent.setup();
  mockPrepare.mockResolvedValue({ success: true, batch });
  render(<TeamsMessagesPage />);
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  expect(await screen.findByRole("dialog", { name: "Review text messages" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("combobox", { name: /Message/ }));
  await user.click(screen.getByRole("option", { name: "Remind nonresponders" }));
  expect(screen.queryByRole("dialog", { name: "Review text messages" })).not.toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "Review and send 0 messages" })).toBeDisabled();
  await user.click(screen.getByRole("combobox", { name: /Intake form/ }));
  await user.click(screen.getByRole("option", { name: /October availability/ }));
  await user.click(screen.getByRole("checkbox", { name: "Rae Rivera" }));
  expect(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ })).toHaveAttribute("data-state", "indeterminate");
  expect(screen.getByRole("button", { name: "Review and send 1 message" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Review and send 1 message" }));
  await waitFor(() => expect(mockPrepare).toHaveBeenCalledWith("church_1", expect.objectContaining({ memberIds: ["member_1"] })));
});
