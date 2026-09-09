import {
  publishLocalVideoWarmIntent,
  readLocalVideoWarmIntent,
  subscribeLocalVideoWarmIntent,
} from "./localVideoWarmIntent";

describe("localVideoWarmIntent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and reads the warm source set", () => {
    publishLocalVideoWarmIntent(["b", "a", "a"]);
    expect(readLocalVideoWarmIntent().sourceIds).toEqual(["a", "b"]);
  });

  it("notifies subscribers of updates", () => {
    const seen: string[][] = [];
    const unsubscribe = subscribeLocalVideoWarmIntent((intent) => {
      seen.push(intent.sourceIds);
    });
    publishLocalVideoWarmIntent(["source-1"]);
    unsubscribe();
    expect(seen[0]).toEqual([]);
    expect(seen.some((ids) => ids.join() === "source-1")).toBe(true);
  });
});
