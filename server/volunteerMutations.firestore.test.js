import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerMutations } from "./volunteerMutations.js";
import { createVolunteerPersonalAccess } from "./volunteerPersonalAccess.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const fixture = async (task) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `volunteer-${randomUUID()}`);
  const db = getFirestore(app);
  const prefix = `volunteer_${randomUUID()}`;
  const COLLECTIONS = { teamSchedules: `${prefix}_schedules`, teamRosterMembers: `${prefix}_members` };
  const memberRef = db.collection(COLLECTIONS.teamRosterMembers).doc("member");
  const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc("schedule");
  const identity = { churchId: "church-a", memberId: "member", actorUid: "account-a" };
  const member = {
    ...identity, userId: identity.actorUid, updatedAt: "baseline", archivedAt: null,
    firstName: "Volunteer", qualifications: ["qualified"], blockoutDates: [],
  };
  const schedule = {
    churchId: identity.churchId, scheduleId: "schedule", assignments: {
      occurrence: { primary: "member", other: "another", second: "member" },
    },
    responses: { occurrence: { other: { memberId: "another", response: "accepted", respondedAt: "before" } } },
  };
  let beforeTransaction = async () => {};
  const store = { collection: (...args) => db.collection(...args), runTransaction: async (fn) => {
    await beforeTransaction();
    return db.runTransaction(fn);
  } };
  const operations = createVolunteerMutations({
    COLLECTIONS, requireFirestore: () => store, nowIso: () => new Date().toISOString(), httpError,
  });
  try {
    await Promise.all([memberRef.set(member), scheduleRef.set(schedule)]);
    await task({ db, COLLECTIONS, operations, identity, member, memberRef, scheduleRef,
      beforeTransaction: (fn) => { beforeTransaction = fn; } });
  } finally {
    await Promise.all(Object.values(COLLECTIONS).map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate();
    await deleteApp(app);
  }
};

test("Firestore time-off contention rejects one stale save and preserves administrative fields", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const saves = await Promise.allSettled(["2099-11-01", "2099-12-01"].map((date) => operations.saveBlockouts({
    ...identity, expectedUpdatedAt: "baseline", blockoutDates: [{ startDate: date, endDate: date }],
  })));
  assert.equal(saves.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(saves.find((result) => result.status === "rejected").reason.status, 409);
  const saved = (await memberRef.get()).data();
  assert.deepEqual(saved.qualifications, ["qualified"]);
  assert.equal(saved.firstName, "Volunteer");
  assert.equal(saved.archivedAt, null);
  assert.equal(saved.blockoutDates.length, 1);
}));

test("Firestore time off rechecks archive, account link and revision after request-time resolution", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef, member, beforeTransaction }) => {
  const save = () => operations.saveBlockouts({ ...identity, expectedUpdatedAt: "baseline", blockoutDates: [] });
  beforeTransaction(() => memberRef.update({ archivedAt: "archived", firstName: "Admin edit" }));
  await assert.rejects(save(), { status: 403 });
  assert.equal((await memberRef.get()).data().archivedAt, "archived");
  await memberRef.set(member);
  beforeTransaction(() => memberRef.update({ userId: "other-account" }));
  await assert.rejects(save(), { status: 403 });
  await memberRef.set(member);
  beforeTransaction(() => memberRef.update({ updatedAt: "admin-revision", qualifications: ["new"] }));
  await assert.rejects(save(), { status: 409 });
  assert.deepEqual((await memberRef.get()).data().qualifications, ["new"]);
}));

test("Firestore concurrent pending acceptance cannot overwrite a decline and retry does no work", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const common = { ...identity, scheduleId: "schedule" };
  await Promise.all([
    operations.writeAssignmentResponses({ ...common, response: "accepted", pendingOnly: true }),
    operations.writeAssignmentResponses({ ...common, response: "declined", targets: [{ occurrenceId: "occurrence", cellKey: "primary" }] }),
  ]);
  const saved = (await scheduleRef.get()).data();
  assert.equal(saved.responses.occurrence.primary.response, "declined");
  assert.equal(saved.responses.occurrence.second.response, "accepted");
  assert.equal(saved.responses.occurrence.other.response, "accepted");
  const retry = await operations.writeAssignmentResponses({ ...common, response: "accepted", pendingOnly: true });
  assert.equal(retry.applied, 0);
}));

test("Firestore response rechecks unpublish and reassignment before commit and rejects cross-church identities", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef, beforeTransaction }) => {
  const respond = (overrides = {}) => operations.writeAssignmentResponses({
    ...identity, scheduleId: "schedule", response: "accepted",
    targets: [{ occurrenceId: "occurrence", cellKey: "primary" }], ...overrides,
  });
  beforeTransaction(() => scheduleRef.update({ published: false }));
  await assert.rejects(respond(), { status: 404 });
  beforeTransaction(async () => {});
  await scheduleRef.update({ published: true });
  await assert.rejects(respond({ churchId: "church-b" }), { status: 404 });
  beforeTransaction(() => scheduleRef.update({ "assignments.occurrence.primary": "replacement" }));
  await assert.rejects(respond(), { status: 409 });
  assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
}));

test("Firestore time-off save racing archive never restores archive state or loses unrelated edits", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const outcomes = await Promise.allSettled([
    operations.saveBlockouts({ ...identity, expectedUpdatedAt: "baseline", blockoutDates: [{ startDate: "2099-12-01" }] }),
    memberRef.update({ archivedAt: "admin-archive", firstName: "Administrative edit", updatedAt: "admin-revision" }),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  const saved = (await memberRef.get()).data();
  assert.equal(saved.archivedAt, "admin-archive");
  assert.equal(saved.firstName, "Administrative edit");
  assert.deepEqual(saved.qualifications, ["qualified"]);
  await assert.rejects(operations.saveBlockouts({
    ...identity, churchId: "church-b", expectedUpdatedAt: saved.updatedAt, blockoutDates: [],
  }), { status: 404 });
}));

test("Firestore time-off revisions advance even when the stored clock is ahead", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const baseline = "2099-01-01T00:00:00.000Z";
  await memberRef.update({ updatedAt: baseline });
  const saved = await operations.saveBlockouts({ ...identity, expectedUpdatedAt: baseline, blockoutDates: [] });
  assert.equal(saved.member.updatedAt, "2099-01-01T00:00:00.001Z");
  await assert.rejects(operations.saveBlockouts({ ...identity, expectedUpdatedAt: baseline, blockoutDates: [] }), { status: 409 });
}));

test("Firestore delayed personal time-off save rechecks revocation before committing", { skip: !enabled }, async () => fixture(async ({ db, COLLECTIONS, operations, identity, memberRef, beforeTransaction }) => {
  const prefix = `delayed_personal_${randomUUID()}`;
  const collections = Object.fromEntries(["access", "credentials", "sessions"].map((kind) => [kind, `${prefix}_${kind}`]));
  const access = createVolunteerPersonalAccess({ db, memberCollection: COLLECTIONS.teamRosterMembers, collections,
    secret: "synthetic-delayed-personal-mutation-test-secret" });
  let proceed;
  let entered;
  const paused = new Promise((yes) => { entered = yes; });
  const resumed = new Promise((yes) => { proceed = yes; });
  try {
    const credential = await access.prepare(identity);
    const session = await access.redeem(credential.token);
    assert.equal((await access.readSession(session.session)).memberId, identity.memberId);
    beforeTransaction(async () => { entered(); await resumed; });
    const save = operations.saveBlockouts({ churchId: identity.churchId, memberId: identity.memberId,
      expectedUpdatedAt: "baseline", blockoutDates: [{ startDate: "2099-12-01" }],
      authorize: async (transaction) => {
        if (!await access.readSession(session.session, transaction)) throw httpError(401, "Personal access is no longer valid.");
      },
    });
    const result = assert.rejects(save, { status: 401 });
    await paused;
    await access.revoke(identity, "admin");
    proceed();
    await result;
    const saved = (await memberRef.get()).data();
    assert.deepEqual(saved.blockoutDates, []);
    assert.equal(saved.updatedAt, "baseline");
    assert.deepEqual(saved.qualifications, ["qualified"]);
  } finally {
    proceed();
    await Promise.all(Object.values(collections).map((name) => db.recursiveDelete(db.collection(name))));
  }
}));
