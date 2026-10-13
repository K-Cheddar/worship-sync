import test from "node:test";
import assert from "node:assert/strict";
import {
  approveReviewedScheduleBatch,
  claimApprovedScheduleBatch,
  claimReviewedNotificationBatch,
  createScheduleBatchStoreOperations,
  createScheduleBatchDispatcher,
  executeReviewedNotificationBatch,
  notificationBatchReviewVersion,
  releaseScheduleBatchLease,
  renewScheduleBatchLease,
  updateScheduleBatchRecipient,
} from "./notificationBatches.js";

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const snapshot = { approvalVersion: "review", expiresAt: Date.now() + 600000 };
const makeBatch = () => ({
  batchId: "batch", churchId: "church", status: "prepared", reviewVersion: "batch-review",
  selectedMemberIds: ["one", "two"], intentIds: ["one", "two", "one"],
  recipients: ["one", "two"].map((intentId) => ({ intentId, approvalVersion: "review", status: "preview" })),
});

test("review identity binds selection, intents, approval versions and segments", () => {
  const batch = makeBatch();
  const version = notificationBatchReviewVersion(String, batch);
  assert.equal(version, notificationBatchReviewVersion(String, structuredClone(batch)));
  for (const mutate of [
    (copy) => copy.selectedMemberIds.push("three"),
    (copy) => { copy.recipients[0].intentId = "other"; },
    (copy) => { copy.recipients[0].approvalVersion = "changed"; },
    (copy) => { copy.recipients[0].segmentCount = 2; },
  ]) {
    const copy = structuredClone(batch);
    mutate(copy);
    assert.notEqual(version, notificationBatchReviewVersion(String, copy));
  }
});

test("claim permits only reviewed prepared or interrupted work in the owning church", () => {
  const args = { current: makeBatch(), churchId: "church", approvalVersion: "batch-review", actorUid: "operator", now: "now", isStaleSending: () => false, httpError };
  const claimed = claimReviewedNotificationBatch(args);
  assert.equal(claimed.status, "dispatching");
  assert.equal(claimed.approvedByUid, "operator");
  for (const change of [{ churchId: "foreign" }, { approvalVersion: "" }, { approvalVersion: "stale" }, { current: claimed }, { current: { ...claimed, status: "sent" } }, { current: { ...claimed, status: "superseded" } }]) {
    assert.throws(() => claimReviewedNotificationBatch({ ...args, ...change }));
  }
  assert.equal(claimReviewedNotificationBatch({ ...args, current: claimed, isStaleSending: () => true }).status, "dispatching");
});

const runner = (batch, intents, overrides = {}) => {
  const sent = [];
  const recovered = [];
  const args = {
    batch,
    getIntent: async (id) => intents.get(id),
    matchesSource: (intent) => intent.sourceType === "example_source",
    isStaleSending: () => true,
    markUnknownAfterInterruption: async (intent) => {
      recovered.push(intent.intentId);
      intents.set(intent.intentId, { ...intent, status: "unknown", outcome: "unknown" });
    },
    sendReviewedIntent: async ({ intentId }) => {
      sent.push(intentId);
      intents.set(intentId, { ...intents.get(intentId), status: "sent" });
      return { success: true };
    },
    nowIso: () => "now",
    ...overrides,
  };
  return { args, sent, recovered };
};
const makeIntents = () => new Map(["one", "two"].map((intentId) => [intentId, {
  intentId, churchId: "church", batchId: "batch", sourceType: "example_source",
  status: "preview", approvalSnapshot: { ...snapshot },
}]));

test("executor is source-independent, collapses duplicate IDs and skips confirmed work on resume", async () => {
  const run = runner(makeBatch(), makeIntents());
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["one", "two"]);
  assert.equal(result.status, "sent");
  await executeReviewedNotificationBatch({ ...run.args, batch: result });
  assert.deepEqual(run.sent, ["one", "two"]);
});

test("unknown, failed, sent and active sends are never automatically retried", async () => {
  for (const status of ["unknown", "failed", "sent", "sending"]) {
    const intents = makeIntents();
    intents.get("one").status = status;
    const run = runner(makeBatch(), intents, { isStaleSending: () => false });
    const result = await executeReviewedNotificationBatch(run.args);
    assert.deepEqual(run.sent, ["two"]);
    assert.equal(result.status, status === "sent" ? "sent" : "partial");
  }
});

test("stale interrupted send is uncertain while untouched recipient continues", async () => {
  const intents = makeIntents();
  intents.get("one").status = "sending";
  const run = runner(makeBatch(), intents);
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.recovered, ["one"]);
  assert.deepEqual(run.sent, ["two"]);
  assert.equal(result.status, "partial");
  assert.equal(result.recipients[0].outcome, "unknown");
});

test("changed review or foreign source blocks both send and recovery", async () => {
  for (const change of [{ churchId: "foreign" }, { batchId: "foreign" }, { sourceType: "other_feature" }, { approvalSnapshot: { ...snapshot, approvalVersion: "changed" }, status: "preview" }]) {
    const intents = makeIntents();
    Object.assign(intents.get("one"), { status: "sending" }, change);
    const run = runner(makeBatch(), intents);
    await executeReviewedNotificationBatch(run.args);
    assert.deepEqual(run.sent, ["two"]);
    assert.deepEqual(run.recovered, []);
  }
});

test("one recipient rejection leaves other recipients accounted for", async () => {
  const intents = makeIntents();
  const run = runner(makeBatch(), intents);
  const send = run.args.sendReviewedIntent;
  run.args.sendReviewedIntent = async (input) => {
    if (input.intentId !== "one") return send(input);
    intents.set("one", { ...intents.get("one"), status: "failed", approvalSnapshot: null });
    return { success: false, errorMessage: "Provider rejected" };
  };
  const result = await executeReviewedNotificationBatch(run.args);
  assert.equal(result.status, "partial");
  assert.equal(result.recipients[0].exclusionReason, "Provider rejected");
  assert.equal(result.recipients[1].status, "sent");
});

test("legacy or malformed selection without a reviewed row stays blocked", async () => {
  const batch = makeBatch();
  batch.recipients = batch.recipients.filter((row) => row.intentId !== "one");
  const intents = makeIntents();
  intents.get("one").approvalSnapshot = null;
  const run = runner(batch, intents);
  await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["two"]);
});

test("lost request can resume persisted successful intents without duplication", async () => {
  const intents = makeIntents();
  const run = runner(makeBatch(), intents);
  const send = run.args.sendReviewedIntent;
  run.args.sendReviewedIntent = async (input) => {
    if (input.intentId === "two") throw new Error("process interrupted before second claim");
    return send(input);
  };
  await assert.rejects(executeReviewedNotificationBatch(run.args), /process interrupted/);
  run.args.sendReviewedIntent = send;
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["one", "two"]);
  assert.equal(result.status, "sent");
});

const makeScheduleBatch = () => ({
  batchId: "schedule-batch", churchId: "church", scheduleId: "schedule",
  sourceType: "team_schedule", intentType: "schedule_initial_notification",
  status: "prepared", reviewVersion: "approved-review",
  recipients: [
    { memberId: "one", intentId: "one", approvalVersion: "review-one", status: "preview" },
    { memberId: "two", intentId: "two", approvalVersion: "review-two", status: "preview" },
  ],
});

test("schedule approval is durable, exact-version and idempotent", () => {
  const batch = makeScheduleBatch();
  const input = {
    current: batch, churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "2026-10-12T15:00:00Z",
    approvedRecipients: [{ intentId: "one", message: "Approved body", approvalVersion: "review-one" }],
    httpError,
  };
  const approved = approveReviewedScheduleBatch(input);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approval.actorUid, "manager");
  assert.deepEqual(approved.approval.recipients, input.approvedRecipients);
  assert.equal(approveReviewedScheduleBatch({ ...input, current: approved, actorUid: "another-manager" }), approved);
  assert.throws(() => approveReviewedScheduleBatch({
    ...input,
    current: { ...approved, status: "paused" },
  }), /no longer available for approval/i);
  for (const change of [
    { approvalVersion: "stale" }, { churchId: "another-church" },
    { current: { ...batch, status: "preparing" } },
  ]) assert.throws(() => approveReviewedScheduleBatch({ ...input, ...change }));
});

test("competing dispatchers claim one Firestore-style batch lease", async () => {
  let batch = approveReviewedScheduleBatch({
    current: makeScheduleBatch(), churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "approved",
    approvedRecipients: [], httpError,
  });
  let transactionTail = Promise.resolve();
  const claim = (ownerToken) => {
    const run = transactionTail.then(() => {
      const next = claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken, now: 100, leaseMs: 50, httpError });
      if (next) batch = next;
      return next;
    });
    transactionTail = run.then(() => undefined, () => undefined);
    return run;
  };
  const [first, second] = await Promise.all([claim("owner-a"), claim("owner-b")]);
  assert.equal([first, second].filter(Boolean).length, 1);
  assert.equal(batch.dispatchGeneration, 1);
});

test("lease expiry permits transfer but fences the old owner's progress and completion", () => {
  let batch = approveReviewedScheduleBatch({
    current: makeScheduleBatch(), churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "approved",
    approvedRecipients: [], httpError,
  });
  batch = claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken: "old", now: 100, leaseMs: 50, httpError });
  assert.equal(claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken: "contender", now: 120, leaseMs: 50, httpError }), null);
  const transferred = claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken: "new", now: 151, leaseMs: 50, httpError });
  assert.equal(transferred.dispatchGeneration, 2);
  assert.equal(updateScheduleBatchRecipient({ current: transferred, ownership: { ownerToken: "old", generation: 1 }, memberId: "one", patch: { status: "sent" }, now: 160 }), null);
  assert.equal(releaseScheduleBatchLease({ current: transferred, ownership: { ownerToken: "old", generation: 1 }, now: 160, status: "complete" }), null);
  assert.equal(renewScheduleBatchLease({ current: transferred, ownership: { ownerToken: "old", generation: 1 }, now: 160, leaseMs: 50 }), null);
});

test("recipient progress skips writes when the persisted row is already current", () => {
  const approved = approveReviewedScheduleBatch({
    current: makeScheduleBatch(), churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "approved",
    approvedRecipients: [
      { memberId: "one", intentId: "one", approvalVersion: "review-one", status: "sent" },
    ], httpError,
  });
  const claimed = claimApprovedScheduleBatch({ current: approved, churchId: "church", ownerToken: "owner", now: 100, leaseMs: 500, httpError });
  const unchanged = updateScheduleBatchRecipient({
    current: claimed,
    ownership: { ownerToken: "owner", generation: 1 },
    memberId: "one",
    patch: { status: claimed.recipients[0].status },
    now: 200,
  });
  assert.equal(unchanged, claimed);
});

test("the Firestore-style shared coordinator caps provider concurrency across dispatcher instances", async () => {
  const batches = new Map();
  const candidate = approveReviewedScheduleBatch({
    current: {
      ...makeScheduleBatch(), status: "prepared", recipients: [
        { memberId: "one", intentId: "one", approvalVersion: "review-one", status: "ready", segmentCount: 1 },
      ],
    },
    churchId: "church", scheduleId: "schedule", approvalVersion: "approved-review",
    actorUid: "manager", now: new Date(1).toISOString(),
    approvedRecipients: [{ memberId: "one", intentId: "one", approvalVersion: "review-one", status: "preview", segmentCount: 1 }],
    httpError,
  });
  batches.set(candidate.batchId, candidate);
  const tails = new Map();
  const runMemoryClaim = (key, task) => {
    const previous = tails.get(key) || Promise.resolve();
    const current = previous.then(task, task);
    tails.set(key, current.then(() => undefined, () => undefined));
    return current;
  };
  const operations = createScheduleBatchStoreOperations({
    requireFirestore: () => null,
    COLLECTIONS: { notificationBatches: "notificationBatches" },
    getDoc: async (collection, id) => collection === "notificationBatches" ? batches.get(id) || null : null,
    setDoc: async (collection, id, value) => { if (collection === "notificationBatches") batches.set(id, value); },
    queryDocs: async () => [...batches.values()],
    runMemoryClaim,
    httpError,
  });
  const states = new Map([["one", { status: "ready" }]]);
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  let resolveProvider;
  const providerBarrier = new Promise((resolve) => { resolveProvider = resolve; });
  const makeDispatcher = (id) => createScheduleBatchDispatcher({
    ...operations,
    isStillAuthorized: async () => true,
    processRecipient: async ({ recipient }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(recipient.intentId);
      if (calls.length === 1) await providerBarrier;
      states.set(recipient.intentId, { status: "sent" });
      active -= 1;
      return {};
    },
    getRecipientState: async (recipient) => states.get(recipient.intentId),
    createOwnerToken: () => id,
    logger: { info() {}, error() {} },
  });
  const first = makeDispatcher("owner-one");
  const second = makeDispatcher("owner-two");
  const firstRun = first.runOnce();
  while (calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
  await second.runOnce();
  assert.equal(calls.length, 1, "a second process is fenced while the app-wide provider lease is held");
  assert.equal(maximumActive, 1);
  resolveProvider();
  await firstRun;
  await first.stop();
  await second.stop();
});

test("shared provider pacing accounts for approved SMS segments rather than recipient count", async () => {
  const store = new Map();
  const tails = new Map();
  const runMemoryClaim = (key, task) => {
    const previous = tails.get(key) || Promise.resolve();
    const current = previous.then(task, task);
    tails.set(key, current.then(() => undefined, () => undefined));
    return current;
  };
  const operations = createScheduleBatchStoreOperations({
    requireFirestore: () => null,
    COLLECTIONS: { notificationBatches: "notificationBatches" },
    getDoc: async (_collection, id) => store.get(id) || null,
    setDoc: async (_collection, id, value) => { store.set(id, value); },
    queryDocs: async () => [],
    runMemoryClaim,
    httpError,
  });
  const ownership = await operations.claimCoordinator("owner", 1000, 90_000);
  assert.deepEqual(ownership, { ownerToken: "owner", generation: 1 });
  assert.equal(await operations.reserveProviderWindow(ownership, 1000, 90_000, 1, 2), 0);
  assert.equal(await operations.reserveProviderWindow(ownership, 1000, 90_000, 1, 3), 2000);
  assert.equal(await operations.reserveProviderWindow(ownership, 3000, 90_000, 1, 1), 3000);
  const saved = store.get("__schedule_sms_dispatch_coordinator__");
  assert.equal(saved.nextSendAvailableAt, 7000);
  await operations.releaseCoordinator(ownership, 4000);
  assert.equal(store.get("__schedule_sms_dispatch_coordinator__").dispatchOwnerToken, "");
});

test("concurrent provider execution obeys the configured request cap and avoids the old final full-batch sweep", async () => {
  const recipients = Array.from({ length: 100 }, (_, index) => ({
    memberId: `member-${index}`,
    intentId: `intent-${index}`,
    approvalVersion: `review-${index}`,
    status: "ready",
    segmentCount: index % 3 === 0 ? 2 : 1,
  }));
  let batch = approveReviewedScheduleBatch({
    current: { ...makeScheduleBatch(), status: "prepared", recipients },
    churchId: "church", scheduleId: "schedule", approvalVersion: "approved-review",
    actorUid: "manager", now: new Date(1).toISOString(), approvedRecipients: recipients, httpError,
  });
  const states = new Map(recipients.map((recipient) => [recipient.intentId, { status: "ready" }]));
  const progressReads = [];
  let active = 0;
  let maximumActive = 0;
  const dispatcher = createScheduleBatchDispatcher({
    listCandidates: async () => [batch],
    claim: async (candidate, ownerToken, now, leaseMs) => {
      const next = claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken, now, leaseMs, httpError });
      if (next) batch = next;
      return next;
    },
    renew: async (batchId, owner, now, leaseMs) => {
      const next = renewScheduleBatchLease({ current: batch, ownership: owner, now, leaseMs });
      if (next) batch = next;
      return next;
    },
    saveRecipientProgress: async (batchId, owner, memberId, patch, now) => {
      const next = updateScheduleBatchRecipient({ current: batch, ownership: owner, memberId, patch, now });
      if (next) batch = next;
      return next;
    },
    release: async (batchId, owner, now, status) => {
      const next = releaseScheduleBatchLease({ current: batch, ownership: owner, now, status });
      if (next) batch = next;
      return next;
    },
    isStillAuthorized: async () => true,
    processRecipient: async ({ recipient }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      states.set(recipient.intentId, { status: "sent" });
      active -= 1;
      return {};
    },
    getRecipientState: async (recipient) => {
      progressReads.push(recipient.intentId);
      return states.get(recipient.intentId);
    },
    reserveProviderWindow: async () => 0,
    createOwnerToken: () => "owner",
    now: () => 200,
    maxRecipientsPerRun: 10,
    maxConcurrentProviderRequests: 2,
    logger: { info() {}, error() {} },
  });
  await dispatcher.runOnce();
  assert.equal(batch.status, "approved");
  assert.equal(maximumActive, 2);
  assert.equal(progressReads.length, 20, "one pre-send and one post-send state read per processed recipient; no 100-row completion sweep");
  assert.equal(batch.recipients.filter((recipient) => recipient.status === "sent").length, 10);
  await dispatcher.stop();
});

test("dispatcher resumes approved work, persists each recipient, and never retries accepted or unknown intents", async () => {
  let batch = approveReviewedScheduleBatch({
    current: makeScheduleBatch(), churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "approved",
    approvedRecipients: [
      { memberId: "one", intentId: "one", approvalVersion: "review-one", message: "one" },
      { memberId: "two", intentId: "two", approvalVersion: "review-two", message: "two" },
    ], httpError,
  });
  const states = new Map(["one", "two"].map((id) => [id, { status: "preview" }]));
  const calls = [];
  const progress = [];
  let now = 100;
  const dispatcher = createScheduleBatchDispatcher({
    listCandidates: async () => [batch],
    claim: async (candidate, ownerToken, at, leaseMs) => {
      const next = claimApprovedScheduleBatch({ current: batch, churchId: "church", ownerToken, now: at, leaseMs, httpError });
      if (next) batch = next;
      return next;
    },
    renew: async (batchId, owner, at, leaseMs) => {
      const next = renewScheduleBatchLease({ current: batch, ownership: owner, now: at, leaseMs });
      if (next) batch = next;
      return next;
    },
    saveRecipientProgress: async (batchId, owner, memberId, state) => {
      const next = updateScheduleBatchRecipient({ current: batch, ownership: owner, memberId, patch: state, now: now++ });
      if (next) { batch = next; progress.push(memberId); }
      return next;
    },
    release: async (batchId, owner, at, status) => {
      const next = releaseScheduleBatchLease({ current: batch, ownership: owner, now: at, status });
      if (next) batch = next;
      return next;
    },
    isStillAuthorized: async () => true,
    processRecipient: async ({ recipient }) => {
      calls.push(recipient.intentId);
      states.set(recipient.intentId, { status: recipient.intentId === "one" ? "sent" : "unknown" });
      return {};
    },
    getRecipientState: async (recipient) => states.get(recipient.intentId),
    createOwnerToken: (() => { let n = 0; return () => `owner-${++n}`; })(),
    now: () => now,
    maxRecipientsPerRun: 2,
    logger: { error() {} },
  });

  await dispatcher.runOnce();
  assert.deepEqual(calls, ["one", "two"]);
  assert.deepEqual(progress, ["one", "two"]);
  assert.equal(batch.status, "partial");
  await dispatcher.runOnce();
  assert.deepEqual(calls, ["one", "two"]);
  await dispatcher.stop();
});

test("permission revocation pauses approved work without processing recipients", async () => {
  const batch = approveReviewedScheduleBatch({
    current: makeScheduleBatch(), churchId: "church", scheduleId: "schedule",
    approvalVersion: "approved-review", actorUid: "manager", now: "approved",
    approvedRecipients: [{ memberId: "one", intentId: "one", approvalVersion: "review-one" }], httpError,
  });
  let savedStatus = "";
  let sent = 0;
  const dispatcher = createScheduleBatchDispatcher({
    listCandidates: async () => [batch],
    claim: async (candidate, ownerToken, now, leaseMs) => claimApprovedScheduleBatch({ current: candidate, churchId: "church", ownerToken, now, leaseMs, httpError }),
    renew: async () => true,
    saveRecipientProgress: async () => true,
    release: async (batchId, ownership, now, status) => { savedStatus = status; return true; },
    isStillAuthorized: async () => false,
    processRecipient: async () => { sent += 1; },
    getRecipientState: async () => ({ status: "preview" }),
    createOwnerToken: () => "owner",
    logger: { error() {} },
  });
  await dispatcher.runOnce();
  assert.equal(savedStatus, "paused");
  assert.equal(sent, 0);
  await dispatcher.stop();
});

test("bounded dispatch advances past finished recipients and rotates between approved batches", async () => {
  const batches = new Map();
  for (const [batchId, approvedAt] of [["batch-a", "2026-10-12T10:00:00.000Z"], ["batch-b", "2026-10-12T10:01:00.000Z"]]) {
    const current = {
      ...makeScheduleBatch(), batchId, status: "prepared",
      reviewVersion: `${batchId}-review`,
      recipients: ["one", "two", "three"].map((memberId) => ({
        memberId: `${batchId}-${memberId}`,
        intentId: `${batchId}-${memberId}`,
        approvalVersion: `${batchId}-${memberId}-review`,
        status: "preview",
      })),
    };
    batches.set(batchId, approveReviewedScheduleBatch({
      current, churchId: "church", scheduleId: "schedule",
      approvalVersion: current.reviewVersion, actorUid: "manager", now: approvedAt,
      approvedRecipients: current.recipients, httpError,
    }));
  }
  const states = new Map([...batches.values()].flatMap((batch) =>
    batch.approval.recipients.map((recipient) => [`${batch.batchId}/${recipient.memberId}`, { status: "preview" }])));
  const calls = [];
  let currentTime = Date.parse("2026-10-12T10:02:00.000Z");
  const dispatcher = createScheduleBatchDispatcher({
    listCandidates: async () => [...batches.values()].sort((left, right) => left.dispatchPriorityAt - right.dispatchPriorityAt),
    claim: async (candidate, ownerToken, now, leaseMs) => {
      const current = batches.get(candidate.batchId);
      const next = claimApprovedScheduleBatch({ current, churchId: "church", ownerToken, now, leaseMs, httpError });
      if (next) batches.set(candidate.batchId, next);
      return next;
    },
    renew: async (batchId, ownership, now, leaseMs) => {
      const next = renewScheduleBatchLease({ current: batches.get(batchId), ownership, now, leaseMs });
      if (next) batches.set(batchId, next);
      return next;
    },
    saveRecipientProgress: async (batchId, ownership, memberId, patch) => {
      const next = updateScheduleBatchRecipient({ current: batches.get(batchId), ownership, memberId, patch, now: currentTime++ });
      if (next) batches.set(batchId, next);
      return next;
    },
    release: async (batchId, ownership, now, status) => {
      const next = releaseScheduleBatchLease({ current: batches.get(batchId), ownership, now, status });
      if (next) batches.set(batchId, next);
      return next;
    },
    isStillAuthorized: async () => true,
    processRecipient: async ({ batch, recipient }) => {
      calls.push(`${batch.batchId}/${recipient.memberId}`);
      states.set(`${batch.batchId}/${recipient.memberId}`, { status: "sent" });
      return {};
    },
    getRecipientState: async (recipient, batch) => states.get(`${batch.batchId}/${recipient.memberId}`),
    createOwnerToken: (() => { let count = 0; return () => `owner-${++count}`; })(),
    now: () => currentTime++,
    maxRecipientsPerRun: 1,
    logger: { error() {} },
  });

  for (let pass = 0; pass < 6; pass += 1) await dispatcher.runOnce();
  assert.deepEqual(calls.slice(0, 4), [
    "batch-a/batch-a-one", "batch-b/batch-b-one",
    "batch-a/batch-a-two", "batch-b/batch-b-two",
  ]);
  assert.equal(calls.length, 6);
  assert.equal(batches.get("batch-a").status, "complete");
  assert.equal(batches.get("batch-b").status, "complete");
  await dispatcher.stop();
});
