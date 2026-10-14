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
const coordinatorId = "internal-schedule-sms-dispatch-coordinator";
const reservedCoordinatorId = "__schedule_sms_dispatch_coordinator__";
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
  let app;
  let db;
  let taskError;
  try {
    await clearFirestoreEmulator();
    app = initializeApp({ projectId }, `schedule-batch-${id}`);
    db = getFirestore(app);
    await task(db);
  } catch (error) {
    taskError = error;
  }
  const cleanupErrors = [];
  if (db) {
    try {
      await db.terminate();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (app) {
    try {
      await deleteApp(app);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (taskError && cleanupErrors.length) {
    throw new AggregateError([taskError, ...cleanupErrors], "Firestore test failed and cleanup reported an error.");
  }
  if (taskError) throw taskError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Firestore test cleanup failed.");
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
  logger = { info() {}, warn() {}, error() {} },
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
  logger,
});

test("Firestore emulator rejects the former reserved coordinator ID", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    await assert.rejects(
      db.collection("notificationBatches").doc(reservedCoordinatorId).set({ status: "idle" }),
      (error) => /document|path|reserved|__schedule_sms_dispatch_coordinator__/i.test(String(error?.message || error)),
    );
  });
});

test("Firestore coordinator lease is atomic, releasable, and excluded from batch discovery", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const firstStore = makeStore(db);
    const secondStore = makeStore(db);
    const [firstClaim, secondClaim] = await Promise.all([
      firstStore.claimCoordinator("coordinator-one", 1000, 500),
      secondStore.claimCoordinator("coordinator-two", 1000, 500),
    ]);
    const claims = [firstClaim, secondClaim].filter(Boolean);
    assert.equal(claims.length, 1, "only one process acquires the coordinator lease");
    const owner = claims[0];
    const ownerStore = firstClaim ? firstStore : secondStore;
    const coordinatorRef = db.collection("notificationBatches").doc(coordinatorId);
    const created = await coordinatorRef.get();
    assert.equal(created.exists, true);
    assert.equal(created.data().intentType, "schedule_sms_dispatch_coordinator");
    assert.equal(created.data().dispatchGeneration, 1);
    assert.equal(created.data().dispatchOwnerToken, firstClaim ? "coordinator-one" : "coordinator-two");
    assert.equal(created.data().dispatchLeaseExpiresAt, 1500);

    await db.collection("notificationBatches").doc("approved-batch").set(approvedBatch({ batchId: "approved-batch", size: 1 }));
    await coordinatorRef.update({ status: "approved", dispatchPriorityAt: 1 });
    const candidates = await ownerStore.listCandidates();
    assert.deepEqual(candidates.map((batch) => batch.batchId), ["approved-batch"]);
    await coordinatorRef.update({ status: "dispatching" });

    assert.equal(await ownerStore.reserveProviderWindow(owner, 1100, 500, 2, 2), 0);
    assert.ok(await ownerStore.releaseCoordinator(owner, 1200));
    const released = (await coordinatorRef.get()).data();
    assert.equal(released.status, "idle");
    assert.equal(released.dispatchOwnerToken, "");
    assert.equal(released.dispatchLeaseExpiresAt, 0);
    assert.equal(released.nextSendAvailableAt, 2100, "release preserves the durable provider rate window");

    const reacquired = await secondStore.claimCoordinator("coordinator-three", 1300, 500);
    assert.deepEqual(reacquired, { ownerToken: "coordinator-three", generation: 2 });
  });
});

test("Firestore coordinator transfers an expired lease and fences the previous owner", { skip: !enabled }, async () => {
  await withFirestore(async (db) => {
    const store = makeStore(db);
    const ownerA = await store.claimCoordinator("coordinator-old", 1000, 100);
    const ownerB = await store.claimCoordinator("coordinator-new", 1101, 100);
    assert.deepEqual(ownerA, { ownerToken: "coordinator-old", generation: 1 });
    assert.deepEqual(ownerB, { ownerToken: "coordinator-new", generation: 2 });
    assert.equal(await store.renewCoordinator(ownerA, 1110, 100), null);
    assert.equal(await store.releaseCoordinator(ownerA, 1110), null);
    const saved = (await db.collection("notificationBatches").doc(coordinatorId).get()).data();
    assert.equal(saved.dispatchOwnerToken, "coordinator-new");
    assert.equal(saved.dispatchGeneration, 2);
    assert.equal(saved.dispatchLeaseExpiresAt, 1201);
  });
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
    const dispatcherErrors = [];
    const logger = {
      info() {},
      warn() {},
      error(event, details) {
        if (event === "schedule_sms.dispatch_scan_error") dispatcherErrors.push(details);
      },
    };
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
      logger,
    });
    const second = dispatcherFor(makeStore(db), {
      ownerToken: "dispatcher-two",
      processRecipient: makeProcess,
      getRecipientState: async (recipient) => state.get(recipient.intentId),
    });
    let timeout;
    let taskError;
    try {
      const firstRun = first.runOnce();
      let providerStarted = false;
      const firstRunResult = firstRun.then((result) => {
        if (!providerStarted && !result) {
          const details = dispatcherErrors.at(-1);
          throw new Error(details?.message || "First dispatcher stopped before reaching the provider.");
        }
        return result;
      });
      const startedOrTimedOut = Promise.race([
        started.then(() => { providerStarted = true; }),
        firstRunResult,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("First dispatcher did not reach the provider.")), 10000);
          timeout.unref?.();
        }),
      ]);
      await startedOrTimedOut;
      assert.equal(await second.runOnce(), false, "the shared Firestore coordinator excludes a second live web process");
      releaseProvider();
      assert.equal(await firstRun, true);
      assert.equal(providerCalls, 1);
      const saved = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(saved.data().status, "complete");
      assert.equal(saved.data().recipients[0].status, "sent");
    } catch (error) {
      taskError = error;
    } finally {
      releaseProvider?.();
      if (timeout) clearTimeout(timeout);
      const stopResults = await Promise.allSettled([
        first.stop({ timeoutMs: 1000 }),
        second.stop({ timeoutMs: 1000 }),
      ]);
      const stopErrors = stopResults.flatMap((result) =>
        result.status === "rejected"
          ? [result.reason]
          : result.value === true
            ? []
            : [new Error("A schedule dispatcher did not finish before shutdown.")],
      );
      if (stopErrors.length) {
        taskError = taskError
          ? new AggregateError([taskError, ...stopErrors], "Schedule dispatcher test and cleanup failed.")
          : new AggregateError(stopErrors, "Schedule dispatchers failed to stop cleanly.");
      }
    }
    if (taskError) throw taskError;
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
      const coordinator = await db.collection("notificationBatches").doc(coordinatorId).get();
      await makeStore(db).releaseCoordinator({
        ownerToken: coordinator.data().dispatchOwnerToken,
        generation: coordinator.data().dispatchGeneration,
      }, Date.now());
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
    let signalFirstPair;
    const firstPairStarted = new Promise((resolve) => { signalFirstPair = resolve; });
    let releaseFirstPair;
    const firstPairGate = new Promise((resolve) => { releaseFirstPair = resolve; });
    const restart = dispatcherFor(makeStore(db), {
      ownerToken: "restart-process",
      maxRecipientsPerRun: 10,
      maxConcurrentProviderRequests: 2,
      getRecipientState: async (recipient) => states.get(recipient.intentId),
      processRecipient: async ({ recipient }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        if (inFlight === 2) signalFirstPair();
        if (accepted === 0) await firstPairGate;
        accepted += 1;
        states.set(recipient.intentId, { status: "sent", outcome: "confirmed" });
        inFlight -= 1;
      },
    });
    let firstPairTimeout;
    try {
      const firstRun = restart.runOnce();
      await Promise.race([
        firstPairStarted,
        firstRun.then(() => { throw new Error("The first run ended before two provider requests overlapped."); }),
        new Promise((_, reject) => {
          firstPairTimeout = setTimeout(() => reject(new Error("Two provider requests did not overlap.")), 10000);
        }),
      ]);
      clearTimeout(firstPairTimeout);
      releaseFirstPair();
      await firstRun;
      while (accepted < 39) await restart.runOnce();
      const stored = await db.collection("notificationBatches").doc(batchId).get();
      assert.equal(accepted, 39);
      assert.equal(peak, 2);
      assert.equal(states.get("intent-1").status, "sent");
      assert.equal(states.get("intent-61").status, "unknown");
      assert.equal(stored.data().status, "partial");
    } finally {
      clearTimeout(firstPairTimeout);
      releaseFirstPair();
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
