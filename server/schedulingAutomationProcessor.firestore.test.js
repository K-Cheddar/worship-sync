process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createSchedulingAutomationProcessor } from "./schedulingAutomationProcessor.js";
import { planSchedulingCycle, resolveEffectiveSchedulingSettings, schedulingSettingsIdFor } from "./schedulingCycles.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const COLLECTIONS = {
  churches: "churches",
  teams: "teams",
  teamSchedules: "teamSchedules",
  teamSchedulingAutomationSettings: "teamSchedulingAutomationSettings",
  teamSchedulingCycles: "teamSchedulingCycles",
  teamSchedulingActions: "teamSchedulingActions",
    teamSchedulingProcessorState: "teamSchedulingProcessorState",
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
    const cursorRows = await db.collection(COLLECTIONS.teamSchedulingProcessorState).where("namespace", "==", suffix).get();
    await Promise.all(cursorRows.docs.map((doc) => doc.ref.delete()));
    await db.collection(COLLECTIONS.churches).doc(churchId).delete();
    await db.terminate();
    await deleteApp(app);
  };
  return { app, db, churchId, teamId, activationAt, namespace: suffix, cleanup };
};

const processorFor = ({ db, createAvailabilityRequest, now = fixedNow, limits, processorStateNamespace = "global" }) => createSchedulingAutomationProcessor({
  firestore: db,
  collections: COLLECTIONS,
  createAvailabilityRequest,
  now,
  limits,
  processorStateNamespace,
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
    assert.equal(dryRun.actions.length, 2);
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
    assert.equal(actionRows.size, 7);
    const request = actionRows.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_request");
    assert.equal(request.state, "completed");
    assert.equal(request.relatedFormId, "stable-form-id");
    assert.equal(cycles.docs[0].data().availabilityFormIds[0], "stable-form-id");
    assert.equal(first.summary.completed + second.summary.completed, 1);
    assert.equal(first.summary.waitingForDelivery + second.summary.waitingForDelivery, 2);
    assert.equal(first.summary.reviewRequired + second.summary.reviewRequired, 0);
    const waitingActions = actionRows.docs.map((doc) => doc.data()).filter((action) =>
      ["availability_follow_up", "leader_summary"].includes(action.actionType));
    assert.equal(waitingActions.length, 2);
    assert.ok(waitingActions.every((action) => action.state === "pending" && action.enabled === false));
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

test("an isolated expired claim is recovered without cycle discovery", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  const now = fixedNow();
  let calls = 0;
  const defaults = (await fixture.db.collection(COLLECTIONS.teamSchedulingAutomationSettings)
    .doc(schedulingSettingsIdFor({ churchId: fixture.churchId })).get()).data();
  const planned = planSchedulingCycle({ churchId: fixture.churchId, teamId: fixture.teamId,
    periodId: "2027-01", serviceTimeZone: "America/New_York",
    effective: resolveEffectiveSchedulingSettings({ defaults, override: { mode: "inherit" } }),
    createdAt: now.toISOString(), createdBy: null });
  planned.cycle.automationEnabled = true;
  planned.cycle.availabilityFormCreationEnabled = true;
  planned.cycle.activationBoundaryAt = fixture.activationAt;
  const request = planned.actions.find((action) => action.actionType === "availability_request");
  Object.assign(request, { enabled: true, state: "claimed", claimToken: "expired-owner-token",
    claimOwner: "previous-run", claimedAt: "2026-12-01T14:00:00.000Z",
    claimExpiresAt: "2026-12-01T15:00:00.000Z", attemptCount: 1 });
  await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).doc(planned.cycle.cycleId).set(planned.cycle);
  await Promise.all(planned.actions.map((action) => fixture.db.collection(COLLECTIONS.teamSchedulingActions)
    .doc(action.actionId).set(action)));
  const processor = processorFor({ db: fixture.db, now: () => now,
    processorStateNamespace: fixture.namespace,
    limits: { churches: 10, teamsPerChurch: 10, maxTeamScopesPerRun: 10, cyclesPerRun: 10,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 5, budgetMs: 480000, lookAheadMonths: 0 },
    createAvailabilityRequest: async () => { calls += 1; return { formId: "isolated-form" }; } });
  try {
    const result = await processor.run({ mode: "execute", limit: 10 });
    const saved = (await fixture.db.collection(COLLECTIONS.teamSchedulingActions).doc(request.actionId).get()).data();
    assert.equal(calls, 1);
    assert.equal(result.summary.cyclesCreated, 0);
    assert.equal(result.summary.expiredClaimsRecovered, 1);
    assert.equal(saved.state, "completed");
    assert.equal(saved.attemptCount, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("cycle discovery stops at its per-run cycle budget and reports remaining work", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  const processor = processorFor({ db: fixture.db, now: fixedNow,
    processorStateNamespace: fixture.namespace,
    limits: { churches: 10, teamsPerChurch: 10, maxTeamScopesPerRun: 10, cyclesPerRun: 1,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 5, budgetMs: 480000, lookAheadMonths: 4 },
    createAvailabilityRequest: async () => ({ skipped: true, reason: "test result" }) });
  try {
    const result = await processor.run({ mode: "execute", limit: 10 });
    const cycles = await fixture.db.collection(COLLECTIONS.teamSchedulingCycles)
      .where("churchId", "==", fixture.churchId).get();
    assert.equal(result.summary.cyclesCreated, 1);
    assert.equal(result.summary.discoveryIncomplete, true);
    assert.equal(cycles.size, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("team discovery resumes after a full page before advancing its church cursor", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  await Promise.all(["processor-extra-a", "processor-extra-b"].map((teamId) =>
    fixture.db.collection(COLLECTIONS.teams).doc(`${teamId}-${fixture.namespace}`).set({
      teamId: `${teamId}-${fixture.namespace}`, churchId: fixture.churchId, name: "Media", archivedAt: null,
    })));
  const processor = processorFor({ db: fixture.db, now: fixedNow,
    processorStateNamespace: fixture.namespace,
    limits: { churches: 10, teamsPerChurch: 1, maxTeamScopesPerRun: 10, cyclesPerRun: 10,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 5, budgetMs: 480000, lookAheadMonths: 0 },
    createAvailabilityRequest: async () => ({ skipped: true, reason: "test result" }) });
  try {
    const first = await processor.run({ mode: "execute", limit: 10 });
    const second = await processor.run({ mode: "execute", limit: 10 });
    const third = await processor.run({ mode: "execute", limit: 10 });
    assert.equal(first.summary.teamsExamined, 1);
    assert.equal(second.summary.teamsExamined, 1);
    assert.equal(third.summary.teamsExamined, 1);
    assert.equal(first.summary.discoveryIncomplete, true);
    assert.equal(second.summary.discoveryIncomplete, true);
    assert.equal(third.summary.discoveryIncomplete, false);
  } finally {
    await fixture.cleanup();
  }
});

test("cycle rediscovery preserves retry timing and exhausts repeated transient failures", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  let currentTime = fixedNow();
  let calls = 0;
  const processor = processorFor({ db: fixture.db, now: () => new Date(currentTime),
    processorStateNamespace: fixture.namespace,
    limits: { churches: 10, teamsPerChurch: 10, maxTeamScopesPerRun: 10, cyclesPerRun: 10,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 3, budgetMs: 480000, lookAheadMonths: 4 },
    createAvailabilityRequest: async () => {
      calls += 1;
      throw Object.assign(new Error("temporary Firestore failure"), { code: "UNAVAILABLE" });
    } });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await scopedRun(fixture, processor);
      const cycleId = (await fixture.db.collection(COLLECTIONS.teamSchedulingCycles)
        .where("churchId", "==", fixture.churchId).get()).docs[0].id;
      const cycle = (await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).doc(cycleId).get()).data();
      const cycleActions = await Promise.all(cycle.plannedActionIds.map((id) =>
        fixture.db.collection(COLLECTIONS.teamSchedulingActions).doc(id).get()));
      const requestSnapshot = cycleActions.find((snapshot) => snapshot.data()?.actionType === "availability_request");
      const request = requestSnapshot.data();
      if (attempt < 2) {
        assert.equal(request.state, "retryable_failure");
        assert.ok(request.nextAttemptAt);
        currentTime = new Date(Date.parse(request.nextAttemptAt) + 1000);
      }
    }
    const actions = await fixture.db.collection(COLLECTIONS.teamSchedulingActions).where("churchId", "==", fixture.churchId).get();
    const request = actions.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_request");
    assert.equal(calls, 3);
    assert.equal(request.state, "review_required");
    assert.equal(request.attemptCount, 3);
    assert.equal(request.nextAttemptAt, null);
  } finally {
    await fixture.cleanup();
  }
});

test("an expired claim at the attempt limit is disabled for leader review", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  const now = fixedNow();
  const defaults = (await fixture.db.collection(COLLECTIONS.teamSchedulingAutomationSettings)
    .doc(schedulingSettingsIdFor({ churchId: fixture.churchId })).get()).data();
  const planned = planSchedulingCycle({ churchId: fixture.churchId, teamId: fixture.teamId,
    periodId: "2027-02", serviceTimeZone: "America/New_York",
    effective: resolveEffectiveSchedulingSettings({ defaults, override: { mode: "inherit" } }),
    createdAt: now.toISOString(), createdBy: null });
  planned.cycle.automationEnabled = true;
  planned.cycle.availabilityFormCreationEnabled = true;
  planned.cycle.activationBoundaryAt = fixture.activationAt;
  const request = planned.actions.find((action) => action.actionType === "availability_request");
  Object.assign(request, { enabled: true, state: "claimed", claimToken: "exhausted-owner",
    claimOwner: "interrupted-run", claimedAt: "2026-12-01T14:00:00.000Z",
    claimExpiresAt: "2026-12-01T15:00:00.000Z", attemptCount: 5 });
  await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).doc(planned.cycle.cycleId).set(planned.cycle);
  await Promise.all(planned.actions.map((action) => fixture.db.collection(COLLECTIONS.teamSchedulingActions)
    .doc(action.actionId).set(action)));
  let calls = 0;
  const processor = processorFor({ db: fixture.db, now: () => now,
    limits: { churches: 10, teamsPerChurch: 10, maxTeamScopesPerRun: 10, cyclesPerRun: 10,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 5, budgetMs: 480000, lookAheadMonths: 0 },
    createAvailabilityRequest: async () => { calls += 1; return { formId: "should-not-run" }; } });
  try {
    const result = await processor.run({ mode: "execute", churchId: fixture.churchId,
      teamId: fixture.teamId, periodId: "2027-02", limit: 10 });
    const saved = (await fixture.db.collection(COLLECTIONS.teamSchedulingActions).doc(request.actionId).get()).data();
    assert.equal(calls, 0);
    assert.equal(saved.state, "review_required");
    assert.equal(saved.enabled, false);
    assert.equal(saved.attemptCount, 5);
    assert.equal(result.summary.reviewRequired, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("existing due work is processed before a constrained discovery budget", { skip: !enabled }, async () => {
  const fixture = await createFixture(randomUUID());
  const baseTime = fixedNow();
  let actionStarted = false;
  const now = () => new Date(baseTime.getTime() + (actionStarted ? 3000 : 0));
  const defaults = (await fixture.db.collection(COLLECTIONS.teamSchedulingAutomationSettings)
    .doc(schedulingSettingsIdFor({ churchId: fixture.churchId })).get()).data();
  const planned = planSchedulingCycle({ churchId: fixture.churchId, teamId: fixture.teamId,
    periodId: "2027-02", serviceTimeZone: "America/New_York",
    effective: resolveEffectiveSchedulingSettings({ defaults, override: { mode: "inherit" } }),
    createdAt: baseTime.toISOString(), createdBy: null });
  planned.cycle.automationEnabled = true;
  planned.cycle.availabilityFormCreationEnabled = true;
  planned.cycle.activationBoundaryAt = fixture.activationAt;
  const request = planned.actions.find((action) => action.actionType === "availability_request");
  Object.assign(request, { enabled: true, state: "pending", dueAt: baseTime.toISOString() });
  await fixture.db.collection(COLLECTIONS.teamSchedulingCycles).doc(planned.cycle.cycleId).set(planned.cycle);
  await Promise.all(planned.actions.map((action) => fixture.db.collection(COLLECTIONS.teamSchedulingActions)
    .doc(action.actionId).set(action)));
  let calls = 0;
  const processor = processorFor({ db: fixture.db, now,
    limits: { churches: 10, teamsPerChurch: 10, maxTeamScopesPerRun: 10, cyclesPerRun: 10,
      actionsPerRun: 10, claimLeaseMs: 300000, maxAttempts: 5, budgetMs: 2000, lookAheadMonths: 0 },
    createAvailabilityRequest: async () => {
      calls += 1;
      actionStarted = true;
      return { formId: "due-action-form" };
    } });
  try {
    const result = await processor.run({ mode: "execute", churchId: fixture.churchId,
      teamId: fixture.teamId, periodId: "2027-02", limit: 10 });
    assert.equal(calls, 1);
    assert.equal(result.summary.completed, 1);
    assert.equal(result.summary.discoveryIncomplete, true);
  } finally {
    await fixture.cleanup();
  }
});
