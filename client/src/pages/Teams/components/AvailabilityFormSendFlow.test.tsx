import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AvailabilityFormSendFlow from "./AvailabilityFormSendFlow";
import { dispatchAvailabilityNotificationBatch, prepareAvailabilityNotificationBatch } from "../../../api/auth";
import type { NotificationBatch, NotificationIntent, TeamIntakeForm, TeamRosterMember } from "../../../api/authTypes";

jest.mock("../../../api/auth", () => ({
  dispatchAvailabilityNotificationBatch: jest.fn(),
  prepareAvailabilityNotificationBatch: jest.fn(),
}));

const form: TeamIntakeForm = {
  formId: "form-1",
  churchId: "church-1",
  name: "October Availability",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  availabilityServices: [],
  availabilityOccurrences: [],
  teamIds: ["worship"],
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

const secondMember: TeamRosterMember = {
  ...member,
  memberId: "member-2",
  firstName: "Sam",
  lastName: "Lee",
};

const batch: NotificationBatch = {
  batchId: "batch-1",
  churchId: "church-1",
  formId: "form-1",
  intentType: "availability_request",
  reminderRound: 0,
  status: "prepared",
  selectedMemberIds: [member.memberId],
  recipients: [{
    memberId: member.memberId,
    memberName: "Rae Kim",
    maskedPhoneNumber: "••• ••• 1234",
    eligibilityStatus: "enabled",
    eligible: true,
    intentId: "intent-1",
    status: "ready",
    segmentCount: 1,
    message: "Respond at https://example.test/a/private-token",
  }],
  intentIds: ["intent-1"],
  approvalVersion: "approval-v1",
  summary: { requested: 1, selected: 1, eligible: 1, awaitingDispatch: 1, alreadySent: 0, excluded: 0, totalSegments: 1, sent: 0, delivered: 0, failed: 0, uncertain: 0, responded: 0, waiting: 1, optedOut: 0 },
};

const emptyHistoryProps = {
  notificationIntents: [],
  smsDeliveryAttempts: [],
  historyLoaded: true,
  historyError: "",
  onRetryHistory: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

it("prepares and reviews personalized messages without sending until explicit confirmation", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: { ...batch, status: "sent" } });
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{ [member.memberId]: { status: "enabled", eligible: true } }} onClose={jest.fn()} />);

  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await user.click(await screen.findByText("View message"));
  await screen.findByText(/private-token/);
  expect(prepareAvailabilityNotificationBatch).toHaveBeenCalledWith("church-1", expect.objectContaining({ intentType: "availability_request", formId: form.formId, memberIds: [member.memberId] }));
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();

  const reviewSendButtons = screen.getAllByRole("button", { name: "Send 1 message" });
  await user.click(reviewSendButtons[0]);
  await user.click(screen.getAllByRole("button", { name: "Send 1 message" }).at(-1)!);
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church-1", "batch-1", "approval-v1"));
});

it("invalidates a prepared review when a recipient is unchecked and prepares only the new selection", async () => {
  const user = userEvent.setup();
  const twoRecipientBatch: NotificationBatch = {
    ...batch,
    selectedMemberIds: [member.memberId, secondMember.memberId],
    recipients: [batch.recipients[0], { ...batch.recipients[0], memberId: secondMember.memberId, memberName: "Sam Lee", intentId: "intent-2" }],
    intentIds: ["intent-1", "intent-2"],
    summary: { ...batch.summary, requested: 2, selected: 2, eligible: 2, awaitingDispatch: 2, totalSegments: 2, waiting: 2 },
  };
  jest.mocked(prepareAvailabilityNotificationBatch)
    .mockResolvedValueOnce({ success: true, batch: twoRecipientBatch })
    .mockResolvedValueOnce({ success: true, batch });
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member, secondMember]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [secondMember.memberId]: { status: "enabled", eligible: true },
  }} onClose={jest.fn()} />);

  await user.click(screen.getByRole("button", { name: "Review 2 messages" }));
  expect(await screen.findByRole("button", { name: "Send 2 messages" })).toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
  expect(screen.queryByRole("button", { name: "Send 2 messages" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Recipients changed");
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));

  await waitFor(() => expect(prepareAvailabilityNotificationBatch).toHaveBeenLastCalledWith("church-1", expect.objectContaining({ memberIds: [member.memberId] })));
});

it("invalidates review after Select visible and Clear", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member, secondMember]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [secondMember.memberId]: { status: "enabled", eligible: true },
  }} onClose={jest.fn()} />);

  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
});

it("closes an outdated confirmation when recipient eligibility changes", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  const props = {
    ...emptyHistoryProps,
    churchId: "church-1",
    form,
    members: [member],
    positions: [],
    teams: [],
    recipients: [],
    eligibilityByMemberId: { [member.memberId]: { status: "enabled" as const, eligible: true } },
    onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} />);
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await user.click(await screen.findByRole("button", { name: "Send 1 message" }));
  expect(screen.getByRole("dialog", { name: "Send this form?" })).toBeInTheDocument();

  view.rerender(<AvailabilityFormSendFlow {...props} eligibilityByMemberId={{
    [member.memberId]: { status: "opted_out", eligible: false },
  }} />);

  expect(screen.queryByRole("dialog", { name: "Send this form?" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
});

it("requires refreshed history before confirmation can stay open or dispatch", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: { ...batch, status: "sent" } });
  const props = {
    ...emptyHistoryProps,
    churchId: "church-1",
    form,
    members: [member],
    positions: [],
    teams: [],
    recipients: [],
    eligibilityByMemberId: { [member.memberId]: { status: "enabled" as const, eligible: true } },
    onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} />);
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  await screen.findByRole("button", { name: "Send 1 message" });
  await user.click(screen.getByRole("button", { name: "Send 1 message" }));
  expect(screen.getByRole("dialog", { name: "Send this form?" })).toBeInTheDocument();

  view.rerender(<AvailabilityFormSendFlow {...props} historyLoaded={false} />);
  expect(screen.queryByRole("dialog", { name: "Send this form?" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send 1 message" })).toBeDisabled();
  expect(dispatchAvailabilityNotificationBatch).not.toHaveBeenCalled();

  view.rerender(<AvailabilityFormSendFlow {...props} historyLoaded />);
  expect(screen.queryByRole("dialog", { name: "Send this form?" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send 1 message" }));
  const sendButtons = screen.getAllByRole("button", { name: "Send 1 message" });
  await user.click(sendButtons[sendButtons.length - 1]);
  await waitFor(() => expect(dispatchAvailabilityNotificationBatch).toHaveBeenCalledWith("church-1", "batch-1", "approval-v1"));
});

it("clears a reviewed batch when the form context changes while mounted", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  const props = {
    ...emptyHistoryProps, churchId: "church-1", members: [member], positions: [], teams: [], recipients: [],
    eligibilityByMemberId: { [member.memberId]: { status: "enabled" as const, eligible: true } }, onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} form={form} />);
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();

  view.rerender(<AvailabilityFormSendFlow {...props} form={{ ...form, formId: "form-2", name: "November availability" }} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument());
  expect(screen.getByRole("status")).toHaveTextContent("Form changed");
});

it("automatically selects newly eligible members after consent refresh without reselecting an unchecked member", async () => {
  const user = userEvent.setup();
  const props = {
    ...emptyHistoryProps,
    churchId: "church-1",
    form,
    members: [member, secondMember],
    positions: [],
    teams: [],
    recipients: [],
    eligibilityByMemberId: {
      [member.memberId]: { status: "enabled" as const, eligible: true },
      [secondMember.memberId]: { status: "consent_needed" as const, eligible: false },
    },
    onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} />);
  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));

  view.rerender(<AvailabilityFormSendFlow {...props} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [secondMember.memberId]: { status: "enabled", eligible: true },
  }} />);

  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Review 1 message" })).toBeEnabled();
});

it("keeps recipient selection when team and name filters change", async () => {
  const user = userEvent.setup();
  const worshipMember = { ...member, teamMemberships: { worship: { teamId: "worship" } } };
  const careMember = { ...secondMember, teamMemberships: { care: { teamId: "care" } } };
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={{ ...form, teamIds: [] }} members={[worshipMember, careMember]} positions={[]} teams={[
    { teamId: "worship", churchId: "church-1", name: "Worship", memberIds: [worshipMember.memberId] },
    { teamId: "care", churchId: "church-1", name: "Care", memberIds: [careMember.memberId] },
  ]} recipients={[]} eligibilityByMemberId={{
    [worshipMember.memberId]: { status: "enabled", eligible: true },
    [careMember.memberId]: { status: "enabled", eligible: true },
  }} onClose={jest.fn()} />);

  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeChecked();
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "Worship" }));
  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Sam Lee" })).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /Search members/ }), "Rae");
  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  await user.clear(screen.getByRole("textbox", { name: /Search members/ }));
  await user.click(screen.getByRole("combobox", { name: /Team/ }));
  await user.click(screen.getByRole("option", { name: "All teams" }));
  await user.type(screen.getByRole("textbox", { name: /Search members/ }), "Sam");
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Rae Kim" })).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: /Search members/ }));
  expect(screen.getByText("2 selected")).toBeInTheDocument();
});

it("keeps sent and responded members out of automatic selection", () => {
  const worshipMemberships = { worship: { teamId: "worship" } };
  const sentMember = { ...secondMember, memberId: "member-sent", firstName: "Alex", teamMemberships: worshipMemberships };
  const respondedMember = { ...secondMember, memberId: "member-responded", firstName: "Casey", teamMemberships: worshipMemberships };
  const recipients = [
    { recipientId: "recipient-sent", churchId: "church-1", formId: form.formId, memberId: sentMember.memberId, createdAt: "2026-09-01" },
    { recipientId: "recipient-responded", churchId: "church-1", formId: form.formId, memberId: respondedMember.memberId, createdAt: "2026-09-01", respondedAt: "2026-09-20" },
  ];
  const sentIntent: NotificationIntent = {
    intentId: "sent-intent", churchId: "church-1", formId: form.formId, recipientId: "recipient-sent", memberId: sentMember.memberId,
    intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: "recipient-sent", sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "sent", createdAt: "2026-09-01", updatedAt: "2026-09-01",
  };
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member, sentMember, respondedMember]} positions={[]} teams={[]} recipients={recipients} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [sentMember.memberId]: { status: "enabled", eligible: true },
    [respondedMember.memberId]: { status: "enabled", eligible: true },
  }} notificationIntents={[sentIntent]} onClose={jest.fn()} />);

  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Alex Lee" })).toBeDisabled();
  expect(screen.getAllByText("Already sent").length).toBeGreaterThan(1);
  expect(screen.getByRole("checkbox", { name: "Casey Lee" })).toBeDisabled();
  expect(screen.getAllByText("Already responded").length).toBeGreaterThan(1);
});

it("leaves previous failures unchecked until the operator selects them for retry", async () => {
  const user = userEvent.setup();
  const failedMember = { ...secondMember, memberId: "member-failed", teamMemberships: member.teamMemberships };
  const failedRecipient = { recipientId: "recipient-failed", churchId: "church-1", formId: form.formId, memberId: failedMember.memberId, createdAt: "2026-09-01" };
  const failedIntent: NotificationIntent = {
    intentId: "failed-intent", churchId: "church-1", formId: form.formId, recipientId: failedRecipient.recipientId, memberId: failedMember.memberId,
    intentType: "availability_request", sourceType: "team_intake_recipient", sourceId: failedRecipient.recipientId,
    sourceVersion: "", occurrenceId: "", channel: "sms", message: "", status: "failed", createdAt: "2026-09-01", updatedAt: "2026-09-01",
  };
  const failedAttempt = {
    attemptId: "attempt-failed", churchId: "church-1", recipientType: "notification_intent" as const,
    recipientId: failedRecipient.recipientId, memberId: failedMember.memberId, formId: form.formId,
    provider: "twilio", purpose: "availability_request" as const, status: "failed" as const,
    outcome: "failed" as const, createdAt: "2026-09-01", updatedAt: "2026-09-01",
  };
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member, failedMember]} positions={[]} teams={[]} recipients={[failedRecipient]} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [failedMember.memberId]: { status: "enabled", eligible: true },
  }} notificationIntents={[failedIntent]} smsDeliveryAttempts={[failedAttempt]} onClose={jest.fn()} />);

  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeChecked();
  expect(screen.getByText("First send · SMS ready")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeEnabled();
  expect(screen.getByText("Previous send failed · select to retry")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review 1 message" })).toBeEnabled();

  await user.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
  expect(screen.getByRole("checkbox", { name: "Sam Lee" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Review 2 messages" })).toBeEnabled();
});

it("does not expose recipient selection before full history loads", () => {
  render(<AvailabilityFormSendFlow {...emptyHistoryProps} churchId="church-1" form={form} members={[member]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{ [member.memberId]: { status: "enabled", eligible: true } }} historyLoaded={false} onClose={jest.fn()} />);

  expect(screen.getByRole("status")).toHaveTextContent("Loading consent and message history");
  expect(screen.getByRole("checkbox", { name: "Rae Kim" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review 1 message" })).toBeDisabled();
});

it("invalidates the current review when form details change under the same form id", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  const props = {
    ...emptyHistoryProps,
    churchId: "church-1",
    members: [member],
    positions: [],
    teams: [],
    recipients: [],
    eligibilityByMemberId: { [member.memberId]: { status: "enabled" as const, eligible: true } },
    onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} form={form} />);
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();

  view.rerender(<AvailabilityFormSendFlow {...props} form={{ ...form, availabilityMessage: "Please update your dates." }} />);

  expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Form details changed");
});
