import { createReplicationProgressTracker } from "./replicationProgress";

describe("replication progress", () => {
  it("does not invent progress before a positive pending baseline is known", () => {
    const progress = createReplicationProgressTracker();

    expect(progress(undefined)).toBeNull();
    expect(progress(Number.NaN)).toBeNull();
    expect(progress(-1)).toBeNull();
    expect(progress(0)).toBeNull();
    expect(progress(12)).toBe(0);
  });

  it("tracks changing pending counts and reserves 100% for successful completion", () => {
    const progress = createReplicationProgressTracker();

    expect(progress(10)).toBe(0);
    expect(progress(7)).toBe(30);
    expect(progress(20)).toBe(0);
    expect(progress(0)).toBe(99);
  });

  it("keeps independent progress baselines for separate replications", () => {
    const contentProgress = createReplicationProgressTracker();
    const bibleProgress = createReplicationProgressTracker();

    expect(contentProgress(100)).toBe(0);
    expect(bibleProgress(4)).toBe(0);
    expect(contentProgress(50)).toBe(50);
    expect(bibleProgress(2)).toBe(50);
  });
});
