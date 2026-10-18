import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerPersonalAccess, DEFAULT_VOLUNTEER_ACCESS_TTL_MS } from "./volunteerPersonalAccess.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const fixture = async (task) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `volunteer-access-${randomUUID()}`);
  const db = getFirestore(app);
  const prefix = `personal_${randomUUID()}`;
  const collections = {
    access: `${prefix}_access`, credentials: `${prefix}_credentials`, sessions: `${prefix}_sessions`,
  };
  const memberCollection = `${prefix}_members`;
  const secret = "synthetic-test-secret-for-volunteer-personal-access-only";
  const identity = { churchId: "church-a", memberId: "member" };
  let currentTime = Date.parse("2026-10-18T12:00:00Z");
  const create = (overrides = {}) => createVolunteerPersonalAccess({
    db, memberCollection, collections, secret, now: () => currentTime, ...overrides,
  });
  const operations = create();
  const memberRef = db.collection(memberCollection).doc(identity.memberId);
  try {
    await memberRef.set({ ...identity, firstName: "Volunteer", archivedAt: null });
    await task({ db, collections, memberRef, identity, operations, create,
      advance: (milliseconds) => { currentTime += milliseconds; } });
  } finally {
    await Promise.all([...Object.values(collections), memberCollection].map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate();
    await deleteApp(app);
  }
};

test("personal credentials reuse exact bearer without extending expiry and persist no plaintext bearer", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, collections, advance }) => {
  const first = await operations.prepare(identity, { actorUid: "admin" });
  assert.match(first.token, /^v_[A-Za-z0-9_-]{32}$/);
  advance(60 * 1000);
  const second = await operations.prepare(identity, { actorUid: "admin" });
  assert.equal(second.reused, true);
  assert.equal(second.token, first.token);
  assert.equal(second.expiresAt, first.expiresAt);
  const redemption = await operations.redeem(first.token);
  assert.equal(redemption.status, "active");
  const session = await operations.readSession(redemption.session);
  assert.equal(session.churchId, identity.churchId);
  assert.equal(session.memberId, identity.memberId);
  assert.equal(session.expiresAt, first.expiresAt);
  const data = await Promise.all(Object.values(collections).map(async (name) => (await db.collection(name).get()).docs.map((doc) => doc.data())));
  const persisted = JSON.stringify(data);
  assert.ok(!persisted.includes(first.token));
  assert.ok(!persisted.includes(redemption.session));
  advance(DEFAULT_VOLUNTEER_ACCESS_TTL_MS);
  assert.equal((await operations.validateCredential(first.token)).status, "expired");
  assert.equal(await operations.readSession(redemption.session), null);
  assert.equal((await operations.redeem(first.token)).status, "expired");
}));

test("replacement and administrative revocation invalidate previous credentials and sessions; restore never revives them", { skip: !enabled }, async () => fixture(async ({ operations, identity }) => {
  const first = await operations.prepare(identity);
  const oldSession = await operations.redeem(first.token);
  const replacement = await operations.prepare(identity, { replace: true, actorUid: "admin" });
  assert.notEqual(replacement.token, first.token);
  assert.equal((await operations.validateCredential(first.token)).status, "invalid");
  assert.equal(await operations.readSession(oldSession.session), null);
  const activeSession = await operations.redeem(replacement.token);
  await operations.revoke(identity, "admin");
  assert.equal((await operations.validateCredential(replacement.token)).status, "revoked");
  assert.equal(await operations.readSession(activeSession.session), null);
  await assert.rejects(operations.prepare(identity), { status: 403 });
  await operations.restore(identity, "admin");
  assert.equal((await operations.validateCredential(replacement.token)).status, "invalid");
  assert.equal(await operations.readSession(activeSession.session), null);
  assert.notEqual((await operations.prepare(identity)).token, replacement.token);
}));

test("personal access rejects wrong church, archived members, invalid bearers and different secrets", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef, create }) => {
  const first = await operations.prepare(identity);
  await assert.rejects(operations.prepare({ ...identity, churchId: "church-b" }), { status: 404 });
  assert.equal((await operations.validateCredential("v_" + "x".repeat(32))).status, "invalid");
  assert.equal((await operations.validateCredential("older-schedule-response-token")).status, "invalid");
  assert.equal((await create({ secret: "another-independent-synthetic-test-secret" }).validateCredential(first.token)).status, "invalid");
  const session = await operations.redeem(first.token);
  await memberRef.update({ archivedAt: "now" });
  assert.equal(await operations.readSession(session.session), null);
  assert.equal((await operations.validateCredential(first.token)).status, "invalid");
  await assert.rejects(operations.prepare(identity), { status: 404 });
}));

test("concurrent preparation reuses one credential and revocation racing redemption leaves no usable session", { skip: !enabled }, async () => fixture(async ({ operations, identity }) => {
  const prepared = await Promise.all([operations.prepare(identity), operations.prepare(identity)]);
  assert.equal(prepared[0].token, prepared[1].token);
  const [redemption] = await Promise.all([
    operations.redeem(prepared[0].token), operations.revoke(identity, "admin"),
  ]);
  assert.equal(await operations.readSession(redemption.session || ""), null);
  assert.equal((await operations.validateCredential(prepared[0].token)).status, "revoked");
}));
