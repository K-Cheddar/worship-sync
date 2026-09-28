import type { PreparedVideoMetricsResponse } from "./preparedVideoMetrics";

// TODO(runtime integration): feed samples from the existing shared
// preparedVideoMetricsSampler, adding system RAM usage to that same tick. Do not
// create a second Electron process-metrics sampler for the governor.

export type ResourceGovernorMode = "auto" | "efficiency" | "maximum-performance";
export type ResourceTier = 0 | 1 | 2 | 3 | 4;
export type ResourcePressure = "healthy" | "elevated" | "constrained" | "critical" | "unknown";
export type ResourceAggressiveness = "normal" | "reduced" | "minimal" | "paused";

/**
 * Advisory policy for optional workloads. Consumers own how and when to apply it.
 * Audience playback is deliberately outside this policy and remains protected.
 */
export type ResourcePolicy = {
  mode: ResourceGovernorMode;
  tier: ResourceTier;
  pressure: ResourcePressure;
  underSustainedPressure: boolean;
  metrics: "available" | "partial" | "unavailable" | "stale";
  recommendations: {
    optionalPreviewWork: ResourceAggressiveness;
    distantMediaPreparation: ResourceAggressiveness;
    backgroundWork: ResourceAggressiveness;
    operatorPreviewQuality: ResourceAggressiveness;
    /** Capture quality needs an explicit subsystem decision because capture can feed live output. */
    captureQuality: "subsystem-controlled";
    /** Generic resource pressure must never automatically reduce audience playback quality. */
    audiencePlayback: "protected";
  };
};

export type ResourceGovernorSample = {
  timestamp: number;
  /** Electron app.getAppMetrics() percentCPUUsage summed across unique WorshipSync processes. */
  appCpuPercent?: number;
  /** Used only if the app-wide CPU aggregate is unavailable. */
  rendererCpuPercent?: number;
  logicalCpuCount?: number;
  /** System-wide used RAM percentage; process working sets are not a substitute. */
  systemMemoryUsedPercent?: number;
};

export type ResourceGovernorCapabilities = {
  logicalCpuCount?: number;
  totalMemoryMB?: number;
};

export type ResourceGovernorState = {
  mode: ResourceGovernorMode;
  tier: ResourceTier;
  autoBaseTier: ResourceTier;
  baseTier: ResourceTier;
  pressureTarget?: ResourceTier;
  pressureSince?: number;
  healthySince?: number;
  lastTierChangeAt?: number;
  lastSampleAt?: number;
  policy: ResourcePolicy;
};

export type ResourceGovernorTiming = {
  pressureConfirmationMs: number;
  recoveryConfirmationMs: number;
  maximumSampleAgeMs: number;
  maximumSampleGapMs: number;
};

export type ResourceGovernorThresholds = {
  cpuElevatedPercent: number;
  cpuConstrainedPercent: number;
  cpuCriticalPercent: number;
  cpuSeverePercent: number;
  memoryElevatedPercent: number;
  memoryConstrainedPercent: number;
  memoryCriticalPercent: number;
  memorySeverePercent: number;
};

export const RESOURCE_GOVERNOR_TIMING: Readonly<ResourceGovernorTiming> = {
  pressureConfirmationMs: 12_000,
  recoveryConfirmationMs: 60_000,
  maximumSampleAgeMs: 12_000,
  maximumSampleGapMs: 12_000,
};

/** Thresholds are conservative fractions of machine capacity, not percentages of one CPU core. */
export const RESOURCE_GOVERNOR_THRESHOLDS: Readonly<ResourceGovernorThresholds> = {
  cpuElevatedPercent: 65,
  cpuConstrainedPercent: 85,
  cpuCriticalPercent: 95,
  cpuSeverePercent: 98,
  memoryElevatedPercent: 82,
  memoryConstrainedPercent: 90,
  memoryCriticalPercent: 96,
  memorySeverePercent: 98,
};

const pressureTier = (
  cpuPercent: number | undefined,
  memoryPercent: number | undefined,
  thresholds: ResourceGovernorThresholds,
): ResourceTier => {
  const cpuTier: ResourceTier = cpuPercent == null
    ? 0
    : cpuPercent >= thresholds.cpuSeverePercent ? 4
      : cpuPercent >= thresholds.cpuCriticalPercent ? 3
        : cpuPercent >= thresholds.cpuConstrainedPercent ? 2
          : cpuPercent >= thresholds.cpuElevatedPercent ? 1 : 0;
  const memoryTier: ResourceTier = memoryPercent == null
    ? 0
    : memoryPercent >= thresholds.memorySeverePercent ? 4
      : memoryPercent >= thresholds.memoryCriticalPercent ? 3
        : memoryPercent >= thresholds.memoryConstrainedPercent ? 2
          : memoryPercent >= thresholds.memoryElevatedPercent ? 1 : 0;
  const strongest = Math.max(cpuTier, memoryTier) as ResourceTier;
  if (cpuTier > 0 && memoryTier > 0) return Math.min(4, strongest + 1) as ResourceTier;
  return strongest;
};

const pressureForTier = (tier: ResourceTier): ResourcePressure => {
  switch (tier) {
    case 0: return "healthy";
    case 1: return "elevated";
    case 2:
    case 3: return "constrained";
    case 4: return "critical";
  }
};

const policyFor = (
  mode: ResourceGovernorMode,
  tier: ResourceTier,
  pressure: ResourcePressure,
  underSustainedPressure: boolean,
  metrics: ResourcePolicy["metrics"],
): ResourcePolicy => {
  const effectiveTier = mode === "maximum-performance" ? 0 : tier;
  const recommendations: ResourcePolicy["recommendations"] = effectiveTier === 0
    ? {
        optionalPreviewWork: "normal",
        distantMediaPreparation: "normal",
        backgroundWork: "normal",
        operatorPreviewQuality: "normal",
        captureQuality: "subsystem-controlled",
        audiencePlayback: "protected",
      }
    : effectiveTier === 1
      ? {
          optionalPreviewWork: "reduced",
          distantMediaPreparation: "normal",
          backgroundWork: "normal",
          operatorPreviewQuality: "normal",
          captureQuality: "subsystem-controlled",
          audiencePlayback: "protected",
        }
      : effectiveTier === 2
        ? {
            optionalPreviewWork: "minimal",
            distantMediaPreparation: "reduced",
              backgroundWork: "normal",
              operatorPreviewQuality: "normal",
            captureQuality: "subsystem-controlled",
            audiencePlayback: "protected",
          }
        : effectiveTier === 3
          ? {
              optionalPreviewWork: "paused",
              distantMediaPreparation: "minimal",
              backgroundWork: "paused",
              operatorPreviewQuality: "normal",
              captureQuality: "subsystem-controlled",
              audiencePlayback: "protected",
            }
          : {
            optionalPreviewWork: "paused",
            distantMediaPreparation: "paused",
            backgroundWork: "paused",
            operatorPreviewQuality: "reduced",
            captureQuality: "subsystem-controlled",
            audiencePlayback: "protected",
          };
  return { mode, tier: effectiveTier, pressure, underSustainedPressure, metrics, recommendations };
};

const validPercent = (value: number | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0 && value <= 100;
const validCpuPercent = (value: number | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0;

const usableSample = (
  sample: ResourceGovernorSample | undefined,
  now: number,
  timing: ResourceGovernorTiming,
  thresholds: ResourceGovernorThresholds,
): { status: ResourcePolicy["metrics"]; target: ResourceTier } => {
  if (!sample || !Number.isFinite(sample.timestamp)) return { status: "unavailable", target: 0 };
  const age = now - sample.timestamp;
  if (age < 0 || age > timing.maximumSampleAgeMs) return { status: "stale", target: 0 };

  const logicalCpuCount = sample.logicalCpuCount;
  const cpuValue = validCpuPercent(sample.appCpuPercent)
    ? sample.appCpuPercent
    : validCpuPercent(sample.rendererCpuPercent) ? sample.rendererCpuPercent : undefined;
  const cpuPercent = cpuValue == null
    ? undefined
    : cpuValue / (Number.isFinite(logicalCpuCount) && (logicalCpuCount ?? 0) > 0 ? logicalCpuCount! : 1);
  const memoryPercent = validPercent(sample.systemMemoryUsedPercent)
    ? sample.systemMemoryUsedPercent
    : undefined;
  const hasCpu = cpuPercent != null;
  const hasMemory = memoryPercent != null;
  if (!hasCpu && !hasMemory) return { status: "unavailable", target: 0 };
  return {
    status: hasCpu && hasMemory ? "available" : "partial",
    target: pressureTier(cpuPercent, memoryPercent, thresholds),
  };
};

export const createResourceGovernorState = (
  mode: ResourceGovernorMode = "auto",
  capabilities: ResourceGovernorCapabilities = {},
): ResourceGovernorState => {
  const lowCapability = (Number.isFinite(capabilities.logicalCpuCount) && capabilities.logicalCpuCount! <= 2)
    || (Number.isFinite(capabilities.totalMemoryMB) && capabilities.totalMemoryMB! <= 4096);
  const baseTier: ResourceTier = mode === "efficiency" || (mode === "auto" && lowCapability) ? 1 : 0;
  const policy = policyFor(mode, baseTier, "healthy", false, "unavailable");
  return { mode, tier: baseTier, autoBaseTier: lowCapability ? 1 : 0, baseTier, policy };
};

export const updateResourceGovernor = (
  previous: ResourceGovernorState,
  sample: ResourceGovernorSample | undefined,
  now: number,
  options: {
    mode?: ResourceGovernorMode;
    timing?: Partial<ResourceGovernorTiming>;
    thresholds?: Partial<ResourceGovernorThresholds>;
  } = {},
): ResourceGovernorState => {
  const timing = { ...RESOURCE_GOVERNOR_TIMING, ...options.timing };
  const thresholds = { ...RESOURCE_GOVERNOR_THRESHOLDS, ...options.thresholds };
  const mode = options.mode ?? previous.mode;
  const observed = usableSample(sample, now, timing, thresholds);
  const gap = previous.lastSampleAt == null ? 0 : now - previous.lastSampleAt;
  const gapInvalid = gap < 0 || gap > timing.maximumSampleGapMs;
  const valid = observed.status === "available" || observed.status === "partial";
  const canAutoReduce = mode !== "maximum-performance";
  let tier = previous.tier;
  let pressureTarget = valid ? observed.target : undefined;
  const pressureLevelChanged = pressureTarget !== previous.pressureTarget;
  let pressureSince = valid && observed.target > 0 && !gapInvalid
    ? pressureLevelChanged ? now : previous.pressureSince ?? now
    : undefined;
  let healthySince = valid && observed.target === 0 && !gapInvalid
    ? previous.healthySince ?? now
    : undefined;
  let lastTierChangeAt = previous.lastTierChangeAt;

  if (canAutoReduce && valid && !gapInvalid) {
    if (observed.target > tier) {
      const readyFromPressure = pressureSince != null && now - pressureSince >= timing.pressureConfirmationMs;
      const readyForNextStep = lastTierChangeAt == null || now - lastTierChangeAt >= timing.pressureConfirmationMs;
      if (readyFromPressure && readyForNextStep) {
        tier = Math.min(observed.target, tier + 1) as ResourceTier;
        lastTierChangeAt = now;
      }
    } else if (observed.target === 0 && tier > previous.baseTier) {
      const readyFromRecovery = healthySince != null && now - healthySince >= timing.recoveryConfirmationMs;
      const readyForNextStep = lastTierChangeAt == null || now - lastTierChangeAt >= timing.recoveryConfirmationMs;
      if (readyFromRecovery && readyForNextStep) {
        tier = Math.max(previous.baseTier, tier - 1) as ResourceTier;
        lastTierChangeAt = now;
      }
    }
  }

  // A manual mode change resets the automatic tier immediately to its declared baseline.
  const modeChanged = mode !== previous.mode;
  let baseTier = previous.baseTier;
  if (modeChanged) {
    baseTier = mode === "efficiency" ? 1 : mode === "maximum-performance" ? 0 : previous.autoBaseTier;
    tier = mode === "maximum-performance" ? 0 : baseTier;
    lastTierChangeAt = now;
    pressureTarget = undefined;
    pressureSince = undefined;
    healthySince = undefined;
  }

  const pressure = valid ? pressureForTier(observed.target) : "unknown";
  const underSustainedPressure = valid && observed.target > 0 && pressureSince != null
    && now - pressureSince >= timing.pressureConfirmationMs;
  const policy = policyFor(mode, tier, pressure, underSustainedPressure, observed.status);
  return {
    mode,
    tier: policy.tier,
    autoBaseTier: previous.autoBaseTier,
    baseTier,
    pressureTarget,
    pressureSince,
    healthySince,
    lastTierChangeAt,
    lastSampleAt: valid ? now : previous.lastSampleAt,
    policy,
  };
};

/** Adapts the existing shared Electron process snapshot without treating working sets as system RAM pressure. */
export const createResourceGovernorSample = (
  metrics: PreparedVideoMetricsResponse,
  logicalCpuCount?: number,
  systemMemoryUsedPercent?: number,
): ResourceGovernorSample | undefined => {
  if (!Number.isFinite(metrics.timestamp)) return undefined;
  const appCpuPercent = metrics.total?.cpu.status === "available" ? metrics.total.cpu.value : undefined;
  const rendererCpuPercent = metrics.cpu.status === "available" ? metrics.cpu.value : undefined;
  return {
    timestamp: metrics.timestamp!,
    ...(appCpuPercent != null && { appCpuPercent }),
    ...(rendererCpuPercent != null && { rendererCpuPercent }),
    ...(Number.isFinite(logicalCpuCount) && (logicalCpuCount ?? 0) > 0 && { logicalCpuCount }),
    ...(validPercent(systemMemoryUsedPercent) && { systemMemoryUsedPercent }),
  };
};
