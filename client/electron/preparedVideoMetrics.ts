export type PreparedVideoMetricStatus =
  | "available"
  | "ipc_unavailable"
  | "renderer_pid_not_matched"
  | "metric_unsupported";

export type PreparedVideoMetricValue = {
  status: "available" | "unsupported";
  value?: number;
  reason?: string;
};

export type PreparedVideoMetricsResponse = {
  status: PreparedVideoMetricStatus;
  timestamp?: number;
  rendererPid?: number;
  matchedPid?: number;
  processType?: string;
  memory: PreparedVideoMetricValue;
  cpu: PreparedVideoMetricValue;
  total?: {
    memory: PreparedVideoMetricValue;
    cpu: PreparedVideoMetricValue;
    processCount: number;
  };
  processes?: PreparedVideoProcessMetric[];
  reason?: string;
};

export type PreparedVideoProcessMetric = {
  pid: number;
  processType: string;
  name?: string;
  serviceName?: string;
  labels: string[];
  memory: PreparedVideoMetricValue;
  cpu: PreparedVideoMetricValue;
};

type ElectronProcessMetric = {
  pid?: number;
  type?: string;
  name?: string;
  serviceName?: string;
  memory?: { workingSetSize?: number };
  cpu?: { percentCPUUsage?: number };
};

const unavailableValue = (reason: string): PreparedVideoMetricValue => ({
  status: "unsupported",
  reason,
});

export const createUnavailablePreparedVideoMetrics = (
  status: Exclude<PreparedVideoMetricStatus, "available">,
  reason: string,
  timestamp?: number,
): PreparedVideoMetricsResponse => ({
  status,
  ...(timestamp != null && { timestamp }),
  memory: unavailableValue(reason),
  cpu: unavailableValue(reason),
  total: {
    memory: unavailableValue(reason),
    cpu: unavailableValue(reason),
    processCount: 0,
  },
  processes: [],
  reason,
});

export const normalizePreparedVideoMetrics = ({
  rendererPid,
  metrics,
  labelsByPid = new Map<number, string[]>(),
  timestamp = Date.now(),
}: {
  rendererPid?: number;
  metrics: ElectronProcessMetric[];
  labelsByPid?: ReadonlyMap<number, string[]>;
  timestamp?: number;
}): PreparedVideoMetricsResponse => {
  const byPid = new Map<number, ElectronProcessMetric>();
  for (const metric of metrics) {
    if (Number.isInteger(metric.pid) && (metric.pid ?? 0) > 0) {
      byPid.set(metric.pid!, metric);
    }
  }
  const processes = [...byPid.values()].map((metric) => ({
    pid: metric.pid!,
    processType: metric.type ?? "unknown",
    ...(metric.name && { name: metric.name }),
    ...(metric.serviceName && { serviceName: metric.serviceName }),
    labels: labelsByPid.get(metric.pid!) ?? [],
    memory: Number.isFinite(metric.memory?.workingSetSize)
      ? { status: "available" as const, value: metric.memory!.workingSetSize }
      : unavailableValue("working set unavailable on this platform"),
    cpu: Number.isFinite(metric.cpu?.percentCPUUsage)
      ? { status: "available" as const, value: metric.cpu!.percentCPUUsage }
      : unavailableValue("CPU metric unavailable on this platform"),
  }));
  const sum = (key: "memory" | "cpu"): PreparedVideoMetricValue => {
    const available = processes
      .map((process) => process[key])
      .filter((value) => value.status === "available" && Number.isFinite(value.value));
    return available.length
      ? { status: "available", value: available.reduce((total, value) => total + (value.value ?? 0), 0) }
      : unavailableValue(`no ${key} metrics available`);
  };
  const total = { memory: sum("memory"), cpu: sum("cpu"), processCount: processes.length };
  const renderer = byPid.get(rendererPid ?? -1);
  const rendererMemory = renderer?.memory?.workingSetSize;
  const rendererCpu = renderer?.cpu?.percentCPUUsage;
  const memory = Number.isFinite(rendererMemory)
    ? { status: "available" as const, value: rendererMemory }
    : unavailableValue("renderer memory metric unsupported");
  const cpu = Number.isFinite(rendererCpu)
    ? { status: "available" as const, value: rendererCpu }
    : unavailableValue("renderer CPU metric unsupported");
  const rendererMatched = Boolean(renderer);
  return {
    status: !rendererMatched
      ? "renderer_pid_not_matched"
      : memory.status === "available" && cpu.status === "available"
        ? "available"
        : "metric_unsupported",
    timestamp,
    ...(Number.isInteger(rendererPid) && { rendererPid }),
    ...(renderer && { matchedPid: renderer.pid, processType: renderer.type }),
    memory,
    cpu,
    total,
    processes,
    ...(!rendererMatched && { reason: "renderer PID was not found in Electron process metrics" }),
  };
};

export const getPreparedVideoMetricsForRenderer = (
  snapshot: PreparedVideoMetricsResponse,
  rendererPid: number,
): PreparedVideoMetricsResponse => {
  if (snapshot.status !== "available" && (snapshot.processes?.length ?? 0) === 0) {
    return { ...snapshot, rendererPid };
  }
  const renderer = snapshot.processes?.find((process) => process.pid === rendererPid);
  return {
    ...snapshot,
    rendererPid,
    ...(renderer && {
      matchedPid: renderer.pid,
      processType: renderer.processType,
      memory: renderer.memory,
      cpu: renderer.cpu,
      status: renderer.memory.status === "available" && renderer.cpu.status === "available"
        ? "available"
        : "metric_unsupported",
    }),
    ...(!renderer && {
      status: "renderer_pid_not_matched",
      matchedPid: undefined,
      processType: undefined,
      memory: unavailableValue("renderer memory metric unavailable in this snapshot"),
      cpu: unavailableValue("renderer CPU metric unavailable in this snapshot"),
    }),
  };
};

/** Shares one Electron CPU measurement interval across every open diagnostics panel. */
export class PreparedVideoMetricsSampler<T> {
  private subscribers = new Set<(snapshot: T) => void>();
  private interval?: ReturnType<typeof setInterval>;
  private lastSnapshot?: T;

  constructor(
    private readonly sample: () => T,
    private readonly intervalMs = 4000,
    private readonly startTimer: typeof setInterval = setInterval,
    private readonly stopTimer: typeof clearInterval = clearInterval,
  ) {}

  subscribe(listener: (snapshot: T) => void): () => void {
    this.subscribers.add(listener);
    if (!this.interval) {
      this.publish();
      this.interval = this.startTimer(() => this.publish(), this.intervalMs);
    } else if (this.lastSnapshot !== undefined) {
      listener(this.lastSnapshot);
    }
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0 && this.interval) {
        this.stopTimer(this.interval);
        this.interval = undefined;
      }
    };
  }

  private publish() {
    if (this.subscribers.size === 0) return;
    const snapshot = this.sample();
    this.lastSnapshot = snapshot;
    this.subscribers.forEach((listener) => listener(snapshot));
  }
}
