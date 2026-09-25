import {
  getPreparedVideoMetricsForRenderer,
  createUnavailablePreparedVideoMetrics,
  normalizePreparedVideoMetrics,
  PreparedVideoMetricsSampler,
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
      timestamp: expect.any(Number),
      rendererPid: 42,
      matchedPid: 42,
      processType: "Tab",
      memory: { status: "available", value: 2048 },
      cpu: { status: "available", value: 3.5 },
      total: {
        memory: { status: "available", value: 2148 },
        cpu: { status: "available", value: 3.5 },
        processCount: 2,
      },
      processes: [
        { pid: 41, processType: "Browser", labels: [], memory: { status: "available", value: 100 }, cpu: { status: "unsupported", reason: "CPU metric unavailable on this platform" } },
        { pid: 42, processType: "Tab", labels: [], memory: { status: "available", value: 2048 }, cpu: { status: "available", value: 3.5 } },
      ],
    });
  });

  it("projects a shared snapshot for each requesting renderer without re-sampling", () => {
    const sample = normalizePreparedVideoMetrics({
      rendererPid: 10,
      timestamp: 123,
      metrics: [
        { pid: 10, type: "Tab", memory: { workingSetSize: 100 }, cpu: { percentCPUUsage: 10 } },
        { pid: 11, type: "Tab", memory: { workingSetSize: 200 }, cpu: { percentCPUUsage: 20 } },
      ],
    });
    const { timestamp, matchedPid, memory, total } = getPreparedVideoMetricsForRenderer(sample, 11);
    expect(timestamp).toBe(123);
    expect(matchedPid).toBe(11);
    expect(memory.value).toBe(200);
    expect(total).toEqual(sample.total);
  });

  it("keeps unsupported platform or sampling fields explicitly unavailable", () => {
    const snapshot = createUnavailablePreparedVideoMetrics("metric_unsupported", "CPU metrics unavailable", 321);
    expect(snapshot).toMatchObject({
      status: "metric_unsupported",
      timestamp: 321,
      total: {
        cpu: { status: "unsupported", reason: "CPU metrics unavailable" },
        memory: { status: "unsupported", reason: "CPU metrics unavailable" },
        processCount: 0,
      },
    });
    expect(getPreparedVideoMetricsForRenderer(snapshot, 11).status).toBe("metric_unsupported");
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

  it("aggregates unique PIDs and leaves multicore CPU values unclamped", () => {
    const snapshot = normalizePreparedVideoMetrics({
      rendererPid: 100,
      timestamp: 123,
      metrics: [
        { pid: 100, type: "Tab", memory: { workingSetSize: 400 }, cpu: { percentCPUUsage: 125 } },
        { pid: 100, type: "Tab", memory: { workingSetSize: 400 }, cpu: { percentCPUUsage: 125 } },
        { pid: 200, type: "GPU", memory: { workingSetSize: 600 }, cpu: { percentCPUUsage: 10 } },
      ],
      labelsByPid: new Map([[200, ["GPU process"]]]),
    });

    expect(snapshot.total).toEqual({
      memory: { status: "available", value: 1000 },
      cpu: { status: "available", value: 135 },
      processCount: 2,
    });
    expect(snapshot.processes?.[1].labels).toEqual(["GPU process"]);
  });

  it("starts one shared timer while subscribed and stops when the last window closes its panel", () => {
    const sample = jest.fn(() => ({ timestamp: Date.now() }));
    let tick: (() => void) | undefined;
    const startTimer = jest.fn((callback: () => void, delay: number) => {
      expect(delay).toBe(4000);
      tick = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const stopTimer = jest.fn();
    const sampler = new PreparedVideoMetricsSampler(sample, 4000, startTimer, stopTimer);
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = sampler.subscribe(first);
    const unsubscribeSecond = sampler.subscribe(second);

    expect(sample).toHaveBeenCalledTimes(1);
    expect(startTimer).toHaveBeenCalledTimes(1);
    expect(tick).toBeDefined();
    tick?.();
    expect(sample).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeFirst();
    tick?.();
    expect(sample).toHaveBeenCalledTimes(3);
    unsubscribeSecond();
    expect(stopTimer).toHaveBeenCalledTimes(1);
    tick?.();
    expect(sample).toHaveBeenCalledTimes(3);
  });
});
