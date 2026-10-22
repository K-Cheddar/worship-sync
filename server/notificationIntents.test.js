import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  AUTOMATIC_NOTIFICATION_SENDS_DISABLED,
  createNotificationIntentHandlers,
  createNotificationIntent,
  NOTIFICATION_INTENT_TYPES,
} from "./notificationIntents.js";
import { createSmsStatusWebhookHandler } from "./smsStatusWebhook.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";
import { measureSmsMessage } from "./smsMessage.js";
import {
  getScheduleAssignedMemberIds,
  getScheduleMemberAssignments,
} from "./scheduleInitialSms.js";
import { approveReviewedScheduleBatch } from "./notificationBatches.js";

const createHarness = ({
  providerSend,
  firestore = false,
  firestoreDb = null,
  requireTeamsEdit,
  authorizeSchedule,
  authorizeScheduleActor,
  authorizeCustomMember,
  authorizeMessagingHistory,
  customSmsReady = false,
  scheduleBulkDispatchReady = false,
  assertCsrf,
  authorizeAvailabilityForm,
  isAvailabilityRecipientInFormScope,
  validateReplacementCandidate,
  beforeSetDoc,
  resolveAvailabilityNotificationContext,
  resolveScheduleNotificationContext,
  logger = { info() {}, warn() {}, error() {} },
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
  storeFor("teamPositions").set("position", { positionId: "position", churchId, teamId: "team_a", name: "Worship" });
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
    collection: (collection) => {
      const filters = [];
      let ordering = null;
      let maxResults = 100;
      const query = {
        doc: (id) => ({ collection, id }),
        where(field, op, value) { filters.push({ field, op, value }); return query; },
        orderBy(field, direction) { ordering = { field, direction }; return query; },
        limit(value) { maxResults = value; return query; },
        async get() {
          let rows = [...storeFor(collection).entries()].map(([id, data]) => ({ id, ...data }));
          rows = rows.filter((item) => filters.every(({ field, op, value }) =>
            op === "in" ? value.includes(item[field]) : op === ">" ? item[field] > value : item[field] === value));
          if (ordering) {
            const direction = ordering.direction === "desc" ? -1 : 1;
            rows.sort((left, right) => (left[ordering.field] - right[ordering.field]) * direction);
          }
          return { docs: rows.slice(0, maxResults).map((row) => ({ id: row.id, data: () => {
            const { id: _id, ...data } = row;
            return data;
          } })) };
        },
      };
      return query;
    },
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
  const getDoc = async (collection, id) => {
    if (firestoreDb) {
      const snapshot = await firestoreDb.collection(collection).doc(id).get();
      return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    }
    return storeFor(collection).get(id) || null;
  };
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
    assertCsrf: assertCsrf || (async () => undefined),
    createId: (prefix) => `${prefix}_${++nextId}`,
    getDoc,
    deleteDoc: async (collection, id) => {
      storeFor(collection).delete(id);
      if (firestoreDb) await firestoreDb.collection(collection).doc(id).delete();
    },
    hashValue,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    nowIso,
    queryDocs: async (collection, filters = []) => [...storeFor(collection).values()].filter((item) => filters.every((filter) => filter.op === "in" ? filter.value.includes(item[filter.field]) : item[filter.field] === filter.value)),
    requireFirestore: () => firestoreDb || (firestore ? db : null),
    requireTeamsEdit: requireTeamsEdit || (async () => ({ user: { uid: "admin_a" } })),
    ...(authorizeCustomMember ? { authorizeCustomMember } : {}),
    ...(authorizeMessagingHistory ? { authorizeMessagingHistory } : {}),
    customSmsReady,
    ...(authorizeSchedule ? { authorizeSchedule } : {}),
    authorizeScheduleActor: authorizeScheduleActor || (async ({ churchId: targetChurchId, scheduleId }) => ({
      admin: { user: { uid: "admin_a" } },
      scoped: false,
      schedule: await getDoc("teamSchedules", scheduleId),
      churchId: targetChurchId,
    })),
    scheduleBulkDispatchReady,
    logger,
    authorizeAvailabilityForm: authorizeAvailabilityForm || (async () => {
      throw Object.assign(new Error("Availability form access required."), { statusCode: 403 });
    }),
    isAvailabilityRecipientInFormScope: isAvailabilityRecipientInFormScope || (async () => true),
    getSmsConsentForChurchPhone: async (id, phone) => id === churchId && phone === phoneNumber
      ? getDoc("smsConsents", smsConsentIdForChurchPhone(id, phone))
      : null,
    prepareAvailabilityNotificationRecipients: async ({ memberIds, purpose, audienceType }) => {
      const currentForm = storeFor("teamIntakeForms").get(form.formId);
      return {
        form: currentForm,
        results: memberIds.map((memberId) => {
          const currentRecipient = storeFor("teamIntakeRecipients").get(recipient.recipientId);
          const exclusionReason = memberId !== member.memberId
            ? "Volunteer is outside this form's team scope."
            : currentRecipient?.revokedAt
              ? "Request was revoked."
              : currentRecipient?.respondedAt && !(purpose === "availability_request" && audienceType === "specific")
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
    resolveAvailabilityNotificationContext: resolveAvailabilityNotificationContext || (async (intent) => ({
      form: storeFor("teamIntakeForms").get(intent.formId),
      recipient: storeFor("teamIntakeRecipients").get(intent.recipientId),
      member: storeFor("teamRosterMembers").get(intent.memberId),
      church: storeFor("churches").get(churchId),
      publicUrl: "https://www.worshipsync.net/a/secure-token",
    })),
    resolveScheduleNotificationContext: resolveScheduleNotificationContext || (async (intent) => {
      const currentSchedule = storeFor("teamSchedules").get(intent.sourceId);
      const currentMember = storeFor("teamRosterMembers").get(intent.memberId);
      if (intent.intentType === "schedule_initial_notification") return {
        schedule: currentSchedule,
        member: currentMember,
        church: storeFor("churches").get(churchId),
        assignments: getScheduleMemberAssignments({ schedule: currentSchedule, memberId: intent.memberId, positions: [...storeFor("teamPositions").values()] }),
        serviceTimeZone: "America/Los_Angeles",
        responseUrl: "https://www.worshipsync.net/schedule-response/secure-token",
      };
      return {
        schedule: currentSchedule,
        member: currentMember,
        church: storeFor("churches").get(churchId),
        occurrence: currentSchedule.occurrences[0],
        serviceName: "Sunday service",
        positionName: "Worship",
        responseUrl: "https://www.worshipsync.net/schedule-response/secure-token",
      };
    }),
    prepareScheduleInitialSmsRecipients: async ({ churchId: targetChurchId, schedule: currentSchedule }) =>
      getScheduleAssignedMemberIds(currentSchedule).map((memberId) => {
        const currentMember = storeFor("teamRosterMembers").get(memberId);
        const assignments = getScheduleMemberAssignments({ schedule: currentSchedule, memberId, positions: [...storeFor("teamPositions").values()] });
        return {
          memberId,
          member: currentMember,
          memberName: `${currentMember?.firstName || ""} ${currentMember?.lastName || ""}`.trim() || "Roster member",
          assignments,
          exclusionKind: "",
          eligibilityStatus: currentMember?.archivedAt ? "no_mobile" : "enabled",
          phoneNumber: currentMember?.archivedAt ? "" : currentMember?.phoneNumber || "",
          eligible: Boolean(currentMember && !currentMember.archivedAt && assignments.length),
          exclusionReason: currentMember?.archivedAt ? "Archived roster members cannot receive schedule SMS." : "",
        };
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
      if (firestoreDb) await firestoreDb.collection(collection).doc(id).set(data, { merge });
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
    return { res, batch, intent: intentId ? await getDoc("notificationIntents", intentId) : null };
  };
  const send = async (intentId, targetChurchId = churchId) => {
    const res = makeResponse();
    const intent = await getDoc("notificationIntents", intentId);
    await handler.sendIntent({ params: { churchId: targetChurchId, intentId }, body: { confirmed: true, approvalVersion: intent?.approvalSnapshot?.approvalVersion || "" } }, res);
    return res;
  };
  const dispatch = async (batchId, confirmed = true, acknowledgedUncertainMemberIds = []) => {
    const res = makeResponse();
    const batch = await getDoc("notificationBatches", batchId);
    await handler.dispatchAvailabilityBatch({ params: { churchId, batchId }, body: { confirmed, approvalVersion: batch?.reviewVersion || "", acknowledgedUncertainMemberIds } }, res);
    return res;
  };
  const abandon = async (batchId) => {
    const res = makeResponse();
    await handler.abandonAvailabilityBatch({ params: { churchId, batchId }, body: {} }, res);
    return res;
  };
  const seedFirestore = async () => {
    if (!firestoreDb) throw new Error("A Firestore database is required to seed the emulator harness.");
    for (const [collection, rows] of collections) {
      for (const [id, data] of rows) await firestoreDb.collection(collection).doc(id).set(data);
    }
  };
  return { collections, storeFor, getDoc, db, handler, makeResponse, preview, send, dispatch, abandon, seedFirestore, schedule, form, recipient, member, phoneNumber, churchId, get providerCalls() { return providerCalls; } };
};

for (const firestore of [false, true]) {
  test(`custom message uses reviewed intents and a separate durable operation (${firestore ? "transaction fake" : "memory"})`, async () => {
    const h = createHarness({ firestore, customSmsReady: true });
    const prepare = async (requestKey) => {
      const res = h.makeResponse();
      await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
        memberIds: [h.member.memberId], message: "Practice Friday.", requestKey,
      } }, res);
      assert.equal(res.statusCode, 200, res.payload?.errorMessage);
      return res.payload.batch;
    };
    const first = await prepare("operation-one");
    assert.equal(h.providerCalls, 0);
    assert.equal(first.message, "Practice Friday. Reply STOP to opt out.");
    assert.equal(first.summary.eligible, 1);
    assert.equal((await prepare("operation-one")).batchId, first.batchId);
    const sent = await h.dispatch(first.batchId);
    assert.equal(sent.statusCode, 200, sent.payload?.errorMessage);
    assert.equal(h.providerCalls, 1);
    assert.equal((await h.dispatch(first.batchId)).statusCode, 409);
    assert.equal(h.providerCalls, 1);
    const second = await prepare("operation-two");
    assert.notEqual(second.batchId, first.batchId);
    assert.equal((await h.dispatch(second.batchId)).statusCode, 200);
    assert.equal(h.providerCalls, 2);
    const history = h.makeResponse();
    await h.handler.listMessageHistory({ params: { churchId: h.churchId }, query: {} }, history);
    assert.equal(history.statusCode, 200, history.payload?.errorMessage);
    assert.equal(history.payload.entries.filter((entry) => entry.messageType === "custom_message").length, 2);
  });
}

test("custom message production gate blocks provider calls and foreign or archived members", async () => {
  const h = createHarness();
  const prepare = async (memberId) => {
    const res = h.makeResponse();
    await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
      memberIds: [memberId], message: "Practice Friday.", requestKey: randomUUID(),
    } }, res);
    return res;
  };
  const batch = (await prepare(h.member.memberId)).payload.batch;
  const gated = await h.dispatch(batch.batchId);
  assert.equal(gated.statusCode, 503);
  assert.equal((await h.send(batch.intentIds[0])).statusCode, 503);
  assert.equal(h.providerCalls, 0);
  h.storeFor("teamRosterMembers").set("foreign", { memberId: "foreign", churchId: "other", phoneNumber: h.phoneNumber });
  assert.equal((await prepare("foreign")).statusCode, 403);
  h.storeFor("teamRosterMembers").set("archived", { memberId: "archived", churchId: h.churchId, archivedAt: "now", phoneNumber: h.phoneNumber });
  assert.equal((await prepare("archived")).statusCode, 403);
});

test("custom message provider uncertainty fences replay of the same operation", async () => {
  const h = createHarness({ customSmsReady: true, providerSend: async () => {
    throw new Error("provider timeout");
  } });
  const prepared = h.makeResponse();
  await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
    memberIds: [h.member.memberId], message: "Practice Friday.", requestKey: "unknown-outcome",
  } }, prepared);
  assert.equal(prepared.statusCode, 200, prepared.payload?.errorMessage);
  const first = await h.dispatch(prepared.payload.batch.batchId);
  assert.equal(first.statusCode, 200);
  assert.equal(h.providerCalls, 1);
  assert.equal(first.payload.batch.summary.uncertain, 1);
  assert.equal((await h.dispatch(prepared.payload.batch.batchId)).statusCode, 200);
  assert.equal(h.providerCalls, 1);
});

test("custom review excludes members without consent or after STOP and sends nothing", async () => {
  const h = createHarness({ customSmsReady: true });
  const consentId = smsConsentIdForChurchPhone(h.churchId, h.phoneNumber);
  h.storeFor("smsConsents").delete(consentId);
  const prepare = async (key) => {
    const res = h.makeResponse();
    await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
      memberIds: [h.member.memberId], message: "Practice Friday.", requestKey: key,
    } }, res);
    return res;
  };
  const withoutConsent = await prepare("missing-consent");
  assert.equal(withoutConsent.statusCode, 200, withoutConsent.payload?.errorMessage);
  assert.equal(withoutConsent.payload.batch.summary.eligible, 0);
  h.storeFor("smsConsents").set(consentId, { consentId, churchId: h.churchId, phoneNumber: h.phoneNumber,
    status: "opted_out", optedOutAt: new Date().toISOString() });
  const optedOut = await prepare("opted-out");
  assert.equal(optedOut.statusCode, 200, optedOut.payload?.errorMessage);
  assert.equal(optedOut.payload.batch.summary.eligible, 0);
  assert.equal(h.providerCalls, 0);
});

test("custom review keeps two roster identities sharing one consented phone", async () => {
  const h = createHarness({ customSmsReady: true });
  const res = h.makeResponse();
  await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
    memberIds: [h.member.memberId, "member_b"], message: "Practice Friday.", requestKey: "shared-phone",
  } }, res);
  assert.equal(res.statusCode, 200, res.payload?.errorMessage);
  assert.equal(res.payload.batch.summary.eligible, 2);
  assert.equal(new Set(res.payload.batch.intentIds).size, 2);
  assert.equal((await h.dispatch(res.payload.batch.batchId)).statusCode, 200);
  assert.equal(h.providerCalls, 2);
});

test("unified history redacts form links while showing authorized custom content", async () => {
  const h = createHarness({ customSmsReady: true });
  const form = await h.preview();
  assert.equal(form.res.statusCode, 200, form.res.payload?.errorMessage);
  const custom = h.makeResponse();
  await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
    memberIds: [h.member.memberId], message: "Practice Friday.", requestKey: "history-custom",
  } }, custom);
  assert.equal(custom.statusCode, 200, custom.payload?.errorMessage);
  await h.dispatch(custom.payload.batch.batchId);
  const response = h.makeResponse();
  await h.handler.listMessageHistory({ params: { churchId: h.churchId }, query: {} }, response);
  assert.equal(response.statusCode, 200, response.payload?.errorMessage);
  const entries = response.payload.entries;
  assert.equal(entries.find((entry) => entry.messageType === "custom_message")?.summary, "Practice Friday. Reply STOP to opt out.");
  assert.doesNotMatch(JSON.stringify(entries.find((entry) => entry.messageType === "availability_request")), /secure-token/);
});

test("scoped history does not reveal another operator's custom message", async () => {
  let actorUid = "admin_a";
  const h = createHarness({ customSmsReady: true,
    authorizeCustomMember: async () => ({ admin: { user: { uid: actorUid } }, scoped: true }),
    authorizeMessagingHistory: async () => ({ admin: { user: { uid: actorUid } }, scoped: true }),
  });
  const prepared = h.makeResponse();
  await h.handler.prepareCustomBatch({ params: { churchId: h.churchId }, body: {
    memberIds: [h.member.memberId], message: "Private practice note.", requestKey: "scoped-note",
  } }, prepared);
  assert.equal(prepared.statusCode, 200, prepared.payload?.errorMessage);
  assert.equal((await h.dispatch(prepared.payload.batch.batchId)).statusCode, 200);
  actorUid = "other_editor";
  const history = h.makeResponse();
  await h.handler.listMessageHistory({ params: { churchId: h.churchId }, query: {} }, history);
  assert.equal(history.statusCode, 200, history.payload?.errorMessage);
  assert.equal(history.payload.entries.length, 0);
});

for (const firestore of [false, true]) {
  test(`grouped schedule SMS is one reviewed intent per current roster member and remains gated (${firestore ? "transaction fake" : "memory"})`, async () => {
    const h = createHarness({ firestore });
    h.schedule.published = true;
    h.schedule.occurrences = [
      { occurrenceId: "occ_1", name: "Sunday service", serviceDate: "2026-10-04", startsAt: "2026-10-04T15:00:00.000Z" },
      { occurrenceId: "occ_2", name: "Combined service", serviceDate: "2026-10-11", startsAt: "2026-10-11T15:00:00.000Z", serviceIds: ["early", "late"], groupId: "combined" },
    ];
    h.storeFor("teamPositions").set("audio", { positionId: "audio", churchId: h.churchId, teamId: "team_a", name: "Audio" });
    const other = { memberId: "member_b", churchId: h.churchId, firstName: "Casey", lastName: "Candidate", phoneNumber: h.phoneNumber };
    h.storeFor("teamRosterMembers").set(other.memberId, other);
    h.schedule.assignments = {
      occ_1: { "position::0": h.member.memberId, "position::1": h.member.memberId, "audio::0": h.member.memberId },
      occ_2: { "position::0": h.member.memberId, "audio::0": other.memberId },
    };
    const getRecipients = async () => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
      await h.handler.getScheduleInitialSmsRecipients({ params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId } }, res);
      return res;
    };
    const recipients = await getRecipients();
    assert.equal(recipients.statusCode, 200);
    assert.equal(recipients.payload.historyComplete, true);
    assert.equal(recipients.payload.recipients.length, 2, "two members sharing a phone remain separate recipients");
    assert.equal(recipients.payload.summary.eligible, 2);
    const prepare = async () => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
      await h.handler.prepareScheduleInitialSmsBatch({
        params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
        body: { memberIds: [h.member.memberId, other.memberId] },
      }, res);
      return res;
    };
    const first = await prepare();
    assert.equal(first.statusCode, 200, JSON.stringify(first.payload));
    assert.equal(first.payload.batch.intentType, "schedule_initial_notification");
    assert.equal(first.payload.batch.recipients.length, 2);
    assert.equal(first.payload.batch.intentIds.length, 2);
    const groupedMessage = first.payload.batch.recipients.find((row) => row.memberId === h.member.memberId).message;
    assert.match(groupedMessage, /First Church: Your schedule is ready/);
    assert.match(groupedMessage, /Sunday service · Sun, Oct 4/);
    assert.match(groupedMessage, /Audio, Worship \(2\)/);
    assert.match(groupedMessage, /Combined service · Sun, Oct 11/);
    assert.equal((groupedMessage.match(/schedule-response\/secure-token/g) || []).length, 1);
    assert.equal(h.providerCalls, 0, "reviewing and persisting the batch never calls the provider");
    const stableIntentIds = [...first.payload.batch.intentIds].sort();
    const batchId = first.payload.batch.batchId;

    h.schedule.description = "unrelated note changed";
    h.schedule.updatedAt = "2026-10-12T12:00:00.000Z";
    const repeated = await prepare();
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.payload.batch.batchId, batchId);
    assert.deepEqual([...repeated.payload.batch.intentIds].sort(), stableIntentIds, "the initial identity is stable across preparation retries and unrelated schedule metadata changes");

    const batchDetail = async () => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
      await h.handler.getAvailabilityBatch({ params: { churchId: h.churchId, batchId } }, res);
      return res;
    };
    const currentReview = await batchDetail();
    assert.equal(currentReview.statusCode, 200);
    assert.equal(currentReview.payload.batch.recipients.find((row) => row.memberId === h.member.memberId).eligible, true);
    h.schedule.assignments.occ_1["position::0"] = other.memberId;
    const staleReview = await batchDetail();
    const staleRecipient = staleReview.payload.batch.recipients.find((row) => row.memberId === h.member.memberId);
    assert.equal(staleRecipient.eligible, false);
    assert.equal(staleRecipient.sourceStale, true, "assignment changes invalidate the persisted approval before use");

    const firstIntent = h.storeFor("notificationIntents").get(stableIntentIds[0]);
    const attemptId = "attempt_accepted";
    h.storeFor("notificationIntents").set(firstIntent.intentId, {
      ...firstIntent, status: "sent", outcome: "confirmed", attemptId, providerAcceptedAttemptId: attemptId,
    });
    h.storeFor("smsDeliveryAttempts").set(attemptId, { attemptId, churchId: h.churchId, notificationIntentId: firstIntent.intentId, status: "accepted", outcome: "confirmed", providerMessageId: "SM_already_accepted" });
    const status = await getRecipients();
    const accepted = status.payload.recipients.find((row) => row.memberId === firstIntent.memberId);
    assert.equal(accepted.previousDeliveryStatus, "accepted");
    assert.equal(accepted.eligible, false);

    const dispatch = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.dispatchAvailabilityBatch({ params: { churchId: h.churchId, batchId }, body: { confirmed: true, approvalVersion: repeated.payload.batch.approvalVersion } }, dispatch);
    assert.equal(dispatch.statusCode, 503);
    assert.match(dispatch.payload.errorMessage, /restart recovery/i);
    const singleSend = await h.send(stableIntentIds[1]);
    assert.equal(singleSend.statusCode, 503, "a grouped message cannot bypass the batch readiness gate through the single-intent route");
    assert.equal(h.providerCalls, 0);
  });

  test(`schedule SMS recipient history blocks unknown outcomes and allows only deliberate definitive-failure retry (${firestore ? "transaction fake" : "memory"})`, async () => {
    const h = createHarness({ firestore });
    h.schedule.published = true;
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId, "position::1": "member_b" } };
    h.storeFor("teamRosterMembers").set("member_b", { memberId: "member_b", churchId: h.churchId, firstName: "Casey", lastName: "Candidate", phoneNumber: h.phoneNumber });
    const batchId = `h_${Buffer.from(`${h.churchId}|notification-batch|schedule_initial_sms|${h.schedule.scheduleId}|initial`).toString("hex")}`;
    const hashValue = (value) => `h_${Buffer.from(String(value)).toString("hex")}`;
    const intentIdForMember = (memberId) => hashValue(`${h.churchId}|notification-intent|schedule_initial_notification|${h.schedule.scheduleId}|${memberId}|initial`);
    const acceptedId = intentIdForMember(h.member.memberId);
    const failedId = intentIdForMember("member_b");
    h.storeFor("notificationIntents").set(acceptedId, {
      intentId: acceptedId, churchId: h.churchId, sourceType: "team_schedule", sourceId: h.schedule.scheduleId,
      intentType: "schedule_initial_notification", memberId: h.member.memberId,
      idempotencyKey: `schedule_initial_notification|${h.schedule.scheduleId}|${h.member.memberId}|initial`,
      status: "unknown", outcome: "unknown",
    });
    h.storeFor("notificationIntents").set(failedId, {
      intentId: failedId, churchId: h.churchId, sourceType: "team_schedule", sourceId: h.schedule.scheduleId,
      intentType: "schedule_initial_notification", memberId: "member_b",
      idempotencyKey: `schedule_initial_notification|${h.schedule.scheduleId}|member_b|initial`,
      status: "failed", outcome: "failed",
    });
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    await h.handler.getScheduleInitialSmsRecipients({ params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.recipients.find((row) => row.memberId === h.member.memberId).eligible, false);
    const failed = res.payload.recipients.find((row) => row.memberId === "member_b");
    assert.equal(failed.previousDeliveryStatus, "failed");
    assert.equal(failed.eligible, true);
    assert.deepEqual(res.payload.selectedMemberIds, [], "a definitive failure is not selected automatically");
    assert.notEqual(batchId, "");
  });
}

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

test("availability preparation rejects an unknown audience instead of silently defaulting", async () => {
  const h = createHarness();
  const { res, batch } = await h.preview({ audienceType: "unknown" });
  assert.equal(res.statusCode, 400);
  assert.equal(batch, undefined);
  assert.equal(h.storeFor("notificationBatches").size, 0);
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

test("an unsent prepared batch can be abandoned and cannot be sent afterward", async () => {
  const h = createHarness();
  const { batch } = await h.preview({ audienceType: "specific", requestKey: "abandon-prepared-batch" });

  const abandoned = await h.abandon(batch.batchId);
  assert.equal(abandoned.statusCode, 200, JSON.stringify(abandoned.payload));
  assert.equal(abandoned.payload.batch.status, "abandoned");
  assert.equal((await h.getDoc("notificationBatches", batch.batchId)).status, "abandoned");
  assert.equal(h.providerCalls, 0);

  const batchDispatch = await h.dispatch(batch.batchId);
  assert.equal(batchDispatch.statusCode, 409);
  assert.equal(h.providerCalls, 0);

  const intentDispatch = await h.send(batch.intentIds[0]);
  assert.equal(intentDispatch.statusCode, 409);
  assert.match(intentDispatch.payload.errorMessage, /review was discarded/i);
  assert.equal(h.providerCalls, 0);
});

test("a batch cannot be abandoned after a send has started", async () => {
  const h = createHarness();
  const { batch } = await h.preview({ requestKey: "do-not-abandon-sent-batch" });
  const dispatched = await h.dispatch(batch.batchId);
  assert.equal(dispatched.statusCode, 200);

  const abandoned = await h.abandon(batch.batchId);
  assert.equal(abandoned.statusCode, 409);
  assert.equal((await h.getDoc("notificationBatches", batch.batchId)).status, "sent");
  assert.equal(h.providerCalls, 1);
});

test("an intentional availability resend gets a new identity while retries preserve each send", async () => {
  const h = createHarness();
  const { batch: firstBatch } = await h.preview();
  const firstSend = await h.dispatch(firstBatch.batchId);
  assert.equal(firstSend.statusCode, 200);
  assert.equal(firstSend.payload.batch.summary.sent, 1);
  assert.equal(h.providerCalls, 1);
  const firstIntent = await h.getDoc("notificationIntents", firstBatch.intentIds[0]);

  const { batch: secondBatch } = await h.preview({ audienceType: "specific" });
  assert.equal(secondBatch.summary.eligible, 1);
  assert.notEqual(secondBatch.intentIds[0], firstBatch.intentIds[0]);
  const secondIntent = await h.getDoc("notificationIntents", secondBatch.intentIds[0]);
  assert.notEqual(secondIntent.idempotencyKey, firstIntent.idempotencyKey);
  assert.equal(secondIntent.message, firstIntent.message);

  const secondSend = await h.dispatch(secondBatch.batchId);
  assert.equal(secondSend.statusCode, 200);
  assert.equal(h.providerCalls, 2);
  assert.equal((await h.getDoc("notificationIntents", firstBatch.intentIds[0])).status, "sent");
  assert.equal((await h.getDoc("notificationIntents", secondBatch.intentIds[0])).status, "sent");
  const replay = await h.dispatch(secondBatch.batchId);
  assert.equal(replay.statusCode, 409);
  assert.equal(h.providerCalls, 2);
});

test("retrying preparation with the same batch key adopts the same intent", async () => {
  const h = createHarness();
  const first = await h.preview({ audienceType: "specific", requestKey: "same-operation" });
  const retry = await h.preview({ audienceType: "specific", requestKey: "same-operation" });
  assert.equal(retry.res.statusCode, 200);
  assert.equal(retry.batch.batchId, first.batch.batchId);
  assert.deepEqual(retry.batch.intentIds, first.batch.intentIds);
  assert.equal(h.storeFor("notificationIntents").size, 1);
  assert.equal(h.providerCalls, 0);
});

test("CSRF rejection happens before batch dispatch and the same prepared operation can be retried", async () => {
  let rejectCsrf = false;
  const h = createHarness({ assertCsrf: async () => {
    if (rejectCsrf) throw Object.assign(new Error("Could not verify this request."), {
      statusCode: 403,
      code: "AUTH_CSRF_MISMATCH",
    });
  } });
  const { batch } = await h.preview({ audienceType: "specific", requestKey: "csrf-recovery-operation" });
  rejectCsrf = true;
  const rejected = await h.dispatch(batch.batchId);
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.payload.code, "AUTH_CSRF_MISMATCH");
  assert.equal((await h.getDoc("notificationBatches", batch.batchId)).status, "prepared");
  assert.equal((await h.getDoc("notificationIntents", batch.intentIds[0])).status, "preview");
  assert.equal(h.storeFor("smsDeliveryAttempts").size, 0);
  assert.equal(h.providerCalls, 0);

  rejectCsrf = false;
  const retried = await h.dispatch(batch.batchId);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.payload.batch.batchId, batch.batchId);
  assert.equal(retried.payload.batch.intentIds[0], batch.intentIds[0]);
  assert.equal(h.providerCalls, 1);
});

test("a new message after an uncertain result requires explicit duplicate-risk acknowledgment", async () => {
  let providerAttempt = 0;
  const h = createHarness({ providerSend: async () => {
    providerAttempt += 1;
    if (providerAttempt === 1) throw Object.assign(new Error("Provider timed out."), { code: "ETIMEDOUT" });
    return { providerMessageId: "SM_second_operation", status: "accepted" };
  } });
  const first = (await h.preview()).batch;
  const uncertain = await h.dispatch(first.batchId);
  assert.equal(uncertain.statusCode, 200);
  assert.equal(uncertain.payload.batch.summary.uncertain, 1);
  assert.equal(h.providerCalls, 1);

  const second = (await h.preview({ audienceType: "specific", requestKey: "deliberate-unknown-resend" })).batch;
  assert.equal(second.summary.eligible, 1);
  assert.equal(second.recipients[0].previousDeliveryStatus, "uncertain");
  const unacknowledged = await h.dispatch(second.batchId);
  assert.equal(unacknowledged.statusCode, 409);
  assert.equal(h.providerCalls, 1);
  assert.equal((await h.getDoc("notificationBatches", second.batchId)).status, "prepared");

  const acknowledged = await h.dispatch(second.batchId, true, [h.member.memberId]);
  assert.equal(acknowledged.statusCode, 200);
  assert.equal(acknowledged.payload.batch.summary.sent, 1);
  const savedAcknowledgment = await h.getDoc("notificationBatches", second.batchId);
  assert.deepEqual(savedAcknowledgment.uncertainOutcomeAcknowledgment.memberIds, [h.member.memberId]);
  assert.equal(savedAcknowledgment.uncertainOutcomeAcknowledgment.actorUid, "admin_a");
  assert.equal(h.providerCalls, 2);

  await h.dispatch(first.batchId);
  assert.equal(h.providerCalls, 2, "replaying the unknown operation must never invoke the provider again");
  assert.equal((await h.getDoc("notificationIntents", first.intentIds[0])).status, "unknown");
});

test("a newly uncertain earlier send is rechecked after the batch claim", async () => {
  let h;
  let injected = false;
  h = createHarness({ beforeSetDoc: async (collection, _id, data) => {
    if (injected || collection !== "notificationBatches" || data.status !== "dispatching") return;
    injected = true;
    h.storeFor("notificationIntents").set("late_unknown_intent", {
      intentId: "late_unknown_intent",
      churchId: h.churchId,
      formId: h.form.formId,
      recipientId: h.recipient.recipientId,
      memberId: h.member.memberId,
      sourceType: "team_intake_recipient",
      sourceId: h.recipient.recipientId,
      intentType: "availability_request",
      status: "unknown",
      batchId: "earlier_batch",
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  } });

  const { batch } = await h.preview({ audienceType: "specific", requestKey: "uncertain-race-operation" });
  const firstDispatch = await h.dispatch(batch.batchId);
  assert.equal(injected, true);
  assert.equal(firstDispatch.statusCode, 200);
  assert.equal(h.providerCalls, 0, "the send must be stopped when earlier delivery becomes uncertain after preflight");
  assert.match(firstDispatch.payload.batch.recipients[0].exclusionReason, /became unconfirmed/i);

  const refreshed = await h.dispatch(batch.batchId);
  assert.equal(refreshed.statusCode, 409);
  assert.equal(h.providerCalls, 0);
  const acknowledged = await h.dispatch(batch.batchId, true, [h.member.memberId]);
  assert.equal(acknowledged.statusCode, 200);
  assert.equal(acknowledged.payload.batch.summary.sent, 1);
  assert.equal(h.providerCalls, 1);
});

test("an uncertain resend blocks a reminder despite an older accepted request", async () => {
  let providerAttempt = 0;
  const h = createHarness({ providerSend: async () => {
    providerAttempt += 1;
    if (providerAttempt === 2) throw Object.assign(new Error("Provider timed out."), { code: "ETIMEDOUT" });
    return { providerMessageId: `SM_${providerAttempt}`, status: "accepted" };
  } });

  const initialRequest = (await h.preview({ requestKey: "accepted-initial-request" })).batch;
  assert.equal((await h.dispatch(initialRequest.batchId)).payload.batch.summary.sent, 1);

  const reminderReview = (await h.preview({
    intentType: "availability_reminder",
    audienceType: "nonresponders",
    requestKey: "reminder-reviewed-before-uncertain-resend",
  })).batch;
  assert.equal(reminderReview.summary.eligible, 1);

  const uncertainResend = (await h.preview({
    audienceType: "specific",
    requestKey: "newer-uncertain-resend",
  })).batch;
  assert.equal((await h.dispatch(uncertainResend.batchId)).payload.batch.summary.uncertain, 1);
  assert.equal(h.providerCalls, 2);

  const blockedDispatch = await h.dispatch(reminderReview.batchId);
  assert.equal(blockedDispatch.statusCode, 409);
  assert.match(blockedDispatch.payload.errorMessage, /before sending a reminder/i);
  assert.equal(h.providerCalls, 2);
  assert.equal((await h.getDoc("notificationBatches", reminderReview.batchId)).status, "prepared");

  const nextReminder = await h.preview({
    intentType: "availability_reminder",
    audienceType: "nonresponders",
    requestKey: "reminder-after-uncertain-resend",
  });
  assert.equal(nextReminder.batch.summary.eligible, 0);
  assert.equal(nextReminder.batch.summary.excluded, 1);
  assert.match(nextReminder.batch.recipients[0].exclusionReason, /before preparing a reminder/i);
  assert.equal(h.providerCalls, 2);

  const directSend = await h.send(reminderReview.intentIds[0]);
  assert.equal(directSend.statusCode, 409);
  assert.match(directSend.payload.errorMessage, /before sending a reminder/i);
  assert.equal(h.providerCalls, 2);
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
  const initial = await h.preview();
  assert.equal(initial.batch.summary.eligible, 1);
  await h.dispatch(initial.batch.batchId);
  const { res, batch } = await h.preview({ intentType: "availability_reminder" });
  assert.equal(res.statusCode, 200);
  assert.equal(batch.reminderRound, 0);
  assert.equal(h.storeFor("teamIntakeForms").get(h.form.formId).reminderRound, undefined);
  assert.equal(batch.recipients[0].message, "First Church: Reminder: Please complete the October availability form: https://www.worshipsync.net/a/secure-token Reply STOP to opt out.");
  assert.equal(batch.recipients[0].segmentCount, 1);
  assert.equal(measureSmsMessage(batch.recipients[0].message).segmentCount, 1);
  assert.match(batch.recipients[0].message, /\/a\/secure-token/);
  assert.equal(h.providerCalls, 1);
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
  const initial = await h.preview();
  await h.dispatch(initial.batch.batchId);
  const { batch, intent } = await h.preview({ intentType: "availability_reminder" });
  h.storeFor("teamIntakeRecipients").set(h.recipient.recipientId, {
    ...h.recipient, respondedAt: "2026-09-25T12:01:00.000Z", submissionId: "submission_a",
  });
  const dispatch = await h.dispatch(batch.batchId);
  assert.equal(dispatch.statusCode, 200);
  assert.equal(h.providerCalls, 1);
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

test("a new operation does not overwrite an abandoned prepared batch", async () => {
  const h = createHarness();
  const oldBatch = (await h.preview()).batch;
  const newBatch = (await h.preview({ audienceType: "specific" })).batch;
  assert.notEqual(oldBatch.batchId, newBatch.batchId);
  assert.notEqual(oldBatch.intentIds[0], newBatch.intentIds[0]);
  assert.equal(h.storeFor("notificationBatches").get(oldBatch.batchId).status, "prepared");
  const oldDispatch = await h.dispatch(oldBatch.batchId);
  assert.equal(oldDispatch.statusCode, 200);
  assert.equal(h.providerCalls, 1);
  const currentDispatch = await h.dispatch(newBatch.batchId);
  assert.equal(currentDispatch.statusCode, 200);
  assert.equal(h.providerCalls, 2);
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
  const initial = await changedSource.preview();
  await changedSource.dispatch(initial.batch.batchId);
  const { intent: second } = await changedSource.preview({ intentType: "availability_reminder" });
  changedSource.storeFor("teamIntakeForms").set(changedSource.form.formId, { ...changedSource.form, active: false });
  const changed = await changedSource.send(second.intentId);
  assert.equal(changed.statusCode, 409);
  assert.equal(changedSource.providerCalls, 1);
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
    "schedule_initial_notification",
    "custom_message",
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

test("schedule confirmation commits promptly and concurrent browser approval dispatches one approved intent", async () => {
  let releaseProvider;
  const providerResult = new Promise((resolve) => { releaseProvider = resolve; });
  const h = createHarness({
    firestore: true,
    scheduleBulkDispatchReady: true,
    providerSend: async () => {
      return providerResult;
    },
  });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
  const preparedResponse = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, preparedResponse);
  assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
  const prepared = preparedResponse.payload.batch;
  const [first, second] = await Promise.all([
    h.dispatch(prepared.batchId), h.dispatch(prepared.batchId),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode], [200, 200]);
  const persisted = h.storeFor("notificationBatches").get(prepared.batchId);
  assert.equal(persisted.status, "approved");
  assert.equal(persisted.approval.reviewVersion, prepared.approvalVersion);
  assert.equal(persisted.approval.recipients[0].message, prepared.recipients[0].message);
  assert.equal(persisted.approval.actorUid, "admin_a");
  assert.equal(h.providerCalls, 0, "approval replies before awaiting the provider operation");

  for (let attempt = 0; attempt < 100 && h.providerCalls === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.providerCalls, 1);
  releaseProvider({ providerMessageId: "SM_approved_once", status: "accepted" });
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(prepared.batchId).status !== "complete"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.storeFor("notificationBatches").get(prepared.batchId).status, "complete");
  assert.equal(h.storeFor("notificationIntents").get(prepared.intentIds[0]).status, "sent");
  assert.equal(h.storeFor("smsDeliveryAttempts").size, 1);
  assert.equal(h.providerCalls, 1);
  const nextReview = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, nextReview);
  assert.equal(nextReview.statusCode, 200);
  const reopened = h.makeResponse();
  await h.handler.getScheduleInitialSmsRecipients({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
  }, reopened);
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.payload.currentBatch, null);
  assert.equal(reopened.payload.recentBatches[0].status, "complete");
  assert.equal(reopened.payload.recentBatches[0].summary.accepted, 1);
  assert.equal(reopened.payload.recentBatches[0].selected, 1);
  await h.handler.stopScheduleBatchDispatcher();
});

test("approved schedule execution rechecks current consent and assignment before each provider call", async () => {
  for (const invalidate of [
    (h) => h.storeFor("smsConsents").set(smsConsentIdForChurchPhone(h.churchId, h.phoneNumber), {
      consentId: smsConsentIdForChurchPhone(h.churchId, h.phoneNumber), churchId: h.churchId,
      phoneNumber: h.phoneNumber, status: "opted_out", optedOutAt: "now",
    }),
    (h) => { h.schedule.assignments = { occ_1: { "position::0": "member_b" } }; },
    (h) => { h.schedule.published = false; },
  ]) {
    const h = createHarness({ firestore: true, scheduleBulkDispatchReady: true });
    h.schedule.published = true;
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
    const preparedResponse = h.makeResponse();
    await h.handler.prepareScheduleInitialSmsBatch({
      params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
      body: { memberIds: [h.member.memberId] },
    }, preparedResponse);
    assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
    const approved = await h.dispatch(preparedResponse.payload.batch.batchId);
    assert.equal(approved.statusCode, 200);
    invalidate(h);
    for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status === "approved"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(h.providerCalls, 0);
    const intent = h.storeFor("notificationIntents").get(preparedResponse.payload.batch.intentIds[0]);
    assert.equal(intent.status, "preview");
    assert.equal(intent.approvalSnapshot, null);
    assert.equal(h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status, "complete");
    await h.handler.stopScheduleBatchDispatcher();
  }
});

test("approved schedule execution may outlive preview expiry while preserving the reviewed message", async () => {
  const h = createHarness({ firestore: true, scheduleBulkDispatchReady: true });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
  const preparedResponse = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, preparedResponse);
  assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
  const approved = await h.dispatch(preparedResponse.payload.batch.batchId);
  assert.equal(approved.statusCode, 200);
  const intent = h.storeFor("notificationIntents").get(preparedResponse.payload.batch.intentIds[0]);
  const approvedMessage = intent.message;
  intent.approvalSnapshot.expiresAt = Date.now() - 1;
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status !== "complete"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.providerCalls, 1);
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).message, approvedMessage);
  assert.equal(h.storeFor("notificationIntents").get(intent.intentId).status, "sent");
  await h.handler.stopScheduleBatchDispatcher();
});

test("worker startup resumes a persisted approved schedule batch and ignores unapproved drafts", async () => {
  const h = createHarness({ firestore: true, scheduleBulkDispatchReady: true });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
  const preparedResponse = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, preparedResponse);
  assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
  const prepared = h.storeFor("notificationBatches").get(preparedResponse.payload.batch.batchId);
  const intent = h.storeFor("notificationIntents").get(prepared.intentIds[0]);
  const row = prepared.recipients[0];
  const approved = approveReviewedScheduleBatch({
    current: prepared,
    churchId: h.churchId,
    scheduleId: h.schedule.scheduleId,
    approvalVersion: prepared.reviewVersion,
    actorUid: "admin_a",
    approvedRecipients: [{
      memberId: row.memberId, memberName: row.memberName, assignments: row.assignments,
      intentId: row.intentId, status: "preview", eligible: true, exclusionReason: "",
      approvalVersion: intent.approvalSnapshot.approvalVersion,
      sourceFingerprint: intent.approvalSnapshot.sourceFingerprint,
      segmentCount: intent.approvalSnapshot.segmentCount,
      maskedPhoneNumber: row.maskedPhoneNumber,
      message: intent.message,
      phoneNumberSnapshot: intent.approvalSnapshot.phoneNumberSnapshot,
    }],
    now: new Date().toISOString(),
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
  });
  h.storeFor("notificationBatches").set(prepared.batchId, approved);
  h.storeFor("notificationBatches").set("unapproved-draft", {
    ...prepared, batchId: "unapproved-draft", scheduleId: "another-schedule", status: "prepared",
    recipients: [], intentIds: [], approval: null,
    dispatchPriorityAt: approved.dispatchPriorityAt + 1,
  });
  h.handler.startScheduleBatchDispatcher();
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(prepared.batchId).status !== "complete"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.providerCalls, 1);
  assert.equal(h.storeFor("notificationBatches").get(prepared.batchId).status, "complete");
  assert.equal(h.storeFor("notificationBatches").get("unapproved-draft").status, "prepared");
  await h.handler.stopScheduleBatchDispatcher();
});

test("scoped manager progress projection finds the approved batch without private phone or response-link data", async () => {
  let scoped = false;
  const h = createHarness({
    firestore: true,
    scheduleBulkDispatchReady: true,
    authorizeSchedule: async (_req, _churchId, schedule) => ({
      admin: { user: { uid: "admin_a" } }, scoped, schedule,
    }),
  });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
  const preparedResponse = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, preparedResponse);
  assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
  assert.match(preparedResponse.payload.batch.recipients[0].message, /secure-token/);
  const approved = await h.dispatch(preparedResponse.payload.batch.batchId);
  assert.equal(approved.statusCode, 200);
  scoped = true;
  const progress = h.makeResponse();
  await h.handler.getScheduleInitialSmsRecipients({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
  }, progress);
  assert.equal(progress.statusCode, 200);
  assert.ok(progress.payload.currentBatch, "another authorized device can discover persisted approval");
  const projection = JSON.stringify(progress.payload.currentBatch);
  assert.doesNotMatch(projection, /secure-token/);
  assert.doesNotMatch(projection, /\+14155550123/);
  assert.match(projection, /0123/);
  await h.handler.stopScheduleBatchDispatcher();
});

test("approved schedule batch pauses when the original operator loses Team management access", async () => {
  let permitted = true;
  const h = createHarness({
    firestore: true,
    scheduleBulkDispatchReady: true,
    authorizeScheduleActor: async ({ scheduleId }) => {
      if (!permitted) throw Object.assign(new Error("Teams edit access required"), { statusCode: 403 });
      return { admin: { user: { uid: "admin_a" } }, scoped: false, schedule: await h.getDoc("teamSchedules", scheduleId) };
    },
  });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
  const preparedResponse = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId] },
  }, preparedResponse);
  assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
  const approved = await h.dispatch(preparedResponse.payload.batch.batchId);
  assert.equal(approved.statusCode, 200);
  permitted = false;
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status !== "paused"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status, "paused");
  assert.equal(h.providerCalls, 0);
  await h.handler.stopScheduleBatchDispatcher();
});

test("revocation during an in-flight schedule send preserves acceptance and requires a new review before resuming", async () => {
  let permitted = true;
  let calls = 0;
  let resolveProvider;
  let notifyProviderStarted;
  const providerStarted = new Promise((resolve) => { notifyProviderStarted = resolve; });
  const firstProviderResponse = new Promise((resolve) => { resolveProvider = resolve; });
  let h;
  h = createHarness({
    firestore: true,
    scheduleBulkDispatchReady: true,
    authorizeScheduleActor: async ({ scheduleId }) => {
      if (!permitted) throw Object.assign(new Error("Teams edit access required"), { statusCode: 403 });
      return { admin: { user: { uid: "admin_a" } }, scoped: false, schedule: await h.getDoc("teamSchedules", scheduleId) };
    },
    providerSend: async () => {
      calls += 1;
      if (calls === 1) {
        notifyProviderStarted();
        return firstProviderResponse;
      }
      return { providerMessageId: `SM_revoked_${calls}`, status: "accepted" };
    },
  });
  h.schedule.published = true;
  h.schedule.assignments = { occ_1: { "position::0": h.member.memberId, "position::1": "member_b" } };
  const prepared = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId, "member_b"] },
  }, prepared);
  assert.equal(prepared.statusCode, 200, JSON.stringify(prepared.payload));
  const approved = await h.dispatch(prepared.payload.batch.batchId);
  assert.equal(approved.statusCode, 200);
  for (let attempt = 0; attempt < 100 && h.providerCalls === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.providerCalls, 1, "the approved batch enters its first provider call");
  await providerStarted;

  permitted = false;
  resolveProvider({ providerMessageId: "SM_accepted_before_revocation", status: "accepted" });
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status !== "paused"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.storeFor("notificationBatches").get(approved.payload.batch.batchId).status, "paused");
  assert.equal(h.storeFor("notificationIntents").get(prepared.payload.batch.intentIds[0]).status, "sent");
  assert.equal(h.providerCalls, 1, "the unsent second recipient pauses while accepted work is preserved");

  permitted = true;
  const staleApproval = await h.dispatch(approved.payload.batch.batchId);
  assert.equal(staleApproval.statusCode, 409, "restored access cannot resume the old approval directly");
  assert.match(staleApproval.payload.errorMessage, /Review the remaining messages again/);

  const freshReview = h.makeResponse();
  await h.handler.prepareScheduleInitialSmsBatch({
    params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
    body: { memberIds: [h.member.memberId, "member_b"] },
  }, freshReview);
  assert.equal(freshReview.statusCode, 200, JSON.stringify(freshReview.payload));
  assert.notEqual(freshReview.payload.batch.approvalVersion, approved.payload.batch.approvalVersion);
  assert.equal(freshReview.payload.batch.intentIds.length, 1);
  const resumed = await h.dispatch(freshReview.payload.batch.batchId);
  assert.equal(resumed.statusCode, 200);
  for (let attempt = 0; attempt < 100 && h.storeFor("notificationBatches").get(freshReview.payload.batch.batchId).status !== "complete"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.providerCalls, 2);
  assert.equal(calls, 2);
  assert.equal(h.storeFor("notificationIntents").get(prepared.payload.batch.intentIds[0]).status, "sent");
  await h.handler.stopScheduleBatchDispatcher();
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
    let h;
    let candidateChecks = 0;
    let releaseValidation;
    let signalValidation;
    const paused = new Promise((resolve) => { signalValidation = resolve; });
    const release = new Promise((resolve) => { releaseValidation = resolve; });
    h = createHarness({ firestore, validateReplacementCandidate: async () => {
      candidateChecks++;
      if (candidateChecks === 2) {
        signalValidation();
        await release;
      }
      return { schedule: h.schedule, member: h.member, occurrence: h.schedule.occurrences[0],
        church: { churchId: h.churchId, name: "First Church" }, position: { name: "Worship" }, holderId: "" };
    } });
    const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } });
    const res = response();
    const preparing = h.handler.prepareReplacementInvitation({ params: { churchId: h.churchId }, body: { scheduleId: h.schedule.scheduleId, occurrenceId: "occ_1", cellKey: "position::0", memberId: h.member.memberId } }, res);
    await paused;
    const intentId = [...h.storeFor("notificationIntents").values()][0].intentId;
    try {
      const otherPreview = response();
      await h.handler.getIntentPreview({ params: { churchId: h.churchId, intentId } }, otherPreview);
      assert.equal(otherPreview.statusCode, 200);
      assert.equal((await h.send(intentId)).payload.success, true);
    } finally {
      releaseValidation();
    }
    await preparing;
    assert.equal(res.statusCode, 409);
    const retained = h.storeFor("notificationIntents").get(intentId);
    assert.equal(retained.status, "sent");
    assert.equal(retained.providerMessageId, "SM1");
    assert.equal((await h.send(intentId)).statusCode, 409);
    assert.equal(h.providerCalls, 1);
  });
}


for (const firestore of [false, true]) {
  test(`delayed preview cannot overwrite message history after another request sends (${firestore ? "transaction" : "memory"})`, async () => {
    let releaseValidation;
    let signalValidation;
    const validationPaused = new Promise((resolve) => { signalValidation = resolve; });
    const validationRelease = new Promise((resolve) => { releaseValidation = resolve; });
    let pauseNextValidation = false;
    let sentBody;
    let h;
    h = createHarness({ firestore,
      providerSend: async ({ body }) => { sentBody = body; return { providerMessageId: "SMpreviewRace", status: "accepted" }; },
      resolveAvailabilityNotificationContext: async (intent) => {
        if (pauseNextValidation) {
          pauseNextValidation = false;
          signalValidation();
          await validationRelease;
        }
        return {
          form: h.storeFor("teamIntakeForms").get(intent.formId),
          recipient: h.storeFor("teamIntakeRecipients").get(intent.recipientId),
          member: h.storeFor("teamRosterMembers").get(intent.memberId),
          church: h.storeFor("churches").get(h.churchId),
          publicUrl: "https://www.worshipsync.net/a/secure-token",
        };
      },
    });
    const { intent } = await h.preview();
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    pauseNextValidation = true;
    const delayedPreview = h.handler.getIntentPreview({ params: { churchId: h.churchId, intentId: intent.intentId } }, res);
    await validationPaused;
    let sent;
    try {
      assert.equal((await h.send(intent.intentId)).payload.success, true);
      sent = structuredClone(h.storeFor("notificationIntents").get(intent.intentId));
      assert.equal(sent.message, sentBody);
      assert.equal(sent.status, "sent");
      h.form.name = "Changed form content after the send";
    } finally {
      releaseValidation();
    }
    await delayedPreview;
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.success, false);
    assert.deepEqual(h.storeFor("notificationIntents").get(intent.intentId), sent);
    assert.equal(h.providerCalls, 1);
  });
}

const firestoreEmulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const firestoreEmulatorProjectId = "demo-worshipsync";

const clearFirestoreEmulator = async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const url = new URL(`http://${emulatorHost}`);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "Firestore cleanup is restricted to a local emulator host");
  const response = await fetch(`http://${emulatorHost}/emulator/v1/projects/${firestoreEmulatorProjectId}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.status, 200, "Firestore emulator database was cleared before the integration case");
};

test("Firestore emulator fences competing client sends with one provider request", { skip: !firestoreEmulatorAvailable }, async () => {
  await clearFirestoreEmulator();
  const projectId = firestoreEmulatorProjectId;
  const app = initializeApp({ projectId }, `notification-intent-race-${randomUUID()}`);
  const db = getFirestore(app);
  let signalProviderStarted;
  let releaseProvider;
  const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  try {
    const h = createHarness({
      firestoreDb: db,
      providerSend: async () => {
        signalProviderStarted();
        await providerGate;
        return { providerMessageId: "SM_emulator_race", status: "accepted" };
      },
    });
    await h.seedFirestore();
    const { intent } = await h.preview();
    const first = h.send(intent.intentId);
    const second = h.send(intent.intentId);
    await providerStarted;
    const fastest = await Promise.race([
      first.then((result) => ({ result })),
      second.then((result) => ({ result })),
    ]);
    assert.equal(fastest.result.statusCode, 409, "one competing request is rejected while the other owns the Firestore intent claim");
    releaseProvider();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
    assert.equal(h.providerCalls, 1);
    const savedIntent = await db.collection("notificationIntents").doc(intent.intentId).get();
    assert.equal(savedIntent.data().status, "sent");
    const attempts = await db.collection("smsDeliveryAttempts").where("notificationIntentId", "==", intent.intentId).get();
    assert.equal(attempts.size, 1);
  } finally {
    releaseProvider?.();
    await deleteApp(app);
  }
});

test("Firestore emulator commits repeated schedule confirmation before one approved batch starts", { skip: !firestoreEmulatorAvailable }, async () => {
  await clearFirestoreEmulator();
  const projectId = firestoreEmulatorProjectId;
  const app = initializeApp({ projectId }, `schedule-confirmation-${randomUUID()}`);
  const db = getFirestore(app);
  let signalProviderStarted;
  let releaseProvider;
  const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  let h;
  try {
    h = createHarness({
      firestoreDb: db,
      scheduleBulkDispatchReady: true,
      providerSend: async () => {
        signalProviderStarted();
        await providerGate;
        return { providerMessageId: "SM_emulator_approved", status: "accepted" };
      },
    });
    h.schedule.published = true;
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
    await h.seedFirestore();
    const prepared = h.makeResponse();
    await h.handler.prepareScheduleInitialSmsBatch({
      params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
      body: { memberIds: [h.member.memberId] },
    }, prepared);
    assert.equal(prepared.statusCode, 200, JSON.stringify(prepared.payload));

    const confirmations = await Promise.all([
      h.dispatch(prepared.payload.batch.batchId),
      h.dispatch(prepared.payload.batch.batchId),
    ]);
    assert.deepEqual(confirmations.map((result) => result.statusCode), [200, 200]);
    await providerStarted;
    assert.equal(h.providerCalls, 1);
    releaseProvider();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const saved = await db.collection("notificationBatches").doc(prepared.payload.batch.batchId).get();
      if (saved.data()?.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const batch = await db.collection("notificationBatches").doc(prepared.payload.batch.batchId).get();
    assert.equal(batch.data().status, "complete");
    assert.equal(batch.data().approval.actorUid, "admin_a");
    const intent = await db.collection("notificationIntents").doc(prepared.payload.batch.intentIds[0]).get();
    assert.equal(intent.data().status, "sent");
    const attempts = await db.collection("smsDeliveryAttempts").where("notificationIntentId", "==", intent.id).get();
    assert.equal(attempts.size, 1);
    assert.equal(h.providerCalls, 1);
  } finally {
    releaseProvider?.();
    if (h) await h.handler.stopScheduleBatchDispatcher({ timeoutMs: 1000 });
    await deleteApp(app);
  }
});

test("Firestore emulator rechecks consent between schedule recipients after an in-flight acceptance", { skip: !firestoreEmulatorAvailable }, async () => {
  await clearFirestoreEmulator();
  const app = initializeApp({ projectId: firestoreEmulatorProjectId }, `schedule-consent-${randomUUID()}`);
  const db = getFirestore(app);
  let h;
  try {
    h = createHarness({
      firestoreDb: db,
      scheduleBulkDispatchReady: true,
      providerSend: async () => {
        await db.collection("smsConsents").doc(smsConsentIdForChurchPhone("church_a", "+14155550123")).update({
          status: "opted_out",
          optedOutAt: new Date().toISOString(),
        });
        return { providerMessageId: "SM_before_opt_out", status: "accepted" };
      },
    });
    h.schedule.published = true;
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId, "position::1": "member_b" } };
    await h.seedFirestore();
    const prepared = h.makeResponse();
    await h.handler.prepareScheduleInitialSmsBatch({
      params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
      body: { memberIds: [h.member.memberId, "member_b"] },
    }, prepared);
    assert.equal(prepared.statusCode, 200, JSON.stringify(prepared.payload));
    const approved = await h.dispatch(prepared.payload.batch.batchId);
    assert.equal(approved.statusCode, 200);
    let batch;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      batch = await db.collection("notificationBatches").doc(prepared.payload.batch.batchId).get();
      if (["complete", "partial"].includes(batch.data()?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const persisted = batch.data();
    assert.equal(h.providerCalls, 1, "the second recipient is revalidated after opt-out and never reaches the provider");
    assert.equal(persisted.recipients.filter((row) => row.status === "sent").length, 1);
    assert.equal(persisted.recipients.filter((row) => row.status === "excluded").length, 1);
    const consent = await db.collection("smsConsents").doc(smsConsentIdForChurchPhone("church_a", "+14155550123")).get();
    assert.equal(consent.data().status, "opted_out");
  } finally {
    if (h) await h.handler.stopScheduleBatchDispatcher({ timeoutMs: 1000 });
    await deleteApp(app);
  }
});

test("Firestore emulator preserves callback evidence through duplicate, delayed, and interrupted provider responses", { skip: !firestoreEmulatorAvailable }, async () => {
  await clearFirestoreEmulator();
  const projectId = firestoreEmulatorProjectId;
  const app = initializeApp({ projectId }, `notification-callback-race-${randomUUID()}`);
  const db = getFirestore(app);
  let callbackUrl = "";
  let webhook;
  let h;
  const invokeCallback = async (status) => {
    const res = h.makeResponse();
    await webhook({
      headers: { "x-twilio-signature": "emulator-test" },
      body: { MessageSid: "SM_emulator_callback", MessageStatus: status, To: h.phoneNumber, AccountSid: "AC1" },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    return res.payload;
  };
  try {
    h = createHarness({
      firestoreDb: db,
      providerSend: async ({ statusCallbackUrl }) => {
        callbackUrl = statusCallbackUrl;
        await invokeCallback("delivered");
        throw Object.assign(new Error("Provider response was interrupted after acceptance."), { code: "ECONNRESET" });
      },
    });
    await h.seedFirestore();
    webhook = createSmsStatusWebhookHandler({
      queryDocs: async () => [],
      getDoc: h.getDoc,
      requireFirestore: () => db,
      COLLECTIONS: { smsDeliveryAttempts: "smsDeliveryAttempts", notificationIntents: "notificationIntents" },
      setDoc: async () => undefined,
      nowIso: () => new Date().toISOString(),
      validateSignature: () => true,
      normalizeStatus: (value) => String(value || "").toLowerCase(),
      getCallbackUrl: () => callbackUrl,
      getAuthToken: () => "AC1",
    });
    const { intent } = await h.preview();
    const send = await h.send(intent.intentId);
    assert.equal(send.statusCode, 200, "the callback confirms acceptance despite the lost provider response");
    assert.equal(send.payload.success, true);
    assert.equal(send.payload.attempt.status, "delivered");
    assert.equal(h.providerCalls, 1);

    const duplicate = await invokeCallback("delivered");
    assert.equal(duplicate.updated, false, "a duplicate callback is idempotent");
    const delayed = await invokeCallback("sent");
    assert.equal(delayed.updated, false, "a delayed lower-rank callback cannot overwrite delivered state");

    const savedIntent = await db.collection("notificationIntents").doc(intent.intentId).get();
    assert.equal(savedIntent.data().status, "sent");
    const attempts = await db.collection("smsDeliveryAttempts").where("notificationIntentId", "==", intent.intentId).get();
    assert.equal(attempts.size, 1);
    assert.equal(attempts.docs[0].data().status, "delivered");
    assert.equal(attempts.docs[0].data().providerMessageId, "SM_emulator_callback");

    const restarted = createHarness({ firestoreDb: db });
    restarted.storeFor("notificationIntents").set(intent.intentId, savedIntent.data());
    const retry = await restarted.send(intent.intentId);
    assert.equal(retry.statusCode, 409);
    assert.equal(restarted.providerCalls, 0, "accepted work remains fenced after process restart");
  } finally {
    await deleteApp(app);
  }
});

test("compact personal SMS binds the reviewed URL/body to the provider and requires fresh review after replacement", async () => {
  for (const replaced of [false, true]) {
    let h;
    let active = true;
    const delivered = [];
    const url = `https://www.worshipsync.net/s#v_${"x".repeat(32)}`;
    const expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000;
    h = createHarness({ firestore: true, scheduleBulkDispatchReady: true,
      providerSend: async (input) => { delivered.push(input); return { providerMessageId: "SM_personal", status: "accepted" }; },
      resolveScheduleNotificationContext: async (intent, options = {}) => {
        if (!active || (options.responseUrlOverride && options.responseUrlOverride !== url)) {
          throw Object.assign(new Error("Personal access changed. Review again."), { statusCode: 409 });
        }
        return { schedule: h.schedule, member: h.member, church: { name: "First Church" },
          assignments: getScheduleMemberAssignments({ schedule: h.schedule, memberId: intent.memberId, positions: [...h.storeFor("teamPositions").values()] }),
          serviceTimeZone: "UTC", responseUrl: url, personalAccessExpiresAt: expiresAt };
      },
    });
    h.schedule.published = true;
    h.schedule.startDate = "2026-11-01"; h.schedule.endDate = "2026-11-30";
    h.schedule.assignments = { occ_1: { "position::0": h.member.memberId } };
    const preparedResponse = h.makeResponse();
    await h.handler.prepareScheduleInitialSmsBatch({ params: { churchId: h.churchId, scheduleId: h.schedule.scheduleId },
      body: { memberIds: [h.member.memberId] } }, preparedResponse);
    assert.equal(preparedResponse.statusCode, 200, JSON.stringify(preparedResponse.payload));
    const batch = preparedResponse.payload.batch;
    const persisted = h.storeFor("notificationIntents").get(batch.intentIds[0]);
    const exactBody = persisted.message;
    assert.match(exactBody, /Your November volunteer schedule is ready/);
    assert.ok(exactBody.includes(url));
    assert.ok(!JSON.stringify(batch).includes(url));
    assert.equal(batch.recipients[0].segmentCount, measureSmsMessage(exactBody).segmentCount);
    active = !replaced;
    const approval = await h.dispatch(batch.batchId);
    if (replaced) {
      assert.equal(approval.statusCode, 409);
      assert.equal(delivered.length, 0);
    } else {
      assert.equal(approval.statusCode, 200);
      for (let attempt = 0; attempt < 100 && !delivered.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].body, exactBody);
      await h.dispatch(batch.batchId);
      assert.equal(delivered.length, 1);
    }
    await h.handler.stopScheduleBatchDispatcher();
  }
});
