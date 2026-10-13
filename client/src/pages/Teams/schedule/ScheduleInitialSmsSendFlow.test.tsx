import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationBatch, ScheduleInitialSmsRecipient, TeamSchedule } from "../../../api/authTypes";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getScheduleInitialSmsRecipients,
  prepareScheduleInitialSmsBatch,
} from "../../../api/auth";
import ScheduleInitialSmsSendFlow from "./ScheduleInitialSmsSendFlow";

jest.mock("../../../api/auth", () => ({
  getScheduleInitialSmsRecipients: jest.fn(),
  dispatchAvailabilityNotificationBatch: jest.fn(),
  prepareScheduleInitialSmsBatch: jest.fn(),
  getAvailabilityNotificationBatch: jest.fn(),
}));

const mockedGetRecipients = jest.mocked(getScheduleInitialSmsRecipients);
const mockedDispatchBatch = jest.mocked(dispatchAvailabilityNotificationBatch);
const mockedPrepareBatch = jest.mocked(prepareScheduleInitialSmsBatch);
const mockedGetBatch = jest.mocked(getAvailabilityNotificationBatch);

const makeRecipient = (
  memberId: string,
  memberName: string,
  overrides: Partial<ScheduleInitialSmsRecipient> = {},
): ScheduleInitialSmsRecipient => ({
  memberId,
  memberName,
  assignments: [{
    occurrenceId: "occurrence-1",
    serviceName: "Sunday Service",
    serviceDate: "2026-10-18",
    startsAt: "2026-10-18T14:00:00.000Z",
    positions: [{ positionId: "position-1", positionName: "Keys" }],
  }],
  eligibilityStatus: "enabled",
  eligible: true,
  exclusionReason: "",
  previousDeliveryStatus: "first_send",
  status: "preview",
  intentId: "",
  segmentCount: 0,
  maskedPhoneNumber: "••• ••• 1234",
  ...overrides,
});

const recipientsResponse = (recipients: ScheduleInitialSmsRecipient[]) => ({
  success: true,
  historyComplete: true,
  dispatchEnabled: false,
  dispatchReadinessMessage: "Bulk schedule SMS is paused until the server is ready for safe dispatch and restart recovery.",
  privacySafe: true,
  hasPreparedSelection: false,
  scheduleId: "schedule-1",
  published: true,
  batchId: "batch-1",
  selectedMemberIds: [],
  recipients,
  summary: { assigned: 2, total: recipients.length, eligible: 2, alreadySent: 0, failed: 1, uncertain: 1, missingConsent: 0, optedOut: 0, missingPhone: 0, ineligible: 0 },
});

const schedule = (assignments: TeamSchedule["assignments"]): TeamSchedule => ({
  scheduleId: "schedule-1",
  churchId: "church-1",
  name: "October schedule",
  teamId: "team-1",
  serviceIds: ["service-1"],
  occurrences: [{ occurrenceId: "occurrence-1", serviceId: "service-1", name: "Sunday Service", startsAt: "2026-10-18T14:00:00.000Z" }],
  assignments,
});

const preparedBatch: NotificationBatch = {
  batchId: "batch-1",
  churchId: "church-1",
  scheduleId: "schedule-1",
  intentType: "schedule_initial_notification",
  status: "prepared",
  selectedMemberIds: ["alice", "bob"],
  intentIds: ["intent-alice", "intent-bob"],
  approvalVersion: "review-1",
  recipients: [
    { memberId: "alice", memberName: "Alice Able", eligible: true, status: "ready", segmentCount: 2, message: "Alice, you are assigned for Sunday Service. Reply here: [private response link] STOP to opt out.", maskedPhoneNumber: "••• ••• 1234" },
    { memberId: "bob", memberName: "Bob Baker", eligible: true, status: "ready", segmentCount: 1, message: "Bob, you are assigned for Sunday Service. Reply here: [private response link] STOP to opt out.", maskedPhoneNumber: "••• ••• 5678" },
  ],
  summary: { requested: 2, selected: 2, eligible: 2, awaitingDispatch: 2, alreadySent: 0, excluded: 0, totalSegments: 3, sent: 0, delivered: 0, failed: 0, uncertain: 0, optedOut: 0 },
};

const renderFlow = (currentSchedule = schedule({})) => render(
  <ScheduleInitialSmsSendFlow
    churchId="church-1"
    schedule={currentSchedule}
    scheduleName="October schedule"
    teamName="Worship Team"
    timeZone="America/New_York"
    onClose={jest.fn()}
  />,
);

describe("ScheduleInitialSmsSendFlow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRecipients.mockResolvedValue(recipientsResponse([
      makeRecipient("alice", "Alice Able"),
      makeRecipient("bob", "Bob Baker", { previousDeliveryStatus: "failed", status: "failed" }),
      makeRecipient("unknown", "Una Uncertain", { eligible: false, previousDeliveryStatus: "uncertain", status: "unknown", exclusionReason: "A previous send is active or its provider outcome is uncertain." }),
    ]));
    mockedPrepareBatch.mockResolvedValue({ success: true, batch: preparedBatch, privacySafe: true });
    mockedGetBatch.mockResolvedValue({ success: true, batch: preparedBatch });
  });

  it("recovers an approved batch from the server and polls progress while the panel is open", async () => {
    jest.useFakeTimers();
    const approvedBatch: NotificationBatch = {
      ...preparedBatch,
      status: "approved",
      recipients: preparedBatch.recipients.map((row) => ({ ...row, status: "preview" })),
      summary: { ...preparedBatch.summary, awaitingExecution: 2, sending: 0 },
    };
    const dispatchingBatch: NotificationBatch = {
      ...approvedBatch,
      status: "dispatching",
      recipients: approvedBatch.recipients.map((row, index) => ({ ...row, status: index === 0 ? "sent" : "sending" })),
      summary: { ...approvedBatch.summary, awaitingExecution: 0, sending: 1, sent: 1 },
    };
    mockedGetRecipients.mockResolvedValue({
      ...recipientsResponse([makeRecipient("alice", "Alice Able"), makeRecipient("bob", "Bob Baker")]),
      selectedMemberIds: ["alice", "bob"],
      currentBatch: approvedBatch,
    });
    mockedGetBatch.mockResolvedValue({ success: true, batch: dispatchingBatch });
    renderFlow();

    expect(await screen.findByText(/Approved messages are being processed/)).toBeInTheDocument();
    expect(screen.getByText(/2 selected · 2 awaiting execution · 0 sending · 0 accepted by provider/)).toBeInTheDocument();
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(mockedGetBatch).toHaveBeenCalledWith("church-1", "batch-1");
    expect(await screen.findByText(/1 sending · 1 accepted by provider/)).toBeInTheDocument();
    jest.useRealTimers();
  });

  it("shows recent batch result summaries after a newer review replaces the current batch", async () => {
    mockedGetRecipients.mockResolvedValue({
      ...recipientsResponse([makeRecipient("alice", "Alice Able")]),
      recentBatches: [{
        reviewVersion: "old-review",
        approvedAt: "2026-10-12T15:00:00.000Z",
        status: "partial",
        selected: 2,
        summary: { accepted: 1, delivered: 1, failed: 0, uncertain: 1, awaiting: 0, excluded: 0 },
      }],
    });
    renderFlow();

    expect(await screen.findByText(/Recent schedule SMS batches \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Partial results/)).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.tagName === "P" && element.textContent?.startsWith("2 selected"))).toBeInTheDocument();
  });

  it("confirms with fake delivery, recovers progress in a second client, and keeps accepted recipients blocked", async () => {
    const user = userEvent.setup();
    const alice = makeRecipient("alice", "Alice Able");
    const reviewed: NotificationBatch = {
      ...preparedBatch,
      selectedMemberIds: ["alice"],
      intentIds: ["intent-alice"],
      recipients: [preparedBatch.recipients[0]],
      summary: { ...preparedBatch.summary, selected: 1, eligible: 1, awaitingDispatch: 1, totalSegments: 2 },
    };
    const approved: NotificationBatch = {
      ...reviewed,
      status: "approved",
      recipients: reviewed.recipients.map((row) => ({ ...row, status: "ready" })),
      summary: { ...reviewed.summary, awaitingExecution: 1, sending: 0 },
    };
    const dispatching: NotificationBatch = {
      ...approved,
      status: "dispatching",
      recipients: approved.recipients.map((row) => ({ ...row, status: "sent", attemptStatus: "accepted" })),
      summary: { ...approved.summary, awaitingExecution: 0, sent: 1, alreadySent: 1 },
    };
    mockedGetRecipients.mockResolvedValueOnce({
      ...recipientsResponse([alice]),
      dispatchEnabled: true,
      dispatchReadinessMessage: "",
    });
    mockedPrepareBatch.mockResolvedValueOnce({ success: true, batch: reviewed, privacySafe: true });
    mockedDispatchBatch.mockResolvedValueOnce({ success: true, batch: approved });
    mockedGetBatch.mockResolvedValue({ success: true, batch: dispatching });

    const { unmount: unmountFirstClient } = renderFlow();
    await user.click(await screen.findByRole("button", { name: "Review 1 message" }));
    expect(await screen.findByText(/Messages are ready to review/)).toBeInTheDocument();
    const sendButton = await screen.findByRole("button", { name: "Send 1 message" });
    expect(sendButton).toBeEnabled();
    await user.click(sendButton);
    await waitFor(() => expect(mockedDispatchBatch).toHaveBeenCalledWith("church-1", "batch-1", "review-1"));
    expect(await screen.findByText(/Approved messages are being processed/)).toBeInTheDocument();
    unmountFirstClient();

    mockedGetRecipients.mockResolvedValueOnce({
      ...recipientsResponse([makeRecipient("alice", "Alice Able", { eligible: false, previousDeliveryStatus: "accepted", status: "sent" })]),
      dispatchEnabled: true,
      dispatchReadinessMessage: "",
      currentBatch: dispatching,
      selectedMemberIds: ["alice"],
    });
    const { unmount: unmountSecondClient } = renderFlow();
    expect(await screen.findByRole("checkbox", { name: "Alice Able" })).toBeDisabled();
    expect(await screen.findByText(/1 accepted by provider/)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3100)); });
    expect(mockedGetBatch).toHaveBeenCalledWith("church-1", "batch-1");
    expect(await screen.findAllByText(/Accepted by provider/)).toHaveLength(2);
    expect(screen.queryByText(/Sending unavailable/)).not.toBeInTheDocument();
    unmountSecondClient();
  });

  it("defaults to first-send members, requires explicit retry selection, preserves selection through search, and saves a gated message review", async () => {
    const user = userEvent.setup();
    renderFlow();

    const alice = await screen.findByRole("checkbox", { name: "Alice Able" });
    const bob = screen.getByRole("checkbox", { name: "Bob Baker" });
    const uncertain = screen.getByRole("checkbox", { name: "Una Uncertain" });
    expect(alice).toBeChecked();
    expect(bob).not.toBeChecked();
    expect(uncertain).toBeDisabled();

    const search = screen.getByLabelText(/Search volunteers/);
    await user.type(search, "Bob");
    await user.click(bob);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.clear(search);
    expect(screen.getByRole("checkbox", { name: "Alice Able" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob Baker" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Review 2 messages" }));
    await waitFor(() => expect(mockedPrepareBatch).toHaveBeenCalledWith("church-1", "schedule-1", ["alice", "bob"]));
    expect(await screen.findByText(/Messages are ready to review/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sending unavailable" })).toBeDisabled();
    expect(screen.getByText(/paused until the server is ready for safe dispatch and restart recovery/)).toBeInTheDocument();
    expect(screen.getByText(/3 expected SMS segments/)).toBeInTheDocument();
    await user.click(screen.getAllByText("View message")[0]);
    expect(screen.getAllByText(/Reply here: \[private response link\]/)).toHaveLength(2);
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
  });

  it("ignores a recipient result for the prior schedule source", async () => {
    let resolveOld: (value: ReturnType<typeof recipientsResponse>) => void = () => undefined;
    mockedGetRecipients
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(recipientsResponse([makeRecipient("new-member", "Current Volunteer")]));
    const view = renderFlow(schedule({ "occurrence-1": { "position-1::0": { primaryMemberId: "old-member" } } }));

    view.rerender(
      <ScheduleInitialSmsSendFlow
        churchId="church-1"
        schedule={schedule({ "occurrence-1": { "position-1::0": { primaryMemberId: "new-member" } } })}
        scheduleName="October schedule"
        teamName="Worship Team"
        timeZone="America/New_York"
        onClose={jest.fn()}
      />,
    );
    expect(await screen.findByRole("checkbox", { name: "Current Volunteer" })).toBeChecked();

    await act(async () => { resolveOld(recipientsResponse([makeRecipient("old-member", "Old Volunteer")])); });
    expect(screen.queryByRole("checkbox", { name: "Old Volunteer" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Current Volunteer" })).toBeChecked();
  });
});
