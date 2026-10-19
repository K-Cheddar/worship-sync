import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createVolunteerOperations } from "./volunteerOperations.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const fixture = async (run, { beforeCommit } = {}) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `volunteer-${randomUUID()}`);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "");
  const COLLECTIONS = {
    teamSchedules: `volunteer_schedules_${suffix}`,
    teamRosterMembers: `volunteer_members_${suffix}`,
  };
  const memberRef = db.collection(COLLECTIONS.teamRosterMembers).doc("member");
  const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc("schedule");
  const identity = { churchId: "church-a", memberId: "member", actorUid: "account-a" };
  const member = {
    ...identity,
    memberId: identity.memberId,
    userId: identity.actorUid,
    updatedAt: "baseline",
    archivedAt: null,
    firstName: "Volunteer",
    lastName: "Member",
    roles: ["volunteer"],
    positionIds: ["position-a"],
    qualifications: ["qualified"],
    email: "private@example.test",
    phoneNumber: "+15555550123",
    notes: "private roster note",
    blockoutDates: [],
  };
  const schedule = {
    churchId: identity.churchId,
    scheduleId: "schedule",
    published: true,
    assignments: {
      occurrence: { primary: "member", second: "member", other: "another" },
    },
    responses: { occurrence: { other: { memberId: "another", response: "accepted" } } },
  };
  let commitHookUsed = false;
  const store = {
    collection: (...args) => db.collection(...args),
    runTransaction: (callback) => db.runTransaction(async (transaction) => {
      const result = await callback(transaction);
      if (beforeCommit && !commitHookUsed) {
        commitHookUsed = true;
        await beforeCommit({ db, memberRef, scheduleRef });
      }
      return result;
    }),
  };
  const operations = createVolunteerOperations({
    COLLECTIONS,
    requireFirestore: () => store,
    getDoc: async (collection, id) => {
      const snapshot = await db.collection(collection).doc(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    updateDocFields: (collection, id, fields) =>
      db.collection(collection).doc(id).update(fields),
    nowIso: () => new Date().toISOString(),
    httpError,
    enqueueSchedule: (_id, task) => task(),
    enqueueMember: (_id, task) => task(),
  });

  try {
    await Promise.all([memberRef.set(member), scheduleRef.set(schedule)]);
    await run({ app, db, COLLECTIONS, identity, member, schedule, memberRef, scheduleRef, operations });
  } finally {
    await Promise.all(Object.values(COLLECTIONS).map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate();
    await deleteApp(app);
  }
};

test("Firestore transactions reject one of two stale time-off saves and preserve unrelated fields", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const saves = await Promise.allSettled(["2099-11-01", "2099-12-01"].map((date) =>
    operations.saveBlockouts({
      ...identity,
      expectedUpdatedAt: "baseline",
      blockoutDates: [{ startDate: date, endDate: date, notes: "Away" }],
    }),
  ));
  assert.equal(saves.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(saves.find((result) => result.status === "rejected").reason.statusCode, 409);
  const saved = (await memberRef.get()).data();
  assert.equal(saved.blockoutDates.length, 1);
  assert.equal(saved.archivedAt, null);
  for (const [field, expected] of Object.entries({
    userId: "account-a",
    firstName: "Volunteer",
    roles: ["volunteer"],
    positionIds: ["position-a"],
    qualifications: ["qualified"],
    email: "private@example.test",
    phoneNumber: "+15555550123",
    notes: "private roster note",
  })) assert.deepEqual(saved[field], expected);
}));

test("Firestore transaction rejects archived or relinked members after identity resolution", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const save = () => operations.saveBlockouts({
    ...identity, expectedUpdatedAt: "baseline", blockoutDates: [],
  });
  await memberRef.update({ archivedAt: "admin-archive" });
  await assert.rejects(save(), { statusCode: 403 });
  await memberRef.update({ archivedAt: null, userId: "another-account" });
  await assert.rejects(save(), { statusCode: 403 });
}));

test("Firestore time-off save racing an administrative archive cannot restore archive or lose roster fields", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  const results = await Promise.allSettled([
    operations.saveBlockouts({
      ...identity,
      expectedUpdatedAt: "baseline",
      blockoutDates: [{ startDate: "2099-12-01", endDate: "2099-12-01" }],
    }),
    memberRef.update({
      archivedAt: "admin-archive",
      firstName: "Admin edit",
      updatedAt: "admin-revision",
    }),
  ]);
  assert.equal(results[1].status, "fulfilled");
  const saved = (await memberRef.get()).data();
  assert.equal(saved.archivedAt, "admin-archive");
  assert.equal(saved.firstName, "Admin edit");
  assert.deepEqual(saved.qualifications, ["qualified"]);
  assert.deepEqual(saved.positionIds, ["position-a"]);
  assert.deepEqual(saved.email, "private@example.test");
}));

test("Firestore time-off transaction rechecks archive state after the initial read", { skip: !enabled }, async () => fixture(async ({ operations, identity, memberRef }) => {
  await assert.rejects(operations.saveBlockouts({
    ...identity,
    expectedUpdatedAt: "baseline",
    blockoutDates: [{ startDate: "2099-12-01", endDate: "2099-12-01" }],
  }), { statusCode: 403 });
  const saved = (await memberRef.get()).data();
  assert.equal(saved.archivedAt, "admin-archive");
  assert.equal(saved.firstName, "Admin edit");
  assert.deepEqual(saved.blockoutDates, []);
  assert.deepEqual(saved.qualifications, ["qualified"]);
}, {
  beforeCommit: ({ memberRef }) => memberRef.update({
    archivedAt: "admin-archive",
    firstName: "Admin edit",
    updatedAt: "admin-revision",
  }),
}));

test("Firestore response transaction rechecks schedule publication at commit", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  await assert.rejects(operations.writeAssignmentResponses({
    ...identity,
    scheduleId: "schedule",
    targets: [{ occurrenceId: "occurrence", cellKey: "primary" }],
    response: "accepted",
    actorUid: identity.actorUid,
  }), { statusCode: 404 });
  assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({ published: false }),
}));

test("Firestore response transaction rejects a slot reassigned before commit", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  await assert.rejects(operations.writeAssignmentResponses({
    ...identity,
    scheduleId: "schedule",
    targets: [{ occurrenceId: "occurrence", cellKey: "primary" }],
    response: "accepted",
    actorUid: identity.actorUid,
  }), { statusCode: 409 });
  assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({ "assignments.occurrence.primary": "replacement" }),
}));

test("Firestore time-off mutation rejects cross-church member identities", { skip: !enabled }, async () => fixture(async ({ operations, identity }) => {
  await assert.rejects(operations.saveBlockouts({
    ...identity,
    churchId: "church-b",
    expectedUpdatedAt: "baseline",
    blockoutDates: [],
  }), { statusCode: 404 });
}));
