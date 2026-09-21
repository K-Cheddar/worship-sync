import {
  normalizePreparedVideoMetrics,
} from "./preparedVideoMetrics";

describe("prepared video metrics normalization", () => {
  it("normalizes renderer memory and CPU from the matching Electron process", () => {
    expect(
      normalizePreparedVideoMetrics({
        rendererPid: 42,
        metrics: [
          { pid: 41, type: "Browser", memory: { workingSetSize: 100 } },
          {
            pid: 42,
            type: "Tab",
            memory: { workingSetSize: 2048 },
            cpu: { percentCPUUsage: 3.5 },
          },
        ],
      }),
    ).toEqual({
      status: "available",
      rendererPid: 42,
      matchedPid: 42,
      processType: "Tab",
      memory: { status: "available", value: 2048 },
      cpu: { status: "available", value: 3.5 },
    });
  });

  it("distinguishes a renderer PID miss from unsupported metric fields", () => {
    expect(
      normalizePreparedVideoMetrics({ rendererPid: 99, metrics: [] }).status,
    ).toBe("renderer_pid_not_matched");
    expect(
      normalizePreparedVideoMetrics({
        rendererPid: 42,
        metrics: [{ pid: 42, memory: {} }],
      }),
    ).toMatchObject({
      status: "metric_unsupported",
      memory: { status: "unsupported" },
      cpu: { status: "unsupported", reason: "renderer CPU metric unsupported" },
    });
  });
});
