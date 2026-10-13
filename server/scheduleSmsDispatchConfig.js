const parseBoundedInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const parsePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const resolveScheduleSmsDispatchConfig = (env = process.env) => {
  const requested = String(env.SCHEDULE_BULK_DISPATCH_ENABLED || "").trim().toLowerCase() === "true";
  const segmentsPerSecond = parsePositiveNumber(env.SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND);
  const enabled = requested && segmentsPerSecond > 0;

  return {
    enabled,
    requested,
    segmentsPerSecond,
    maxRecipientsPerRun: parseBoundedInteger(env.SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN, 10, 1, 25),
    maxConcurrentProviderRequests: parseBoundedInteger(env.SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY, 1, 1, 2),
    pollIntervalMs: parseBoundedInteger(env.SCHEDULE_BULK_DISPATCH_POLL_INTERVAL_MS, 5000, 1000, 60000),
    leaseMs: parseBoundedInteger(env.SCHEDULE_BULK_DISPATCH_LEASE_MS, 90000, 30000, 300000),
    readinessMessage: !requested
      ? "Bulk schedule SMS is paused until the server is ready for safe dispatch and restart recovery."
      : segmentsPerSecond > 0
        ? ""
        : "Bulk schedule SMS needs a verified send rate before the server can enable it. Contact your administrator.",
  };
};

