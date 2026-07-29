/** Parses friendly service-plan durations. A bare number remains minutes for
 * compatibility with the previous editor; colon notation is minutes:seconds. */
export const parseServicePlanDuration = (value: string): number | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 0;
  const colon = /^(\d+):(\d{1,2})$/.exec(normalized);
  if (colon) {
    const seconds = Number(colon[2]);
    return seconds < 60 ? Number(colon[1]) * 60 + seconds : null;
  }
  const natural = /^(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes))?\s*(?:(\d+)\s*(?:s|sec|secs|second|seconds))?$/.exec(normalized);
  if (natural && (natural[1] || natural[2])) {
    return Math.round((Number(natural[1] || 0) * 60) + Number(natural[2] || 0));
  }
  const minutes = Number(normalized);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 60) : null;
};

export const getServicePlanDurationSeconds = (value: {
  durationSeconds?: number;
  durationMinutes?: number;
}): number => {
  const seconds = Number(value.durationSeconds);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);
  const minutes = Number(value.durationMinutes);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * 60) : 0;
};

export const formatServicePlanDuration = (value: {
  durationSeconds?: number;
  durationMinutes?: number;
}): string => {
  const seconds = getServicePlanDurationSeconds(value);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) return `${minutes} min`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
};
