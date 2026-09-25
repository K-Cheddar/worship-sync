import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATIC_NOTIFICATION_SENDS_DISABLED,
  createNotificationIntentHandlers,
  createNotificationIntent,
  NOTIFICATION_INTENT_TYPES,
} from "./notificationIntents.js";
import { smsConsentIdForChurchPhone } from "./smsConsent.js";

const createHarness = ({ providerSend, firestore = false, requireTeamsEdit } = {}) => {
  const collections = new Map();
  const storeFor = (collection) => {
    if (!collections.has(collection)) collections.set(collection, new Map());
    return collections.get(collection);
  };
  const hashValue = (value) => `h_${Buffer.from(String(value)).toString("hex")}`;
  let nextId = 0;
  let providerCalls = 0;
  const nowIso = () => "2026-09-25T12:00:00.000Z";
  const churchId = "church_a";
  const phoneNumber = "+14155550123";
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
  storeFor("teamRosterMembers").set(member.memberId, member);
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
        create: (ref, value) => {
          if (storeFor(ref.collection).has(ref.id)) throw new Error("already exists");
          storeFor(ref.collection).set(ref.id, value);
        },
      }));
      transactionTail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  const handler = createNotificationIntentHandlers({
    COLLECTIONS: {
      notificationIntents: "notificationIntents", smsDeliveryAttempts: "smsDeliveryAttempts",
      notificationDeliveries: "notificationDeliveries",
      teamSchedules: "teamSchedules", teamRosterMembers: "teamRosterMembers", churches: "churches",
      churchMessagingConfigs: "churchMessagingConfigs", smsConsents: "smsConsents",
    },
    assertCsrf: async () => undefined,
    createId: (prefix) => `${prefix}_${++nextId}`,
    getDoc: async (collection, id) => storeFor(collection).get(id) || null,
    hashValue,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    nowIso,
    queryDocs: async (collection, filters = []) => [...storeFor(collection).values()].filter((item) => filters.every((filter) => item[filter.field] === filter.value)),
    requireFirestore: () => firestore ? db : null,
    requireTeamsEdit: requireTeamsEdit || (async () => ({ user: { uid: "admin_a" } })),
    getSmsConsentForChurchPhone: async (id, phone) => id === churchId && phone === phoneNumber
      ? storeFor("smsConsents").get(smsConsentIdForChurchPhone(id, phone)) || null
      : null,
    smsProviderFactory: () => provider,
    validateTwilioStatusCallbackUrl: () => "https://example.test/status",
    setDoc: async (collection, id, data, { merge = false } = {}) => {
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
    await handler.previewAvailability({
      params: { churchId },
      body: { intentType: "availability_request", scheduleId: schedule.scheduleId, memberIds: [member.memberId], ...overrides },
    }, res);
    return { res, intent: res.payload?.intents?.[0] };
  };
  const send = async (intentId, targetChurchId = churchId) => {
    const res = makeResponse();
    await handler.sendIntent({ params: { churchId: targetChurchId, intentId }, body: {} }, res);
    return res;
  };
  return { collections, storeFor, handler, preview, send, schedule, member, phoneNumber, churchId, get providerCalls() { return providerCalls; } };
};

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
  assert.equal(optedOut.statusCode, 409);
  assert.equal(h.providerCalls, 0);

  const second = await h.preview();
  h.storeFor("teamSchedules").set(h.schedule.scheduleId, { ...h.schedule, updatedAt: "new-version" });
  const changed = await h.send(second.intent.intentId);
  assert.equal(changed.statusCode, 409);
  assert.equal(h.providerCalls, 0);
});

test("permission is checked again immediately before the provider send", async () => {
  let checks = 0;
  const h = createHarness({ requireTeamsEdit: async () => {
    checks += 1;
    if (checks > 2) throw Object.assign(new Error("Teams edit permission is required."), { statusCode: 403 });
    return { user: { uid: "admin_a" } };
  } });
  const { intent } = await h.preview();
  const result = await h.send(intent.intentId);
  assert.equal(result.statusCode, 403);
  assert.equal(checks, 3);
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
  assert.equal(h.providerCalls, 1);
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
