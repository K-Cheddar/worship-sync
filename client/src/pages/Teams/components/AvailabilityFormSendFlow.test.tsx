import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AvailabilityFormSendFlow from "./AvailabilityFormSendFlow";
import { dispatchAvailabilityNotificationBatch, prepareAvailabilityNotificationBatch } from "../../../api/auth";
import type { NotificationBatch, TeamIntakeForm, TeamRosterMember } from "../../../api/authTypes";

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

beforeEach(() => jest.clearAllMocks());

it("prepares and reviews personalized messages without sending until explicit confirmation", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  jest.mocked(dispatchAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch: { ...batch, status: "sent" } });
  render(<AvailabilityFormSendFlow churchId="church-1" form={form} members={[member]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{ [member.memberId]: { status: "enabled", eligible: true } }} onClose={jest.fn()} />);

  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));
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
  render(<AvailabilityFormSendFlow churchId="church-1" form={form} members={[member, secondMember]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [secondMember.memberId]: { status: "enabled", eligible: true },
  }} onClose={jest.fn()} />);

  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));
  await user.click(screen.getByRole("checkbox", { name: "Sam Lee" }));
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
  render(<AvailabilityFormSendFlow churchId="church-1" form={form} members={[member, secondMember]} positions={[]} teams={[]} recipients={[]} eligibilityByMemberId={{
    [member.memberId]: { status: "enabled", eligible: true },
    [secondMember.memberId]: { status: "enabled", eligible: true },
  }} onClose={jest.fn()} />);

  await user.click(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ }));
  await user.click(screen.getByRole("button", { name: "Review 2 messages" }));
  expect(await screen.findByRole("button", { name: "Send 2 messages" })).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Select all 2 eligible shown/ }));
  expect(screen.queryByRole("button", { name: "Send 2 messages" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("button", { name: "Send 2 messages" })).not.toBeInTheDocument();
});

it("clears a reviewed batch when the form context changes while mounted", async () => {
  const user = userEvent.setup();
  jest.mocked(prepareAvailabilityNotificationBatch).mockResolvedValue({ success: true, batch });
  const props = {
    churchId: "church-1", members: [member], positions: [], teams: [], recipients: [],
    eligibilityByMemberId: { [member.memberId]: { status: "enabled" as const, eligible: true } }, onClose: jest.fn(),
  };
  const view = render(<AvailabilityFormSendFlow {...props} form={form} />);
  await user.click(screen.getByRole("checkbox", { name: "Rae Kim" }));
  await user.click(screen.getByRole("button", { name: "Review 1 message" }));
  expect(await screen.findByRole("button", { name: "Send 1 message" })).toBeInTheDocument();

  view.rerender(<AvailabilityFormSendFlow {...props} form={{ ...form, formId: "form-2", name: "November availability" }} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Send 1 message" })).not.toBeInTheDocument());
  expect(screen.getByRole("status")).toHaveTextContent("Form changed");
});
