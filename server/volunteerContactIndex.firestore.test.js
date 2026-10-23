import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerContactIndex, volunteerContactIndexFields } from "./volunteerContactIndex.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const secret = "synthetic-contact-index-secret-only";
const fixture = async (task) => {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: "demo-worshipsync" }, suffix);
  const db = getFirestore(app);
  const memberCollection = `index_members_${suffix}`;
  const coverageCollection = `index_coverage_${suffix}`;
  const index = createVolunteerContactIndex({ db, memberCollection, coverageCollection, secret });
  try { await task({ db, memberCollection, coverageCollection, index }); }
  finally {
    await Promise.all([memberCollection, coverageCollection].map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate(); await deleteApp(app);
  }
};

test("contact index audits coverage and preserves legacy collisions and church scope", { skip: !enabled }, async () => fixture(async ({ db, memberCollection, index, coverageCollection }) => {
  const rows = [
    { memberId: "one", churchId: "church", email: " Person@Example.test ", phoneNumber: "(212) 555-0123" },
    { memberId: "two", churchId: "church", email: "person@example.test", phoneNumber: "+12125550123" },
    { memberId: "archived", churchId: "church", email: "person@example.test", archivedAt: "archived" },
    { memberId: "other", churchId: "other-church", email: "person@example.test" },
    { memberId: "invalid-phone", churchId: "church", email: "valid-email@example.test", phoneNumber: "legacy invalid phone" },
  ];
  for (const row of rows) await db.collection(memberCollection).doc(row.memberId).set(row);
  const identity = { churchId: "church", memberId: "one" };
  assert.equal(await index.hasUniqueOwner(identity, "email", "person@example.test"), false);
  await index.backfillChurch("church", { pageSize: 1 });
  assert.equal(await index.hasUniqueOwner(identity, "sms", "+12125550123"), false);
  assert.equal(await index.hasUniqueOwner(identity, "email", "person@example.test"), false);
  const two = db.collection(memberCollection).doc("two");
  const moved = { ...rows[1], churchId: "other-church" };
  await two.update({ ...moved, ...volunteerContactIndexFields(moved, secret) });
  assert.equal(await index.hasUniqueOwner(identity, "email", "person@example.test"), true);
  assert.equal(await index.hasUniqueOwner(identity, "sms", "+12125550123"), true);
  // Incomplete legacy entries and a rotated key cannot pass the coverage gate.
  await db.collection(memberCollection).doc("legacy").set({ churchId: "church", email: "person@example.test" });
  assert.equal((await index.auditChurch("church")).complete, false);
  assert.equal(await index.hasUniqueOwner(identity, "email", "person@example.test"), false);
  const rotated = createVolunteerContactIndex({ db, memberCollection, coverageCollection, secret: `${secret}-rotated` });
  assert.equal(await rotated.hasUniqueOwner(identity, "email", "person@example.test"), false);
}));

test("contact index revalidates transactional changes before verification", { skip: !enabled }, async () => fixture(async ({ db, memberCollection, index }) => {
  const member = { memberId: "one", churchId: "church", email: "person@example.test" };
  const ref = db.collection(memberCollection).doc("one");
  await ref.set(member);
  await index.backfillChurch("church");
  assert.equal(await index.hasUniqueOwner(member, "email", member.email), true);
  await db.runTransaction(async (transaction) => {
    assert.equal(await index.hasUniqueOwner(member, "email", member.email, transaction), true);
    const updated = { ...member, archivedAt: "archived" };
    transaction.update(ref, { archivedAt: "archived", ...volunteerContactIndexFields(updated, secret) });
  });
  assert.equal(await index.hasUniqueOwner(member, "email", member.email), false);
}));

test("contact backfill indexes the current member after a contact change during migration", { skip: !enabled }, async () => fixture(async ({ db, memberCollection, coverageCollection }) => {
  const ref = db.collection(memberCollection).doc("one");
  await ref.set({ churchId: "church", memberId: "one", email: "old@example.test" });
  let proceed; let reached;
  const paused = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { proceed = resolve; });
  let first = true;
  const migrationDb = { collection: db.collection.bind(db), runTransaction: async (callback) => {
    if (first) { first = false; reached(); await gate; }
    return db.runTransaction(callback);
  } };
  const index = createVolunteerContactIndex({ db: migrationDb, memberCollection, coverageCollection, secret });
  const pending = index.backfillChurch("church");
  await paused;
  try { await ref.update({ email: "new@example.test", notes: "preserve" }); }
  finally { proceed(); }
  assert.equal((await pending).complete, true);
  assert.equal(await index.hasUniqueOwner({ churchId: "church", memberId: "one" }, "email", "new@example.test"), true);
  assert.equal(await index.hasUniqueOwner({ churchId: "church", memberId: "one" }, "email", "old@example.test"), false);
  assert.equal((await ref.get()).data().notes, "preserve");
}));

test("secret rotation retains legacy uniqueness until the new key coverage is audited", { skip: !enabled }, async () => fixture(async ({ db, memberCollection, coverageCollection, index }) => {
  await db.collection(memberCollection).doc("old-key").set({ churchId: "church", email: "shared@example.test" });
  await index.backfillChurch("church");
  const rotatedSecret = `${secret}-rotated`;
  const member = { churchId: "church", memberId: "new-key", email: "shared@example.test" };
  await db.collection(memberCollection).doc(member.memberId).set({ ...member, ...volunteerContactIndexFields(member, rotatedSecret) });
  const rotated = createVolunteerContactIndex({ db, memberCollection, coverageCollection, secret: rotatedSecret });
  assert.equal(await rotated.hasUniqueOwner(member, "email", member.email), false);
  assert.equal((await rotated.backfillChurch("church")).collisions, 1);
  assert.equal(await rotated.hasUniqueOwner(member, "email", member.email), false);
}));

test("interrupted backfill disables indexed reads and keeps legacy collision protection", { skip: !enabled }, async () => fixture(async ({ db, memberCollection, coverageCollection, index }) => {
  const identity = { churchId: "church", memberId: "one" };
  await db.collection(memberCollection).doc("one").set({ ...identity, email: "shared@example.test" });
  await index.backfillChurch("church");
  await db.collection(memberCollection).doc("legacy").set({ churchId: "church", email: "shared@example.test" });
  const interruptedDb = { collection: db.collection.bind(db), runTransaction: async () => { throw new Error("interrupted"); } };
  const interrupted = createVolunteerContactIndex({ db: interruptedDb, memberCollection, coverageCollection, secret });
  await assert.rejects(interrupted.backfillChurch("church"), /interrupted/);
  assert.equal(await index.hasUniqueOwner(identity, "email", "shared@example.test"), false);
  assert.equal((await index.backfillChurch("church")).collisions, 1);
}));
