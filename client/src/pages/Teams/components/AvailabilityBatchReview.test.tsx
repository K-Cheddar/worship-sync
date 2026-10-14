import { fireEvent, render, screen } from "@testing-library/react";
import AvailabilityBatchReview from "./AvailabilityBatchReview";
import type { NotificationBatch } from "../../../api/authTypes";

const batch: NotificationBatch = {
  batchId: "batch-1",
  churchId: "church-1",
  formId: "form-1",
  intentType: "availability_request",
  reminderRound: 0,
  status: "sent",
  selectedMemberIds: ["one"],
  recipients: [{ memberId: "one", memberName: "Rae Rivera", eligible: true, status: "sent", segmentCount: 1, attemptStatus: "delivered" }],
  intentIds: ["intent-1"],
  approvalVersion: "approval-1",
  summary: { requested: 1, selected: 1, eligible: 1, awaitingDispatch: 0, alreadySent: 0, excluded: 0, totalSegments: 1, sent: 1, delivered: 1, failed: 1, uncertain: 1, responded: 2, waiting: 3, optedOut: 1 },
};

it("keeps delivery and response counts separate and surfaces send exceptions", () => {
  render(<AvailabilityBatchReview batch={batch} formName="October Availability" busy={false} onConfirm={jest.fn()} />);

  expect(screen.getByText("Delivered")).toBeInTheDocument();
  expect(screen.getByText("Responded")).toBeInTheDocument();
  expect(screen.getByText("Waiting for a response")).toBeInTheDocument();
  expect(screen.getByText("1 failed · 1 could not be confirmed · 1 phone number opted out")).toBeInTheDocument();
  expect(screen.getAllByRole("definition").map((element) => element.textContent)).toEqual(["1", "1", "2", "3"]);
  expect(screen.getByText(/Sent · Delivered/)).toBeInTheDocument();
});

it("shows a shared phone destination while retaining each member's separate private message", () => {
  const sharedBatch: NotificationBatch = {
    ...batch,
    status: "prepared",
    selectedMemberIds: ["one", "two"],
    recipients: [
      { memberId: "one", memberName: "Rae Rivera", eligible: true, status: "preview", segmentCount: 1, phoneNumberSnapshot: "+14155550123", message: "Rae's private link: https://example.test/a/rae-token" },
      { memberId: "two", memberName: "Sam Rivera", eligible: true, status: "preview", segmentCount: 1, phoneNumberSnapshot: "+14155550123", message: "Sam's private link: https://example.test/a/sam-token" },
    ],
    summary: { ...batch.summary, selected: 2, eligible: 2, totalSegments: 2 },
  };
  render(<AvailabilityBatchReview batch={sharedBatch} formName="October Availability" busy={false} onConfirm={jest.fn()} />);

  expect(screen.getAllByText(/\+14155550123/)).toHaveLength(2);
  expect(screen.getAllByText(/Shared phone number · each volunteer gets a separate private message\./)).toHaveLength(2);
  screen.getAllByText("View message").forEach((summary) => fireEvent.click(summary));
  expect(screen.getByText(/rae-token/)).toBeInTheDocument();
  expect(screen.getByText(/sam-token/)).toBeInTheDocument();
});

it("shows a plain-language confirmation with recipient messages, count, and scoped phone details", () => {
  const confirmationBatch: NotificationBatch = {
    ...batch,
    status: "prepared",
    selectedMemberIds: ["one", "two", "three"],
    recipients: [
      { memberId: "one", memberName: "Rae Rivera", eligible: true, status: "ready", segmentCount: 2, phoneNumberSnapshot: "+14155550123", maskedPhoneNumber: "••• ••• 0123", message: "Rae's private link: https://example.test/a/rae-token" },
      { memberId: "two", memberName: "Sam Rivera", eligible: true, status: "ready", segmentCount: 1, phoneNumberSnapshot: "+14155550124", maskedPhoneNumber: "••• ••• 0124", message: "Sam's private link: https://example.test/a/sam-token" },
      { memberId: "three", memberName: "Alex Rivera", eligible: false, status: "excluded", segmentCount: 0, exclusionReason: "SMS consent is needed." },
    ],
    summary: { ...batch.summary, selected: 3, eligible: 2, excluded: 1, totalSegments: 3 },
  };
  render(<AvailabilityBatchReview batch={confirmationBatch} formName="October Availability" busy={false} privacySafe mode="confirmation" />);

  expect(screen.getByText("2 volunteers will receive a text message.")).toBeInTheDocument();
  expect(screen.getByText("Estimated texts: 3.")).toBeInTheDocument();
  expect(screen.getByText("This longer message counts as 2 texts.")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("1 selected volunteer won't receive a new message.");
  expect(screen.getByRole("alert")).toHaveTextContent("Text message consent is needed.");
  expect(screen.getByText("••• ••• 0123")).toBeInTheDocument();
  expect(screen.queryByText("+14155550123")).not.toBeInTheDocument();
  const messageSummaries = screen.getAllByText("View message");
  expect(messageSummaries).toHaveLength(2);
  fireEvent.click(messageSummaries[0]);
  expect(screen.getByText(/rae-token/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
});

it("shows truthful progress for sending, partial, and completed batches without a send action", () => {
  const sendingBatch: NotificationBatch = {
    ...batch,
    status: "dispatching",
    recipients: [
      { memberId: "one", memberName: "Rae Rivera", eligible: true, status: "sending", segmentCount: 1, phoneNumberSnapshot: "+14155550123" },
      { memberId: "two", memberName: "Sam Rivera", eligible: true, status: "preview", segmentCount: 1, phoneNumberSnapshot: "+14155550124" },
    ],
    summary: { ...batch.summary, selected: 2, eligible: 2, awaitingExecution: 1, sending: 1, sent: 0, delivered: 0, failed: 0, uncertain: 0 },
  };
  const { rerender } = render(<AvailabilityBatchReview batch={sendingBatch} formName="October Availability" busy={false} mode="status" />);
  expect(screen.getByRole("status")).toHaveTextContent("Messages are sending.");
  expect(screen.getAllByText(/Sending/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Waiting to send/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();

  const partialBatch: NotificationBatch = {
    ...sendingBatch,
    status: "partial",
    recipients: [
      { memberId: "one", memberName: "Rae Rivera", eligible: false, status: "unknown", attemptOutcome: "unknown", segmentCount: 1 },
      { memberId: "two", memberName: "Sam Rivera", eligible: false, status: "failed", segmentCount: 1 },
    ],
    summary: { ...sendingBatch.summary, eligible: 0, awaitingExecution: 0, sending: 0, sent: 0, failed: 1, uncertain: 1 },
  };
  rerender(<AvailabilityBatchReview batch={partialBatch} formName="October Availability" busy={false} mode="status" />);
  expect(screen.getByRole("status")).toHaveTextContent("Some messages failed or we could not confirm whether they were sent.");
  expect(screen.getByText(/Could not confirm whether this was sent/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();

  const completeBatch = { ...partialBatch, status: "complete" as const, summary: { ...partialBatch.summary, failed: 0, uncertain: 0, sent: 2 } };
  rerender(<AvailabilityBatchReview batch={completeBatch} formName="October Availability" busy={false} mode="status" />);
  expect(screen.getByRole("status")).toHaveTextContent("All selected messages have been processed.");
  expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
});
