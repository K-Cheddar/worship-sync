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
  rendererPid?: number;
  matchedPid?: number;
  processType?: string;
  memory: PreparedVideoMetricValue;
  cpu: PreparedVideoMetricValue;
  reason?: string;
};

type ElectronProcessMetric = {
  pid?: number;
  type?: string;
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
): PreparedVideoMetricsResponse => ({
  status,
  memory: unavailableValue(reason),
  cpu: unavailableValue(reason),
  reason,
});

export const normalizePreparedVideoMetrics = ({
  rendererPid,
  metrics,
}: {
  rendererPid?: number;
  metrics: ElectronProcessMetric[];
}): PreparedVideoMetricsResponse => {
  if (!Number.isInteger(rendererPid) || rendererPid <= 0) {
    const reason = "renderer PID unavailable";
    return createUnavailablePreparedVideoMetrics("renderer_pid_not_matched", reason);
  }

  const metric = metrics.find((candidate) => candidate.pid === rendererPid);
  if (!metric) {
    const reason = `renderer PID ${rendererPid} was not found in Electron process metrics`;
    return {
      ...createUnavailablePreparedVideoMetrics("renderer_pid_not_matched", reason),
      rendererPid,
    };
  }

  const memoryWorkingSetKb = metric.memory?.workingSetSize;
  const cpuPercent = metric.cpu?.percentCPUUsage;
  const memoryAvailable = Number.isFinite(memoryWorkingSetKb);
  const cpuAvailable = Number.isFinite(cpuPercent);
  const reason = !memoryAvailable || !cpuAvailable
    ? "Electron did not expose one or more renderer metrics"
    : undefined;

  return {
    status: memoryAvailable && cpuAvailable ? "available" : "metric_unsupported",
    rendererPid,
    matchedPid: metric.pid,
    processType: metric.type,
    memory: memoryAvailable
      ? { status: "available", value: memoryWorkingSetKb }
      : unavailableValue("renderer memory metric unsupported"),
    cpu: cpuAvailable
      ? { status: "available", value: cpuPercent }
      : unavailableValue("renderer CPU metric unsupported"),
    ...(reason ? { reason } : {}),
  };
};
