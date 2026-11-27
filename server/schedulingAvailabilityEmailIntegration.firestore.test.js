import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { schedulingSettingsIdFor } from "./schedulingCycles.js";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const deleteChurchRows = async (db, collection, churchId) => {
  const rows = await db.collection(collection).where("churchId", "==", churchId).limit(1000).get();
  await Promise.all(rows.docs.map((row) => row.ref.delete()));
};

test("live scheduling creates the availability request, emails once, and recovers from a repeated run", { skip: !enabled }, async () => {
  process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
  process.env.SCHEDULING_AUTOMATION_EMAIL_ENABLED = "true";
  process.env.FIREBASE_PROJECT_ID = "demo-worshipsync";
  process.env.FIREBASE_CLIENT_EMAIL = "scheduling-email-test@demo-worshipsync.iam.gserviceaccount.com";
  process.env.FIREBASE_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  // Keep dotenv from supplying a live Realtime Database to this Firestore-only fixture.
  process.env.FIREBASE_DATABASE_URL = "";
  process.env.VITE_FIREBASE_DATABASE_URL = "";

  const { authHandlers, authRuntimeInfo, COLLECTIONS, runSchedulingAutomationProcessor,
    seedChurchServiceTimesForServerTests, setSendEmailForServerTests } = await import("../authService.js");
  const { getFirestore } = await import("firebase-admin/firestore");
  assert.equal(authRuntimeInfo.hasFirestore, true);
  const db = getFirestore();
  const suffix = randomUUID();
  const churchId = `scheduling-email-church-${suffix}`;
  const teamId = `scheduling-email-team-${suffix}`;
  const positionId = `scheduling-email-position-${suffix}`;
  const positionedMemberId = `scheduling-email-positioned-${suffix}`;
  const noEmailMemberId = `scheduling-email-no-contact-${suffix}`;
  const directEmailMemberIds = Array.from({ length: 51 }, (_, index) => `scheduling-email-direct-${suffix}-${index}`);
  const settingsId = schedulingSettingsIdFor({ churchId });
  const namespace = `scheduling-email-${suffix}`;
  const collectionNames = [
    COLLECTIONS.notificationIntents,
    COLLECTIONS.teamIntakeRecipients,
    COLLECTIONS.teamIntakeForms,
    COLLECTIONS.teamAvailabilityFormCreationGuards,
    COLLECTIONS.teamSchedulingActions,
    COLLECTIONS.teamSchedulingCycles,
    COLLECTIONS.teamSchedules,
    COLLECTIONS.teamPositions,
    COLLECTIONS.teamRosterMembers,
    COLLECTIONS.teams,
    COLLECTIONS.teamSchedulingAutomationSettings,
    COLLECTIONS.churches,
  ];
  const providerCalls = [];
  const acceptedByIdempotencyKey = new Map();
  setSendEmailForServerTests(async (payload) => {
    providerCalls.push(payload);
    if (acceptedByIdempotencyKey.has(payload.idempotencyKey)) {
      return { id: acceptedByIdempotencyKey.get(payload.idempotencyKey) };
    }
    const id = `resend-test-${acceptedByIdempotencyKey.size + 1}`;
    acceptedByIdempotencyKey.set(payload.idempotencyKey, id);
    return { id };
  });

  try {
    await db.collection(COLLECTIONS.churches).doc(churchId).set({
      churchId,
      name: "Demo Church",
      status: "active",
      serviceTimeZone: "UTC",
      intakeFormDefaults: { team_availability: {} },
    });
    await db.collection(COLLECTIONS.teams).doc(teamId).set({
      teamId,
      churchId,
      name: "Media Team",
      memberIds: [noEmailMemberId, ...directEmailMemberIds],
      archivedAt: null,
    });
    await db.collection(COLLECTIONS.teamPositions).doc(positionId).set({
      positionId,
      churchId,
      teamId,
      name: "Camera",
      archivedAt: null,
    });
    await db.collection(COLLECTIONS.teamRosterMembers).doc(positionedMemberId).set({
      memberId: positionedMemberId,
      churchId,
      firstName: "Alex",
      lastName: "Position",
      email: "alex.position@example.com",
      positionIds: [positionId],
      archivedAt: null,
      teamMemberships: {},
    });
    await db.collection(COLLECTIONS.teamRosterMembers).doc(noEmailMemberId).set({
      memberId: noEmailMemberId,
      churchId,
      firstName: "Taylor",
      lastName: "NoContact",
      email: "",
      positionIds: [],
      archivedAt: null,
      teamMemberships: { [teamId]: { teamId, status: "active", active: true } },
    });
    await Promise.all(directEmailMemberIds.map((memberId, index) => db.collection(COLLECTIONS.teamRosterMembers).doc(memberId).set({
      memberId,
      churchId,
      firstName: `Direct${index}`,
      lastName: "Member",
      email: `scheduling-direct-${suffix}-${index}@example.com`,
      positionIds: [],
      archivedAt: null,
      teamMemberships: {},
    })));
    await db.collection(COLLECTIONS.teamSchedulingAutomationSettings).doc(settingsId).set({
      settingsId,
      churchId,
      teamId: null,
      scopeType: "church_defaults",
      settings: {
        frequency: "monthly",
        preparationDay: 24,
        availabilityRequestLeadDays: 60,
        followUpAfterDays: 3,
        leaderSummaryAfterDays: 3,
        availabilityResponseLeadDays: 14,
        localExecutionTime: "09:00",
        publicationPolicy: "manual",
      },
      availabilityAutomationEnabled: true,
      availabilityFormCreationEnabled: true,
      availabilityAutomationActivatedAt: "2026-11-01T00:00:00.000Z",
      availabilityEmailDeliveryEnabled: true,
      availabilityEmailDeliveryActivatedAt: "2026-11-01T00:00:00.000Z",
      availabilityEmailDeliveryDisabledAt: null,
      availabilitySmsDeliveryEnabled: false,
      revision: 1,
    });
    seedChurchServiceTimesForServerTests({
      churchId,
      services: [{
        id: "sabbath-service",
        serviceId: "sabbath-service",
        churchId,
        name: "Sabbath Service",
        reccurence: "weekly",
        dayOfWeek: 6,
        time: "10:00",
        positionRequirements: [{ positionId, count: 1 }],
      }],
    });

    const run = (mode = "live") => runSchedulingAutomationProcessor({
      mode,
      churchId,
      teamId,
      periodId: "2027-02",
      limit: 10,
      processorStateNamespace: namespace,
      now: () => new Date("2026-11-27T15:00:00.000Z"),
    });
    const dryRun = await run("dry-run");
    const requestPreview = dryRun.actions.find((action) => action.actionType === "availability_request")
      ?.availabilityPreview;
    assert.deepEqual({
      formAction: requestPreview?.formAction,
      recipientCount: requestPreview?.recipientCount,
      emailEligibleCount: requestPreview?.emailEligibleCount,
      noEmailContactCount: requestPreview?.noEmailContactCount,
    }, {
      formAction: "create",
      recipientCount: 53,
      emailEligibleCount: 52,
      noEmailContactCount: 1,
    });
    for (const collection of [COLLECTIONS.teamSchedulingCycles, COLLECTIONS.teamIntakeForms,
      COLLECTIONS.teamIntakeRecipients, COLLECTIONS.notificationIntents, COLLECTIONS.teamSchedulingActions]) {
      assert.equal((await db.collection(collection).where("churchId", "==", churchId).get()).size, 0,
        `dry-run must not write to ${collection}`);
    }
    assert.equal(providerCalls.length, 0, "dry-run must not call the email provider");

    const first = await run();
    assert.equal(first.summary.completed, 1);
    assert.equal(first.summary.claimed, 2);

    const cycles = await db.collection(COLLECTIONS.teamSchedulingCycles).where("churchId", "==", churchId).get();
    const forms = await db.collection(COLLECTIONS.teamIntakeForms).where("churchId", "==", churchId).get();
    assert.equal(cycles.size, 1);
    assert.equal(forms.size, 1);
    const cycle = cycles.docs[0].data();
    const form = forms.docs[0].data();
    assert.equal(form.teamIds[0], teamId);
    assert.equal(form.startDate, "2027-02-01");
    assert.equal(form.endDate, "2027-02-28");
    assert.equal(form.responseDeadline, cycle.deadlines.availabilityResponse.localDate);
    assert.ok(form.availabilityOccurrences.some((occurrence) => occurrence.serviceId === "sabbath-service"));

    const recipients = await db.collection(COLLECTIONS.teamIntakeRecipients)
      .where("churchId", "==", churchId).where("formId", "==", form.formId).get();
    assert.equal(recipients.size, 53);
    assert.ok(recipients.docs.every((doc) => doc.data().recipientTokenCiphertext && doc.data().recipientTokenHash));
    const byMember = new Map(recipients.docs.map((doc) => [doc.data().memberId, { recipientId: doc.id, ...doc.data() }]));
    assert.ok(byMember.has(positionedMemberId), "position-based team eligibility must create a recipient");
    assert.ok(byMember.has(noEmailMemberId), "lack of email must not exclude the availability request");
    assert.equal(await authHandlers.isAvailabilityRecipientInFormScope({
      churchId, formId: form.formId, recipientId: byMember.get(noEmailMemberId).recipientId, memberId: noEmailMemberId,
    }), true);
    const credentialsByRecipientId = new Map(recipients.docs.map((doc) => [doc.id, {
      recipientTokenHash: doc.data().recipientTokenHash,
      recipientTokenCiphertext: doc.data().recipientTokenCiphertext,
    }]));

    const intents = await db.collection(COLLECTIONS.notificationIntents)
      .where("churchId", "==", churchId).where("formId", "==", form.formId).get();
    assert.equal(intents.size, 52);
    const allIntentRows = intents.docs.map((doc) => doc.data());
    const sentIntents = allIntentRows.filter((row) => row.status === "sent");
    assert.equal(sentIntents.length, 50);
    assert.ok(sentIntents.every((intent) => intent.channel === "email" && intent.providerMessageId));
    assert.ok(sentIntents.every((intent) => !Object.hasOwn(intent, "publicUrl")));
    assert.ok(allIntentRows.some((intent) => intent.memberId === positionedMemberId));
    assert.equal(providerCalls.length, 50);
    assert.ok(providerCalls.every((call) => /February 2027 availability/.test(call.subject)));
    assert.ok(providerCalls.every((call) => /\/a\//.test(call.textBody) && call.idempotencyKey));

    const actions = await db.collection(COLLECTIONS.teamSchedulingActions).where("churchId", "==", churchId).get();
    const requestAction = actions.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_request");
    const deliveryAction = actions.docs.map((doc) => doc.data()).find((action) => action.actionType === "availability_email_delivery");
    assert.equal(requestAction.state, "completed");
    assert.equal(deliveryAction.state, "retryable_failure");
    assert.equal(deliveryAction.result.acceptedCount, 50);
    assert.equal(deliveryAction.result.pendingCount, 2);
    assert.equal(deliveryAction.result.noEmailContactCount, 1);
    assert.equal(deliveryAction.result.uncertainCount, 0);

    // Simulate a previously queued intent whose member no longer has email.
    // It must not disappear from reconciliation merely because current audience
    // discovery excludes that member.
    const queued = intents.docs.find((doc) => doc.data().status === "ready").data();
    const obsoleteRef = db.collection(COLLECTIONS.notificationIntents).doc(`obsolete-${suffix}`);
    await obsoleteRef.set({ ...queued, intentId: obsoleteRef.id, memberId: noEmailMemberId,
      recipientId: byMember.get(noEmailMemberId).recipientId, idempotencyKey: `obsolete-${suffix}` });
    const continued = await run();
    assert.equal(continued.summary.claimed, 1);
    assert.equal(continued.summary.completed, 1);
    assert.equal(providerCalls.length, 52);
    assert.ok(providerCalls.some((call) => /alex\.position@example\.com/.test(call.to)));
    const completedDelivery = (await db.collection(COLLECTIONS.teamSchedulingActions)
      .where("churchId", "==", churchId).get()).docs.map((doc) => doc.data())
      .find((action) => action.actionType === "availability_email_delivery");
    assert.equal(completedDelivery.state, "completed");
    assert.equal(completedDelivery.result.acceptedCount, 52);
    assert.equal((await obsoleteRef.get()).data().status, "suppressed");
    assert.equal(completedDelivery.result.suppressedCount, 1);
    await obsoleteRef.delete();

    const repeated = await run();
    assert.equal(repeated.summary.claimed, 0);
    assert.equal(providerCalls.length, 52);
    assert.equal((await db.collection(COLLECTIONS.teamIntakeForms).where("churchId", "==", churchId).get()).size, 1);
    assert.equal((await db.collection(COLLECTIONS.notificationIntents).where("churchId", "==", churchId).get()).size, 52);
    const finalRecipients = await db.collection(COLLECTIONS.teamIntakeRecipients)
      .where("churchId", "==", churchId).where("formId", "==", form.formId).get();
    assert.equal(finalRecipients.size, credentialsByRecipientId.size);
    for (const row of finalRecipients.docs) {
      assert.deepEqual({
        recipientTokenHash: row.data().recipientTokenHash,
        recipientTokenCiphertext: row.data().recipientTokenCiphertext,
      }, credentialsByRecipientId.get(row.id));
    }
  } finally {
    setSendEmailForServerTests(null);
    await Promise.all(collectionNames.map((collection) => deleteChurchRows(db, collection, churchId)));
  }
});
