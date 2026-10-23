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
const { COLLECTIONS: C, setDoc, getDoc, queryDocs, authHandlers } = auth;
let counter = 0;
afterEach(() => {
  auth.setSendEmailForServerTests(null);
  auth.setVerifyIdTokenForServerTests(null);
  auth.setAuthReadObserverForServerTests(null);
  auth.setServerFirestoreForTests(null);
});

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  set() { return this; },
});
const session = () => ({
  destroy(callback) { callback?.(); },
  regenerate(callback) { delete this.auth; callback?.(); },
});
const call = async (handler, context, { body = {}, params = {} } = {}) => {
  const result = response();
  await handler({ session: context.session, headers: context.headers,
    params: { churchId: context.churchId, ...params }, body }, result);
  return result;
};
const account = async (churchId, name, role = "member", permissions = {}) => {
  const activeSession = session();
  const userId = `${churchId}_${name}`;
  const seeded = await auth.seedActiveHumanBearerForServerTests({
    req: { session: activeSession }, userId, email: `${name}@example.test`,
    churchId, role, appAccess: "full", permissions,
  });
  const context = { churchId, userId, session: activeSession,
    headers: { authorization: `Bearer ${seeded.humanApiToken}` } };
  const me = await call(authHandlers.getAuthMe, context);
  assert.equal(me.statusCode, 200);
  context.headers["x-csrf-token"] = me.payload.csrfToken;
  return context;
};
const teams = async () => {
  const churchId = `account_leads_${++counter}`;
  for (const [suffix, extra] of [["media", {}], ["praise", {}],
    ["archived", { archivedAt: new Date().toISOString() }], ["foreign", { churchId: "other" }]]) {
    const teamId = `${churchId}_${suffix}`;
    await setDoc(C.teams, teamId, { churchId, teamId, name: suffix, memberIds: [], ...extra });
  }
  return { churchId, media: `${churchId}_media`, praise: `${churchId}_praise`,
    archived: `${churchId}_archived`, foreign: `${churchId}_foreign` };
};

const concurrentAccessFixture = async (firestore) => {
  const churchId = `concurrent_access_${++counter}`;
  const permissions = { teams: "view", services: "none", teamScopes: { praise: "view" } };
  const seed = {
    [C.churches]: { [churchId]: { churchId, status: "active", name: "Church" } },
    [C.users]: {}, [C.memberships]: {},
    [C.teams]: { media: { churchId, teamId: "media" }, praise: { churchId, teamId: "praise" } },
  };
  for (const userId of ["adminA", "adminB", "target"]) {
    seed[C.users][userId] = { uid: userId, email: `${userId}@example.test` };
    seed[C.memberships][`${churchId}_${userId}`] = { churchId, userId, status: "active",
      role: userId === "target" ? "member" : "admin", controllerAccess: "full", permissions,
      notifications: { intakeSubmissions: "off" } };
  }
  const db = firestore ? createDigestFirestore(seed) : null;
  auth.setServerFirestoreForTests(db);
  if (!db) for (const [collection, rows] of Object.entries(seed)) {
    for (const [id, row] of Object.entries(rows)) await setDoc(collection, id, row);
  }
  const admins = [];
  for (const userId of ["adminA", "adminB"]) {
    const context = { churchId, session: { ...session(), auth: { sessionKind: "human", userId, churchId } }, headers: {} };
    context.headers["x-csrf-token"] = (await call(authHandlers.getAuthMe, context)).payload.csrfToken;
    admins.push(context);
  }
  const readTarget = async (context) => (await call(authHandlers.listChurchMembers, context))
    .payload.members.find((member) => member.userId === "target");
  const save = (context, loaded, nextPermissions, controllerAccess = "full") =>
    call(authHandlers.updateMemberAccess, context, { params: { userId: "target" }, body: {
      accessRevision: loaded.accessRevision, controllerAccess, permissions: nextPermissions,
    } });
  return { churchId, db, admins, readTarget, save, permissions };
};

test("two administrators cannot erase a Team Lead with a stale access snapshot", async () => {
  for (const firestore of [false, true]) {
    const { churchId, admins: [adminA, adminB], readTarget, save } = await concurrentAccessFixture(firestore);
    const aLoaded = await readTarget(adminA);
    const bLoaded = await readTarget(adminB);
    const assigned = { ...bLoaded.permissions, teamScopes: { praise: "view", media: "edit" } };
    assert.equal((await save(adminB, bLoaded, assigned)).statusCode, 200);
    const stale = await save(adminA, aLoaded, aLoaded.permissions, "music");
    assert.equal(stale.statusCode, 409, "stale full permission maps must never erase the other admin's grant");
    assert.equal(stale.payload.code, "MEMBER_ACCESS_CONFLICT");
    const fresh = await readTarget(adminA);
    assert.deepEqual(fresh.permissions, assigned);
    assert.notEqual(fresh.accessRevision, aLoaded.accessRevision);
    assert.equal((await save(adminA, fresh, fresh.permissions, "music")).statusCode, 200);
    const saved = await getDoc(C.memberships, `${churchId}_target`);
    assert.deepEqual(saved.permissions, assigned);
    assert.equal(saved.controllerAccess, "music");
    assert.equal(saved.notifications.intakeSubmissions, "off");
    auth.setServerFirestoreForTests(null);
  }
});

test("a second admin's commit between request parsing and the access transaction is retained", async () => {
  const { db, admins: [adminA, adminB], readTarget, save } = await concurrentAccessFixture(true);
  const aLoaded = await readTarget(adminA);
  const bLoaded = await readTarget(adminB);
  let release;
  let start;
  const started = new Promise((resolve) => { start = resolve; });
  db.beforeTransaction = async () => {
    db.beforeTransaction = null;
    start();
    await new Promise((resolve) => { release = resolve; });
  };
  const pendingA = save(adminA, aLoaded, aLoaded.permissions, "music");
  await started;
  const assigned = { ...bLoaded.permissions, teamScopes: { praise: "view", media: "edit" } };
  assert.equal((await save(adminB, bLoaded, assigned)).statusCode, 200);
  release();
  assert.equal((await pendingA).statusCode, 409);
  assert.deepEqual((await readTarget(adminB)).permissions, assigned);
});

test("legacy access patches merge fresh scopes but cannot replace them without a revision", async () => {
  for (const firestore of [false, true]) {
    const { admins: [adminA, adminB], readTarget, save } = await concurrentAccessFixture(firestore);
    const stale = await readTarget(adminA);
    const assigned = { ...stale.permissions, teamScopes: { praise: "view", media: "edit" } };
    assert.equal((await save(adminB, stale, assigned)).statusCode, 200);
    const withoutRevision = { ...stale, accessRevision: undefined };
    assert.equal((await save(adminA, withoutRevision, stale.permissions, "music")).statusCode, 409);
    assert.equal((await save(adminA, withoutRevision, { services: "view" }, "music")).statusCode, 200);
    assert.deepEqual((await readTarget(adminA)).permissions, { ...assigned, services: "view" });
    const events = await queryDocs(C.securityEvents, [{ field: "churchId", value: adminA.churchId }]);
    assert.deepEqual(events.find((event) => event.userId === "adminA").permissions, { ...assigned, services: "view" });
    auth.setServerFirestoreForTests(null);
  }
});

test("personal preferences and scope insertion order do not invalidate a reviewed access revision", async () => {
  for (const firestore of [false, true]) {
    const { churchId, admins: [adminA], readTarget, save } = await concurrentAccessFixture(firestore);
    const initial = await readTarget(adminA);
    const assigned = { ...initial.permissions, teamScopes: { praise: "view", media: "edit" } };
    assert.equal((await save(adminA, initial, assigned)).statusCode, 200);
    const reviewed = await readTarget(adminA);
    const membershipId = `${churchId}_target`;
    await setDoc(C.memberships, membershipId, {
      ...(await getDoc(C.memberships, membershipId)),
      permissions: { ...assigned, teamScopes: { media: "edit", praise: "view" } },
      notifications: { intakeSubmissions: "on" },
    });
    assert.equal((await readTarget(adminA)).accessRevision, reviewed.accessRevision);
    assert.equal((await save(adminA, reviewed, assigned, "music")).statusCode, 200);
    assert.equal((await getDoc(C.memberships, membershipId)).notifications.intakeSubmissions, "on");
    auth.setServerFirestoreForTests(null);
  }
});

test("an access revision cannot cross churches even for the same account and permissions", async () => {
  const first = await concurrentAccessFixture(false);
  const firstLoaded = await first.readTarget(first.admins[0]);
  const second = await concurrentAccessFixture(false);
  const secondLoaded = await second.readTarget(second.admins[0]);
  assert.notEqual(firstLoaded.accessRevision, secondLoaded.accessRevision);
  assert.equal((await second.save(second.admins[0], firstLoaded, secondLoaded.permissions, "music")).statusCode, 409);
  assert.deepEqual(await second.readTarget(second.admins[0]), secondLoaded);
});

test("admins can save explicit Team Leads; promotion and demotion retain only valid scopes", async () => {
  const { churchId, media, praise, archived, foreign } = await teams();
  const admin = await account(churchId, "admin", "admin");
  const lead = await account(churchId, "lead", "member", {
    teams: "none", services: "view", teamScopes: { [media]: "edit", [praise]: "view" },
  });
  const scopes = { [media]: "edit", [praise]: "view" };
  const promoted = await call(authHandlers.makeAdmin, admin, { params: { userId: lead.userId } });
  assert.equal(promoted.statusCode, 200);
  let me = await call(authHandlers.getAuthMe, lead);
  assert.deepEqual(me.payload.permissions, { teams: "edit", services: "edit", teamScopes: scopes });
  assert.ok(me.payload.notificationCategories.includes("intakeSubmissions"));

  const saved = await call(authHandlers.updateMemberAccess, admin, {
    params: { userId: lead.userId }, body: { controllerAccess: "full",
      accessRevision: (await call(authHandlers.listChurchMembers, admin)).payload.members
        .find((member) => member.userId === lead.userId).accessRevision,
      permissions: { teams: "none", services: "none", teamScopes: {
        ...scopes, [archived]: "edit", [foreign]: "edit", missing: "edit",
      } } },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual((await getDoc(C.memberships, `${churchId}_${lead.userId}`)).permissions,
    { teams: "edit", services: "edit", teamScopes: scopes });
  const listed = await call(authHandlers.listChurchMembers, admin);
  assert.deepEqual(listed.payload.members.find((member) => member.userId === lead.userId).permissions.teamScopes, scopes);
  // Historic invalid scopes must not become grants when an admin is demoted.
  await setDoc(C.memberships, `${churchId}_${lead.userId}`, { permissions: {
    teams: "edit", services: "edit", teamScopes: { ...scopes, [foreign]: "edit", [archived]: "edit" },
  } }, { merge: true });

  const demoted = await call(authHandlers.removeAdmin, admin, { params: { userId: lead.userId } });
  assert.equal(demoted.statusCode, 200);
  me = await call(authHandlers.getAuthMe, lead);
  assert.deepEqual(me.payload.permissions, { teams: "none", services: "none", teamScopes: scopes });
  await auth.requireTeamsEditForTeamSession({ session: lead.session, headers: lead.headers }, churchId, media);
  await assert.rejects(auth.requireTeamsEditForTeamSession(
    { session: lead.session, headers: lead.headers }, churchId, praise), /edit access/i);
  const denied = await call(authHandlers.updateMemberAccess, lead, {
    params: { userId: admin.userId }, body: { controllerAccess: "full", permissions: {} },
  });
  assert.equal(denied.statusCode, 403);
  const after = await call(authHandlers.getAuthMe, admin);
  assert.deepEqual(after.payload.notificationCategories, ["scheduleAssignments", "scheduleReminders"]);
  const beforePreferences = (await getDoc(C.memberships, `${churchId}_${lead.userId}`)).permissions;
  const muted = await call(authHandlers.updateOwnNotificationPreferences, lead,
    { body: { intakeSubmissions: "off", scheduleResponses: "off" } });
  assert.equal(muted.statusCode, 200);
  assert.deepEqual((await getDoc(C.memberships, `${churchId}_${lead.userId}`)).permissions, beforePreferences);
});

test("pending admin/global-editor invitations preserve leads through edits and unlinked acceptance", async () => {
  for (const role of ["admin", "member"]) {
    const { churchId, media, praise, archived, foreign } = await teams();
    const admin = await account(churchId, `owner${counter}`, "admin");
    const email = `invited${counter}@example.test`;
    let token;
    auth.setSendEmailForServerTests(async (payload) => {
      const match = `${payload.textBody} ${payload.htmlBody}`.match(/invite\?token=([^&\s"')]+)/);
      if (match) token = decodeURIComponent(match[1]);
    });
    const created = await call(authHandlers.createInvite, admin, { body: {
      email, role, controllerAccess: "full", permissions: {
        teams: "edit", services: "view", teamScopes: { [media]: "edit", [praise]: "view" },
      },
    } });
    assert.equal(created.statusCode, 200);
    assert.ok(token);
    const inviteId = created.payload.invite.inviteId;
    for (const nextRole of ["admin", "member"]) {
      const roleOnly = await call(authHandlers.updateInviteAccess, admin, {
        params: { inviteId }, body: { role: nextRole, controllerAccess: "full" },
      });
      assert.equal(roleOnly.statusCode, 200);
      assert.deepEqual(roleOnly.payload.invite.permissions.teamScopes, { [media]: "edit", [praise]: "view" });
      if (nextRole === "member") {
        assert.equal(roleOnly.payload.invite.permissions.teams, "none");
        assert.equal(roleOnly.payload.invite.permissions.services, "none");
      }
    }
    const edited = await call(authHandlers.updateInviteAccess, admin, {
      params: { inviteId }, body: { role, controllerAccess: "full", permissions: {
        teams: "edit", services: "view", teamScopes: {
          [media]: "edit", [praise]: "view", [archived]: "edit", [foreign]: "edit",
        },
      } },
    });
    assert.equal(edited.statusCode, 200);
    assert.deepEqual((await getDoc(C.invites, inviteId)).permissions.teamScopes,
      { [media]: "edit", [praise]: "view" });
    // A team archived while the invite is pending must not survive acceptance.
    await setDoc(C.teams, praise, { archivedAt: new Date().toISOString() }, { merge: true });
    const userId = `${churchId}_accepted`;
    auth.setVerifyIdTokenForServerTests(async () => ({ uid: userId, email }));
    const acceptContext = { session: session(), headers: {}, churchId };
    const accepted = await call(authHandlers.acceptInvite, acceptContext,
      { body: { token, idToken: "test-token" } });
    assert.equal(accepted.statusCode, 200);
    acceptContext.session.auth = { sessionKind: "human", userId, churchId };
    const bootstrap = await call(authHandlers.getAuthMe, acceptContext);
    assert.deepEqual(bootstrap.payload.permissions.teamScopes, { [media]: "edit" });
    assert.deepEqual((await getDoc(C.memberships, `${churchId}_${userId}`)).permissions.teamScopes,
      { [media]: "edit" });
    assert.equal((await queryDocs(C.teamRosterMembers, [{ field: "userId", value: userId }])).length, 0);
  }
});

test("an access save racing with demotion cannot restore the administrator's global privileges", async () => {
  const { churchId, media } = await teams();
  const owner = await account(churchId, "raceowner", "admin");
  const target = await account(churchId, "racetarget", "admin", { teamScopes: { [media]: "edit" } });
  let demoted = false;
  auth.setAuthReadObserverForServerTests((read) => {
    if (read.type !== "getDoc" || read.collectionName !== C.teams || read.id !== media || demoted) return;
    demoted = true;
    void setDoc(C.memberships, `${churchId}_${target.userId}`, {
      role: "member", permissions: { teams: "none", services: "none", teamScopes: { [media]: "edit" } },
    }, { merge: true });
  });
  const result = await call(authHandlers.updateMemberAccess, owner, {
    params: { userId: target.userId }, body: { controllerAccess: "full", permissions: {
      teams: "edit", services: "edit", teamScopes: { [media]: "edit" },
    } },
  });
  assert.equal(demoted, true);
  assert.equal(result.statusCode, 409);
  assert.equal((await getDoc(C.memberships, `${churchId}_${target.userId}`)).permissions.teams, "none");
});

test("bootstrap offers team email settings only for active scopes and an account email", async () => {
  const { churchId, media, archived, foreign } = await teams();
  const lead = await account(churchId, "noemail", "admin", {
    teamScopes: { [media]: "edit", [archived]: "edit", [foreign]: "edit" },
  });
  await setDoc(C.users, lead.userId, { email: "", primaryEmail: "" }, { merge: true });
  const result = await call(authHandlers.getAuthMe, lead);
  assert.deepEqual(result.payload.permissions.teamScopes, { [media]: "edit" });
  assert.deepEqual(result.payload.notificationCategories, ["scheduleAssignments", "scheduleReminders"]);
});

test("Firestore role transactions retain valid scopes and replace privilege maps on demotion", async () => {
  const churchId = "firestore_account_leads";
  const scopes = { media: "edit", praise: "view", foreign: "edit", archived: "edit" };
  const db = createDigestFirestore({
    [C.churches]: { [churchId]: { churchId, status: "active", name: "Church", adminCount: 1 } },
    [C.users]: { owner: { uid: "owner", email: "owner@example.test" }, lead: { uid: "lead", email: "lead@example.test" } },
    [C.memberships]: {
      [`${churchId}_owner`]: { membershipId: `${churchId}_owner`, churchId, userId: "owner", role: "admin", status: "active" },
      [`${churchId}_lead`]: { membershipId: `${churchId}_lead`, churchId, userId: "lead", role: "member", status: "active",
        controllerAccess: "full", permissions: { teams: "none", services: "none", teamScopes: scopes } },
    },
    [C.teams]: { media: { teamId: "media", churchId }, praise: { teamId: "praise", churchId },
      foreign: { teamId: "foreign", churchId: "other" }, archived: { teamId: "archived", churchId, archivedAt: "2026-01-01" } },
  });
  auth.setServerFirestoreForTests(db);
  const owner = { churchId, session: { ...session(), auth: { sessionKind: "human", userId: "owner", churchId } }, headers: {} };
  owner.headers["x-csrf-token"] = (await call(authHandlers.getAuthMe, owner)).payload.csrfToken;
  assert.equal((await call(authHandlers.makeAdmin, owner, { params: { userId: "lead" } })).statusCode, 200);
  assert.deepEqual(db.read(C.memberships, `${churchId}_lead`).permissions,
    { teams: "edit", services: "edit", teamScopes: { media: "edit", praise: "view" } });
  assert.equal((await call(authHandlers.removeAdmin, owner, { params: { userId: "lead" } })).statusCode, 200);
  assert.deepEqual(db.read(C.memberships, `${churchId}_lead`).permissions,
    { teams: "none", services: "none", teamScopes: { media: "edit", praise: "view" } });
});

test("recovery promotions preserve explicit scopes and personal preferences in both stores", async () => {
  for (const firestore of [false, true]) {
    for (const support of [false, true]) {
      const churchId = `recovery_leads_${++counter}`;
      const userId = `${churchId}_lead`;
      const membershipId = `${churchId}_${userId}`;
      const email = `${userId}@example.test`;
      const token = `${churchId}_token`;
      const notifications = { intakeSubmissions: "off", scheduleResponses: "default" };
      const seed = {
        [C.churches]: { [churchId]: { churchId, status: "needs-admin", name: "Church", adminCount: 0 } },
        [C.users]: { [userId]: { uid: userId, email, normalizedEmail: email } },
        [C.memberships]: { [membershipId]: { membershipId, userId, churchId, role: "member", status: "active", notifications,
          permissions: { teams: "none", services: "none", teamScopes: { media: "edit", praise: "view", foreign: "edit" } } } },
        [C.teams]: { media: { teamId: "media", churchId }, praise: { teamId: "praise", churchId },
          foreign: { teamId: "foreign", churchId: "other" } },
        [C.adminRecoveryRequests]: { [churchId]: { requestId: churchId, churchId, requesterUid: userId,
          tokenHash: createHash("sha256").update(token).digest("hex"), status: "pending",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() } },
      };
      if (firestore) auth.setServerFirestoreForTests(createDigestFirestore(seed));
      else for (const [collection, rows] of Object.entries(seed)) {
        for (const [id, row] of Object.entries(rows)) await setDoc(collection, id, row);
      }
      auth.setVerifyIdTokenForServerTests(async () => ({ uid: "support", worshipsyncSupport: true }));
      const result = await call(support ? authHandlers.recoverAdmin : authHandlers.confirmRecovery,
        { churchId, session: session(), headers: { authorization: "Bearer test-support" } },
        { body: support ? { email } : { token } });
      assert.equal(result.statusCode, 200);
      const membership = await getDoc(C.memberships, membershipId);
      assert.deepEqual(membership.permissions, { teams: "edit", services: "edit", teamScopes: { media: "edit", praise: "view" } });
      assert.deepEqual(membership.notifications, notifications);
      auth.setServerFirestoreForTests(null);
    }
  }
});

test("both digests use active account scopes, deduplicate teams, and honor personal category opt-outs", async () => {
  const { churchId, media, praise, archived, foreign } = await teams();
  const candidates = [
    ["media", "member", { [media]: "edit" }],
    ["adminmedia", "admin", { [media]: "edit" }],
    ["adminnone", "admin", {}], ["globalnone", "member", {}, "edit"],
    ["multi", "member", { [media]: "edit", [praise]: "edit" }],
    ["praise", "member", { [praise]: "edit" }],
    ["viewer", "member", { [media]: "view" }],
    ["archived", "member", { [archived]: "edit" }],
    ["foreign", "member", { [foreign]: "edit" }],
    ["inactive", "member", { [media]: "edit" }],
    ["noemail", "member", { [media]: "edit" }],
    ["oldrosterlead", "member", {}],
    ["intakemuted", "member", { [media]: "edit" }],
    ["responsemuted", "member", { [media]: "edit" }],
  ];
  for (const [name, role, teamScopes, global = "none"] of candidates) {
    const userId = `${churchId}_${name}`;
    await setDoc(C.users, userId, { uid: userId, email: name === "noemail" ? "" : `${name}@example.test` });
    await setDoc(C.memberships, `${churchId}_${userId}`, {
      churchId, userId, role, status: name === "inactive" ? "inactive" : "active",
      permissions: { teams: global, teamScopes }, notifications: {
        intakeSubmissions: name === "intakemuted" ? "off" : "default",
        scheduleResponses: name === "responsemuted" ? "off" : "default",
      },
    });
  }
  await setDoc(C.teamRosterMembers, `${churchId}_old`, { churchId,
    userId: `${churchId}_oldrosterlead`, teamMemberships: { [media]: { teamId: media, isTeamLead: true } } });
  const sent = [];
  auth.setSendEmailForServerTests(async (payload) => sent.push(payload));
  const since = new Date(Date.now() - 21 * 60 * 1000).toISOString();
  for (const [label, teamIds, expected] of [
    ["media", [media], ["media", "adminmedia", "multi", "responsemuted"]],
    ["combined", [media, praise], ["media", "adminmedia", "multi", "praise", "responsemuted"]],
    ["all", [], ["media", "adminmedia", "multi", "praise", "responsemuted"]],
    ["invalid", [archived, foreign], []],
  ]) {
    sent.length = 0;
    const formId = `${churchId}_${label}`;
    await setDoc(C.teamIntakeForms, formId, { churchId, formId, teamIds, pendingDigestSince: since });
    await setDoc(C.teamIntakeSubmissions, `${formId}_submission`, { formId, churchId,
      submittedAt: since, firstName: "Volunteer" });
    await auth.sendIntakeSubmissionDigest(formId);
    assert.deepEqual(sent.map((email) => email.to).sort(), expected.map((name) => `${name}@example.test`).sort(), label);
  }
  sent.length = 0;
  const scheduleId = `${churchId}_schedule`;
  await setDoc(C.teamSchedules, scheduleId, { churchId, teamId: media, scheduleId,
    pendingResponseDigestSince: since, responses: { occurrence: { cell: {
      memberId: "unlinked", response: "accepted", respondedAt: since,
    } } } });
  await auth.sendScheduleResponseDigest(scheduleId);
  assert.deepEqual(sent.map((email) => email.to).sort(),
    ["media", "adminmedia", "multi", "intakemuted"].map((name) => `${name}@example.test`).sort());
  assert.ok(sent.every((email) => typeof email.to === "string" && email.idempotencyKey));
});
