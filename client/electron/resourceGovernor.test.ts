import {
  createResourceGovernorSample,
  createResourceGovernorState,
  subscribeResourceGovernorToPreparedMetrics,
  RESOURCE_GOVERNOR_THRESHOLDS,
  RESOURCE_GOVERNOR_TIMING,
  updateResourceGovernor,
  type ResourceGovernorSample,
} from "./resourceGovernor";
import { PreparedVideoMetricsSampler, type PreparedVideoMetricsResponse } from "./preparedVideoMetrics";

const sample = (timestamp: number, cpu = 20, memory = 45, cores = 4): ResourceGovernorSample => ({
  timestamp,
  appCpuPercent: cpu,
  logicalCpuCount: cores,
  systemMemoryUsedPercent: memory,
});

const updateAt = (
  state: ReturnType<typeof createResourceGovernorState>,
  timestamp: number,
  cpu?: number,
  memory?: number,
) => updateResourceGovernor(state, {
  timestamp,
  ...(cpu != null && { appCpuPercent: cpu, logicalCpuCount: 4 }),
  ...(memory != null && { systemMemoryUsedPercent: memory }),
}, timestamp);

describe("runtime resource governor", () => {
  it("starts healthy in Auto and leaves audience playback protected", () => {
    const state = createResourceGovernorState();
    expect(state.policy).toMatchObject({
      mode: "auto",
      tier: 0,
      pressure: "healthy",
      recommendations: {
        optionalPreviewWork: "normal",
        captureQuality: "subsystem-controlled",
        audiencePlayback: "protected",
      },
    });
  });

  it("does not degrade on a single high CPU sample", () => {
    const initial = createResourceGovernorState();
    const pressured = updateAt(initial, 0, 380, 45);
    const spikeCleared = updateAt(pressured, 4_000, 20, 45);
    expect(pressured.tier).toBe(0);
    expect(pressured.policy.underSustainedPressure).toBe(false);
    expect(spikeCleared.tier).toBe(0);
  });

  it("degrades one level after sustained CPU pressure and stages further reductions", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, 360, 45);
    expect(state.tier).toBe(1);
    expect(state.policy.underSustainedPressure).toBe(true);
    expect(state.policy.recommendations.optionalPreviewWork).toBe("reduced");
    for (const timestamp of [16_000, 20_000, 24_000]) state = updateAt(state, timestamp, 360, 45);
    expect(state.tier).toBe(2);
    expect(state.policy.recommendations.distantMediaPreparation).toBe("reduced");
    expect(state.policy.recommendations.backgroundWork).toBe("normal");
  });

  it("degrades after sustained system memory pressure", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, undefined, 88);
    expect(state.tier).toBe(1);
  });

  it("treats combined pressure more strongly than either source alone", () => {
    const cpuOnly = updateAt(createResourceGovernorState(), 0, 260, 40);
    const memoryOnly = updateAt(createResourceGovernorState(), 0, undefined, 84);
    const combined = updateAt(createResourceGovernorState(), 0, 260, 84);
    expect(cpuOnly.policy.pressure).toBe("elevated");
    expect(memoryOnly.policy.pressure).toBe("elevated");
    expect(combined.policy.pressure).toBe("constrained");
  });

  it("requires a much longer healthy period before recovery", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, undefined, 88);
    expect(state.tier).toBe(1);
    for (let timestamp = 16_000; timestamp <= 72_000; timestamp += 4_000) state = updateAt(state, timestamp, 20, 45);
    expect(state.tier).toBe(1);
    state = updateAt(state, 76_000, 20, 45);
    expect(state.tier).toBe(0);
  });

  it("does not flap when pressure samples oscillate before confirmation", () => {
    let state = createResourceGovernorState();
    const inputs = [
      [0, 360], [4_000, 20], [8_000, 360], [12_000, 20], [16_000, 360], [20_000, 20],
    ] as const;
    for (const [timestamp, cpu] of inputs) state = updateAt(state, timestamp, cpu, 45);
    expect(state.tier).toBe(0);
  });

  it("requires higher severity itself to persist before taking another shedding step", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, 260, 45);
    expect(state.tier).toBe(1);
    state = updateAt(state, 16_000, 400, 45);
    expect(state.policy.pressure).toBe("critical");
    expect(state.tier).toBe(1);
  });

  it("sheds background work before lowering operator-preview quality", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000, 28_000, 32_000, 36_000]) {
      state = updateAt(state, timestamp, 400, 45);
    }
    expect(state.tier).toBe(3);
    expect(state.policy.recommendations.backgroundWork).toBe("paused");
    expect(state.policy.recommendations.operatorPreviewQuality).toBe("normal");
    for (const timestamp of [40_000, 44_000, 48_000]) state = updateAt(state, timestamp, 400, 45);
    expect(state.tier).toBe(4);
    expect(state.policy.recommendations.operatorPreviewQuality).toBe("reduced");
  });

  it("starts Efficiency conservatively and does not restore its baseline", () => {
    let state = createResourceGovernorState("efficiency");
    expect(state.tier).toBe(1);
    for (const timestamp of [0, 30_000, 60_000, 90_000]) state = updateAt(state, timestamp, 20, 45);
    expect(state.tier).toBe(1);
    expect(state.policy.recommendations.optionalPreviewWork).toBe("reduced");
  });

  it("reports pressure but applies no Auto reductions in Maximum Performance", () => {
    let state = createResourceGovernorState("maximum-performance");
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, 380, 97);
    expect(state.policy).toMatchObject({
      tier: 0,
      pressure: "critical",
      recommendations: { optionalPreviewWork: "normal", audiencePlayback: "protected" },
    });
  });

  it("fails safely on unavailable or stale metrics by holding the current tier", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000]) state = updateAt(state, timestamp, undefined, 88);
    expect(state.tier).toBe(1);
    state = updateResourceGovernor(state, undefined, 16_000);
    expect(state.tier).toBe(1);
    expect(state.policy.metrics).toBe("unavailable");
    expect(state.policy.pressure).toBe("unknown");
    state = updateResourceGovernor(state, sample(16_000), 40_000);
    expect(state.tier).toBe(1);
    expect(state.policy.metrics).toBe("stale");
  });

  it("uses low static capability only as a conservative Auto starting tier", () => {
    expect(createResourceGovernorState("auto", { logicalCpuCount: 2 }).tier).toBe(1);
    expect(createResourceGovernorState("auto", { totalMemoryMB: 4096 }).tier).toBe(1);
    expect(createResourceGovernorState("auto", { logicalCpuCount: 8, totalMemoryMB: 16_384 }).tier).toBe(0);
  });

  it("restores the selected mode baseline when the mode changes", () => {
    const efficiency = createResourceGovernorState("efficiency");
    const automatic = updateResourceGovernor(efficiency, sample(1_000), 1_000, { mode: "auto" });
    expect(automatic.tier).toBe(0);
    const lowCapability = createResourceGovernorState("auto", { logicalCpuCount: 2 });
    const maximum = updateResourceGovernor(lowCapability, sample(1_000), 1_000, { mode: "maximum-performance" });
    const restored = updateResourceGovernor(maximum, sample(2_000), 2_000, { mode: "auto" });
    expect(restored.tier).toBe(1);
  });

  it("adapts existing app process CPU metrics without summing working sets as system RAM", () => {
    const adapted = createResourceGovernorSample({
      status: "available",
      timestamp: 12_000,
      memory: {
        private: { status: "available", value: 300 },
        workingSet: { status: "available", value: 800 },
      },
      cpu: { status: "available", value: 45 },
      total: {
        privateMemory: { status: "available", value: 2_000 },
        workingSetMemory: { status: "available", value: 4_000 },
        cpu: { status: "available", value: 360 },
        processCount: 5,
      },
    }, 8);
    expect(adapted).toEqual({ timestamp: 12_000, appCpuPercent: 360, rendererCpuPercent: 45, logicalCpuCount: 8 });
  });

  it("uses actual system RAM pressure supplied on the shared sampler tick", () => {
    const adapted = createResourceGovernorSample({
      status: "available",
      timestamp: 500,
      memory: {
        private: { status: "available", value: 300 },
        workingSet: { status: "available", value: 900_000 },
      },
      cpu: { status: "unsupported" },
      total: {
        privateMemory: { status: "available", value: 10_000 },
        workingSetMemory: { status: "available", value: 20_000_000 },
        cpu: { status: "unsupported" },
        processCount: 5,
      },
    }, 8, 97);
    expect(adapted).toEqual({ timestamp: 500, logicalCpuCount: 8, systemMemoryUsedPercent: 97 });
  });

  it("drives runtime policy from the existing shared metrics sampler", () => {
    let tick: (() => void) | undefined;
    let now = 0;
    const metrics = (): PreparedVideoMetricsResponse => ({
      status: "available",
      timestamp: now,
      memory: {},
      cpu: { status: "unsupported" },
      total: {
        privateMemory: { status: "unsupported" },
        workingSetMemory: { status: "unsupported" },
        cpu: { status: "available", value: 360 },
        processCount: 5,
      },
    });
    const sampler = new PreparedVideoMetricsSampler(
      metrics,
      4_000,
      (callback) => {
        tick = callback;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      jest.fn(),
    );
    const states: ReturnType<typeof createResourceGovernorState>[] = [];
    const stop = subscribeResourceGovernorToPreparedMetrics(sampler, {
      logicalCpuCount: 4,
      getSystemMemoryUsedPercent: () => 45,
      onState: (state) => states.push(state),
      now: () => now,
    });
    for (now = 4_000; now <= 16_000; now += 4_000) tick?.();
    expect(states.at(-1)?.policy).toMatchObject({
      tier: 1,
      metrics: "available",
      recommendations: { audiencePlayback: "protected" },
    });
    stop();
  });

  it("does not normalize away valid multicore CPU totals over 100 percent", () => {
    let state = createResourceGovernorState();
    for (const timestamp of [0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000]) state = updateAt(state, timestamp, 360, 45);
    expect(state.policy.pressure).toBe("constrained");
  });

  it("uses the documented sustained-pressure and slow-recovery windows", () => {
    expect(RESOURCE_GOVERNOR_TIMING).toMatchObject({
      pressureConfirmationMs: 12_000,
      recoveryConfirmationMs: 60_000,
      maximumSampleAgeMs: 12_000,
    });
    expect(RESOURCE_GOVERNOR_THRESHOLDS).toMatchObject({
      cpuElevatedPercent: 65,
      cpuConstrainedPercent: 85,
      cpuCriticalPercent: 95,
      cpuSeverePercent: 98,
      memoryElevatedPercent: 82,
      memoryConstrainedPercent: 90,
      memoryCriticalPercent: 96,
      memorySeverePercent: 98,
    });
  });
});
