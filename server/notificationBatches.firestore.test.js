import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  approveReviewedScheduleBatch,
  createScheduleBatchDispatcher,
  createScheduleBatchStoreOperations,
} from "./notificationBatches.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const projectId = "demo-worshipsync";
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const clearFirestoreEmulator = async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const url = new URL(`http://${emulatorHost}`);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "Firestore cleanup is restricted to a local emulator host");
  const response = await fetch(`http://${emulatorHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.status, 200, "Firestore emulator database was cleared before the integration case");
};

const withFirestore = async (task) => {
  const id = randomUUID();
  await clearFirestoreEmulator();
  const app = initializeApp({ projectId }, `schedule-batch-${id}`);
  const db = getFirestore(app);
  try {
    await task(db);
  } finally {
    await deleteApp(app);
  }
};

const makeStore = (db) => createScheduleBatchStoreOperations({
  requireFirestore: () => db,
  COLLECTIONS: { notificationBatches: "notificationBatches" },
  getDoc: async (collection, id) => {
    const snapshot = await db.collection(collection).doc(id).get();
    return snapshot.exists ? { batchId: snapshot.id, ...snapshot.data() } : null;
  },
  setDoc: async (collection, id, value, options) => db.collection(collection).doc(id).set(value, options),
  queryDocs: async () => [],
  runMemoryClaim: async () => { throw new Error("Firestore emulator tests must not use the memory claim path."); },
  httpError,
});

const approvedBatch = ({ batchId, size, status = "approved", previousStates = new Map() }) => {
  const recipients = Array.from({ length: size }, (_, index) => {
    const memberId = `member-${index + 1}`;
    const intentId = `intent-${index + 1}`;
    return {
      memberId,
      intentId,
      approvalVersion: `review-${index + 1}`,
      status: previousStates.get(intentId) || "preview",
      segmentCount: index % 7 === 0 ? 2 : 1,
    };
  });
  const prepared = {
    batchId,
    churchId: "emulator-church",
    scheduleId: "emulator-schedule",
    sourceType: "team_schedule",
    intentType: "schedule_initial_notification",
    status: "prepared",
    reviewVersion: "review-batch",
    dispatchPriorityAt: 1,
    recipients,
    selectedMemberIds: recipients.map((row) => row.memberId),
  };
  const batch = approveReviewedScheduleBatch({
    current: prepared,
    churchId: prepared.churchId,
    scheduleId: prepared.scheduleId,
    approvalVersion: prepared.reviewVersion,
    actorUid: "emulator-operator",
    now: new Date(1).toISOString(),
    approvedRecipients: recipients.map(({ memberId, intentId, approvalVersion, status: rowStatus, segmentCount }) => ({
      memberId, intentId, approvalVersion, status: rowStatus, segmentCount, message: "Reviewed emulator message",
    })),
    httpError,
  });
  batch.status = status;
  batch.dispatchLeaseExpiresAt = status === "dispatching" ? 1 : 0;
  return batch;
};

const dispatcherFor = (store, {
  ownerToken,
  processRecipient,
  getRecipientState,
  isStillAuthorized = async () => true,
  maxRecipientsPerRun = 10,
  maxConcurrentProviderRequests = 1,
  now = () => Date.now(),
} = {}) => createScheduleBatchDispatcher({
  ...store,
  createOwnerToken: () => ownerToken,
  isStillAuthorized,
  processRecipient,
  getRecipientState,
  maxRecipientsPerRun,
  maxConcurrentProviderRequests,
  pollIntervalMs: 1000,
  leaseMs: 30000,
  now,
  logger: { info() {}, warn() {}, error() {} },
});

test("Firestore emulator lets only one of two live dispatchers claim and send an approved batch", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const batchId = `batch-${randomUUID()}`;
    const batch = approvedBatch({ batchId, size: 1 });
    await db.collection("notificationBatches").doc(batchId).set(batch);
    const state = new Map([["intent-1", { status: "preview" }]]);
    let signalProviderStarted;
    const started = new Promise((resolve) => { signalProviderStarted = resolve; });
    let releaseProvider;
    const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
    let providerCalls = 0;
    const makeProcess = async ({ recipient }) => {
      providerCalls += 1;
      signalProviderStarted();
      await providerGate;
      state.set(recipient.intentId, { status: "sent", outcome: "confirmed" });
    };
    const first = dispatcherFor(makeStore(db), {
      ownerToken: "dispatcher-one",
      processRecipient: makeProcess,
      getRecipientState: async (recipient) => state.get(recipient.intentId),
    });
    const second = dispatcherFor(makeStore(db), {
      ownerToken: "dispatcher-two",
      processRecipient: makeProcess,
      getRecipientState: async (recipient) => state.get(recipient.intentId),
    });
    try {
      const firstRun = first.runOnce();
      let timeout;
      const startedOrTimedOut = Promise.race([
        started,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("First dispatcher did not reach the provider.")), 10000);
          timeout.unref?.();
        }),
      ]);
      await startedOrTimedOut;
      clearTimeout(timeout);
      assert.equal(await second.runOnce(), false, "the shared Firestore coordinator excludes a second live web process");
      releaseProvider();
      assert.equal(await firstRun, true);
      assert.equal(providerCalls, 1);
      const saved = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(saved.data().status, "complete");
      assert.equal(saved.data().recipients[0].status, "sent");
    } finally {
      releaseProvider?.();
      await first.stop({ timeoutMs: 1000 });
      await second.stop({ timeoutMs: 1000 });
    }
  });
});

test("Firestore emulator transfers expired leases and fences the old owner's progress write", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const batchId = `batch-${randomUUID()}`;
    const batch = approvedBatch({ batchId, size: 1 });
    await db.collection("notificationBatches").doc(batchId).set(batch);
    const store = makeStore(db);
    const initial = (await db.collection("notificationBatches").doc(batchId).get()).data();
    const ownerA = await store.claim({ ...initial, batchId }, "owner-a", 1000, 100);
    assert.equal(ownerA.dispatchGeneration, 1);
    const ownerB = await store.claim({ ...ownerA, batchId }, "owner-b", 1200, 100);
    assert.equal(ownerB.dispatchGeneration, 2);
    assert.equal(await store.saveRecipientProgress(batchId, { ownerToken: "owner-a", generation: 1 }, "member-1", { status: "sent" }, 1300), null);
    const savedByNewOwner = await store.saveRecipientProgress(batchId, { ownerToken: "owner-b", generation: 2 }, "member-1", { status: "preview" }, 1300);
    assert.equal(savedByNewOwner.recipients[0].status, "preview");
    const stored = await db.collection("notificationBatches").doc(batchId).get();
    assert.equal(stored.data().dispatchOwnerToken, "owner-b");
    assert.equal(stored.data().recipients[0].status, "preview");
  });
});

test("Firestore emulator fences a slow provider result after lease transfer and recovers accepted work without resending", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const batchId = `batch-${randomUUID()}`;
    await db.collection("notificationBatches").doc(batchId).set(approvedBatch({ batchId, size: 1 }));
    await db.collection("notificationIntents").doc("intent-1").set({ status: "preview", attemptId: "" });
    let signalProviderStarted;
    let releaseProvider;
    const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
    const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
    let providerCalls = 0;
    const readIntent = async (recipient) => {
      const snapshot = await db.collection("notificationIntents").doc(recipient.intentId).get();
      return snapshot.exists ? snapshot.data() : { status: "excluded" };
    };
    const sendOnce = async ({ recipient }) => {
      const claimed = await db.runTransaction(async (transaction) => {
        const ref = db.collection("notificationIntents").doc(recipient.intentId);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().status !== "preview") return false;
        transaction.set(ref, { status: "sending" }, { merge: true });
        return true;
      });
      if (!claimed) return;
      providerCalls += 1;
      signalProviderStarted();
      await providerGate;
      await db.runTransaction(async (transaction) => {
        const ref = db.collection("notificationIntents").doc(recipient.intentId);
        const snapshot = await transaction.get(ref);
        if (snapshot.exists && snapshot.data().status === "sending") transaction.set(ref, { status: "sent", outcome: "confirmed" }, { merge: true });
      });
    };
    const oldProcess = dispatcherFor(makeStore(db), {
      ownerToken: "slow-old-process",
      processRecipient: sendOnce,
      getRecipientState: readIntent,
    });
    const recoveredProcess = dispatcherFor(makeStore(db), {
      ownerToken: "new-process",
      processRecipient: sendOnce,
      getRecipientState: readIntent,
    });
    const resumedProcess = dispatcherFor(makeStore(db), {
      ownerToken: "restart-process",
      processRecipient: sendOnce,
      getRecipientState: readIntent,
    });
    try {
      const oldRun = oldProcess.runOnce();
      await providerStarted;
      await db.collection("notificationBatches").doc(batchId).update({ dispatchLeaseExpiresAt: Date.now() - 1 });
      await db.collection("notificationBatches").doc("__schedule_sms_dispatch_coordinator__").update({ dispatchOwnerToken: "", dispatchLeaseExpiresAt: 0 });
      await recoveredProcess.runOnce();
      releaseProvider();
      await oldRun;
      const afterOldWrite = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(afterOldWrite.data().recipients[0].status, "sending", "the stale owner cannot overwrite the new owner's progress");
      assert.equal((await readIntent({ intentId: "intent-1" })).status, "sent");

      await resumedProcess.runOnce();
      const complete = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(complete.data().status, "complete");
      assert.equal(complete.data().recipients[0].status, "sent");
      assert.equal(providerCalls, 1, "restart recovery sees the accepted intent and never starts another provider request");
    } finally {
      releaseProvider?.();
      await oldProcess.stop({ timeoutMs: 1000 });
      await recoveredProcess.stop({ timeoutMs: 1000 });
      await resumedProcess.stop({ timeoutMs: 1000 });
    }
  });
});

test("Firestore emulator restarts a 100-recipient batch, skips accepted and uncertain intents, and pauses on permission loss", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const batchId = `batch-${randomUUID()}`;
    const savedStates = new Map();
    for (let index = 0; index < 60; index += 1) savedStates.set(`intent-${index + 1}`, "sent");
    savedStates.set("intent-61", "unknown");
    const batch = approvedBatch({ batchId, size: 100, status: "dispatching", previousStates: savedStates });
    await db.collection("notificationBatches").doc(batchId).set(batch);
    const states = new Map([...savedStates].map(([intentId, status]) => [intentId, { status }]));
    for (let index = 61; index < 100; index += 1) states.set(`intent-${index + 1}`, { status: "preview" });
    let accepted = 0;
    let inFlight = 0;
    let peak = 0;
    const restart = dispatcherFor(makeStore(db), {
      ownerToken: "restart-process",
      maxRecipientsPerRun: 10,
      maxConcurrentProviderRequests: 2,
      getRecipientState: async (recipient) => states.get(recipient.intentId),
      processRecipient: async ({ recipient }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        accepted += 1;
        states.set(recipient.intentId, { status: "sent", outcome: "confirmed" });
        inFlight -= 1;
      },
    });
    try {
      while (accepted < 39) await restart.runOnce();
      const stored = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(accepted, 39);
      assert.equal(peak, 2);
      assert.equal(states.get("intent-1").status, "sent");
      assert.equal(states.get("intent-61").status, "unknown");
      assert.equal(stored.data().status, "partial");
    } finally {
      await restart.stop({ timeoutMs: 1000 });
    }

    const pauseId = `batch-${randomUUID()}`;
    const pauseBatch = approvedBatch({ batchId: pauseId, size: 3 });
    await db.collection("notificationBatches").doc(pauseId).set(pauseBatch);
    let authorized = true;
    let acceptedBeforePause = 0;
    const pauseStates = new Map(Array.from({ length: 3 }, (_, index) => [`intent-${index + 1}`, { status: "preview" }]));
    const pausing = dispatcherFor(makeStore(db), {
      ownerToken: "permission-revocation-process",
      getRecipientState: async (recipient) => pauseStates.get(recipient.intentId),
      isStillAuthorized: async () => authorized,
      processRecipient: async ({ recipient }) => {
        acceptedBeforePause += 1;
        pauseStates.set(recipient.intentId, { status: "sent", outcome: "confirmed" });
        authorized = false;
      },
    });
    try {
      await pausing.runOnce();
      const paused = await db.collection("notificationBatches").doc(pauseId).get();
      assert.equal(acceptedBeforePause, 1);
      assert.equal(paused.data().status, "paused");
      assert.equal(paused.data().recipients.filter((row) => row.status === "sent").length, 1);
      assert.equal(paused.data().recipients.filter((row) => row.status === "preview").length, 2);
    } finally {
      await pausing.stop({ timeoutMs: 1000 });
    }
  });
});
