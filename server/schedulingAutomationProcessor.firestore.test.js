process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createSchedulingAutomationProcessor } from "./schedulingAutomationProcessor.js";
import { schedulingSettingsIdFor } from "./schedulingCycles.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const COLLECTIONS = {
  churches: "churches",
  teams: "teams",
  teamSchedules: "teamSchedules",
  teamSchedulingAutomationSettings: "teamSchedulingAutomationSettings",
  teamSchedulingCycles: "teamSchedulingCycles",
  teamSchedulingActions: "teamSchedulingActions",
};
const settings = {
  frequency: "monthly",
  preparationDay: 24,
  availabilityRequestLeadDays: 60,
  followUpAfterDays: 3,
  leaderSummaryAfterDays: 3,
  availabilityResponseLeadDays: 14,
  localExecutionTime: "09:00",
  publicationPolicy: "manual",
};
const fixedNow = () => new Date("2026-12-01T16:00:00.000Z");

const createFixture = async (suffix) => {
  const app = initializeApp({ projectId: "demo-worshipsync" }, `scheduling-processor-${suffix}`);
  const db = getFirestore(app);
  const churchId = `processor-church-${suffix}`;
  const teamId = `processor-team-${suffix}`;
  const settingsId = schedulingSettingsIdFor({ churchId });
  const activationAt = "2026-11-24T14:00:00.000Z";
  await db.collection(COLLECTIONS.churches).doc(churchId).set({ churchId, status: "active", serviceTimeZone: "America/New_York" });
  await db.collection(COLLECTIONS.teams).doc(teamId).set({ teamId, churchId, name: "Media", archivedAt: null });
  await db.collection(COLLECTIONS.teamSchedulingAutomationSettings).doc(settingsId).set({
    settingsId, churchId, teamId: null, scopeType: "church_defaults", settings,
    availabilityAutomationEnabled: true, availabilityFormCreationEnabled: true,
    availabilityAutomationActivatedAt: activationAt, notificationDeliveryEnabled: false, revision: 1,
  });
  const cleanup = async () => {
    for (const collection of [COLLECTIONS.teamSchedulingActions, COLLECTIONS.teamSchedulingCycles,
      COLLECTIONS.teamSchedulingAutomationSettings, COLLECTIONS.teams]) {
      const rows = await db.collection(collection).where("churchId", "==", churchId).get();
      await Promise.all(rows.docs.map((doc) => doc.ref.delete()));
    }
    await db.collection(COLLECTIONS.churches).doc(churchId).delete();
    await db.terminate();
    await deleteApp(app);
  };
  return { app, db, churchId, teamId, activationAt, cleanup };
};

const processorFor = ({ db, createAvailabilityRequest, now = fixedNow }) => createSchedulingAutomationProcessor({
  firestore: db,
  collections: COLLECTIONS,
  createAvailabilityRequest,
  now,
  logger: { info() {}, error() {} },
});

const scopedRun = (fixture, processor, mode = "execute") => processor.run({
  mode,
  churchId: fixture.churchId,
  teamId: fixture.teamId,
  periodId: "2027-02",
  limit: 10,
});

test("Firestore processor dry run is read-only and concurrent runs create one cycle and claim once", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  let calls = 0;
  const processor = processorFor({
    db: fixture.db,
    createAvailabilityRequest: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { formId: "stable-form-id", recipientCount: 4, skippedRecipientCount: 1 };
    },
  });
  try {
    const dryRun = await scopedRun(fixture, processor, "dry-run");
    assert.equal(dryRun.summary.cyclesCreated, 1);
    assert.equal(dryRun.actions.length, 1);
    assert.equal((await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).where("churchId", "==", fixture.churchId).get()).size, 0);
    assert.equal((await fixture.db.collection(COLLECTIONS.teamSchedulingActions).where("churchId", "==", fixture.churchId).get()).size, 0);

    const [first, second] = await Promise.all([
      scopedRun(fixture, processor),
      scopedRun(fixture, processor),
    ]);
    assert.equal(calls, 1);
    const cycles = await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).where("churchId", "==", fixture.churchId).get();
    const actionRows = await fixture.db.collection(COLLECTIONS.teamSchedulingActions).where("churchId", "==", fixture.churchId).get();
    assert.equal(cycles.size, 1);
    assert.equal(actionRows.size, 6);
    const request = actionRows.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_request");
    assert.equal(request.state, "completed");
    assert.equal(request.relatedFormId, "stable-form-id");
    assert.equal(cycles.docs[0].data().availabilityFormIds[0], "stable-form-id");
    assert.equal(first.summary.completed + second.summary.completed, 1);
    assert.equal(first.summary.reviewRequired + second.summary.reviewRequired, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("Firestore processor reclaims an expired action lease and fences the stale owner", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  let currentTime = fixedNow();
  let calls = 0;
  let releaseFirst;
  const firstOperation = new Promise((resolve) => { releaseFirst = resolve; });
  const processor = processorFor({
    db: fixture.db,
    now: () => new Date(currentTime),
    createAvailabilityRequest: async () => {
      calls += 1;
      if (calls === 1) await firstOperation;
      return { formId: "stable-form-id", recipientCount: 4 };
    },
  });
  try {
    const firstRun = scopedRun(fixture, processor);
    for (let attempt = 0; attempt < 40 && calls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(calls, 1);
    currentTime = new Date(currentTime.getTime() + 6 * 60 * 1000);
    const replacement = await scopedRun(fixture, processor);
    releaseFirst();
    const stale = await firstRun;
    assert.equal(calls, 2);
    assert.equal(replacement.summary.completed, 1);
    assert.equal(stale.summary.staleClaims, 1);
    const actions = await fixture.db.collection(COLLECTIONS.teamSchedulingActions).where("churchId", "==", fixture.churchId).get();
    const request = actions.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_request");
    assert.equal(request.state, "completed");
    assert.equal(request.claimToken, null);
    assert.equal(request.claimOwner, null);
  } finally {
    releaseFirst?.();
    await fixture.cleanup();
  }
});
