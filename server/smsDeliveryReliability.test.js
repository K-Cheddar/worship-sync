import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { createSmsDeliveryReconciler } from "./smsDeliveryAttempts.js";
import { createSmsStatusWebhookHandler } from "./smsStatusWebhook.js";
import { normalizeTwilioStatus, validateTwilioWebhookSignature, twilioStatusCallbackUrlForRequest } from "./smsProvider.js";

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const copy = (value) => value ? structuredClone(value) : null;
const fixture = (transactional) => {
  const intent = { intentId: "i", churchId: "c", memberId: "m", recipientId: "r", sourceId: "r", batchId: "b", attemptId: "a", status: "sending", sendStartedAt: "2020-01-01", approvedByUid: "operator" };
  const attempt = { attemptId: "a", churchId: "c", memberId: "m", recipientId: "r", sourceId: "r", notificationIntentId: "i", phoneNumberSnapshot: "+14155550123", providerAccountId: "AC1", callbackToken: "a".repeat(64), status: "pending" };
  const docs = new Map([["notificationIntents/i", copy(intent)], ["smsDeliveryAttempts/a", copy(attempt)]]);
  const versions = new Map();
  const hooks = { beforeCommit: null, beforeWrite: null, retries: 0 };
  const put = (key, value) => { docs.set(key, copy(value)); versions.set(key, (versions.get(key) || 0) + 1); };
  const getDoc = async (collection, id) => copy(docs.get(`${collection}/${id}`));
  const setDoc = async (collection, id, value) => {
    if (hooks.beforeWrite) await hooks.beforeWrite(collection, id, value);
    const key = `${collection}/${id}`; put(key, { ...docs.get(key), ...value });
  };
  // Optimistic MVCC: transactions overlap, stage writes, validate *all* reads,
  // retry conflicts, and publish atomically. This is deliberately not serial.
  const db = {
    collection: (collection) => ({ doc: (id) => `${collection}/${id}` }),
    async runTransaction(callback) {
      for (let count = 0; count < 20; count++) {
        const reads = new Map(); const writes = []; let writing = false;
        const result = await callback({
          async get(key) {
            assert.equal(writing, false, "Firestore disallows reads after writes");
            reads.set(key, versions.get(key) || 0);
            const value = copy(docs.get(key));
            return { exists: Boolean(value), data: () => value };
          },
          set(key, patch) { writing = true; writes.push([key, patch]); },
        });
        if (hooks.beforeCommit) await hooks.beforeCommit();
        if ([...reads].some(([key, version]) => (versions.get(key) || 0) !== version)) { hooks.retries++; continue; }
        for (const [key, patch] of writes) put(key, { ...docs.get(key), ...patch });
        return result;
      }
      throw new Error("retry limit");
    },
  };
  const deps = { getDoc, setDoc, requireFirestore: () => transactional ? db : null, nowIso: () => "2026-10-12T12:00:00.000Z" };
  const reconcile = createSmsDeliveryReconciler(deps);
  const recovery = () => reconcile({ churchId: "c", intentId: "i", attemptId: "a", recovery: true, expectedIntent: copy(intent), isStaleSending: () => true, update: { status: "pending", outcome: "unknown" } });
  const accepted = (status = "accepted") => reconcile({ churchId: "c", intentId: "i", attemptId: "a", update: { providerMessageId: "SM1", status, outcome: "confirmed" } });
  const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; return this; } });
  const base = "https://worshipsync.net/api/webhooks/twilio/sms-status?configured=1";
  const url = `${base}&attempt=a&correlation=${attempt.callbackToken}`;
  const handler = createSmsStatusWebhookHandler({ ...deps,
    queryDocs: async (_collection, filters) => [...docs.values()].filter((v) => filters.every((f) => v[f.field] === f.value)),
    validateSignature: validateTwilioWebhookSignature, normalizeStatus: normalizeTwilioStatus,
    getAuthToken: () => "secret", getCallbackUrl: (req) => twilioStatusCallbackUrlForRequest(base, req),
  });
  const callback = async (status, { callbackUrl = url, body = {}, signature } = {}) => {
    const params = { MessageSid: "SM1", MessageStatus: status, To: attempt.phoneNumberSnapshot, AccountSid: "AC1", ...body };
    const res = response();
    await handler({ originalUrl: new URL(callbackUrl).pathname + new URL(callbackUrl).search, headers: { "x-twilio-signature": signature || twilio.getExpectedTwilioSignature("secret", callbackUrl, params) }, body: params }, res);
    return res;
  };
  return { docs, intent, attempt, hooks, put, reconcile, recovery, accepted, callback, url, base };
};

for (const transactional of [false, true]) {
  const mode = transactional ? "optimistic transactions" : "memory";
  test(`confirmed evidence repairs intent and survives later exceptions (${mode})`, async () => {
    const h = fixture(transactional);
    h.put("smsDeliveryAttempts/a", { ...h.attempt, providerMessageId: "SM1", outcome: "confirmed", status: "delivered", deliveredAt: "earlier" });
    await h.recovery();
    await h.reconcile({ attemptId: "a", churchId: "c", intentId: "i", update: { outcome: "unknown", status: "pending" } });
    assert.equal(h.docs.get("notificationIntents/i").status, "sent");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "delivered");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").deliveredAt, "earlier");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").providerMessageId, "SM1");
  });
  test(`early signed callback, timeout, concurrent callbacks and recovery converge (${mode})`, async () => {
    const h = fixture(transactional);
    await h.recovery();
    assert.equal(h.docs.get("notificationIntents/i").status, "unknown");
    await Promise.all([h.callback("sent"), h.callback("delivered"), h.recovery(), h.recovery()]);
    assert.equal(h.docs.get("notificationIntents/i").status, "sent");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "delivered");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").outcome, "confirmed");
    assert.equal((await h.callback("delivered")).payload.updated, false);
    await h.accepted();
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "delivered");
  });
  test(`wrong owners, SID and correlation cannot mutate state (${mode})`, async () => {
    const h = fixture(transactional);
    for (const params of [ { churchId: "foreign", intentId: "i", attemptId: "a" }, { churchId: "c", intentId: "foreign", attemptId: "a" }, { churchId: "c", intentId: "i", attemptId: "missing" } ]) {
      assert.equal((await h.reconcile({ ...params, update: { outcome: "unknown" } })).ignored, true);
    }
    assert.equal((await h.callback("sent", { signature: "forged" })).statusCode, 403);
    assert.equal((await h.callback("sent", { callbackUrl: h.url.replace("correlation=" + "a".repeat(64), "correlation=" + "b".repeat(64)) })).payload.ignored, true);
    assert.equal((await h.callback("sent", { body: { To: "+14155550999" } })).payload.ignored, true);
    assert.equal((await h.callback("sent", { body: { AccountSid: "AC2" } })).payload.ignored, true);
    assert.equal((await h.callback("mystery")).payload.ignored, true);
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "pending");
    await h.accepted();
    assert.equal((await h.callback("delivered", { body: { MessageSid: "SMforeign" } })).payload.ignored, true);
    assert.equal(h.docs.get("smsDeliveryAttempts/a").providerMessageId, "SM1");
  });
  test(`legacy, deleted, unmatched and older attempts stay isolated (${mode})`, async () => {
    const h = fixture(transactional);
    const legacy = { ...h.attempt }; delete legacy.callbackToken;
    h.put("smsDeliveryAttempts/a", legacy);
    assert.equal((await h.callback("sent")).payload.ignored, true);
    assert.equal((await h.callback("sent", { callbackUrl: h.base })).payload.ignored, true);
    h.put("smsDeliveryAttempts/a", { ...legacy, providerMessageId: "SM1" });
    assert.equal((await h.callback("undelivered", { callbackUrl: h.base })).statusCode, 200);
    assert.equal(h.docs.get("notificationIntents/i").status, "sent");
    h.put("notificationIntents/i", { ...h.intent, attemptId: "later", status: "sending" });
    await h.callback("delivered", { callbackUrl: h.base });
    assert.equal(h.docs.get("notificationIntents/i").attemptId, "later");
    assert.equal(h.docs.get("notificationIntents/i").status, "sending");
    assert.equal(h.docs.get("notificationIntents/i").providerAcceptedAttemptId, "a");
    h.docs.delete("smsDeliveryAttempts/a");
    assert.equal((await h.callback("sent")).payload.ignored, true);
  });
  test(`legacy interrupted intent without attempt stays unknown (${mode})`, async () => {
    const h = fixture(transactional); delete h.intent.attemptId;
    h.put("notificationIntents/i", h.intent);
    await h.reconcile({ churchId: "c", intentId: "i", recovery: true, expectedIntent: h.intent, isStaleSending: () => true, update: { outcome: "unknown" } });
    assert.equal(h.docs.get("notificationIntents/i").status, "unknown");
  });
}

test("memory intent-write failure retains confirmed attempt checkpoint for recovery", async () => {
  const h = fixture(false);
  h.hooks.beforeWrite = async (collection) => { if (collection === "notificationIntents") throw new Error("database unavailable"); };
  await assert.rejects(h.accepted(), /database unavailable/);
  assert.equal(h.docs.get("notificationIntents/i").status, "sending");
  assert.equal(h.docs.get("smsDeliveryAttempts/a").providerMessageId, "SM1");
  h.hooks.beforeWrite = null;
  await h.recovery();
  assert.equal(h.docs.get("notificationIntents/i").status, "sent");
});

for (const competitor of ["send result", "callback"]) {
  test(`stale transaction read retries after a newer ${competitor} commits`, async () => {
    const h = fixture(true); const paused = deferred(); const release = deferred(); let first = true;
    h.hooks.beforeCommit = async () => { if (first) { first = false; paused.resolve(); await release.promise; } };
    const stale = h.recovery(); await paused.promise;
    if (competitor === "callback") await h.callback("delivered"); else await h.accepted();
    release.resolve(); await stale;
    assert.ok(h.hooks.retries >= 1);
    assert.equal(h.docs.get("notificationIntents/i").status, "sent");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").outcome, "confirmed");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, competitor === "callback" ? "delivered" : "accepted");
  });
}

test("simultaneously read callbacks retry conflict rather than overwrite terminal result", async () => {
  const h = fixture(true); const paused = deferred(); const release = deferred(); let first = true;
  h.hooks.beforeCommit = async () => { if (first) { first = false; paused.resolve(); await release.promise; } };
  const sent = h.callback("sent"); await paused.promise;
  await h.callback("delivered"); release.resolve(); await sent;
  assert.ok(h.hooks.retries >= 1);
  assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "delivered");
});


for (const transactional of [false, true]) {
  test(`confirmed acceptance survives a later rejection handler (${transactional ? "transaction" : "memory"})`, async () => {
    const h = fixture(transactional);
    await h.accepted();
    await h.reconcile({ churchId: "c", intentId: "i", attemptId: "a", update: { status: "failed", outcome: "failed", failureCode: "21609" } });
    assert.equal(h.docs.get("smsDeliveryAttempts/a").status, "accepted");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").outcome, "confirmed");
  });
  test(`competing recoveries converge and wrong recovery owner is ignored (${transactional ? "transaction" : "memory"})`, async () => {
    const h = fixture(transactional);
    assert.equal((await h.reconcile({ churchId: "c", intentId: "i", attemptId: "a", recovery: true, expectedIntent: { ...h.intent, approvedByUid: "other" }, isStaleSending: () => true })).ignored, true);
    await Promise.all([h.recovery(), h.recovery()]);
    if (transactional) assert.ok(h.hooks.retries >= 1);
    assert.equal(h.docs.get("notificationIntents/i").status, "unknown");
    assert.equal(h.docs.get("smsDeliveryAttempts/a").outcome, "unknown");
  });
}

test("failed transaction commits neither acceptance nor intent and can reconcile on retry", async () => {
  const h = fixture(true);
  h.hooks.beforeCommit = async () => { throw new Error("Firestore unavailable"); };
  await assert.rejects(h.accepted(), /Firestore unavailable/);
  assert.equal(h.docs.get("smsDeliveryAttempts/a").providerMessageId, undefined);
  assert.equal(h.docs.get("notificationIntents/i").status, "sending");
  h.hooks.beforeCommit = null;
  await h.accepted();
  assert.equal(h.docs.get("notificationIntents/i").status, "sent");
});


for (const transactional of [false, true]) {
  test(`callback with foreign persisted ownership is ignored (${transactional ? "transaction" : "memory"})`, async () => {
    for (const mismatch of [{ churchId: "other" }, { memberId: "other" }, { sourceId: "other" }, { recipientId: "other" }]) {
      const h = fixture(transactional);
      h.put("notificationIntents/i", { ...h.intent, ...mismatch });
      assert.equal((await h.callback("delivered")).payload.ignored, true);
      assert.equal(h.docs.get("smsDeliveryAttempts/a").providerMessageId, undefined);
    }
  });
}
