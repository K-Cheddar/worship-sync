import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import crypto, { randomUUID } from "node:crypto";
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
    await task({ db, collections, memberCollection, secret, memberRef, identity, operations, create, getNow: () => currentTime,
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
  const replacement = await operations.prepare(identity, { replace: true, actorUid: "admin", requestKey: "synthetic-replacement-request" });
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


test("live envelope integrity/key failures never silently replace authority", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, collections, create }) => {
  const first = await operations.prepare(identity);
  const stateRef = (await db.collection(collections.access).get()).docs[0].ref;
  const original = (await stateRef.get()).data();
  const session = await operations.redeem(first.token);
  const parts = original.credentialEnvelope.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  await stateRef.update({ credentialEnvelope: parts.join(".") });
  await assert.rejects(operations.prepare(identity), { status: 503 });
  await assert.rejects(operations.current(identity), { status: 503 });
  assert.equal((await stateRef.get()).get("generation"), first.generation);
  assert.equal((await operations.readSession(session.session)).memberId, identity.memberId);
  await stateRef.update({ credentialEnvelope: original.credentialEnvelope });
  await assert.rejects(create({ secret: "different-synthetic-envelope-key-with-enough-entropy" }).prepare(identity), { status: 503 });
  assert.throws(() => create({ secret: undefined }));
  assert.equal((await operations.prepare(identity)).token, first.token);
  assert.equal((await db.collection(collections.credentials).get()).size, 1);
}));

test("v2 envelopes authenticate credential identity and generation; replacement retries do not rotate twice", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, collections }) => {
  const first = await operations.prepare(identity);
  const stateRef = (await db.collection(collections.access).get()).docs[0].ref;
  const oldEnvelope = (await stateRef.get()).get("credentialEnvelope");
  assert.match(oldEnvelope, /^v2\./);
  const options = { replace: true, actorUid: "admin", requestKey: "synthetic-lost-response-replacement" };
  const [replacement, retry] = await Promise.all([operations.prepare(identity, options), operations.prepare(identity, options)]);
  assert.equal(replacement.token, retry.token);
  assert.equal(replacement.generation, first.generation + 1);
  assert.equal((await operations.validateCredential(first.token)).status, "invalid");
  const activeState = (await stateRef.get()).data();
  await stateRef.update({ credentialEnvelope: oldEnvelope });
  await assert.rejects(operations.prepare(identity), { status: 503 });
  await stateRef.set(activeState);
  const next = await operations.prepare(identity, { ...options, requestKey: "synthetic-next-explicit-replacement" });
  await assert.rejects(operations.prepare(identity, options), { status: 409 });
  assert.equal((await operations.prepare(identity)).token, next.token);
  await assert.rejects(operations.prepare(identity, { replace: true }), { status: 400 });
}));

test("persistent revocation survives key changes and idempotent restore never revives old tokens", { skip: !enabled }, async () => fixture(async ({ operations, identity, create, advance }) => {
  const old = await operations.prepare(identity);
  await operations.revoke(identity, "admin");
  const generation = (await operations.readState(identity)).generation;
  await operations.revoke(identity, "admin");
  assert.equal((await operations.readState(identity)).generation, generation);
  advance(DEFAULT_VOLUNTEER_ACCESS_TTL_MS + 1);
  const changedKey = create({ secret: "synthetic-rotated-key-is-not-a-revocation-reset" });
  await assert.rejects(changedKey.prepare(identity), { status: 403 });
  await changedKey.restore(identity, "admin");
  const fresh = await changedKey.prepare(identity);
  const activeSession = await changedKey.redeem(fresh.token);
  await changedKey.restore(identity, "admin");
  assert.ok(await changedKey.readSession(activeSession.session));
  assert.equal((await operations.validateCredential(old.token)).status, "invalid");
}));

test("same contacts and names never merge identities across members or churches; deletion ends access", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, memberCollection, memberRef }) => {
  const other = { churchId: identity.churchId, memberId: "other" };
  const foreign = { churchId: "church-b", memberId: "foreign" };
  const contact = { firstName: "Same", email: "shared@example.test", phoneNumber: "+15555550123" };
  await memberRef.update(contact);
  await db.collection(memberCollection).doc(other.memberId).set({ ...other, ...contact });
  await db.collection(memberCollection).doc(foreign.memberId).set({ ...foreign, ...contact });
  const values = await Promise.all([identity, other, foreign].map((owner) => operations.prepare(owner)));
  assert.equal(new Set(values.map((value) => value.token)).size, 3);
  for (let index = 0; index < values.length; index++) {
    const validated = await operations.validateCredential(values[index].token);
    assert.equal(validated.identity.memberId, [identity, other, foreign][index].memberId);
    assert.equal(validated.identity.churchId, [identity, other, foreign][index].churchId);
  }
  const session = await operations.redeem(values[0].token);
  await memberRef.delete();
  assert.equal(await operations.readSession(session.session), null);
  assert.equal((await operations.validateCredential(values[0].token)).status, "invalid");
  assert.equal((await operations.validateCredential(values[1].token)).status, "active");
}));

test("legacy keyed-scope v1 envelopes upgrade only on intentional reuse and keep their fixed expiry", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, collections, secret, advance }) => {
  const first = await operations.prepare(identity);
  const row = (await db.collection(collections.access).get()).docs[0];
  const state = row.data();
  const legacyScope = crypto.createHmac("sha256", secret).update(`worshipsync/volunteer/v1/scope:${JSON.stringify([identity.churchId, identity.memberId])}`).digest("hex");
  const key = crypto.createHash("sha256").update(`volunteer-credential-envelope:${secret}`).digest();
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(legacyScope));
  const encrypted = Buffer.concat([cipher.update(first.token, "utf8"), cipher.final()]);
  await db.collection(collections.access).doc(legacyScope).set({ ...state,
    credentialEnvelope: ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".") });
  await row.ref.delete();
  assert.equal((await operations.validateCredential(first.token)).status, "active");
  assert.match((await operations.readState(identity)).credentialEnvelope, /^v1\./);
  advance(1000);
  const reused = await operations.prepare(identity);
  assert.equal(reused.token, first.token); assert.equal(reused.expiresAt, first.expiresAt);
  assert.match((await operations.readState(identity)).credentialEnvelope, /^v2\./);
  await operations.revoke(identity, "admin");
  await assert.rejects(operations.prepare(identity), { status: 403 });
}));

const credentialWorker = (config) => new Promise((resolve, reject) => {
  const child = fork(new URL("./fixtures/volunteerCredentialWorker.mjs", import.meta.url), [], { silent: true, execArgv: [] });
  const timer = setTimeout(() => { child.kill(); reject(new Error("Credential worker timed out")); }, 30000);
  child.on("error", reject);
  child.on("message", (message) => {
    if (message.ready) child.send(config);
    else if (message.error) { clearTimeout(timer); reject(new Error(message.error)); }
    else { clearTimeout(timer); resolve(message); }
  });
  child.on("exit", (code) => { if (code) { clearTimeout(timer); reject(new Error("Credential worker failed")); } });
});

test("two independent processes issue one generation and concurrent replacements invalidate existing sessions", { skip: !enabled }, async () => fixture(async ({ db, collections, memberCollection, identity, secret, getNow, operations }) => {
  const config = { collections, memberCollection, identity, secret, now: getNow() };
  const issued = await Promise.all([credentialWorker(config), credentialWorker(config)]);
  assert.equal(issued[0].token, issued[1].token);
  assert.equal((await db.collection(collections.credentials).get()).size, 1);
  const session = await operations.redeem(issued[0].token);
  const replaced = await Promise.all([1, 2].map((number) => credentialWorker({ ...config,
    options: { replace: true, requestKey: `synthetic-process-replacement-${number}`, actorUid: "admin" } })));
  assert.equal(await operations.readSession(session.session), null);
  const statuses = await Promise.all(replaced.map((result) => operations.validateCredential(result.token)));
  assert.equal(statuses.filter((result) => result.status === "active").length, 1);
  assert.equal((await operations.readState(identity)).generation, 3);
}));


test("revocation racing an already-started credential read rejects authority before its transaction begins", { skip: !enabled }, async () => fixture(async ({ operations, identity, db, create }) => {
  const credential = await operations.prepare(identity);
  let release; let entered;
  const paused = new Promise((resolve) => { entered = resolve; });
  const resumed = new Promise((resolve) => { release = resolve; });
  const waiting = create({ db: { collection: (...args) => db.collection(...args), runTransaction: async (fn) => {
    entered(); await resumed; return db.runTransaction(fn);
  } } });
  try {
    const read = waiting.validateCredential(credential.token);
    await paused; await operations.revoke(identity, "admin"); release();
    assert.equal((await read).status, "revoked");
    assert.equal((await operations.redeem(credential.token)).status, "revoked");
  } finally { release(); }
}));
