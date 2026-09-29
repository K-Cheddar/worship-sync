import { render, screen } from "@testing-library/react";
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
  expect(screen.getByText(/1 SMS segment · Delivered/)).toBeInTheDocument();
});
