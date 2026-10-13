import { monitorEventLoopDelay } from "node:perf_hooks";
import { createScheduleBatchDispatcher, createScheduleBatchStoreOperations, approveReviewedScheduleBatch } from "../server/notificationBatches.js";

const SIZES = [10, 25, 50, 100];
const SIMULATION_SCALE = 40;
const FIRESTORE_OPERATION_ROUND_TRIP_MS = 25;
const PROFILES = [
  { name: "baseline (2/pass, 5s poll, serial)", maxRecipientsPerRun: 2, maxConcurrentProviderRequests: 1, pollIntervalMs: 5000, coordinator: false },
  { name: "optimized (10/pass, immediate, serial)", maxRecipientsPerRun: 10, maxConcurrentProviderRequests: 1, pollIntervalMs: 5000, coordinator: true },
  { name: "optimized (10/pass, immediate, concurrency 2)", maxRecipientsPerRun: 10, maxConcurrentProviderRequests: 2, pollIntervalMs: 5000, coordinator: true },
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const makeBenchmark = async ({ size, profile, recovery = false, injectTimeout = false }) => {
  const reads = { count: 0 };
  const writes = { count: 0 };
  const records = new Map();
  const locks = new Map();
  const batchId = `benchmark-${size}-${profile.name.replaceAll(/[^a-z0-9]+/gi, "-")}-${recovery ? "recovery" : "normal"}-${injectTimeout ? "timeout" : "clean"}`;
  const recipients = Array.from({ length: size }, (_, index) => ({
    memberId: `member-${index + 1}`,
    intentId: `intent-${index + 1}`,
    approvalVersion: `review-${index + 1}`,
    status: recovery && index < Math.floor(size * 0.6) ? "sent" : recovery && index === Math.floor(size * 0.6) ? "unknown" : "preview",
    segmentCount: index % 8 === 0 ? 2 : 1,
  }));
  const approved = approveReviewedScheduleBatch({
    current: {
      batchId,
      churchId: "benchmark-church",
      scheduleId: "benchmark-schedule",
      sourceType: "team_schedule",
      intentType: "schedule_initial_notification",
      status: "prepared",
      reviewVersion: "benchmark-review",
      selectedMemberIds: recipients.map((row) => row.memberId),
      recipients,
      dispatchPriorityAt: 1,
    },
    churchId: "benchmark-church",
    scheduleId: "benchmark-schedule",
    approvalVersion: "benchmark-review",
    actorUid: "benchmark-operator",
    now: new Date(1).toISOString(),
    approvedRecipients: recipients.map(({ memberId, intentId, approvalVersion, status, segmentCount }) => ({ memberId, intentId, approvalVersion, status, segmentCount, message: "Approved benchmark message" })),
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
  });
  approved.status = recovery ? "dispatching" : "approved";
  approved.dispatchLeaseExpiresAt = recovery ? 1 : 0;
  records.set(batchId, approved);
  const stateByIntent = new Map(recipients.map((recipient) => [recipient.intentId, { ...recipient }]));
  let currentOwner = 0;
  let inFlightCalls = 0;
  let maxConcurrentCalls = 0;
  let accepted = 0;
  let failed = 0;
  let unknown = 0;
  let totalSegments = 0;
  let firstAcceptanceMs = null;
  let modeledElapsedMs = 0;
  const providerSlots = Array.from({ length: profile.maxConcurrentProviderRequests }, () => 0);
  const providerEvents = [];
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const heartbeatStarted = Date.now();
  let heartbeatExpected = heartbeatStarted + 10;
  let heartbeatMaxLagMs = 0;
  const heartbeat = setInterval(() => {
    const current = Date.now();
    heartbeatMaxLagMs = Math.max(heartbeatMaxLagMs, current - heartbeatExpected);
    heartbeatExpected = current + 10;
  }, 10);

  const getDoc = async (collection, id) => {
    reads.count += 1;
    return records.get(id) || null;
  };
  const setDoc = async (collection, id, value, { merge = false } = {}) => {
    const previous = records.get(id) || {};
    const next = merge ? { ...previous, ...value } : value;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      writes.count += 1;
      records.set(id, next);
    }
    return next;
  };
  const queryDocs = async (collection, filters = [], { limit = 1000 } = {}) => {
    const all = [...records.values()];
    const matched = all.filter((item) => filters.every(({ field, op, value }) => op === "in" ? value.includes(item[field]) : item[field] === value));
    reads.count += matched.length;
    return matched.slice(0, limit);
  };
  const store = createScheduleBatchStoreOperations({
    requireFirestore: () => null,
    COLLECTIONS: { notificationBatches: "notificationBatches" },
    getDoc,
    setDoc,
    queryDocs,
    runMemoryClaim: async (id, task) => {
      const prior = locks.get(id) || Promise.resolve();
      const current = prior.then(task, task);
      locks.set(id, current.then(() => undefined, () => undefined));
      return current;
    },
  });

  const dispatchStore = profile.coordinator ? store : {
    ...store,
    claimCoordinator: async (ownerToken) => ({ ownerToken, generation: 1 }),
    renewCoordinator: async () => true,
    reserveProviderWindow: async () => 0,
    releaseCoordinator: async () => true,
  };
  const dispatcher = createScheduleBatchDispatcher({
    ...dispatchStore,
    createOwnerToken: () => `owner-${++currentOwner}`,
    now: () => Date.now() + modeledElapsedMs,
    pollIntervalMs: profile.pollIntervalMs,
    leaseMs: 90000,
    maxRecipientsPerRun: profile.maxRecipientsPerRun,
    maxConcurrentProviderRequests: profile.maxConcurrentProviderRequests,
    isStillAuthorized: async () => true,
    getRecipientState: async (recipient) => stateByIntent.get(recipient.intentId) || { status: "excluded" },
    processRecipient: async ({ recipient, segmentCount }) => {
      const index = Number(recipient.memberId.slice("member-".length)) - 1;
      const timeout = injectTimeout && index === Math.floor(size / 2);
      const slow = index % 25 === 24;
      const providerDurationMs = timeout ? 15000 : slow ? 1800 : 400 + (index % 7) * 70;
      const simulatedDatabaseMs = 150;
      const slotIndex = providerSlots.indexOf(Math.min(...providerSlots));
      const requestStartMs = Math.max(modeledElapsedMs + simulatedDatabaseMs, providerSlots[slotIndex]);
      const requestEndMs = requestStartMs + providerDurationMs + simulatedDatabaseMs;
      providerSlots[slotIndex] = requestEndMs;
      providerEvents.push({ intentId: recipient.intentId, startMs: requestStartMs, endMs: requestEndMs, providerDurationMs, timeout, segmentCount });
      totalSegments += segmentCount;
      inFlightCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, inFlightCalls);
      await sleep(Math.max(1, providerDurationMs / SIMULATION_SCALE));
      inFlightCalls -= 1;
      modeledElapsedMs = Math.max(modeledElapsedMs, requestEndMs);
      if (timeout) {
        unknown += 1;
        stateByIntent.set(recipient.intentId, { ...recipient, status: "unknown", outcome: "unknown" });
        return { outcome: "unknown" };
      }
      accepted += 1;
      if (firstAcceptanceMs === null) firstAcceptanceMs = requestEndMs;
      stateByIntent.set(recipient.intentId, { ...recipient, status: "sent", outcome: "confirmed" });
      return { outcome: "confirmed" };
    },
    logger: { info() {}, warn() {}, error() {} },
  });

  let passes = 0;
  let didWork = false;
  while (passes < size + 10) {
    passes += 1;
    didWork = await dispatcher.runOnce();
    const unfinished = [...stateByIntent.values()].some((row) => ["preview", "ready"].includes(row.status));
    if (!unfinished || !didWork) break;
    if (!profile.coordinator) modeledElapsedMs += profile.pollIntervalMs;
  }
  await dispatcher.stop({ timeoutMs: 100 });
  clearInterval(heartbeat);
  histogram.disable();

  const totalTimeMs = Math.max(modeledElapsedMs, ...providerSlots);
  const providerRequests = accepted + failed + unknown;
  const result = {
    profile: profile.name,
    recipients: size,
    recovery,
    timeoutInjected: injectTimeout,
    providerRequests,
    accepted,
    unknown,
    totalSegments,
    totalTimeSeconds: Number((totalTimeMs / 1000).toFixed(2)),
    timeToFirstAcceptanceSeconds: firstAcceptanceMs === null ? null : Number((firstAcceptanceMs / 1000).toFixed(2)),
    providerRequestsPerSecond: Number((providerRequests / Math.max(totalTimeMs / 1000, 0.001)).toFixed(2)),
    firestoreReads: reads.count,
    firestoreWrites: writes.count,
    modeledFirestoreOperationCostSeconds: Number(((reads.count + writes.count) * FIRESTORE_OPERATION_ROUND_TRIP_MS / 1000).toFixed(2)),
    maxConcurrentProviderRequests: maxConcurrentCalls,
    eventLoopMaxLagMs: Number(Math.max(heartbeatMaxLagMs, histogram.max / 1e6 || 0).toFixed(2)),
    passes,
    recoveryOverheadNote: recovery ? "Only untouched preview/ready intents were offered; sent and unknown outcomes were excluded." : undefined,
  };
  return { result, providerEvents };
};

const results = [];
for (const size of SIZES) {
  for (const profile of PROFILES) {
    results.push((await makeBenchmark({ size, profile })).result);
  }
}
for (const profile of PROFILES.slice(1)) {
  results.push((await makeBenchmark({ size: 100, profile, injectTimeout: true })).result);
  results.push((await makeBenchmark({ size: 100, profile, recovery: true })).result);
}

console.log(JSON.stringify({
  benchmark: "schedule-sms-dispatcher-model",
  simulated: true,
  simulationScale: SIMULATION_SCALE,
  assumptions: {
    normalProviderLatencyMs: "400-820ms, with a 1.8s slow request every 25th recipient",
    injectedTimeoutMs: 15000,
    firestoreOperationRoundTripMs: FIRESTORE_OPERATION_ROUND_TRIP_MS,
    providerSegments: "1 segment for most messages, 2 for every eighth message",
    currentBaseline: "2 recipients per pass, 5s idle after each useful pass, serial provider calls",
    optimizedProfiles: "10 recipients per bounded pass, immediate continuation after useful work, serial or 2 concurrent provider calls",
    providerLimits: "The concurrency-2 profile is a comparison only; it is not a recommendation or a Twilio throughput target.",
    modeledFirestoreOperationCost: "Read/write counts are observed from the dispatcher store boundary. This cost is a separate estimate, not added to total modeled provider wall time.",
  },
  results,
}, null, 2));
