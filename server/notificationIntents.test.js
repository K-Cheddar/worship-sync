import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATIC_NOTIFICATION_SENDS_DISABLED,
  createNotificationIntentHandlers,
  createNotificationIntent,
  NOTIFICATION_INTENT_TYPES,
} from "./notificationIntents.js";
import { createSmsStatusWebhookHandler } from "./smsStatusWebhook.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { measureSmsMessage } from "./smsMessage.js";

const createHarness = ({
  providerSend,
  firestore = false,
  requireTeamsEdit,
  authorizeSchedule,
  authorizeAvailabilityForm,
  isAvailabilityRecipientInFormScope,
  validateReplacementCandidate,
  beforeSetDoc,
} = {}) => {
  const collections = new Map();
  const storeFor = (collection) => {
    if (!collections.has(collection)) collections.set(collection, new Map());
    return collections.get(collection);
  };
  const hashValue = (value) => `h_${Buffer.from(String(value)).toString("hex")}`;
  let nextId = 0;
  let providerCalls = 0;
  const nowIso = () => new Date().toISOString();
  const responseDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const churchId = "church_a";
  const phoneNumber = "+14155550123";
  const form = {
    formId: "form_a", churchId, name: "October availability", startDate: "2026-10-01",
    endDate: "2026-10-31", responseDeadline, active: true,
    enabledFields: ["availability"], teamIds: [], availabilityOccurrences: [{ occurrenceId: "occ_1" }],
  };
  const recipient = {
    recipientId: "recipient_a", churchId, formId: form.formId, memberId: "member_a",
    respondedAt: null, revokedAt: null,
  };
  const schedule = {
    scheduleId: "schedule_a", churchId, teamId: "team_a", name: "October rota",
    updatedAt: "2026-09-25T10:00:00.000Z", sentAt: null,
    occurrences: [{ occurrenceId: "occ_1", name: "Sunday service", startsAt: "2026-10-04T10:00:00.000Z" }],
    assignments: {},
  };
  const member = { memberId: "member_a", churchId, firstName: "Rae", lastName: "Rivera", phoneNumber };
  const config = {
    churchId, provider: "twilio", twilioAccountSid: "AC1", senderPhoneNumber: "+14155550999",
    enabled: true, registrationStatus: "approved",
  };
  storeFor("churches").set(churchId, { churchId, name: "First Church" });
  storeFor("teamSchedules").set(schedule.scheduleId, schedule);
  storeFor("teamIntakeForms").set(form.formId, form);
  storeFor("teamIntakeRecipients").set(recipient.recipientId, recipient);
  storeFor("teamRosterMembers").set(member.memberId, member);
  storeFor("teamRosterMembers").set("member_b", { memberId: "member_b", churchId, firstName: "Casey", lastName: "Candidate", phoneNumber });
  storeFor("teamPositions").set("position", { positionId: "position", churchId, name: "Worship" });
  storeFor("churchMessagingConfigs").set(churchId, config);
  storeFor("smsConsents").set(smsConsentIdForChurchPhone(churchId, phoneNumber), {
    consentId: smsConsentIdForChurchPhone(churchId, phoneNumber), churchId, phoneNumber,
    status: "opted_in", verifiedAt: nowIso(), consentedAt: nowIso(),
  });
  const provider = {
    async sendMessage(input) {
      providerCalls += 1;
      if (providerSend) return providerSend(input);
      return { providerMessageId: `SM${providerCalls}`, status: "accepted" };
    },
  };
  let transactionTail = Promise.resolve();
  const db = {
    collection: (collection) => ({
      doc: (id) => ({ collection, id }),
    }),
    runTransaction: (callback) => {
      const run = transactionTail.then(() => callback({
        get: async (ref) => {
          const value = storeFor(ref.collection).get(ref.id);
          return { exists: Boolean(value), id: ref.id, data: () => value };
        },
        set: (ref, value, options = {}) => {
          const prior = storeFor(ref.collection).get(ref.id) || {};
          storeFor(ref.collection).set(ref.id, options.merge ? { ...prior, ...value } : value);
        },
        delete: (ref) => storeFor(ref.collection).delete(ref.id),
        create: (ref, value) => {
          if (storeFor(ref.collection).has(ref.id)) throw new Error("already exists");
          storeFor(ref.collection).set(ref.id, value);
        },
      }));
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const getDoc = async (collection, id) => storeFor(collection).get(id) || null;
  const handler = createNotificationIntentHandlers({
    COLLECTIONS: {
      notificationIntents: "notificationIntents", smsDeliveryAttempts: "smsDeliveryAttempts",
      notificationBatches: "notificationBatches", teamIntakeForms: "teamIntakeForms",
      teamIntakeRecipients: "teamIntakeRecipients",
      notificationDeliveries: "notificationDeliveries",
      teamSchedules: "teamSchedules", teamRosterMembers: "teamRosterMembers", churches: "churches",
    churchMessagingConfigs: "churchMessagingConfigs", smsConsents: "smsConsents",
    teamPositions: "teamPositions",
    },
    assertCsrf: async () => undefined,
    createId: (prefix) => `${prefix}_${++nextId}`,
    getDoc,
    deleteDoc: async (collection, id) => storeFor(collection).delete(id),
    hashValue,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    nowIso,
    queryDocs: async (collection, filters = []) => [...storeFor(collection).values()].filter((item) => filters.every((filter) => filter.op === "in" ? filter.value.includes(item[filter.field]) : item[filter.field] === filter.value)),
    requireFirestore: () => firestore ? db : null,
    requireTeamsEdit: requireTeamsEdit || (async () => ({ user: { uid: "admin_a" } })),
    ...(authorizeSchedule ? { authorizeSchedule } : {}),
    authorizeAvailabilityForm: authorizeAvailabilityForm || (async () => {
      throw Object.assign(new Error("Availability form access required."), { statusCode: 403 });
    }),
    isAvailabilityRecipientInFormScope: isAvailabilityRecipientInFormScope || (async () => true),
    getSmsConsentForChurchPhone: async (id, phone) => id === churchId && phone === phoneNumber
      ? storeFor("smsConsents").get(smsConsentIdForChurchPhone(id, phone)) || null
      : null,
    prepareAvailabilityNotificationRecipients: async ({ memberIds, purpose }) => {
      const currentForm = storeFor("teamIntakeForms").get(form.formId);
      return {
        form: currentForm,
        results: memberIds.map((memberId) => {
          const currentRecipient = storeFor("teamIntakeRecipients").get(recipient.recipientId);
          const exclusionReason = memberId !== member.memberId
            ? "Volunteer is outside this form's team scope."
            : currentRecipient?.revokedAt
              ? "Request was revoked."
              : currentRecipient?.respondedAt
                ? "Availability response already received."
                : purpose === "availability_reminder" && !currentRecipient
                  ? "No individual intake request exists."
                  : "";
          return {
            memberId,
            recipientId: currentRecipient?.recipientId || recipient.recipientId,
            recipient: currentRecipient || recipient,
            member: memberId === member.memberId ? member : null,
            form: currentForm,
            churchName: "First Church",
            publicUrl: "https://www.worshipsync.net/a/secure-token",
            phoneNumber,
            maskedPhoneNumber: "••• ••• 0123",
            eligibilityStatus: "enabled",
            eligible: !exclusionReason,
            exclusionReason,
          };
        }),
      };
    },
    resolveAvailabilityNotificationContext: async (intent) => ({
      form: storeFor("teamIntakeForms").get(intent.formId),
      recipient: storeFor("teamIntakeRecipients").get(intent.recipientId),
      member: storeFor("teamRosterMembers").get(intent.memberId),
      church: storeFor("churches").get(churchId),
      publicUrl: "https://www.worshipsync.net/a/secure-token",
    }),
    resolveScheduleNotificationContext: async (intent) => ({
      schedule: storeFor("teamSchedules").get(intent.sourceId),
      member,
      church: storeFor("churches").get(churchId),
      occurrence: schedule.occurrences[0],
      serviceName: "Sunday service",
      positionName: "Worship",
      responseUrl: "https://www.worshipsync.net/schedule-response/secure-token",
    }),
    validateReplacementCandidate: validateReplacementCandidate || (async ({ churchId: targetChurchId, scheduleId, occurrenceId, cellKey, memberId }) => {
      const candidate = storeFor("teamRosterMembers").get(memberId);
      const currentSchedule = storeFor("teamSchedules").get(scheduleId);
      if (targetChurchId !== churchId || scheduleId !== schedule.scheduleId || !currentSchedule || !candidate || candidate.archivedAt || candidate.serviceAvailability?.[occurrenceId] === "unavailable") {
        throw Object.assign(new Error("Candidate is not eligible for this church schedule."), { statusCode: 409 });
      }
      const cell = currentSchedule.assignments?.[occurrenceId]?.[cellKey];
      const holderId = typeof cell === "string" ? cell : cell?.primaryMemberId || "";
      const response = currentSchedule.responses?.[occurrenceId]?.[cellKey]?.response;
      if ((holderId && response !== "declined") || memberId === holderId) throw Object.assign(new Error("Replacement candidate is not eligible."), { statusCode: 409 });
      return { schedule: currentSchedule, member: candidate, occurrence: currentSchedule.occurrences.find((item) => item.occurrenceId === occurrenceId), church: storeFor("churches").get(churchId), position: { name: "Worship" }, holderId };
    }),
    smsProviderFactory: () => provider,
    validateTwilioStatusCallbackUrl: () => "https://example.test/status",
    setDoc: async (collection, id, data, { merge = false } = {}) => {
      if (beforeSetDoc) await beforeSetDoc(collection, id, data);
      const current = storeFor(collection).get(id) || {};
      storeFor(collection).set(id, merge ? { ...current, ...data } : { ...data });
    },
  });
  const makeResponse = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  const preview = async (overrides = {}) => {
    const res = makeResponse();
    await handler.prepareAvailabilityBatch({
      params: { churchId },
      body: { intentType: "availability_request", formId: form.formId, memberIds: [member.memberId], requestKey: `request-${nextId++}`, ...overrides },
    }, res);
    const batch = res.payload?.batch;
    const intentId = batch?.intentIds?.[0];
    return { res, batch, intent: intentId ? storeFor("notificationIntents").get(intentId) : null };
  };
  const send = async (intentId, targetChurchId = churchId) => {
    const res = makeResponse();
    const intent = storeFor("notificationIntents").get(intentId);
    await handler.sendIntent({ params: { churchId: targetChurchId, intentId }, body: { confirmed: true, approvalVersion: intent?.approvalSnapshot?.approvalVersion || "" } }, res);
    return res;
  };
  const dispatch = async (batchId, confirmed = true) => {
    const res = makeResponse();
    const batch = storeFor("notificationBatches").get(batchId);
    await handler.dispatchAvailabilityBatch({ params: { churchId, batchId }, body: { confirmed, approvalVersion: batch?.reviewVersion || "" } }, res);
    return res;
  };
  return { collections, storeFor, getDoc, db, handler, preview, send, dispatch, schedule, form, recipient, member, phoneNumber, churchId, get providerCalls() { return providerCalls; } };
};

for (const firestore of [false, true]) {
  test(`schedule authorization is rechecked after claim before provider (${firestore ? "transaction fake" : "memory"})`, async () => {
    let allowed = true;
    let checks = 0;
    const h = createHarness({ firestore, authorizeSchedule: async () => {
      checks += 1;
      if (!allowed) throw Object.assign(new Error("Teams edit access required"), { statusCode: 403 });
      // Preparation/review succeed; permission is lost on the final dispatch check.
      if (checks === 3) allowed = false;
      return { admin: { user: { uid: "manager" }, permissions: { teamScopes: { team_a: "edit" } } }, scoped: true };
    } });
    h.schedule.sentAt = "2026-10-01T00:00:00Z";
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
    await h.handler.saveEventIntents({ churchId: h.churchId, schedule: h.schedule, intentType: "assignment_notification", entries: [{ memberId: h.member.memberId, occurrenceId: "occ_1", cellKey: "position::0" }] });
    const intent = [...h.storeFor("notificationIntents").values()][0];
    const preview = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.getIntentPreview({ params: { churchId: h.churchId, intentId: intent.intentId } }, preview);
    assert.equal(preview.statusCode, 200);
    assert.doesNotMatch(preview.payload.preview.message, /secure-token/);
    assert.notEqual(preview.payload.preview.phoneNumberSnapshot, h.phoneNumber);
    assert.equal(h.providerCalls, 0);
    // First send authorization succeeds but the final read rejects.
    checks = 2;
    const result = await h.send(intent.intentId);
    assert.equal(result.statusCode, 403);
    assert.equal(h.providerCalls, 0);
    assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "failed");
    assert.equal([...h.storeFor("smsDeliveryAttempts").values()][0].outcome, "not_sent");
  });

  test(`replacement resolution checks current source ownership (${firestore ? "transaction fake" : "memory"})`, async () => {
    let allowed = true;
    const h = createHarness({ firestore, authorizeSchedule: async () => {
      if (!allowed) throw Object.assign(new Error("Teams edit access required"), { statusCode: 403 });
      return { admin: { user: { uid: "manager" }, permissions: { teamScopes: { team_a: "edit" } } }, scoped: true };
    } });
    const invoke = async (handler, input) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
      await handler(input, res);
      return res;
    };
    const prepared = await invoke(h.handler.prepareReplacementInvitation, { params: { churchId: h.churchId }, body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId: "member_b" } });
    assert.equal(prepared.statusCode, 200);
    assert.equal(prepared.payload.intent.phoneNumberSnapshot, "");
    assert.ok(prepared.payload.intent.approvalVersion);
    assert.equal(h.providerCalls, 0);
    allowed = false;
    const params = { churchId: h.churchId, intentId: prepared.payload.intent.intentId };
    assert.equal((await invoke(h.handler.resolveReplacementInvitation, { params })).statusCode, 403);
    assert.equal(h.storeFor("notificationIntents").get(params.intentId).replacementResolvedAt, undefined);
    allowed = true;
    assert.equal((await invoke(h.handler.resolveReplacementInvitation, { params })).statusCode, 200);
  });
}

test("availability preview is church-scoped and does not call the provider", async () => {
  const h = createHarness();
  const { res, intent } = await h.preview();
  assert.equal(res.statusCode, 200);
  assert.equal(intent.status, "preview");
  assert.equal(h.providerCalls, 0);
  const wrongChurch = await h.send(intent.intentId, "church_b");
  assert.equal(wrongChurch.statusCode, 404);
  assert.equal(h.providerCalls, 0);
});

test("a prepared batch is scoped to its selected form and recipients, and hides tokens from history", async () => {
  const h = createHarness();
  h.storeFor("teamIntakeRecipients").set(h.recipient.recipientId, {
    ...h.recipient,
    createdAt: "2026-09-01T00:00:00.000Z",
    recipientTokenHash: "private-hash",
    recipientTokenCiphertext: "private-ciphertext",
    createdByUid: "admin-1",
  });
  const { batch, intent } = await h.preview({ memberIds: [h.member.memberId, "other_member"] });
  assert.equal(batch.summary.requested, 2);
  assert.equal(batch.summary.eligible, 1);
  assert.equal(batch.summary.excluded, 1);
  assert.equal(batch.intentIds.length, 1);
  assert.equal(batch.recipients[0].message, "First Church: Please submit your October availability: https://www.worshipsync.net/a/secure-token Reply STOP to opt out.");
  assert.equal(batch.recipients[0].segmentCount, 1);
  assert.equal(measureSmsMessage(batch.recipients[0].message).segmentCount, 1);
  assert.deepEqual(batch.intakeRecipients, [{
    recipientId: h.recipient.recipientId,
    churchId: h.churchId,
    formId: h.form.formId,
    memberId: h.member.memberId,
    respondedAt: null,
    revokedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "admin-1",
  }]);
  assert.doesNotMatch(JSON.stringify(batch.intakeRecipients), /private-(hash|ciphertext)/);
  assert.equal(h.providerCalls, 0);

  const history = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await h.handler.listIntents({ params: { churchId: h.churchId }, query: { formId: h.form.formId } }, history);
  assert.equal(history.payload.intents[0].message, undefined);
  assert.doesNotMatch(history.payload.intents[0].messagePreview, /secure-token/);
  assert.equal(intent.batchId, batch.batchId);
});

test("a confirmed availability request cannot be selected for a duplicate send", async () => {
  const h = createHarness();
  const { batch: firstBatch } = await h.preview();
  const firstSend = await h.dispatch(firstBatch.batchId);
  assert.equal(firstSend.statusCode, 200);
  assert.equal(firstSend.payload.batch.summary.sent, 1);
  assert.equal(h.providerCalls, 1);

  const { batch: secondBatch } = await h.preview();
  assert.equal(secondBatch.summary.eligible, 0);
  assert.equal(secondBatch.summary.alreadySent, 1);
  assert.equal(secondBatch.recipients[0].status, "sent");
  assert.match(secondBatch.recipients[0].exclusionReason, /already sent/i);
  const secondSend = await h.dispatch(secondBatch.batchId);
  assert.equal(secondSend.statusCode, 200);
  assert.equal(h.providerCalls, 1);
});

test("forms with editable non-availability fields prepare form-response messages", async () => {
  const h = createHarness();
  const form = {
    ...h.form,
    enabledFields: ["firstName", "lastName", "email", "blockoutDates", "notes", "birthDate"],
  };
  h.storeFor("teamIntakeForms").set(form.formId, form);
  const { res, batch } = await h.preview();
  assert.equal(res.statusCode, 200);
  assert.equal(batch.summary.eligible, 1);
  assert.equal(batch.recipients[0].message, "First Church: Please complete the October availability form: https://www.worshipsync.net/a/secure-token Reply STOP to opt out.");
  assert.match(batch.recipients[0].message, /\/a\/secure-token/);
  assert.match(batch.recipients[0].message, /Reply STOP to opt out/);
  assert.doesNotMatch(batch.recipients[0].message, /submit your .*availability/);
  assert.equal(h.providerCalls, 0);
});

test("form reminders use reminder wording and remain scoped to the current form response", async () => {
  const h = createHarness();
  const form = {
    ...h.form,
    enabledFields: ["blockoutDates", "notes"],
    availabilityOccurrences: [],
  };
  h.storeFor("teamIntakeForms").set(form.formId, form);
  const { res, batch } = await h.preview({ intentType: "availability_reminder" });
  assert.equal(res.statusCode, 200);
  assert.equal(batch.reminderRound, 1);
  assert.equal(batch.recipients[0].message, "First Church: Reminder: Please complete the October availability form: https://www.worshipsync.net/a/secure-token Reply STOP to opt out.");
  assert.equal(batch.recipients[0].segmentCount, 1);
  assert.equal(measureSmsMessage(batch.recipients[0].message).segmentCount, 1);
  assert.match(batch.recipients[0].message, /\/a\/secure-token/);
  assert.equal(h.providerCalls, 0);
});

test("batch preparation rejects forms without any editable personalized response fields before reserving a batch", async () => {
  const h = createHarness();
  h.storeFor("teamIntakeForms").set(h.form.formId, { ...h.form, enabledFields: ["firstName", "email"] });
  const { res } = await h.preview();
  assert.equal(res.statusCode, 409);
  assert.match(res.payload.errorMessage, /no response fields for an existing volunteer/i);
  assert.equal(h.storeFor("notificationBatches").size, 0);
  assert.equal(h.providerCalls, 0);
});

test("form history is newest-first, bounded, paginated, and redacts links on every row", async () => {
  const h = createHarness();
  const intents = h.storeFor("notificationIntents");
  for (let index = 0; index < 265; index += 1) {
    const id = `history_${String(index).padStart(3, "0")}`;
    intents.set(id, {
      intentId: id, churchId: h.churchId, intentType: "availability_request",
      sourceType: "team_intake_recipient", sourceId: h.recipient.recipientId,
      formId: h.form.formId, recipientId: h.recipient.recipientId, memberId: h.member.memberId,
      idempotencyKey: id, status: index === 264 ? "failed" : "preview",
      message: `First Church: respond at https://example.test/a/private-${index}. Reply STOP.`,
      responseUrl: `https://example.test/a/private-${index}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
      updatedAt: new Date().toISOString(),
      failureMessage: "Provider error contains no public details.",
    });
  }
  const loadPage = async (cursor = "") => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.listIntents({ params: { churchId: h.churchId }, query: { formId: h.form.formId, limit: "100", ...(cursor ? { cursor } : {}) } }, res);
    return res.payload;
  };
  const pages = [];
  let cursor = "";
  do {
    const page = await loadPage(cursor);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(pages.map((page) => page.intents.length), [100, 100, 65]);
  const all = pages.flatMap((page) => page.intents);
  assert.equal(new Set(all.map((intent) => intent.intentId)).size, 265);
  assert.equal(all[0].intentId, "history_264");
  assert.doesNotMatch(JSON.stringify(all), /private-\d+/);
  assert.equal(all[0].message, undefined);
  assert.equal(all[0].responseUrl, undefined);
  assert.equal(all[0].approvalSnapshot, undefined);
});

test("church-wide form history keeps former recipients while scoped editors lose current access", async () => {
  const broad = createHarness({
    authorizeAvailabilityForm: async () => ({
      admin: { user: { uid: "teams_editor" } },
      scoped: false,
    }),
  });
  broad.storeFor("teamIntakeForms").set(broad.form.formId, {
    ...broad.form,
    purpose: "team_availability",
    teamIds: ["worship"],
  });
  const formerIntent = {
    intentId: "former_history",
    churchId: broad.churchId,
    intentType: "availability_request",
    sourceType: "team_intake_recipient",
    sourceId: "former_recipient",
    recipientId: "former_recipient",
    memberId: "former_member",
    formId: broad.form.formId,
    status: "sent",
    createdAt: "2026-09-20T10:00:00.000Z",
  };
  broad.storeFor("notificationIntents").set(formerIntent.intentId, formerIntent);
  broad.storeFor("smsDeliveryAttempts").set("former_attempt", {
    attemptId: "former_attempt",
    churchId: broad.churchId,
    notificationIntentId: formerIntent.intentId,
    status: "delivered",
    outcome: "confirmed",
    createdAt: "2026-09-20T10:01:00.000Z",
  });
  broad.storeFor("notificationIntents").set("unrelated_form_history", {
    ...formerIntent,
    intentId: "unrelated_form_history",
    formId: "another_form",
  });

  const makeResponse = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  });
  const broadHistory = makeResponse();
  await broad.handler.listIntents({
    params: { churchId: broad.churchId },
    query: { formId: broad.form.formId },
  }, broadHistory);
  assert.deepEqual(broadHistory.payload.intents.map(({ intentId }) => intentId), ["former_history"]);
  assert.equal(broadHistory.payload.intents[0].attemptStatus, "delivered");

  const scoped = createHarness({
    requireTeamsEdit: async () => { throw Object.assign(new Error("Teams Edit access required."), { statusCode: 403 }); },
    authorizeAvailabilityForm: async () => ({
      admin: { user: { uid: "worship_manager" } },
      scoped: true,
    }),
    isAvailabilityRecipientInFormScope: async ({ memberId }) => memberId === "current_member",
  });
  scoped.storeFor("teamIntakeForms").set(scoped.form.formId, {
    ...scoped.form,
    purpose: "team_availability",
    teamIds: ["worship"],
  });
  scoped.storeFor("notificationIntents").set("current_history", {
    ...formerIntent,
    intentId: "current_history",
    sourceId: "current_recipient",
    recipientId: "current_recipient",
    memberId: "current_member",
    status: "preview",
  });
  scoped.storeFor("notificationIntents").set(formerIntent.intentId, formerIntent);
  const scopedHistory = makeResponse();
  await scoped.handler.listIntents({
    params: { churchId: scoped.churchId },
    query: { formId: scoped.form.formId },
  }, scopedHistory);
  assert.deepEqual(scopedHistory.payload.intents.map(({ intentId }) => intentId), ["current_history"]);

  const formerPreview = makeResponse();
  await scoped.handler.getIntentPreview({
    params: { churchId: scoped.churchId, intentId: formerIntent.intentId },
    body: {},
  }, formerPreview);
  assert.equal(formerPreview.statusCode, 404);
  const formerSend = makeResponse();
  await scoped.handler.sendIntent({
    params: { churchId: scoped.churchId, intentId: formerIntent.intentId },
    body: { confirmed: true, approvalVersion: "stale" },
  }, formerSend);
  assert.equal(formerSend.statusCode, 404);
  assert.equal(scoped.providerCalls, 0);

  const wrongChurch = makeResponse();
  await broad.handler.listIntents({
    params: { churchId: "church_b" },
    query: { formId: broad.form.formId },
  }, wrongChurch);
  assert.equal(wrongChurch.statusCode, 404);
});

test("a response after reminder preparation blocks dispatch and keeps request history", async () => {
  const h = createHarness();
  const { batch, intent } = await h.preview({ intentType: "availability_reminder" });
  h.storeFor("teamIntakeRecipients").set(h.recipient.recipientId, {
    ...h.recipient, respondedAt: "2026-09-25T12:01:00.000Z", submissionId: "submission_a",
  });
  const dispatch = await h.dispatch(batch.batchId);
  assert.equal(dispatch.statusCode, 200);
  assert.equal(h.providerCalls, 0);
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "preview");
  assert.match(dispatch.payload.batch.recipients[0].exclusionReason, /already responded/i);
});

test("bulk dispatch requires confirmation, sends exactly one selected batch, and blocks concurrent retry", async () => {
  const h = createHarness({ providerSend: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { providerMessageId: "SM_batch", status: "accepted" };
  } });
  const { batch } = await h.preview({ memberIds: [h.member.memberId, "other_member"] });
  const noConfirmation = await h.dispatch(batch.batchId, false);
  assert.equal(noConfirmation.statusCode, 400);
  const results = await Promise.all([h.dispatch(batch.batchId), h.dispatch(batch.batchId)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.storeFor("smsDeliveryAttempts").size, 1);
  assert.equal(h.storeFor("notificationIntents").size, 1);
  const completed = results.find((result) => result.statusCode === 200).payload.batch;
  assert.equal(completed.summary.sent, 1);
  assert.equal(completed.summary.alreadySent, 1);
  assert.equal(completed.summary.awaitingDispatch, 0);
});

test("a newly prepared batch supersedes its prior draft and cannot dispatch through the old batch identity", async () => {
  const h = createHarness();
  const oldBatch = (await h.preview()).batch;
  const newBatch = (await h.preview()).batch;
  assert.notEqual(oldBatch.batchId, newBatch.batchId);
  assert.equal(h.storeFor("notificationBatches").get(oldBatch.batchId).status, "superseded");
  const staleDispatch = await h.dispatch(oldBatch.batchId);
  assert.equal(staleDispatch.statusCode, 409);
  assert.equal(h.providerCalls, 0);
  const currentDispatch = await h.dispatch(newBatch.batchId);
  assert.equal(currentDispatch.statusCode, 200);
  assert.equal(h.providerCalls, 1);
});

test("a concurrent approval makes one provider call and stores one attempt", async () => {
  const h = createHarness({ providerSend: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { providerMessageId: "SM_concurrent", status: "accepted" };
  } });
  const { intent } = await h.preview();
  const results = await Promise.all([h.send(intent.intentId), h.send(intent.intentId)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.storeFor("smsDeliveryAttempts").size, 1);
  assert.equal(h.storeFor("notificationDeliveries").size, 1);
});

test("an approved message version is fixed and source or phone changes require a new preview", async () => {
  const h = createHarness();
  const { intent } = await h.preview();
  const firstVersion = intent.approvalSnapshot.approvalVersion;
  h.storeFor("churches").set(h.churchId, { churchId: h.churchId, name: "Changed Church" });
  const stale = await h.send(intent.intentId);
  assert.equal(stale.statusCode, 409);
  assert.equal(h.providerCalls, 0);
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).approvalSnapshot, null);

  const previewRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await h.handler.getIntentPreview({ params: { churchId: h.churchId, intentId: intent.intentId }, body: {} }, previewRes);
  assert.equal(previewRes.statusCode, 200);
  assert.notEqual(previewRes.payload.preview.approvalVersion, firstVersion);
  assert.match(previewRes.payload.preview.message, /Changed Church/);

  h.storeFor("teamRosterMembers").set(h.member.memberId, { ...h.member, phoneNumber: "+14155550199" });
  const phoneChanged = await h.send(intent.intentId);
  assert.equal(phoneChanged.statusCode, 400);
  assert.equal(h.providerCalls, 0);
});

test("manual send responses and history projections never return private message or token fields", async () => {
  const h = createHarness();
  const { intent } = await h.preview();
  const sent = await h.send(intent.intentId);
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.payload.intent.message, undefined);
  assert.equal(sent.payload.intent.responseUrl, undefined);
  assert.doesNotMatch(JSON.stringify(sent.payload), /secure-token/);

  const history = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await h.handler.listIntents({ params: { churchId: h.churchId }, query: { formId: h.form.formId } }, history);
  assert.equal(history.payload.intents[0].message, undefined);
  assert.equal(history.payload.intents[0].responseUrl, undefined);
  assert.doesNotMatch(JSON.stringify(history.payload), /secure-token/);
});

test("Firestore transaction claims prevent concurrent sends across requests", async () => {
  const h = createHarness({ firestore: true, providerSend: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { providerMessageId: "SM_firestore_race", status: "accepted" };
  } });
  const { intent } = await h.preview();
  const results = await Promise.all([h.send(intent.intentId), h.send(intent.intentId)]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(h.providerCalls, 1);
  assert.equal(h.storeFor("smsDeliveryAttempts").size, 1);
});

test("opt-out and changed source records block dispatch after preview", async () => {
  const h = createHarness();
  const { intent } = await h.preview();
  const consentId = smsConsentIdForChurchPhone(h.churchId, h.phoneNumber);
  h.storeFor("smsConsents").set(consentId, {
    ...h.storeFor("smsConsents").get(consentId), status: "opted_out", optedOutAt: "now",
  });
  const optedOut = await h.send(intent.intentId);
  assert.equal(optedOut.statusCode, 400);
  assert.equal(h.providerCalls, 0);

  const changedSource = createHarness();
  const { intent: second } = await changedSource.preview({ intentType: "availability_reminder" });
  changedSource.storeFor("teamIntakeForms").set(changedSource.form.formId, { ...changedSource.form, active: false });
  const changed = await changedSource.send(second.intentId);
  assert.equal(changed.statusCode, 409);
  assert.equal(changedSource.providerCalls, 0);
});

test("permission is checked again immediately before the provider send", async () => {
  let checks = 0;
  const h = createHarness({ requireTeamsEdit: async () => {
    checks += 1;
    if (checks > 3) throw Object.assign(new Error("Teams edit permission is required."), { statusCode: 403 });
    return { user: { uid: "admin_a" } };
  } });
  const { intent } = await h.preview();
  const result = await h.send(intent.intentId);
  assert.equal(result.statusCode, 403);
  assert.equal(checks, 4);
  assert.equal(h.providerCalls, 0);
  assert.equal(h.storeFor("smsDeliveryAttempts").values().next().value.outcome, "not_sent");
});

test("provider timeout is recorded as uncertain and cannot be retried", async () => {
  const h = createHarness({ providerSend: async () => {
    throw Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" });
  } });
  const { intent } = await h.preview();
  const first = await h.send(intent.intentId);
  const second = await h.send(intent.intentId);
  const savedIntent = h.storeFor("notificationIntents").get(intent.intentId);
  const attempt = [...h.storeFor("smsDeliveryAttempts").values()][0];
  assert.equal(first.statusCode, 202);
  assert.equal(first.payload.outcome, "unknown");
  assert.equal(second.statusCode, 409);
  assert.equal(savedIntent.status, "unknown");
  assert.equal(attempt.status, "pending");
  assert.equal(attempt.outcome, "unknown");
  assert.equal(attempt.failureCode, "ETIMEDOUT");
  assert.equal(attempt.failureMessage, "socket timed out");
  assert.equal(h.providerCalls, 1);
});

test("Twilio 21609 records its provider message and code as a definitive rejection", async () => {
  const h = createHarness({ providerSend: async () => {
    throw Object.assign(new Error("A statusCallback URL must be publicly accessible."), {
      code: 21609,
      statusCode: 400,
      definitiveRejection: true,
    });
  } });
  const { intent } = await h.preview();
  const result = await h.send(intent.intentId);
  const attempt = [...h.storeFor("smsDeliveryAttempts").values()][0];
  assert.equal(result.statusCode, 502);
  assert.equal(result.payload.outcome, "failed");
  assert.equal(attempt.status, "failed");
  assert.equal(attempt.outcome, "failed");
  assert.equal(attempt.failureCode, "21609");
  assert.equal(attempt.failureMessage, "A statusCallback URL must be publicly accessible.");
});

test("interrupted bulk dispatch marks in-flight attempts uncertain and can resume only untouched recipients", async () => {
  const h = createHarness();
  const intent = createNotificationIntent({
    churchId: h.churchId, intentType: "availability_request", sourceType: "team_intake_recipient",
    sourceId: h.recipient.recipientId, formId: h.form.formId, recipientId: h.recipient.recipientId,
    memberId: h.member.memberId, idempotencyKey: "interrupted-intent", message: "Preview only", now: "2026-09-25T10:00:00.000Z",
  });
  intent.intentId = "intent_interrupted";
  intent.batchId = "batch_interrupted";
  intent.status = "sending";
  intent.sendStartedAt = "2020-01-01T00:00:00.000Z";
  intent.attemptId = "attempt_interrupted";
  h.storeFor("notificationIntents").set(intent.intentId, intent);
  h.storeFor("smsDeliveryAttempts").set(intent.attemptId, { attemptId: intent.attemptId, churchId: h.churchId, notificationIntentId: intent.intentId, memberId: intent.memberId, recipientId: intent.recipientId, sourceId: intent.sourceId, status: "pending" });
  h.storeFor("notificationBatches").set("batch_interrupted", {
    batchId: "batch_interrupted", churchId: h.churchId, formId: h.form.formId,
    intentType: "availability_request", status: "dispatching", dispatchStartedAt: "2020-01-01T00:00:00.000Z",
    reviewVersion: "review-interrupted",
    intentIds: [intent.intentId], selectedMemberIds: [h.member.memberId],
    recipients: [{ memberId: h.member.memberId, memberName: "Rae Rivera", intentId: intent.intentId, status: "sending" }],
  });
  const res = await h.dispatch("batch_interrupted");
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.batch.status, "partial");
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "unknown");
  assert.equal(h.storeFor("smsDeliveryAttempts").get(intent.attemptId).outcome, "unknown");
  assert.equal(h.providerCalls, 0);
});

test("automatic dispatch is blocked globally and event adapters only record previews", async () => {
  const h = createHarness();
  assert.equal(AUTOMATIC_NOTIFICATION_SENDS_DISABLED, true);
  await assert.rejects(h.handler.dispatchAutomatically(), /disabled by the server/);
  const { intent } = await h.preview();
  await h.handler.saveEventIntents({
    churchId: h.churchId,
    schedule: h.schedule,
    intentType: "assignment_confirmation",
    entries: [{ memberId: h.member.memberId, occurrenceId: "occ_1", cellKey: "position::0" }],
  });
  assert.equal(intent.status, "preview");
  assert.equal(h.providerCalls, 0);
});

test("shared intents cover every requested volunteer notification event", () => {
  assert.deepEqual(NOTIFICATION_INTENT_TYPES, [
    "availability_request", "availability_reminder", "assignment_notification",
    "assignment_confirmation", "schedule_change", "replacement_request",
  ]);
  for (const intentType of NOTIFICATION_INTENT_TYPES) {
    assert.equal(createNotificationIntent({
      churchId: "church_a", intentType, sourceType: "team_schedule", sourceId: "schedule_a",
      memberId: "member_a", idempotencyKey: `${intentType}|one`, message: "Preview only", now: "now",
    }).status, "preview");
  }
});

test("notification intent creation retains the original declining assignment holder", () => {
  const intent = createNotificationIntent({
    churchId: "church_a", intentType: "replacement_request", sourceType: "team_schedule",
    sourceId: "schedule_a", memberId: "replacement_member", originalMemberId: "declining_member",
    idempotencyKey: "replacement|one", message: "Preview only", now: "now",
  });
  assert.equal(intent.originalMemberId, "declining_member");
});

test("replacement invitations are manually prepared, specific, and limited to one candidate per vacancy", async () => {
  const h = createHarness();
  const invoke = async (memberId) => {
    const res = h.handler.prepareReplacementInvitation
      ? { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } }
      : null;
    await h.handler.prepareReplacementInvitation({
      params: { churchId: h.churchId },
      body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId },
    }, res);
    return res;
  };
  const first = await invoke(h.member.memberId);
  assert.equal(first.statusCode, 200, first.payload?.errorMessage);
  assert.match(first.payload.intent.message, /Worship for Sunday service on Sun, Oct 4/);
  assert.match(first.payload.intent.message, /schedule changes only after they assign you/i);
  assert.equal(h.providerCalls, 0);
  const other = await invoke("member_b");
  assert.equal(other.statusCode, 409);
  const closed = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await h.handler.resolveReplacementInvitation({
    params: { churchId: h.churchId, intentId: first.payload.intent.intentId },
    body: {},
  }, closed);
  assert.equal(closed.statusCode, 200);
  const nextCandidate = await invoke("member_b");
  assert.equal(nextCandidate.statusCode, 200, nextCandidate.payload?.errorMessage);
  assert.equal(h.schedule.assignments.occ_1, undefined, "preparing an invite never assigns the candidate");
  assert.equal(h.providerCalls, 0);
});

test("declined assignments retain their holder, reject self-invites, and recheck vacancy and candidate state at send", async () => {
  const prepare = async (h, memberId) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.prepareReplacementInvitation({ params: { churchId: h.churchId }, body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId } }, res);
    return res;
  };
  const declinedSchedule = (h) => h.storeFor("teamSchedules").set(h.schedule.scheduleId, {
    ...h.schedule,
    assignments: { occ_1: { "position::0": { primaryMemberId: h.member.memberId } } },
    responses: { occ_1: { "position::0": { memberId: h.member.memberId, response: "declined" } } },
  });

  const h = createHarness();
  declinedSchedule(h);
  const selfInvite = await prepare(h, h.member.memberId);
  assert.equal(selfInvite.statusCode, 409);
  const invitation = await prepare(h, "member_b");
  assert.equal(invitation.statusCode, 200, invitation.payload?.errorMessage);
  const saved = h.storeFor("notificationIntents").get(invitation.payload.intent.intentId);
  assert.equal(saved.originalMemberId, h.member.memberId);
  assert.equal((await h.send(saved.intentId)).statusCode, 200);
  assert.equal(h.providerCalls, 1);

  for (const changedSchedule of [
    (current, candidateId) => ({ ...current, assignments: { occ_1: { "position::0": { primaryMemberId: candidateId } } } }),
    (current) => ({ ...current, responses: { occ_1: { "position::0": { memberId: current.assignments.occ_1["position::0"].primaryMemberId, response: "accepted" } } } }),
  ]) {
    const changed = createHarness();
    declinedSchedule(changed);
    const draft = await prepare(changed, "member_b");
    assert.equal(draft.statusCode, 200);
    const source = changed.storeFor("teamSchedules").get(changed.schedule.scheduleId);
    changed.storeFor("teamSchedules").set(changed.schedule.scheduleId, changedSchedule(source, "member_b"));
    const result = await changed.send(draft.payload.intent.intentId);
    assert.equal(result.statusCode, 409);
    assert.equal(changed.providerCalls, 0);
  }

  const unavailable = createHarness();
  declinedSchedule(unavailable);
  const draft = await prepare(unavailable, "member_b");
  assert.equal(draft.statusCode, 200);
  unavailable.storeFor("teamRosterMembers").set("member_b", { ...unavailable.storeFor("teamRosterMembers").get("member_b"), serviceAvailability: { occ_1: "unavailable" } });
  assert.equal((await unavailable.send(draft.payload.intent.intentId)).statusCode, 409);
  assert.equal(unavailable.providerCalls, 0);
});

test("concurrent replacement preparation claims one vacancy and failed preparation releases its claim", async () => {
  const invoke = async (h, memberId) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.prepareReplacementInvitation({ params: { churchId: h.churchId }, body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId } }, res);
    return res;
  };
  const h = createHarness();
  const outcomes = await Promise.all([invoke(h, h.member.memberId), invoke(h, "member_b")]);
  assert.deepEqual(outcomes.map((item) => item.statusCode).sort(), [200, 409]);
  assert.equal(h.storeFor("notificationIntents").size, 1);

  let candidateChecks = 0;
  const interrupted = createHarness({ validateReplacementCandidate: async () => {
    candidateChecks += 1;
    if (candidateChecks === 2) throw Object.assign(new Error("Eligibility changed during preview."), { statusCode: 409 });
    return { schedule: interrupted.schedule, member: interrupted.member, occurrence: interrupted.schedule.occurrences[0], church: { churchId: interrupted.churchId, name: "First Church" }, position: { name: "Worship" }, holderId: "" };
  } });
  const failed = await invoke(interrupted, interrupted.member.memberId);
  assert.equal(failed.statusCode, 409);
  const claim = [...interrupted.storeFor("notificationBatches").values()][0];
  assert.equal(claim.status, "released");
  assert.equal(interrupted.storeFor("notificationIntents").size, 0);
});

for (const firestore of [false, true]) {
  test(`send claim checkpoints its attempt identity before provider work (${firestore ? "transaction fake" : "memory"})`, async () => {
    const h = createHarness({ firestore, providerSend: async () => {
      const sending = [...h.storeFor("notificationIntents").values()].find((intent) => intent.status === "sending");
      assert.ok(sending.attemptId);
      const attempt = h.storeFor("smsDeliveryAttempts").get(sending.attemptId);
      assert.equal(attempt.notificationIntentId, sending.intentId);
      assert.equal(attempt.status, "pending");
      return { providerMessageId: "SM_checkpoint", status: "accepted" };
    } });
    const { batch } = await h.preview();
    assert.equal((await h.dispatch(batch.batchId)).statusCode, 200);
    assert.equal(h.providerCalls, 1);
  });
}

test("availability dispatch cannot recover another church or feature's stale intent", async () => {
  for (const foreign of [{ churchId: "church_b" }, { sourceType: "team_schedule" }, { batchId: "other_batch" }]) {
    const h = createHarness();
    const { batch, intent } = await h.preview();
    h.storeFor("notificationIntents").set(intent.intentId, {
      ...intent, status: "sending", sendStartedAt: "2020-01-01T00:00:00.000Z", ...foreign,
    });
    const res = await h.dispatch(batch.batchId);
    assert.equal(res.statusCode, 200);
    assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "sending");
    assert.equal(h.providerCalls, 0);
  }
});

test("batch consent withdrawal or expired individual approval never calls provider", async () => {
  for (const invalidate of [
    (h, intent) => { intent.approvalSnapshot.expiresAt = Date.now() - 1; },
    (h) => h.storeFor("smsConsents").delete(smsConsentIdForChurchPhone(h.churchId, h.phoneNumber)),
    (h) => { h.storeFor("smsConsents").get(smsConsentIdForChurchPhone(h.churchId, h.phoneNumber)).status = "pending"; },
  ]) {
    const h = createHarness({ firestore: true });
    const { batch, intent } = await h.preview();
    invalidate(h, intent);
    const result = await h.dispatch(batch.batchId);
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.batch.status, "partial");
    assert.equal(result.payload.batch.recipients[0].eligible, false);
    assert.equal(h.providerCalls, 0);
  }
});


test("accepted send with repeated intent-write failures retains SID and recovers without another provider call", async () => {
  let fail = true;
  const h = createHarness({ beforeSetDoc: async (collection, _id, data) => {
    if (fail && collection === "notificationIntents" && data.status === "sent") throw new Error("intent write unavailable");
  } });
  const { intent } = await h.preview();
  assert.equal((await h.send(intent.intentId)).statusCode, 500);
  const attempt = [...h.storeFor("smsDeliveryAttempts").values()][0];
  assert.equal(attempt.providerMessageId, "SM1");
  assert.equal(attempt.outcome, "confirmed");
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "sending");
  assert.equal((await h.send(intent.intentId)).statusCode, 409);
  fail = false;
  h.storeFor("notificationIntents").get(intent.intentId).sendStartedAt = "2020-01-01";
  const res = { status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await h.handler.listIntents({ params: { churchId: h.churchId }, query: { formId: h.form.formId } }, res);
  assert.equal(res.payload.intents[0].status, "sent");
  assert.equal((await h.send(intent.intentId)).statusCode, 409);
  assert.equal(h.providerCalls, 1);
});

for (const firestore of [false, true]) {
  test(`callback before send-result persistence wins over provider timeout (${firestore ? "transaction" : "memory"})`, async () => {
    let h;
    h = createHarness({ firestore, providerSend: async ({ statusCallbackUrl }) => {
      const handler = createSmsStatusWebhookHandler({
        getDoc: h.getDoc, requireFirestore: () => firestore ? h.db : null,
        queryDocs: async () => [], nowIso: () => new Date().toISOString(),
        setDoc: async (collection, id, patch) => h.storeFor(collection).set(id, { ...h.storeFor(collection).get(id), ...patch }),
        validateSignature: () => true, normalizeStatus: (status) => status,
        getAuthToken: () => "test", getCallbackUrl: () => statusCallbackUrl,
      });
      const res = { status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
      await handler({ headers: {}, body: { MessageSid: "SMearly", MessageStatus: "delivered", To: h.phoneNumber, AccountSid: "AC1" } }, res);
      assert.equal(res.payload.updated, true);
      throw Object.assign(new Error("request timed out after acceptance"), { code: 21609 });
    } });
    const { intent } = await h.preview();
    const sent = await h.send(intent.intentId);
    assert.equal(sent.payload.success, true);
    assert.equal(sent.payload.attempt.status, "delivered");
    assert.equal(sent.payload.attempt.callbackToken, undefined);
    assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "sent");
    assert.equal((await h.send(intent.intentId)).statusCode, 409);
    assert.equal(h.providerCalls, 1);
  });
}

test("arbitrary five-digit provider code remains unknown and blocked", async () => {
  const h = createHarness({ providerSend: async () => { throw Object.assign(new Error("lost reply"), { code: 21609 }); } });
  const { intent } = await h.preview();
  assert.equal((await h.send(intent.intentId)).payload.outcome, "unknown");
  assert.equal((await h.send(intent.intentId)).statusCode, 409);
  assert.equal(h.providerCalls, 1);
});


for (const firestore of [false, true]) {
  test(`older accepted-attempt fence blocks another deliberately prepared claim (${firestore ? "transaction" : "memory"})`, async () => {
    const h = createHarness({ firestore });
    const { intent } = await h.preview();
    h.storeFor("notificationIntents").get(intent.intentId).providerAcceptedAttemptId = "older";
    assert.equal((await h.send(intent.intentId)).statusCode, 409);
    assert.equal(h.providerCalls, 0);
  });
}


for (const firestore of [false, true]) {
  test(`replacement preview cleanup cannot delete an intent accepted concurrently (${firestore ? "transaction" : "memory"})`, async () => {
    let h; let interleaved = false;
    h = createHarness({ firestore, beforeSetDoc: async (collection, id, data) => {
      if (collection !== "notificationIntents" || !data.approvalSnapshot || interleaved) return;
      interleaved = true;
      h.storeFor(collection).set(id, { ...h.storeFor(collection).get(id), ...data });
      assert.equal((await h.send(id)).payload.success, true);
      throw new Error("preview response persistence failed after concurrent send");
    } });
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.prepareReplacementInvitation({ params: { churchId: h.churchId }, body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId: h.member.memberId } }, res);
    assert.equal(res.statusCode, 500);
    const retained = [...h.storeFor("notificationIntents").values()][0];
    assert.equal(retained.status, "sent");
    assert.equal(retained.providerMessageId, "SM1");
    assert.equal((await h.send(retained.intentId)).statusCode, 409);
    assert.equal(h.providerCalls, 1);
  });
}
