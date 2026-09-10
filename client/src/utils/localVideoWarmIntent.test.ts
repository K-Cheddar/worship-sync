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

  it("clears a persisted warm set when republishing empty after restart", async () => {
    publishLocalVideoWarmIntent(["stale-cam"]);
    expect(readLocalVideoWarmIntent().sourceIds).toEqual(["stale-cam"]);

    jest.resetModules();
    const {
      publishLocalVideoWarmIntent: publishFresh,
      readLocalVideoWarmIntent: readFresh,
    } = await import("./localVideoWarmIntent");

    publishFresh([]);
    expect(readFresh().sourceIds).toEqual([]);
  });
});
