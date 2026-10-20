process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  createVolunteerIdentityOperations,
  volunteerIdentityClaimId,
} from "./volunteerIdentity.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const httpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

const createRes = () => ({
  statusCode: 200,
  payload: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const createRequest = ({ churchId, userId, params = {}, body = {} }) => {
  const csrfToken = "firestore-test-csrf";
  return {
    params: { churchId, ...params },
    body,
    query: {},
    headers: { "x-csrf-token": csrfToken },
    session: {
      csrfToken,
      auth: { sessionKind: "human", userId, churchId },
    },
  };
};

const setMembership = async (db, { churchId, userId, role = "member" }) => {
  const membershipId = `${churchId}_${userId}`;
  await db.collection("memberships").doc(membershipId).set({
    membershipId,
    churchId,
    userId,
    role,
    status: "active",
    controllerAccess: role === "admin" ? "full" : "none",
    appAccess: role === "admin" ? "full" : "member",
    permissions: {
      teams: role === "admin" ? "edit" : "none",
      services: role === "admin" ? "edit" : "none",
      teamScopes: {},
    },
  });
};

test("Firestore serializes simultaneous roster links for one account", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `identity-link-${randomUUID()}`);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "");
  const COLLECTIONS = {
    memberships: `identity_memberships_${suffix}`,
    teamRosterMembers: `identity_roster_${suffix}`,
    teamVolunteerIdentityClaims: `identity_claims_${suffix}`,
  };
  const churchId = "church-a";
  const userId = "account-a";
  const identityRef = db
    .collection(COLLECTIONS.memberships)
    .doc(`${churchId}_${userId}`);
  const operations = createVolunteerIdentityOperations({
    COLLECTIONS,
    requireFirestore: () => db,
    getDoc: async (collection, id) => {
      const snapshot = await db.collection(collection).doc(id).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    },
    queryDocs: async (collection, filters = []) => {
      let query = db.collection(collection);
      filters.forEach((filter) => {
        query = query.where(filter.field, filter.op || "==", filter.value);
      });
      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    },
    setDoc: (collection, id, data, options = {}) =>
      db.collection(collection).doc(id).set(data, options),
    deleteDoc: (collection, id) => db.collection(collection).doc(id).delete(),
    nowIso: () => new Date().toISOString(),
    httpError,
  });

  try {
    await identityRef.set({
      churchId,
      userId,
      membershipId: identityRef.id,
      status: "active",
    });
    await Promise.all(["member-one", "member-two"].map((memberId) =>
      db.collection(COLLECTIONS.teamRosterMembers).doc(memberId).set({
        churchId,
        memberId,
        userId: "",
        archivedAt: null,
      }),
    ));

    const attempts = await Promise.allSettled(["member-one", "member-two"].map((memberId) =>
      operations.linkRosterMember({
        churchId,
        memberId,
        userId,
        actorUid: userId,
        source: "self",
      }),
    ));
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    const rejected = attempts.find((item) => item.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);

    const linked = await db
      .collection(COLLECTIONS.teamRosterMembers)
      .where("churchId", "==", churchId)
      .where("userId", "==", userId)
      .get();
    assert.equal(linked.size, 1);
    const claim = await db
      .collection(COLLECTIONS.teamVolunteerIdentityClaims)
      .doc(volunteerIdentityClaimId(churchId, userId))
      .get();
    assert.equal(claim.data().memberId, linked.docs[0].id);
  } finally {
    await Promise.all(Object.values(COLLECTIONS).map((name) => db.recursiveDelete(db.collection(name))));
    await db.terminate();
    await deleteApp(app);
  }
});

test("Firestore removal and a racing link cannot leave a partial identity", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `identity-removal-${randomUUID()}`);
  const db = getFirestore(app);
  const churchId = `identity_remove_${randomUUID().replaceAll("-", "")}`;
  const churchB = `${churchId}_other_church`;
  const adminId = `${churchId}_admin`;
  const targetId = `${churchId}_target`;
  const memberId = `${churchId}_member`;
  const memberBId = `${churchB}_member`;

  const auth = await import("../authService.js");
  auth.setServerFirestoreForTests(db);

  try {
    await Promise.all([
      db.collection("churches").doc(churchId).set({
        churchId,
        name: "Identity removal test",
        status: "active",
        adminCount: 1,
        contentDatabaseKey: `rtdb_${churchId}`,
      }),
      db.collection("churches").doc(churchB).set({
        churchId: churchB,
        name: "Other church",
        status: "active",
        adminCount: 0,
      }),
      db.collection("users").doc(adminId).set({ uid: adminId, email: `${adminId}@example.test` }),
      db.collection("users").doc(targetId).set({ uid: targetId, email: `${targetId}@example.test` }),
      setMembership(db, { churchId, userId: adminId, role: "admin" }),
      setMembership(db, { churchId, userId: targetId }),
      db.collection("teamRosterMembers").doc(memberId).set({
        churchId,
        memberId,
        userId: "",
        firstName: "Target",
        archivedAt: null,
        invitedAt: "invite-a",
        linkedAt: "",
        blockoutDates: [{ startDate: "2099-01-01", endDate: "2099-01-02" }],
      }),
      db.collection("teamRosterMembers").doc(memberBId).set({
        churchId: churchB,
        memberId: memberBId,
        userId: targetId,
        linkedAt: "linked-b",
        invitedAt: "invite-b",
      }),
      db.collection("teamSchedules").doc(`${churchId}_schedule`).set({
        churchId,
        scheduleId: `${churchId}_schedule`,
        assignments: { occurrence: { lead: memberId } },
        responses: { occurrence: { lead: { memberId, response: "accepted" } } },
      }),
    ]);

    const linkRes = createRes();
    const removalRes = createRes();
    await Promise.all([
      auth.authHandlers.linkTeamRosterMember(
        createRequest({
          churchId,
          userId: adminId,
          params: { memberId },
          body: { userId: targetId },
        }),
        linkRes,
      ),
      auth.authHandlers.removeMember(
        createRequest({
          churchId,
          userId: adminId,
          params: { userId: targetId },
        }),
        removalRes,
      ),
    ]);

    assert.equal(removalRes.statusCode, 200);
    assert.ok([200, 404].includes(linkRes.statusCode));
    const memberA = (await db.collection("teamRosterMembers").doc(memberId).get()).data();
    const memberB = (await db.collection("teamRosterMembers").doc(memberBId).get()).data();
    assert.equal(memberA.userId, "");
    assert.equal(memberA.linkedAt, "");
    assert.equal(memberA.invitedAt, "");
    assert.deepEqual(memberA.blockoutDates, [
      { startDate: "2099-01-01", endDate: "2099-01-02" },
    ]);
    assert.equal(memberB.userId, targetId);
    assert.equal(memberB.linkedAt, "linked-b");
    assert.equal(
      (await db.collection("memberships").doc(`${churchId}_${targetId}`).get()).exists,
      false,
    );
    assert.equal(
      (await db
        .collection("teamVolunteerIdentityClaims")
        .doc(volunteerIdentityClaimId(churchId, targetId))
        .get()).exists,
      false,
    );
    const removalEvents = await db
      .collection("securityEvents")
      .where("churchId", "==", churchId)
      .where("targetUserId", "==", targetId)
      .get();
    assert.ok(removalEvents.docs.some((doc) => doc.get("type") === "member_removed"));
    assert.ok(removalEvents.docs.some((doc) => doc.get("type") === "team_member_account_links_cleared"));
    const schedule = (await db.collection("teamSchedules").doc(`${churchId}_schedule`).get()).data();
    assert.deepEqual(schedule.assignments, { occurrence: { lead: memberId } });
    assert.deepEqual(schedule.responses, {
      occurrence: { lead: { memberId, response: "accepted" } },
    });
  } finally {
    auth.setServerFirestoreForTests(null);
    for (const collection of [
      "churches",
      "memberships",
      "users",
      "teamRosterMembers",
      "teamVolunteerIdentityClaims",
      "teamSchedules",
      "securityEvents",
    ]) {
      const rows = await db
        .collection(collection)
        .where("churchId", "in", [churchId, churchB])
        .get()
        .catch(() => null);
      if (rows) await Promise.all(rows.docs.map((doc) => doc.ref.delete()));
    }
    await db.collection("users").doc(adminId).delete().catch(() => {});
    await db.collection("users").doc(targetId).delete().catch(() => {});
    await db.terminate();
    await deleteApp(app);
  }
});

test("Firestore permanent roster deletion releases only its church claim during a racing replacement link", { skip: !enabled }, async () => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `identity-delete-${randomUUID()}`);
  const db = getFirestore(app);
  const suffix = randomUUID().replaceAll("-", "");
  const churchA = `identity_delete_a_${suffix}`;
  const churchB = `identity_delete_b_${suffix}`;
  const userId = `identity_delete_user_${suffix}`;
  const memberA = `${churchA}_old_member`;
  const replacementA = `${churchA}_replacement_member`;
  const memberB = `${churchB}_member`;
  const scheduleA = `${churchA}_schedule`;
  const scheduleB = `${churchB}_schedule`;
  const auth = await import("../authService.js");
  auth.setServerFirestoreForTests(db);

  try {
    await Promise.all([
      db.collection("churches").doc(churchA).set({
        churchId: churchA,
        name: "Deletion Church A",
        status: "active",
        adminCount: 1,
        contentDatabaseKey: `rtdb_${churchA}`,
      }),
      db.collection("churches").doc(churchB).set({
        churchId: churchB,
        name: "Deletion Church B",
        status: "active",
        adminCount: 1,
        contentDatabaseKey: `rtdb_${churchB}`,
      }),
      db.collection("users").doc(userId).set({ uid: userId, email: `${userId}@example.test` }),
      setMembership(db, { churchId: churchA, userId, role: "admin" }),
      setMembership(db, { churchId: churchB, userId, role: "admin" }),
      db.collection("teamRosterMembers").doc(memberA).set({
        churchId: churchA,
        memberId: memberA,
        userId: "",
        archivedAt: null,
      }),
      db.collection("teamRosterMembers").doc(replacementA).set({
        churchId: churchA,
        memberId: replacementA,
        userId: "",
        archivedAt: null,
      }),
      db.collection("teamRosterMembers").doc(memberB).set({
        churchId: churchB,
        memberId: memberB,
        userId: "",
        archivedAt: null,
      }),
      db.collection("teamSchedules").doc(scheduleA).set({
        churchId: churchA,
        scheduleId: scheduleA,
        assignments: { occurrence: { "position::0": memberA } },
        responses: { occurrence: { "position::0": { memberId: memberA, response: "accepted" } } },
      }),
      db.collection("teamSchedules").doc(scheduleB).set({
        churchId: churchB,
        scheduleId: scheduleB,
        assignments: { occurrence: { "position::0": "other-member" } },
        responses: { occurrence: { "position::0": { memberId: "other-member", response: "declined" } } },
      }),
    ]);

    const linkedA = createRes();
    const linkedB = createRes();
    await Promise.all([
      auth.authHandlers.linkTeamRosterMember(
        createRequest({ churchId: churchA, userId, params: { memberId: memberA } }),
        linkedA,
      ),
      auth.authHandlers.linkTeamRosterMember(
        createRequest({ churchId: churchB, userId, params: { memberId: memberB } }),
        linkedB,
      ),
    ]);
    assert.equal(linkedA.statusCode, 200);
    assert.equal(linkedB.statusCode, 200);

    const deletion = createRes();
    const replacementLink = createRes();
    await Promise.all([
      auth.authHandlers.deleteTeamRosterMember(
        createRequest({ churchId: churchA, userId, params: { memberId: memberA } }),
        deletion,
      ),
      auth.authHandlers.linkTeamRosterMember(
        createRequest({ churchId: churchA, userId, params: { memberId: replacementA } }),
        replacementLink,
      ),
    ]);
    assert.equal(deletion.statusCode, 200);
    assert.ok([200, 409].includes(replacementLink.statusCode));
    if (replacementLink.statusCode === 409) {
      const retriedLink = createRes();
      await auth.authHandlers.linkTeamRosterMember(
        createRequest({ churchId: churchA, userId, params: { memberId: replacementA } }),
        retriedLink,
      );
      assert.equal(retriedLink.statusCode, 200);
    }

    assert.equal((await db.collection("teamRosterMembers").doc(memberA).get()).exists, false);
    assert.equal(
      (await db.collection("teamRosterMembers").doc(replacementA).get()).get("userId"),
      userId,
    );
    assert.equal(
      (await db.collection("teamVolunteerIdentityClaims").doc(volunteerIdentityClaimId(churchA, userId)).get()).get("memberId"),
      replacementA,
    );
    assert.equal(
      (await db.collection("teamVolunteerIdentityClaims").doc(volunteerIdentityClaimId(churchB, userId)).get()).get("memberId"),
      memberB,
    );
    const savedA = (await db.collection("teamSchedules").doc(scheduleA).get()).data();
    assert.deepEqual(savedA.assignments, { occurrence: {} });
    assert.deepEqual(savedA.responses, {
      occurrence: { "position::0": { memberId: memberA, response: "accepted" } },
    });
    const savedB = (await db.collection("teamSchedules").doc(scheduleB).get()).data();
    assert.deepEqual(savedB.assignments, { occurrence: { "position::0": "other-member" } });
    assert.deepEqual(savedB.responses, {
      occurrence: { "position::0": { memberId: "other-member", response: "declined" } },
    });
  } finally {
    auth.setServerFirestoreForTests(null);
    for (const collection of ["churches", "memberships", "users", "teamRosterMembers", "teamVolunteerIdentityClaims", "teamSchedules", "securityEvents"]) {
      const rows = await db
        .collection(collection)
        .where("churchId", "in", [churchA, churchB])
        .get()
        .catch(() => null);
      if (rows) await Promise.all(rows.docs.map((doc) => doc.ref.delete()));
    }
    await db.collection("users").doc(userId).delete().catch(() => {});
    await db.terminate();
    await deleteApp(app);
  }
});
