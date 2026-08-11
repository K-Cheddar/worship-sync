import test from "node:test";
import assert from "node:assert/strict";

import {
  createNotificationLedger,
  deliveryKey,
  partitionUndelivered,
} from "./notificationLedger.js";

const send = (overrides = {}) => ({
  recipient: "vol@church.test",
  event: "schedule.assigned",
  subject: "sched-1",
  occurrence: "svc-a@2026-09-06",
  ...overrides,
});

test("the key is stable and case-insensitive", () => {
  assert.equal(deliveryKey(send()), deliveryKey(send()));
  assert.equal(
    deliveryKey(send({ recipient: "VOL@CHURCH.TEST" })),
    deliveryKey(send()),
  );
});

test("each of the four fields changes identity", () => {
  const base = deliveryKey(send());
  assert.notEqual(deliveryKey(send({ recipient: "other@church.test" })), base);
  assert.notEqual(deliveryKey(send({ event: "schedule.changed" })), base);
  assert.notEqual(deliveryKey(send({ subject: "sched-2" })), base);
  // Four Sundays is four notifications, not one.
  assert.notEqual(deliveryKey(send({ occurrence: "svc-a@2026-09-13" })), base);
});

test("a value containing the separator cannot impersonate another key", () => {
  // Without escaping, subject "a|b" + occurrence "c" would collide with
  // subject "a" + occurrence "b|c".
  assert.notEqual(
    deliveryKey(send({ subject: "a|b", occurrence: "c" })),
    deliveryKey(send({ subject: "a", occurrence: "b|c" })),
  );
});

test("missing optional fields are stable rather than undefined-stringified", () => {
  const key = deliveryKey({ recipient: "a@b.test", event: "x" });
  assert.equal(key, deliveryKey({ recipient: "a@b.test", event: "x" }));
  assert.ok(!key.includes("undefined"));
});

test("already-delivered sends are suppressed", () => {
  const sent = new Set([deliveryKey(send())]);
  const { pending, suppressed } = partitionUndelivered(
    [send(), send({ occurrence: "svc-a@2026-09-13" })],
    sent,
  );

  assert.equal(pending.length, 1);
  assert.equal(pending[0].occurrence, "svc-a@2026-09-13");
  assert.equal(suppressed.length, 1);
});

test("duplicates within one batch collapse", () => {
  // A member listed in two positions on one service should hear once.
  const { pending, suppressed } = partitionUndelivered(
    [send(), send()],
    new Set(),
  );

  assert.equal(pending.length, 1);
  assert.equal(suppressed.length, 1);
});

test("pending sends carry their key so the caller records the same one", () => {
  const { pending } = partitionUndelivered([send()], new Set());
  assert.equal(pending[0].deliveryKey, deliveryKey(send()));
});

test("the ledger only asks the store about keys it is considering", async () => {
  const asked = [];
  const saved = [];
  const ledger = createNotificationLedger({
    listKeys: async (churchId, keys) => {
      asked.push({ churchId, keys });
      return [deliveryKey(send())];
    },
    saveKey: async (churchId, entry) => saved.push({ churchId, entry }),
  });

  const { pending } = await ledger.selectPending("church-1", [
    send(),
    send({ event: "schedule.changed" }),
  ]);

  assert.equal(asked.length, 1);
  assert.equal(asked[0].churchId, "church-1");
  assert.equal(asked[0].keys.length, 2);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].event, "schedule.changed");

  await ledger.record("church-1", pending[0]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entry.deliveryKey, pending[0].deliveryKey);
  assert.equal(saved[0].entry.event, "schedule.changed");
});

test("an empty batch does not hit the store", async () => {
  let called = false;
  const ledger = createNotificationLedger({
    listKeys: async () => {
      called = true;
      return [];
    },
    saveKey: async () => {},
  });

  const result = await ledger.selectPending("church-1", []);

  assert.deepEqual(result, { pending: [], suppressed: [] });
  assert.equal(called, false);
});
