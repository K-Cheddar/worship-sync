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
  expect(screen.getByText("Waiting")).toBeInTheDocument();
  expect(screen.getByText("1 failed · 1 uncertain · 1 opted out")).toBeInTheDocument();
  expect(screen.getAllByRole("definition").map((element) => element.textContent)).toEqual(["1", "1", "2", "3"]);
  expect(screen.getByText(/Accepted by provider · Delivered/)).toBeInTheDocument();
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
  expect(screen.getAllByText(/Shared destination · 2 members receive separate private links\./)).toHaveLength(2);
  screen.getAllByText("View message").forEach((summary) => fireEvent.click(summary));
  expect(screen.getByText(/rae-token/)).toBeInTheDocument();
  expect(screen.getByText(/sam-token/)).toBeInTheDocument();
});
