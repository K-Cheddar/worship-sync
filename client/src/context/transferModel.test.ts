import { getActivitySummary, getTransferOverview, type Transfer } from "./transferModel";

const transfer = (id: string, progress: number | null): Transfer => ({
  id,
  type: "test",
  name: id,
  status: "active",
  progress,
});

describe("getTransferOverview", () => {
  it("averages determinate active transfer progress and includes new zero percent work", () => {
    const eighty = transfer("eighty", 80);
    const twenty = transfer("twenty", 20);
    expect(getTransferOverview([eighty, twenty]).progress).toBe(50);
    expect(getTransferOverview([eighty, twenty, transfer("new", 0)]).progress).toBeCloseTo(100 / 3);
  });

  it("keeps indeterminate transfers in the active count without diluting the measurable mean", () => {
    const overview = getTransferOverview([transfer("measurable", 80), transfer("unknown", null)]);
    expect(overview.activeCount).toBe(2);
    expect(overview.progress).toBe(80);
  });

  it("reports indeterminate aggregate progress when no active transfer has a value", () => {
    const overview = getTransferOverview([transfer("unknown", null)]);
    expect(overview.activeCount).toBe(1);
    expect(overview.progress).toBeNull();
  });

  it("excludes terminal transfers from the aggregate", () => {
    expect(getTransferOverview([{ ...transfer("done", 100), status: "complete" }]).progress).toBeNull();
    expect(getTransferOverview([{ ...transfer("partial", 70), status: "partial" }]).progress).toBeNull();
  });
});

describe("getActivitySummary", () => {
  it("counts active and attention-needed operations without reporting zero active work", () => {
    const active = { ...transfer("upload", 20), status: "active" as const };
    const failed = { ...transfer("failed", 0), status: "failed" as const };
    expect(getActivitySummary([failed])).toMatchObject({
      activeCount: 0,
      attentionCount: 1,
      label: "Activity · 1 needs attention",
      accent: "attention",
    });
    expect(getActivitySummary([active, failed])).toMatchObject({
      activeCount: 1,
      attentionCount: 1,
      label: "Activity · 1 active · 1 needs attention",
      accent: "attention",
    });
  });

  it("counts a retry action as attention even when the operation is not failed", () => {
    expect(getActivitySummary([{
      ...transfer("cleanup", null),
      status: "complete",
      actions: [{ key: "retry-cleanup", label: "Retry cleanup" }],
    }]).attentionCount).toBe(1);
  });
});
