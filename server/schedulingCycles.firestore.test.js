process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const {
  authHandlers,
  COLLECTIONS,
  seedActiveHumanBearerForServerTests,
  setDoc,
  setServerFirestoreForTests,
} = await import("../authService.js");

const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  send(payload) { this.body = payload; return this; },
  set() { return this; },
  clearCookie() { return this; },
});

const createContext = async ({ db, churchId, suffix }) => {
  const session = { destroy(callback) { callback?.(); } };
  const userId = `scheduling_cycle_admin_${suffix}`;
  const { humanApiToken } = await seedActiveHumanBearerForServerTests({
    req: { params: {}, headers: {}, body: {}, session },
    userId,
    email: `scheduling-cycle-${suffix}@example.test`,
    churchId,
    role: "admin",
  });
  await setDoc(COLLECTIONS.churches, churchId, { serviceTimeZone: "America/New_York" }, { merge: true });
  const headers = { authorization: `Bearer ${humanApiToken}` };
  const me = response();
  await authHandlers.getAuthMe({ params: {}, headers, session }, me);
  headers["x-csrf-token"] = String(me.payload.csrfToken || "");
  return { churchId, headers, session, db, userId };
};

const callHandler = async (handler, { context, params = {}, body = {} }) => {
  const result = response();
  await handler({
    params: { churchId: context.churchId, ...params },
    headers: context.headers,
    session: context.session,
    body,
    query: {},
  }, result);
  return result;
};

test("Firestore atomically revisions scheduling settings and creates one durable cycle with unique actions", { skip: !emulatorEnabled }, async () => {
  const suffix = randomUUID();
  const app = initializeApp({ projectId: "demo-worshipsync" }, `scheduling-cycles-${suffix}`);
  const db = getFirestore(app);
  setServerFirestoreForTests(db);
  const churchId = `scheduling_cycle_church_${suffix}`;
  const teamId = `scheduling_cycle_team_${suffix}`;
  const context = await createContext({ db, churchId, suffix });
  await setDoc(COLLECTIONS.teams, teamId, {
    teamId, churchId, name: "Media", memberIds: [], archivedAt: null,
  });
  const settings = {
    frequency: "monthly",
    preparationDay: 24,
    availabilityRequestLeadDays: 14,
    followUpAfterDays: 3,
    leaderSummaryAfterDays: 3,
    localExecutionTime: "09:00",
    publicationPolicy: "manual",
  };

  try {
    const writes = await Promise.all([
      callHandler(authHandlers.saveChurchSchedulingDefaults, { context, body: { settings, revision: 0 } }),
      callHandler(authHandlers.saveChurchSchedulingDefaults, { context, body: { settings, revision: 0 } }),
    ]);
    assert.deepEqual(writes.map(({ statusCode }) => statusCode).sort(), [200, 409]);
    const persistedSettings = await db.collection(COLLECTIONS.teamSchedulingAutomationSettings)
      .where("churchId", "==", churchId).get();
    assert.equal(persistedSettings.size, 1);
    assert.equal(persistedSettings.docs[0].data().revision, 1);

    const cycles = await Promise.all([
      callHandler(authHandlers.ensureSchedulingCycle, { context, params: { teamId }, body: { periodId: "2026-12" } }),
      callHandler(authHandlers.ensureSchedulingCycle, { context, params: { teamId }, body: { periodId: "2026-12" } }),
      callHandler(authHandlers.ensureSchedulingCycle, { context, params: { teamId }, body: { periodId: "2026-12" } }),
    ]);
    assert.ok(cycles.every(({ statusCode }) => statusCode === 200), JSON.stringify(cycles.map((item) => item.payload)));
    assert.equal(new Set(cycles.map(({ payload }) => payload.cycle.cycleId)).size, 1);

    const savedCycles = await db.collection(COLLECTIONS.teamSchedulingCycles)
      .where("churchId", "==", churchId).get();
    const savedActions = await db.collection(COLLECTIONS.teamSchedulingActions)
      .where("churchId", "==", churchId).get();
    assert.equal(savedCycles.size, 1);
    assert.equal(savedActions.size, 6);
    const cycle = savedCycles.docs[0].data();
    assert.equal(cycle.configurationRevision, "church:1");
    assert.equal(cycle.automationEnabled, false);
    assert.equal(cycle.publicationPolicy, "manual");
    assert.equal(cycle.effectiveConfiguration.preparationDay, 24);
    assert.equal(savedActions.docs.filter((doc) => doc.data().enabled).length, 0);
    assert.equal(savedActions.docs.filter((doc) => doc.data().state === "manual").length, 1);
  } finally {
    for (const collection of [
      COLLECTIONS.teamSchedulingActions,
      COLLECTIONS.teamSchedulingCycles,
      COLLECTIONS.teamSchedulingAutomationSettings,
      COLLECTIONS.teams,
      COLLECTIONS.memberships,
    ]) {
      const rows = await db.collection(collection).where("churchId", "==", churchId).get();
      await Promise.all(rows.docs.map((doc) => doc.ref.delete()));
    }
    await Promise.all([
      db.collection(COLLECTIONS.churches).doc(churchId).delete(),
      db.collection(COLLECTIONS.users).doc(context.userId).delete(),
    ]);
    setServerFirestoreForTests(null);
    await db.terminate();
    await deleteApp(app);
  }
});
