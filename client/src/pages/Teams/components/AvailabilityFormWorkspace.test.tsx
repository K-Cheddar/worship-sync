import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationBatch, NotificationIntent, TeamIntakeForm, TeamIntakeRecipient, TeamRosterMember } from "../../../api/authTypes";
import { dispatchAvailabilityNotificationBatch, prepareAvailabilityNotificationBatch } from "../../../api/auth";
import { getAvailabilityFormProgress } from "../availabilityFormProgress";
import AvailabilityFormWorkspace from "./AvailabilityFormWorkspace";

jest.mock("../../../api/auth", () => ({
  dispatchAvailabilityNotificationBatch: jest.fn(),
  getAvailabilityNotificationBatch: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
}));

const form: TeamIntakeForm = {
  formId: "form-1",
  churchId: "church-1",
  name: "October availability",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  teamIds: ["worship"],
  availabilityServices: [],
  availabilityOccurrences: [],
  active: true,
};

const member: TeamRosterMember = {
  memberId: "member-1",
  churchId: "church-1",
  firstName: "Rae",
  lastName: "Kim",
  phoneNumber: "+19545551234",
  positionIds: [],
  blockoutDates: [],
  teamMemberships: { worship: { teamId: "worship" } },
};

const recipient: TeamIntakeRecipient = {
  recipientId: "recipient-1",
  churchId: "church-1",
  formId: form.formId,
  memberId: member.memberId,
  createdAt: "2026-09-01T00:00:00.000Z",
};

const sentIntent: NotificationIntent = {
  intentId: "original-request",
  churchId: form.churchId,
  formId: form.formId,
  recipientId: recipient.recipientId,
  memberId: member.memberId,
  intentType: "availability_request",
  sourceType: "team_intake_recipient",
  sourceId: recipient.recipientId,
  sourceVersion: "",
  occurrenceId: "",
  channel: "sms",
  message: "Original link",
  status: "sent",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  sentAt: "2026-09-02T00:00:00.000Z",
};

const teams = [{ teamId: "worship", churchId: form.churchId, name: "Worship", memberIds: [member.memberId] }];
const members = [member];
const recipients = [recipient];
const notificationIntents = [sentIntent];
const eligibilityByMemberId = { [member.memberId]: { status: "enabled" as const, eligible: true } };
const rows = getAvailabilityFormProgress({
  members,
  positions: [],
  teams,
  recipients,
  eligibilityByMemberId,
  notificationIntents,
  smsDeliveryAttempts: [],
  form,
  intentType: "availability_request",
}, [], []);

const reviewedBatch: NotificationBatch = {
  batchId: "batch-resend",
  churchId: form.churchId,
  formId: form.formId,
  intentType: "availability_request",
  audienceType: "specific",
  reminderRound: 0,
  status: "prepared",
  selectedMemberIds: [member.memberId],
  intentIds: ["new-request"],
  approvalVersion: "approval-1",
  recipients: [{
    memberId: member.memberId,
    memberName: "Rae Kim",
    recipientId: recipient.recipientId,
    maskedPhoneNumber: "••• ••• 1234",
    eligible: true,
    intentId: "new-request",
    status: "ready",
    segmentCount: 1,
    message: "First Church: Please submit your availability: https://example.test/a/private-token Reply STOP to opt out.",
    previousDeliveryStatus: "accepted",
    previousSentAt: sentIntent.sentAt,
  }],
  summary: { requested: 1, selected: 1, eligible: 1, awaitingDispatch: 1, alreadySent: 0, excluded: 0, totalSegments: 1, sent: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0, waiting: 1, optedOut: 0 },
};

const historyProps = {
  notificationIntents,
  smsDeliveryAttempts: [],
  historyLoaded: true,
  historyError: "",
  onRetryHistory: jest.fn(),
};

const Harness = () => {
  const [sendOpen, setSendOpen] = useState(false);
  return <AvailabilityFormWorkspace
    rows={rows}
    sendFlowProps={{
      churchId: form.churchId,
      form,
      members,
      positions: [],
      teams,
      recipients,
      eligibilityByMemberId,
      ...historyProps,
      onClose: () => setSendOpen(false),
    }}
    recipientActions={{
      onCreateLink: jest.fn(),
      onCopyLink: jest.fn(),
      onOpenLink: jest.fn(),
      onRevoke: jest.fn(),
    }}
    canEdit
    canCopyGeneralLink={false}
    linkBusy={false}
    serviceTimeZone="UTC"
    sendOpen={sendOpen}
    onSend={() => setSendOpen(true)}
    onEdit={jest.fn()}
    onBack={jest.fn()}
    onCopyGeneralLink={async () => undefined}
    onRefresh={jest.fn()}
  />;
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
});

it("opens the shared review flow with only the chosen previously sent volunteer selected", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: reviewedBatch });
  render(<Harness />);

  await user.click(screen.getByRole("button", { name: "Actions for Rae Kim" }));
  await user.click(screen.getByRole("menuitem", { name: "Resend link" }));

  const dialog = screen.getByRole("dialog", { name: "Send requests" });
  expect(within(dialog).getByRole("radio", { name: "Specific volunteers" })).toBeChecked();
  expect(within(dialog).getAllByText("1 selected").length).toBeGreaterThan(0);
  expect(within(dialog).getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();

  await user.click(within(dialog).getByRole("button", { name: "Continue to review" }));
  const review = await screen.findByRole("dialog", { name: "Review text messages" });
  expect(within(review).getByText("Specific volunteers")).toBeInTheDocument();
  expect(within(review).getByText(/Previously sent on/)).toBeInTheDocument();
  expect(within(review).getByText(reviewedBatch.recipients[0].message!)).toBeInTheDocument();
  expect(prepareAvailabilityNotificationBatch).toHaveBeenCalledWith(form.churchId, expect.objectContaining({
    intentType: "availability_request",
    audienceType: "specific",
    formId: form.formId,
    memberIds: [member.memberId],
  }));
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();

  await user.click(within(review).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send requests" })).not.toBeInTheDocument());
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();
});
