import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { createVolunteerPersonalAccess } from "./volunteerPersonalAccess.js";
import { createVolunteerOperations } from "./volunteerOperations.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const fixture = async (run, { beforeCommit, beforeCommitEveryAttempt = false, nowIso = () => new Date().toISOString() } = {}) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `volunteer-${randomUUID()}`);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "");
  const COLLECTIONS = {
    teamSchedules: `volunteer_schedules_${suffix}`,
    teamRosterMembers: `volunteer_members_${suffix}`,
    memberships: `volunteer_memberships_${suffix}`,
  };
  const memberRef = db.collection(COLLECTIONS.teamRosterMembers).doc("member");
  const scheduleRef = db.collection(COLLECTIONS.teamSchedules).doc("schedule");
  const membershipRef = db.collection(COLLECTIONS.memberships).doc("church-a_account-a");
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
    updatedAt: "baseline",
    assignments: {
      occurrence: { primary: "member", second: "another", other: "another" },
    },
    occurrences: [{ occurrenceId: "occurrence", startsAt: "2099-12-01T15:00:00.000Z" }],
    responses: { occurrence: { other: { memberId: "another", response: "accepted" } } },
  };
  let commitHookUsed = false;
  let externalWrites = Promise.resolve();
  const store = {
    collection: (...args) => db.collection(...args),
    runTransaction: async (callback) => {
      try {
        return await db.runTransaction(async (transaction) => {
          await externalWrites;
          const readPaths = new Set();
          const tracked = new Proxy(transaction, { get(target, key) {
            if (key === "get") return (document) => {
              if (document.path) readPaths.add(document.path);
              return target.get(document);
            };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
          } });
          const result = await callback(tracked);
          if (beforeCommit && (beforeCommitEveryAttempt || !commitHookUsed)) {
            commitHookUsed = true;
            const writes = [];
            const intercept = (document) => new Proxy(document, { get(target, key) {
              if (key === "update" || key === "delete") return (...args) => {
                writes.push({ path: target.path, run: () => target[key](...args) });
                return Promise.resolve();
              };
              const value = target[key];
              return typeof value === "function" ? value.bind(target) : value;
            } });
            await beforeCommit({ db, memberRef: intercept(memberRef),
              scheduleRef: intercept(scheduleRef), membershipRef: intercept(membershipRef) });
            externalWrites = Promise.all(writes.map((write) => write.run()));
            if (writes.some((write) => readPaths.has(write.path))) {
              // Release pessimistic read locks before awaiting the competing
              // writer. Firestore retries this aborted attempt against its real
              // persisted result, rather than waiting for the 60s lock timeout.
              throw Object.assign(new Error("Controlled competing Firestore write"), { code: 10 });
            }
            await externalWrites;
          }
          return result;
        });
      } finally { await externalWrites; }
    },
  };
  const operations = createVolunteerOperations({
    COLLECTIONS,
    requireFirestore: () => store,
    getDoc: async (collection, id) => {
      const snapshot = await db.collection(collection).doc(id).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    queryDocs: async (collection, filters = [], { limit = 0, orderById = false, startAfterId = "", includeDocumentId = false } = {}) => {
      let query = db.collection(collection);
      filters.forEach(({ field, value }) => {
        query = query.where(field, "==", value);
      });
      if (orderById) {
        query = query.orderBy(FieldPath.documentId());
        if (startAfterId) query = query.startAfter(startAfterId);
      }
      if (limit > 0) query = query.limit(limit);
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        ...(includeDocumentId ? { documentId: doc.id } : {}),
      }));
    },
    updateDocFields: (collection, id, fields) =>
      db.collection(collection).doc(id).update(fields),
    nowIso,
    httpError,
    enqueueSchedule: (_id, task) => task(),
    enqueueMember: (_id, task) => task(),
  });

  try {
    await Promise.all([
      memberRef.set(member),
      scheduleRef.set(schedule),
      membershipRef.set({ churchId: identity.churchId, userId: identity.actorUid, status: "active" }),
    ]);
    await run({ app, db, COLLECTIONS, identity, member, schedule, memberRef, scheduleRef, membershipRef, operations });
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

test("Firestore pending-only acceptance racing an explicit decline preserves the decline", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const result = await operations.acceptPendingAssignments(identity);
  const saved = (await scheduleRef.get()).data();

  assert.equal(result.newlyAccepted, 0);
  assert.equal(result.alreadyDeclined, 1);
  assert.equal(saved.responses.occurrence.primary.response, "declined");
  assert.equal(saved.responses.occurrence.primary.respondedAt, "decline-at-commit");
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({
    "responses.occurrence.primary": {
      memberId: "member",
      response: "declined",
      respondedAt: "decline-at-commit",
    },
  }),
}));

test("Firestore pending-only acceptance racing an explicit acceptance keeps the original answer", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const result = await operations.acceptPendingAssignments(identity);
  const saved = (await scheduleRef.get()).data();

  assert.equal(result.newlyAccepted, 0);
  assert.equal(result.alreadyAccepted, 1);
  assert.equal(saved.responses.occurrence.primary.respondedAt, "accept-at-commit");
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({
    "responses.occurrence.primary": {
      memberId: "member",
      response: "accepted",
      respondedAt: "accept-at-commit",
    },
  }),
}));

test("two simultaneous Firestore accept-pending requests commit one acceptance", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const results = await Promise.all([
    operations.acceptPendingAssignments(identity),
    operations.acceptPendingAssignments(identity),
  ]);
  const saved = (await scheduleRef.get()).data();

  assert.equal(results.reduce((sum, result) => sum + result.newlyAccepted, 0), 1);
  assert.equal(saved.responses.occurrence.primary.response, "accepted");
  assert.equal(saved.responses.occurrence.primary.memberId, identity.memberId);
}));

test("Firestore pending-only acceptance skips a reassigned assignment", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const result = await operations.acceptPendingAssignments(identity);
  const saved = (await scheduleRef.get()).data();

  assert.equal(result.newlyAccepted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(saved.assignments.occurrence.primary, "replacement");
  assert.equal(saved.responses.occurrence.primary, undefined);
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({ "assignments.occurrence.primary": "replacement" }),
}));

test("Firestore pending-only acceptance skips a schedule unpublished before commit", { skip: !enabled }, async () => fixture(async ({ operations, identity, scheduleRef }) => {
  const result = await operations.acceptPendingAssignments(identity);
  const saved = (await scheduleRef.get()).data();

  assert.equal(result.newlyAccepted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(saved.published, false);
  assert.equal(saved.updatedAt, "baseline");
}, {
  beforeCommit: ({ scheduleRef }) => scheduleRef.update({ published: false }),
}));

test("Firestore pending-only acceptance stops after member archival or account unlink", { skip: !enabled }, async (t) => {
  await t.test("archival", { skip: !enabled }, () => fixture(async ({ operations, identity, memberRef, scheduleRef }) => {
    const result = await operations.acceptPendingAssignments(identity);
    assert.equal(result.newlyAccepted, 0);
    assert.equal(result.authorizationChanged, true);
    assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
    assert.ok((await memberRef.get()).data().archivedAt);
  }, { beforeCommit: ({ memberRef }) => memberRef.update({ archivedAt: "archive-at-commit" }) }));

  await t.test("unlink", { skip: !enabled }, () => fixture(async ({ operations, identity, memberRef, scheduleRef }) => {
    const result = await operations.acceptPendingAssignments(identity);
    assert.equal(result.newlyAccepted, 0);
    assert.equal(result.authorizationChanged, true);
    assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
    assert.equal((await memberRef.get()).data().userId, "another-account");
  }, { beforeCommit: ({ memberRef }) => memberRef.update({ userId: "another-account" }) }));
});

test("Firestore pending-only acceptance rechecks church membership at commit", { skip: !enabled }, async () => fixture(async ({ operations, identity, membershipRef, scheduleRef }) => {
  const result = await operations.acceptPendingAssignments(identity);
  assert.equal(result.newlyAccepted, 0);
  assert.equal(result.authorizationChanged, true);
  assert.equal((await membershipRef.get()).exists, false);
  assert.equal((await scheduleRef.get()).data().responses.occurrence.primary, undefined);
}, {
  beforeCommit: ({ membershipRef }) => membershipRef.delete(),
}));

test("Firestore schedule failure is isolated and a later retry processes only remaining pending work", { skip: !enabled }, async () => {
  let keepContending = true;
  await fixture(async ({ operations, identity, db, COLLECTIONS }) => {
    const secondSchedule = {
      churchId: identity.churchId,
      scheduleId: "schedule-b",
      published: true,
      occurrences: [{ occurrenceId: "occurrence", startsAt: "2099-12-01T15:00:00.000Z" }],
      assignments: { occurrence: { primary: "member" } },
      responses: {},
    };
    await db.collection(COLLECTIONS.teamSchedules).doc("schedule-b").set(secondSchedule);
    const first = await operations.acceptPendingAssignments(identity);

    assert.equal(first.newlyAccepted, 1);
    assert.equal(first.failedScheduleCount, 1);
    assert.equal(first.schedules.find((row) => row.scheduleId === "schedule-b").status, "updated");
    assert.equal((await db.collection(COLLECTIONS.teamSchedules).doc("schedule-b").get()).data().responses.occurrence.primary.response, "accepted");

    keepContending = false;
    const retry = await operations.acceptPendingAssignments(identity);
    assert.equal(retry.newlyAccepted, 1);
    assert.equal(retry.schedules.some((row) => row.scheduleId === "schedule-b"), false);
    assert.equal((await db.collection(COLLECTIONS.teamSchedules).doc("schedule-b").get()).data().responses.occurrence.primary.response, "accepted");
  }, {
    beforeCommitEveryAttempt: true,
    beforeCommit: async ({ scheduleRef }) => {
      if (!keepContending) return;
      const previous = (await scheduleRef.get()).data().updatedAt || "baseline";
      await scheduleRef.update({ updatedAt: `${previous}!` });
    },
  });
});


for (const change of ["revoke", "replace"]) test(`personal bulk ${change} authority is rechecked in every independent schedule transaction`, { skip: !enabled }, async () => fixture(async ({ db, COLLECTIONS, member, schedule, identity, scheduleRef }) => {
  const secondRef = db.collection(COLLECTIONS.teamSchedules).doc("schedule-b");
  await secondRef.set({ ...schedule, scheduleId: "schedule-b" });
  const prefix = `bulk_access_${randomUUID()}`;
  const collections = Object.fromEntries(["access", "credentials", "sessions"].map((kind) => [kind, `${prefix}_${kind}`]));
  const access = createVolunteerPersonalAccess({ db, memberCollection: COLLECTIONS.teamRosterMembers, collections,
    secret: "synthetic-personal-bulk-transaction-secret" });
  try {
    const prepared = await access.prepare(identity);
    const redeemed = await access.redeem(prepared.token);
    let committed = false;
    let authorizations = 0;
    const store = { collection: (...args) => db.collection(...args), runTransaction: async (fn) => {
      const result = await db.runTransaction(fn);
      if (!committed) { committed = true; if (change === "revoke") await access.revoke(identity, "admin");
        else await access.prepare(identity, { replace: true, actorUid: "admin", requestKey: "synthetic-bulk-replace-request" }); }
      return result;
    } };
    const operation = createVolunteerOperations({ COLLECTIONS, requireFirestore: () => store,
      nowIso: () => new Date().toISOString(), httpError,
      queryDocs: async (name) => (await db.collection(name).where("churchId", "==", identity.churchId)
        .orderBy(FieldPath.documentId()).get()).docs.map((row) => ({ id: row.id, documentId: row.id, ...row.data() })),
    });
    assert.ok(await access.readSession(redeemed.session));
    const result = await operation.acceptPendingAssignments({ ...identity, actorUid: undefined,
      authorize: async (transaction) => {
        authorizations++;
        if (!await access.readSession(redeemed.session, transaction)) throw httpError(401, "Unavailable");
      },
    });
    assert.equal(result.newlyAccepted, 1);
    assert.equal(result.authorizationChanged, true);
    assert.equal(authorizations, 2);
    assert.equal((await scheduleRef.get()).get("responses.occurrence.primary.response"), "accepted");
    assert.equal((await secondRef.get()).get("responses.occurrence.primary"), undefined);
    assert.equal((await db.collection(COLLECTIONS.teamRosterMembers).doc(member.memberId).get()).get("userId"), identity.actorUid);
  } finally { await Promise.all(Object.values(collections).map((name) => db.recursiveDelete(db.collection(name)))); }
}));

for (const race of ["none", "decline", "reassignment", "draft", "failure"]) {
  test(`Firestore human/personal bulk parity preserves exact records across ${race}`, { skip: !enabled }, async () => {
    const outputs = [];
    for (const personal of [false, true]) {
      let contending = true;
      await fixture(async ({ db, COLLECTIONS, operations, identity, schedule, scheduleRef }) => {
        const unrelated = { memberId: "another", response: "legacy-unknown", custom: { keep: [1, "two"] } };
        const responses = { occurrence: {
          other: unrelated,
          accepted: { memberId: "member", response: "accepted", custom: "accepted metadata" },
          declined: { memberId: "member", response: "declined", custom: "declined metadata" },
        }, old: { primary: { memberId: "member", response: "pending", custom: "past" } }, legacy: { untouched: { arbitrary: true } } };
        await scheduleRef.set({ ...schedule, occurrences: [...schedule.occurrences,
          { occurrenceId: "old", startsAt: "2000-01-01T00:00:00Z" }],
          assignments: { occurrence: { ...schedule.assignments.occurrence, accepted: "member", declined: "member" }, old: { primary: "member" } }, responses });
        await db.collection(COLLECTIONS.teamSchedules).doc("schedule-b").set({ ...schedule, scheduleId: "schedule-b" });
        const draft = db.collection(COLLECTIONS.teamSchedules).doc("schedule-draft");
        await draft.set({ ...schedule, scheduleId: draft.id, published: false });
        const prefix = `parity_${randomUUID()}`;
        const collections = Object.fromEntries(["access", "credentials", "sessions"].map((kind) => [kind, `${prefix}_${kind}`]));
        const access = createVolunteerPersonalAccess({ db, memberCollection: COLLECTIONS.teamRosterMembers, collections,
          secret: "synthetic-bulk-parity-secret-only" });
        try {
          const redeemed = personal ? await access.redeem((await access.prepare(identity)).token) : null;
          const principal = personal ? { churchId: identity.churchId, memberId: identity.memberId,
            authorize: async (transaction) => {
              if (!await access.readSession(redeemed.session, transaction)) throw httpError(401, "Unavailable");
            } } : identity;
          const result = await operations.acceptPendingAssignments(principal);
          const saved = (await scheduleRef.get()).data();
          assert.deepEqual(saved.responses.occurrence.other, unrelated);
          assert.deepEqual(saved.responses.occurrence.accepted, responses.occurrence.accepted);
          assert.deepEqual(saved.responses.occurrence.declined, responses.occurrence.declined);
          assert.deepEqual(saved.responses.old, responses.old);
          assert.deepEqual(saved.responses.legacy, responses.legacy);
          assert.deepEqual((await draft.get()).data().responses, schedule.responses);
          assert.equal(saved.responses.occurrence.primary?.response, race === "decline" ? "declined" : race === "none" ? "accepted" : undefined);
          contending = false;
          const retry = await operations.acceptPendingAssignments(principal);
          assert.equal(result.failedScheduleCount, race === "failure" ? 1 : 0);
          assert.equal(retry.newlyAccepted, race === "failure" ? 1 : 0);
          if (race !== "failure") assert.deepEqual((await scheduleRef.get()).data().responses, saved.responses);
          outputs.push({ responses: saved.responses, outcomes: result.schedules, accepted: result.newlyAccepted });
        } finally { await Promise.all(Object.values(collections).map((name) => db.recursiveDelete(db.collection(name)))); }
      }, { nowIso: () => "2026-10-21T12:00:00.000Z", beforeCommitEveryAttempt: race === "failure", beforeCommit: race === "none" ? undefined : ({ scheduleRef }) =>
        race === "failure" ? (contending ? scheduleRef.update({ updatedAt: randomUUID() }) : undefined) : scheduleRef.update(race === "decline" ? { "responses.occurrence.primary": { memberId: "member", response: "declined", custom: "concurrent decline" } }
          : race === "reassignment" ? { "assignments.occurrence.primary": "another" } : { published: false }),
      });
    }
    assert.deepEqual(outputs[0], outputs[1]);
  });
}
