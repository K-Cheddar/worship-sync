process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDigestFirestore } from "./fixtures/digestFirestore.js";
const auth = await import("../authService.js");
const { COLLECTIONS: C } = auth;
const recipientHash = (email) => createHash("sha256").update(email).digest("hex");
let counter = 0;
afterEach(() => {
  auth.setSendEmailForServerTests(null);
  auth.setServerFirestoreForTests(null);
  auth.setIntakeDigestProviderTimeoutForServerTests(null);
});

const fixture = async ({ firestore = false, old = true } = {}) => {
  const id = `response_digest_${++counter}`;
  const churchId = `${id}_church`;
  const teamId = `${id}_team`;
  const since = new Date(Date.now() - (old ? 21 * 60 * 1000 : 1000)).toISOString();
  const seed = {
    [C.teams]: { [teamId]: { teamId, churchId, name: "Media" } },
    [C.teamSchedules]: { [id]: { scheduleId: id, churchId, teamId, name: "Sunday",
      pendingResponseDigestSince: since,
      responses: { sunday: { "camera::0": { memberId: "avery", response: "accepted", respondedAt: since } } },
    } },
    [C.users]: {}, [C.memberships]: {},
  };
  for (const name of ["first", "second"]) {
    const userId = `${id}_${name}`;
    seed[C.users][userId] = { uid: userId, email: `${name}@example.test` };
    seed[C.memberships][`${churchId}_${userId}`] = { churchId, userId, role: "member", status: "active",
      permissions: { teams: "none", teamScopes: { [teamId]: "edit" } } };
  }
  let db;
  if (firestore) {
    db = createDigestFirestore(seed);
    auth.setServerFirestoreForTests(db);
  } else {
    for (const [collection, rows] of Object.entries(seed)) {
      for (const [key, row] of Object.entries(rows)) await auth.setDoc(collection, key, row);
    }
  }
  return { id, churchId, teamId, since, db };
};

test("three failed attempts complete the batch without duplicates and allow the next digest", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const warnings = [];
  t.mock.method(console, "warn", (line) => warnings.push(JSON.parse(line)));
  for (const firestore of [false, true]) {
    const { id, since } = await fixture({ firestore });
    const sent = [];
    let newerAt;
    const conflict = { memberId: "jordan", occurrenceId: "next", cellKey: "camera::1", blockedAt: since };
    auth.setSendEmailForServerTests(async (email) => {
      sent.push(email);
      if (email.to === "second@example.test") {
        if (sent.length === 4) {
          newerAt = new Date(Date.now() + 1000).toISOString();
          await auth.setDoc(C.teamSchedules, id, {
            responses: { next: { "camera::1": { memberId: "jordan", response: "declined", respondedAt: newerAt } } },
            pendingBlockoutConflicts: { added: conflict },
          }, { merge: true });
        }
        throw new Error("permanent provider failure");
      }
    });
    let frozen;
    for (const count of [1, 2]) {
      await auth.sendScheduleResponseDigest(id);
      const current = await auth.getDoc(C.teamSchedules, id);
      assert.equal(current.pendingResponseDigestSince, since);
      assert.deepEqual(current.pendingResponseDigestBatch.attempts, { [recipientHash("second@example.test")]: count });
      frozen ||= current.pendingResponseDigestBatch;
    }
    await auth.sendScheduleResponseDigest(id);
    assert.deepEqual(sent.map((email) => email.to), [
      "first@example.test", "second@example.test", "second@example.test", "second@example.test",
    ]);
    assert.ok(sent.slice(1).every((email) => email.idempotencyKey === sent[1].idempotencyKey && email.htmlBody === frozen.email.htmlBody));
    const completed = await auth.getDoc(C.teamSchedules, id);
    assert.equal(completed.pendingResponseDigestBatch, null);
    assert.equal(completed.pendingResponseDigestSince, frozen.nextSince);
    assert.equal(completed.responses.next["camera::1"].respondedAt, newerAt);
    assert.deepEqual(completed.pendingBlockoutConflicts, { added: conflict });
    assert.equal((await auth.queryDocs(C.notificationDeliveries, [{ field: "subject", value: id }])).length, 1);

    t.mock.timers.tick(1001);
    auth.setSendEmailForServerTests(async (email) => sent.push(email));
    await auth.sendScheduleResponseDigest(id);
    assert.deepEqual(sent.slice(4).map((email) => email.to), ["first@example.test", "second@example.test"]);
    assert.notEqual(sent[4].idempotencyKey, sent[0].idempotencyKey);
    assert.match(sent[4].textBody, /Cannot serve \(1\)/);
    assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
    auth.setServerFirestoreForTests(null);
  }
  const exhausted = warnings.filter((line) => line.event === "schedule.responses.digest.retry_exhausted");
  assert.equal(exhausted.length, 2);
  assert.ok(exhausted.every((line) => line.attemptCount === 3));
  assert.ok(warnings.every((line) => !JSON.stringify(line).includes("@example.test")));
});

test("restart retains retry counts and skips exhausted recipients while respecting an active lease", async () => {
  const { id, db } = await fixture({ firestore: true });
  auth.setSendEmailForServerTests(async () => { throw new Error("provider unavailable"); });
  await auth.sendScheduleResponseDigest(id);
  await auth.sendScheduleResponseDigest(id);
  const frozen = db.read(C.teamSchedules, id).pendingResponseDigestBatch;
  assert.deepEqual(frozen.attempts, {
    [recipientHash("first@example.test")]: 2, [recipientHash("second@example.test")]: 2,
  });
  // Simulate a worker stopping after checkpointing the first recipient's last failure.
  const retained = { ...frozen, claimId: "stopped-worker", leaseUntil: Date.now() + 60_000,
    attempts: { ...frozen.attempts, [recipientHash("first@example.test")]: 3 } };
  await db.collection(C.teamSchedules).doc(id).update({ pendingResponseDigestBatch: retained });
  const restarted = await import("../authService.js?response-digest-retry-limit-restart");
  restarted.setServerFirestoreForTests(db);
  const sent = [];
  restarted.setSendEmailForServerTests(async (email) => {
    sent.push(email);
    throw new Error("provider still unavailable");
  });
  try {
    await restarted.recoverPendingScheduleResponseDigests();
    await restarted.sendScheduleResponseDigest(id);
    assert.equal(sent.length, 0);
    assert.deepEqual(db.read(C.teamSchedules, id).pendingResponseDigestBatch, retained);
    await db.collection(C.teamSchedules).doc(id).update({ pendingResponseDigestBatch: { ...retained, leaseUntil: 1 } });
    await restarted.sendScheduleResponseDigest(id);
    assert.deepEqual(sent.map((email) => email.to), ["second@example.test"]);
    assert.equal(sent[0].htmlBody, frozen.email.htmlBody);
    assert.equal(db.read(C.teamSchedules, id).pendingResponseDigestBatch, null);
    assert.equal(db.read(C.teamSchedules, id).pendingResponseDigestSince, null);
    await restarted.sendScheduleResponseDigest(id);
    assert.equal(sent.length, 1);
  } finally {
    restarted.setSendEmailForServerTests(null);
    restarted.setServerFirestoreForTests(null);
  }
});

test("a failed send cannot change retry counts or release a replacement worker's lease", async () => {
  const { id, db } = await fixture({ firestore: true });
  let rejectSend;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const sent = [];
  auth.setSendEmailForServerTests(async (email) => {
    sent.push(email);
    started();
    await new Promise((_resolve, reject) => { rejectSend = reject; });
  });
  const running = auth.sendScheduleResponseDigest(id);
  await ready;
  const batch = db.read(C.teamSchedules, id).pendingResponseDigestBatch;
  const replacement = { ...batch, claimId: "replacement-worker", leaseUntil: Date.now() + 60_000,
    attempts: { [recipientHash("first@example.test")]: 2 } };
  await db.collection(C.teamSchedules).doc(id).update({ pendingResponseDigestBatch: replacement });
  rejectSend(new Error("late failed send"));
  await running;
  assert.equal(sent.length, 1);
  assert.deepEqual(db.read(C.teamSchedules, id).pendingResponseDigestBatch, replacement);
});

test("restart recovery waits for an active lease then resumes the frozen batch at expiration", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const { id, db } = await fixture({ firestore: true });
  auth.setSendEmailForServerTests(async (email) => {
    if (email.to.startsWith("second")) throw new Error("acceptance uncertain");
  });
  await auth.sendScheduleResponseDigest(id);
  const frozen = db.read(C.teamSchedules, id).pendingResponseDigestBatch;
  const restartAt = Date.now();
  // A stopped process loses its local timers; retain only the durable database.
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: restartAt });
  const leaseUntil = Date.now() + 5 * 60 * 1000;
  await db.collection(C.teamSchedules).doc(id).update({
    pendingResponseDigestBatch: { ...frozen, claimId: "stopped-worker", leaseUntil },
  });
  const restarted = await import("../authService.js?response-digest-active-restart");
  restarted.setServerFirestoreForTests(db);
  const sent = [];
  restarted.setSendEmailForServerTests(async (email) => { sent.push(email); });
  try {
    await restarted.recoverPendingScheduleResponseDigests();
    await restarted.sendScheduleResponseDigest(id); // A competing explicit attempt must also wait.
    t.mock.timers.tick(5 * 60 * 1000 - 1);
    await restarted.recoverPendingScheduleResponseDigests();
    assert.equal(sent.length, 0);
    assert.equal(db.read(C.teamSchedules, id).pendingResponseDigestBatch.claimId, "stopped-worker");
    t.mock.timers.tick(1);
    await new Promise(setImmediate); // Drain the timer's asynchronous delivery.
    assert.equal(sent.length, 1); // The first recipient was already accepted before the restart.
    assert.equal(sent[0].to, "second@example.test");
    assert.equal(sent[0].htmlBody, frozen.email.htmlBody);
    assert.equal(db.read(C.teamSchedules, id).pendingResponseDigestSince, null);
  } finally {
    restarted.setSendEmailForServerTests(null);
    restarted.setServerFirestoreForTests(null);
  }
});

test("failed durable sends retry after a bounded delay without a busy loop", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const { id } = await fixture();
  const attempts = [];
  auth.setSendEmailForServerTests(async (email) => {
    attempts.push(email);
    throw new Error("provider unavailable");
  });
  await auth.sendScheduleResponseDigest(id);
  t.mock.timers.tick(59_999);
  await auth.recoverPendingScheduleResponseDigests();
  assert.equal(attempts.length, 2);
  auth.setSendEmailForServerTests(async (email) => { attempts.push(email); });
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(attempts.length, 4);
  assert.equal(attempts[0].idempotencyKey, attempts[2].idempotencyKey);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});

test("missing provider never records delivery or advances the schedule batch", async () => {
  const { id, since } = await fixture();
  await auth.sendScheduleResponseDigest(id);
  const schedule = await auth.getDoc(C.teamSchedules, id);
  assert.equal(schedule.pendingResponseDigestSince, since);
  assert.ok(schedule.pendingResponseDigestBatch.email);
  assert.equal(schedule.pendingResponseDigestBatch.leaseUntil, 0);
  assert.equal((await auth.queryDocs(C.notificationDeliveries, [{ field: "subject", value: id }])).length, 0);
});

test("partial failure freezes payload, skips accepted recipients, and preserves responses arriving during send", async () => {
  const { id, since } = await fixture({ firestore: true });
  const sent = [];
  let fail = true;
  let newerAt;
  auth.setSendEmailForServerTests(async (payload) => {
    sent.push(payload);
    if (payload.to.startsWith("second") && fail) throw new Error("Transient provider failure");
    if (!newerAt) {
      const schedule = await auth.getDoc(C.teamSchedules, id);
      // A later response belongs to the next batch even if it arrives mid-send.
      newerAt = new Date(Date.now() + 1000).toISOString();
      await auth.setDoc(C.teamSchedules, id, { responses: { ...schedule.responses, next: {
        "camera::1": { memberId: "jordan", response: "declined", respondedAt: newerAt },
      } } }, { merge: true });
    }
  });
  await auth.sendScheduleResponseDigest(id);
  const failed = await auth.getDoc(C.teamSchedules, id);
  assert.equal(failed.pendingResponseDigestSince, since);
  const originalBatch = failed.pendingResponseDigestBatch;
  fail = false;
  await auth.sendScheduleResponseDigest(id);
  assert.deepEqual(sent.map((email) => email.to), ["first@example.test", "second@example.test", "second@example.test"]);
  assert.equal(sent[1].idempotencyKey, sent[2].idempotencyKey);
  assert.equal(sent[1].htmlBody, sent[2].htmlBody);
  const done = await auth.getDoc(C.teamSchedules, id);
  assert.equal(done.pendingResponseDigestBatch, null);
  assert.equal(done.pendingResponseDigestSince, originalBatch.nextSince);
  assert.equal(done.responses.next["camera::1"].respondedAt, newerAt);
  assert.equal((await auth.queryDocs(C.notificationDeliveries, [{ field: "subject", value: id }])).length, 2);
});

test("separate workers share a lease; restart retries the same durable batch", async () => {
  const { id, db } = await fixture({ firestore: true });
  const second = await import("../authService.js?response-digest-worker");
  const restarted = await import("../authService.js?response-digest-restart");
  second.setServerFirestoreForTests(db);
  restarted.setServerFirestoreForTests(db);
  let unblock;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const sent = [];
  auth.setSendEmailForServerTests(async (email) => {
    sent.push(email);
    started();
    await new Promise((resolve) => { unblock = resolve; });
    throw new Error("process interrupted before acceptance");
  });
  second.setSendEmailForServerTests(async (email) => sent.push(email));
  restarted.setSendEmailForServerTests(async (email) => sent.push(email));
  try {
    const running = auth.sendScheduleResponseDigest(id);
    await ready;
    await second.sendScheduleResponseDigest(id);
    assert.equal(sent.length, 1);
    // Avoid blocking the original worker again for its next recipient.
    auth.setSendEmailForServerTests(async () => { throw new Error("provider unavailable"); });
    unblock();
    await running;
    const batch = (await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestBatch;
    await restarted.recoverPendingScheduleResponseDigests();
    assert.deepEqual(sent.map((email) => email.to), ["first@example.test", "first@example.test", "second@example.test"]);
    assert.equal(sent[0].idempotencyKey, sent[1].idempotencyKey);
    assert.ok(batch.batchId);
    assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
  } finally {
    second.setSendEmailForServerTests(null);
    second.setServerFirestoreForTests(null);
    restarted.setSendEmailForServerTests(null);
    restarted.setServerFirestoreForTests(null);
  }
});

test("expired claims recover, while new opt-outs are honored without changing permissions", async () => {
  const { id, churchId, db } = await fixture({ firestore: true });
  auth.setSendEmailForServerTests(async () => { throw new Error("temporary failure"); });
  await auth.sendScheduleResponseDigest(id);
  const batch = db.read(C.teamSchedules, id).pendingResponseDigestBatch;
  await db.collection(C.teamSchedules).doc(id).update({
    pendingResponseDigestBatch: { ...batch, claimId: "stopped-worker", leaseUntil: 1 },
  });
  const userId = `${id}_second`;
  const membershipId = `${churchId}_${userId}`;
  const permissions = (await auth.getDoc(C.memberships, membershipId)).permissions;
  await auth.setDoc(C.memberships, membershipId, { notifications: { scheduleResponses: "off" } }, { merge: true });
  const sent = [];
  auth.setSendEmailForServerTests(async (email) => sent.push(email));
  await auth.sendScheduleResponseDigest(id);
  assert.deepEqual(sent.map((email) => email.to), ["first@example.test"]);
  assert.deepEqual((await auth.getDoc(C.memberships, membershipId)).permissions, permissions);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});

test("provider timeout retains retryable work and uses the same provider key", async () => {
  const { id, since } = await fixture();
  auth.setIntakeDigestProviderTimeoutForServerTests(10);
  const attempts = [];
  auth.setSendEmailForServerTests(async (email) => {
    attempts.push(email);
    return new Promise(() => {});
  });
  await auth.sendScheduleResponseDigest(id);
  assert.ok(attempts.every((email) => email.signal.aborted));
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, since);
  auth.setSendEmailForServerTests(async (email) => attempts.push(email));
  await auth.sendScheduleResponseDigest(id);
  assert.equal(attempts[0].idempotencyKey, attempts[2].idempotencyKey);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});

test("provider acceptance followed by ledger failure retries with identical content and key", async () => {
  const { id, db, since } = await fixture({ firestore: true });
  let failLedger = true;
  db.beforeSet = (collection) => {
    if (collection === C.notificationDeliveries && failLedger) {
      failLedger = false;
      throw new Error("ledger temporarily unavailable");
    }
  };
  const attempts = [];
  const providerAcceptedKeys = new Set();
  auth.setSendEmailForServerTests(async (email) => {
    attempts.push(email);
    providerAcceptedKeys.add(email.idempotencyKey);
  });
  await auth.sendScheduleResponseDigest(id);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, since);
  await auth.sendScheduleResponseDigest(id);
  assert.equal(attempts.length, 3);
  assert.equal(providerAcceptedKeys.size, 2);
  assert.equal(attempts[0].idempotencyKey, attempts[2].idempotencyKey);
  assert.equal(attempts[0].htmlBody, attempts[2].htmlBody);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});

test("finishing a batch preserves newly added and updated conflict keys", async () => {
  const { id, db, since } = await fixture({ firestore: true });
  const conflict = { memberId: "avery", occurrenceId: "sunday", cellKey: "camera::0", blockedAt: since };
  await db.collection(C.teamSchedules).doc(id).update({ pendingBlockoutConflicts: { original: conflict } });
  const updated = { ...conflict, blockedAt: new Date(Date.now() + 1000).toISOString() };
  let changed = false;
  auth.setSendEmailForServerTests(async () => {
    if (changed) return;
    changed = true;
    await db.collection(C.teamSchedules).doc(id).update({
      pendingBlockoutConflicts: { original: updated, added: { ...updated, cellKey: "camera::1" } },
    });
  });
  await auth.sendScheduleResponseDigest(id);
  const saved = await auth.getDoc(C.teamSchedules, id);
  assert.deepEqual(saved.pendingBlockoutConflicts, {
    original: updated, added: { ...updated, cellKey: "camera::1" },
  });
  assert.ok(saved.pendingResponseDigestSince);
});

test("recovery advances past 100 leased schedules to other pending work", async () => {
  const { id, db, churchId, teamId, since } = await fixture({ firestore: true });
  for (let index = 0; index < 100; index += 1) {
    await db.collection(C.teamSchedules).doc(`aaa_leased_${String(index).padStart(3, "0")}`).set({
      churchId, teamId, pendingResponseDigestSince: since,
      pendingResponseDigestBatch: { claimId: "other-worker", leaseUntil: Date.now() + 60 * 60 * 1000 },
    });
  }
  const sends = [];
  auth.setSendEmailForServerTests(async (email) => sends.push(email));
  await auth.recoverPendingScheduleResponseDigests();
  assert.equal(sends.length, 0);
  await auth.recoverPendingScheduleResponseDigests();
  assert.equal(sends.length, 2);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});

test("a schedule moved to another team never sends its old frozen payload to that team's leads", async () => {
  const { id, churchId, db } = await fixture({ firestore: true });
  auth.setSendEmailForServerTests(async () => { throw new Error("temporary provider failure"); });
  await auth.sendScheduleResponseDigest(id);
  const teamId = `${id}_new_team`;
  await db.collection(C.teams).doc(teamId).set({ churchId, teamId });
  await db.collection(C.users).doc("new_lead").set({ uid: "new_lead", email: "newlead@example.test" });
  await db.collection(C.memberships).doc("new_lead_membership").set({
    churchId, userId: "new_lead", status: "active", role: "member",
    permissions: { teamScopes: { [teamId]: "edit" } },
  });
  await db.collection(C.teamSchedules).doc(id).update({ teamId, responses: {}, pendingBlockoutConflicts: {} });
  const sent = [];
  auth.setSendEmailForServerTests(async (email) => sent.push(email));
  await auth.sendScheduleResponseDigest(id);
  assert.equal(sent.length, 0);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestBatch, null);
  await auth.sendScheduleResponseDigest(id);
  assert.equal(sent.length, 0);
  assert.equal((await auth.getDoc(C.teamSchedules, id)).pendingResponseDigestSince, null);
});
