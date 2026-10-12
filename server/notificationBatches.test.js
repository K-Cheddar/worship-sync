import test from "node:test";
import assert from "node:assert/strict";
import { claimReviewedNotificationBatch, executeReviewedNotificationBatch, notificationBatchReviewVersion } from "./notificationBatches.js";

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const snapshot = { approvalVersion: "review", expiresAt: Date.now() + 600000 };
const makeBatch = () => ({
  batchId: "batch", churchId: "church", status: "prepared", reviewVersion: "batch-review",
  selectedMemberIds: ["one", "two"], intentIds: ["one", "two", "one"],
  recipients: ["one", "two"].map((intentId) => ({ intentId, approvalVersion: "review", status: "preview" })),
});

test("review identity binds selection, intents, approval versions and segments", () => {
  const batch = makeBatch();
  const version = notificationBatchReviewVersion(String, batch);
  assert.equal(version, notificationBatchReviewVersion(String, structuredClone(batch)));
  for (const mutate of [
    (copy) => copy.selectedMemberIds.push("three"),
    (copy) => { copy.recipients[0].intentId = "other"; },
    (copy) => { copy.recipients[0].approvalVersion = "changed"; },
    (copy) => { copy.recipients[0].segmentCount = 2; },
  ]) {
    const copy = structuredClone(batch);
    mutate(copy);
    assert.notEqual(version, notificationBatchReviewVersion(String, copy));
  }
});

test("claim permits only reviewed prepared or interrupted work in the owning church", () => {
  const args = { current: makeBatch(), churchId: "church", approvalVersion: "batch-review", actorUid: "operator", now: "now", isStaleSending: () => false, httpError };
  const claimed = claimReviewedNotificationBatch(args);
  assert.equal(claimed.status, "dispatching");
  assert.equal(claimed.approvedByUid, "operator");
  for (const change of [{ churchId: "foreign" }, { approvalVersion: "" }, { approvalVersion: "stale" }, { current: claimed }, { current: { ...claimed, status: "sent" } }, { current: { ...claimed, status: "superseded" } }]) {
    assert.throws(() => claimReviewedNotificationBatch({ ...args, ...change }));
  }
  assert.equal(claimReviewedNotificationBatch({ ...args, current: claimed, isStaleSending: () => true }).status, "dispatching");
});

const runner = (batch, intents, overrides = {}) => {
  const sent = [];
  const recovered = [];
  const args = {
    batch,
    getIntent: async (id) => intents.get(id),
    matchesSource: (intent) => intent.sourceType === "example_source",
    isStaleSending: () => true,
    markUnknownAfterInterruption: async (intent) => {
      recovered.push(intent.intentId);
      intents.set(intent.intentId, { ...intent, status: "unknown", outcome: "unknown" });
    },
    sendReviewedIntent: async ({ intentId }) => {
      sent.push(intentId);
      intents.set(intentId, { ...intents.get(intentId), status: "sent" });
      return { success: true };
    },
    nowIso: () => "now",
    ...overrides,
  };
  return { args, sent, recovered };
};
const makeIntents = () => new Map(["one", "two"].map((intentId) => [intentId, {
  intentId, churchId: "church", batchId: "batch", sourceType: "example_source",
  status: "preview", approvalSnapshot: { ...snapshot },
}]));

test("executor is source-independent, collapses duplicate IDs and skips confirmed work on resume", async () => {
  const run = runner(makeBatch(), makeIntents());
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["one", "two"]);
  assert.equal(result.status, "sent");
  await executeReviewedNotificationBatch({ ...run.args, batch: result });
  assert.deepEqual(run.sent, ["one", "two"]);
});

test("unknown, failed, sent and active sends are never automatically retried", async () => {
  for (const status of ["unknown", "failed", "sent", "sending"]) {
    const intents = makeIntents();
    intents.get("one").status = status;
    const run = runner(makeBatch(), intents, { isStaleSending: () => false });
    const result = await executeReviewedNotificationBatch(run.args);
    assert.deepEqual(run.sent, ["two"]);
    assert.equal(result.status, status === "sent" ? "sent" : "partial");
  }
});

test("stale interrupted send is uncertain while untouched recipient continues", async () => {
  const intents = makeIntents();
  intents.get("one").status = "sending";
  const run = runner(makeBatch(), intents);
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.recovered, ["one"]);
  assert.deepEqual(run.sent, ["two"]);
  assert.equal(result.status, "partial");
  assert.equal(result.recipients[0].outcome, "unknown");
});

test("changed review or foreign source blocks both send and recovery", async () => {
  for (const change of [{ churchId: "foreign" }, { batchId: "foreign" }, { sourceType: "other_feature" }, { approvalSnapshot: { ...snapshot, approvalVersion: "changed" }, status: "preview" }]) {
    const intents = makeIntents();
    Object.assign(intents.get("one"), { status: "sending" }, change);
    const run = runner(makeBatch(), intents);
    await executeReviewedNotificationBatch(run.args);
    assert.deepEqual(run.sent, ["two"]);
    assert.deepEqual(run.recovered, []);
  }
});

test("one recipient rejection leaves other recipients accounted for", async () => {
  const intents = makeIntents();
  const run = runner(makeBatch(), intents);
  const send = run.args.sendReviewedIntent;
  run.args.sendReviewedIntent = async (input) => {
    if (input.intentId !== "one") return send(input);
    intents.set("one", { ...intents.get("one"), status: "failed", approvalSnapshot: null });
    return { success: false, errorMessage: "Provider rejected" };
  };
  const result = await executeReviewedNotificationBatch(run.args);
  assert.equal(result.status, "partial");
  assert.equal(result.recipients[0].exclusionReason, "Provider rejected");
  assert.equal(result.recipients[1].status, "sent");
});

test("legacy or malformed selection without a reviewed row stays blocked", async () => {
  const batch = makeBatch();
  batch.recipients = batch.recipients.filter((row) => row.intentId !== "one");
  const intents = makeIntents();
  intents.get("one").approvalSnapshot = null;
  const run = runner(batch, intents);
  await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["two"]);
});

test("lost request can resume persisted successful intents without duplication", async () => {
  const intents = makeIntents();
  const run = runner(makeBatch(), intents);
  const send = run.args.sendReviewedIntent;
  run.args.sendReviewedIntent = async (input) => {
    if (input.intentId === "two") throw new Error("process interrupted before second claim");
    return send(input);
  };
  await assert.rejects(executeReviewedNotificationBatch(run.args), /process interrupted/);
  run.args.sendReviewedIntent = send;
  const result = await executeReviewedNotificationBatch(run.args);
  assert.deepEqual(run.sent, ["one", "two"]);
  assert.equal(result.status, "sent");
});
