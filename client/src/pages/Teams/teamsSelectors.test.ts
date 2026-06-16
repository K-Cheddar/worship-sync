import type { TeamIntakeSubmission } from "../../api/authTypes";
import {
  intakeSubmissionNeedsAction,
  submissionMatchesStatusFilter,
} from "./teamsSelectors";

const STATUSES: TeamIntakeSubmission["status"][] = [
  "new",
  "applied",
  "dismissed",
];

describe("intake submission status filtering", () => {
  it("treats new as needing action, applied and dismissed as done", () => {
    expect(intakeSubmissionNeedsAction({ status: "new" })).toBe(true);
    expect(intakeSubmissionNeedsAction({ status: "applied" })).toBe(false);
    expect(intakeSubmissionNeedsAction({ status: "dismissed" })).toBe(false);
  });

  it("the needs_action filter keeps only open submissions", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "needs_action"),
    );
    expect(kept).toEqual(["new"]);
  });

  it("the processed filter keeps only resolved submissions", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "processed"),
    );
    expect(kept).toEqual(["applied", "dismissed"]);
  });

  it("the all filter keeps every submission", () => {
    const kept = STATUSES.filter((status) =>
      submissionMatchesStatusFilter(status, "all"),
    );
    expect(kept).toEqual(STATUSES);
  });
});
