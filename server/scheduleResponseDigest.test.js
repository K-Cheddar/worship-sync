process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createDigestFirestore } from "./fixtures/digestFirestore.js";
const auth = await import("../authService.js");
const { COLLECTIONS: C } = auth;
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
