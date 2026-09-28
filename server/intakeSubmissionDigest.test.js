process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const {
  COLLECTIONS,
  getDoc,
  nowIso,
  persistIntakeSubmissionForServerTests,
  recoverPendingIntakeSubmissionDigests,
  sendIntakeSubmissionDigest,
  setDoc,
  setServerFirestoreForTests,
  setIntakeNotifyRecipientsForServerTests,
  setSendEmailForServerTests,
} = await import("../authService.js");

let formCounter = 0;
const createPendingDigest = async ({ pendingSince = nowIso() } = {}) => {
  const formId = `intake_digest_test_${++formCounter}`;
  const churchId = `intake_digest_church_${formCounter}`;
  await setDoc(COLLECTIONS.teamIntakeForms, formId, {
    formId,
    churchId,
    name: "Fall availability",
    pendingDigestSince: pendingSince,
  });
  await setDoc(COLLECTIONS.teamIntakeSubmissions, `submission_${formId}`, {
    submissionId: `submission_${formId}`,
    formId,
    churchId,
    firstName: "Avery",
    lastName: "Stone",
    submittedAt: pendingSince,
  });
  return { formId, churchId };
};

afterEach(() => {
  setIntakeNotifyRecipientsForServerTests(null);
  setSendEmailForServerTests(null);
  setServerFirestoreForTests(null);
});

const clone = (value) => structuredClone(value);
const mergeFirestore = (current, update) => {
  const result = { ...(current || {}) };
  for (const [key, value] of Object.entries(update)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergeFirestore(result[key], value)
        : value;
  }
  return result;
};

const createFirestore = (seed = {}) => {
  const stores = new Map(
    Object.entries(seed).map(([name, docs]) => [
      name,
      new Map(Object.entries(docs).map(([id, value]) => [id, clone(value)])),
    ]),
  );
  const getStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  let database;
  const snapshot = (id, data, ref) => ({
    id,
    ref,
    exists: Boolean(data),
    data: () => (data ? clone(data) : undefined),
  });
  const collection = (name) => {
    const store = getStore(name);
    const doc = (id) => {
      const ref = {
        id,
        collection: name,
        async get() {
          return snapshot(id, store.get(id), ref);
        },
        async set(data, options = {}) {
          store.set(
            id,
            options.merge ? mergeFirestore(store.get(id), data) : clone(data),
          );
        },
        async update(data) {
          const current = store.get(id);
          if (!current) throw new Error("document does not exist");
          store.set(id, { ...current, ...clone(data) });
        },
      };
      return ref;
    };
    return {
      doc,
      where(field, op, value) {
        const filters = [{ field, op, value }];
        let limit = Infinity;
        let cursor = null;
        let cursorArgs = null;
        const query = {
          where(nextField, nextOp, nextValue) {
            filters.push({ field: nextField, op: nextOp, value: nextValue });
            return query;
          },
          orderBy() {
            return query;
          },
          startAfter(...args) {
            cursorArgs = args;
            return query;
          },
          limit(count) {
            limit = count;
            return query;
          },
          async get() {
            await database.beforeQuery?.(name, filters);
            let docs = [...store.entries()]
              .filter(([id, value]) =>
                filters.every((filter) => {
                  const actual =
                    filter.field === "__name__" ? id : value[filter.field];
                  if (filter.op === "==") return actual === filter.value;
                  if (filter.op === ">") return actual > filter.value;
                  return false;
                }),
              )
              .sort(
                ([idA, a], [idB, b]) =>
                  String(a.pendingDigestSince || "").localeCompare(
                    String(b.pendingDigestSince || ""),
                  ) || idA.localeCompare(idB),
              );
            if (cursorArgs) {
              const [since, id] = cursorArgs;
              docs = docs.filter(
                ([docId, value]) =>
                  value.pendingDigestSince > since ||
                  (value.pendingDigestSince === since && docId > id),
              );
            }
            docs = docs.slice(0, limit).map(([id, value]) => ({
              id,
              ref: doc(id),
              data: () => clone(value),
            }));
            return { docs };
          },
        };
        return query;
      },
    };
  };

  let transactionTail = Promise.resolve();
  database = {
    collection,
    async runTransaction(callback) {
      if (database.beforeTransaction) await database.beforeTransaction();
      let release;
      const previous = transactionTail;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const run = async () => {
          const writes = [];
          const result = await callback({
            async get(ref) {
              if (typeof ref.get === "function") return ref.get();
              throw new Error("Unsupported transaction query");
            },
            set(ref, data, options) {
              writes.push({ type: "set", ref, data, options });
            },
            update(ref, data) {
              writes.push({ type: "update", ref, data });
            },
          });
          return { result, writes };
        };
        let pending = await run();
        if (database.retryTransactions > 0) {
          database.retryTransactions -= 1;
          database.transactionCallbackRuns += 1;
          pending = await run();
        }
        const { result, writes } = pending;
        for (const write of writes) {
          const store = getStore(write.ref.collection);
          if (write.type === "update") {
            store.set(write.ref.id, {
              ...store.get(write.ref.id),
              ...clone(write.data),
            });
          } else {
            const next = write.options?.merge
              ? mergeFirestore(store.get(write.ref.id), write.data)
              : clone(write.data);
            store.set(write.ref.id, next);
          }
        }
        return result;
      } finally {
        release();
      }
    },
    read(name, id) {
      return clone(getStore(name).get(id));
    },
    retryTransactions: 0,
    transactionCallbackRuns: 0,
  };
  return database;
};

test("a digest with no eligible recipients closes without sending", async () => {
  setIntakeNotifyRecipientsForServerTests([]);
  const { formId } = await createPendingDigest();
  let sends = 0;
  setSendEmailForServerTests(async () => {
    sends += 1;
  });

  await sendIntakeSubmissionDigest(formId);

  assert.equal(sends, 0);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("partial provider failure retries only the undelivered recipient", async () => {
  setIntakeNotifyRecipientsForServerTests([
    "lead@example.test",
    "other@example.test",
  ]);
  const { formId } = await createPendingDigest();
  const sent = [];
  let rejectOther = true;
  setSendEmailForServerTests(async ({ to }) => {
    sent.push(to);
    if (to === "other@example.test" && rejectOther) {
      throw new Error("provider unavailable");
    }
  });

  await sendIntakeSubmissionDigest(formId);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince !=
      null,
    true,
  );
  rejectOther = false;
  await sendIntakeSubmissionDigest(formId);

  assert.deepEqual(sent, [
    "lead@example.test",
    "other@example.test",
    "other@example.test",
  ]);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("startup recovery sends an elapsed persisted digest", async () => {
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  const pendingSince = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const { formId } = await createPendingDigest({ pendingSince });
  const sent = [];
  setSendEmailForServerTests(async ({ to }) => sent.push(to));

  await recoverPendingIntakeSubmissionDigests();

  assert.deepEqual(sent, ["lead@example.test"]);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("provider retries stop at the configured bound and clear exhausted work", async () => {
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  const { formId } = await createPendingDigest();
  let sends = 0;
  setSendEmailForServerTests(async () => {
    sends += 1;
    throw new Error("provider unavailable");
  });

  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);

  assert.equal(sends, 3);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("overlapping digest execution does not send the same form twice", async () => {
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  const { formId } = await createPendingDigest();
  let resolveSend;
  let notifyStarted;
  const started = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  let sends = 0;
  setSendEmailForServerTests(
    () =>
      new Promise((resolve) => {
        sends += 1;
        resolveSend = resolve;
        notifyStarted();
      }),
  );

  const first = sendIntakeSubmissionDigest(formId);
  await started;
  await sendIntakeSubmissionDigest(formId);
  resolveSend();
  await first;

  assert.equal(sends, 1);
});

test("Firestore top-level replacement clears exhausted attempts for the next batch", async () => {
  const formId = `intake_firestore_digest_${++formCounter}`;
  const churchId = `intake_firestore_church_${formCounter}`;
  const recipient = "lead@example.test";
  const attemptKey = crypto
    .createHash("sha256")
    .update(recipient)
    .digest("hex");
  const since = nowIso();
  const db = createFirestore({
    [COLLECTIONS.teamIntakeForms]: {
      [formId]: {
        formId,
        churchId,
        name: "Fall availability",
        pendingDigestSince: since,
        pendingDigestBatchId: "batch-one",
        pendingDigestAttempts: { [attemptKey]: 0 },
      },
    },
    [COLLECTIONS.teamIntakeSubmissions]: {
      first: {
        submissionId: "first",
        formId,
        churchId,
        firstName: "Avery",
        submittedAt: since,
        digestBatchId: "batch-one",
      },
    },
  });
  setServerFirestoreForTests(db);
  setIntakeNotifyRecipientsForServerTests([recipient]);
  const sent = [];
  let reject = true;
  setSendEmailForServerTests(async ({ idempotencyKey, to }) => {
    sent.push({ idempotencyKey, to });
    if (reject) throw new Error("provider unavailable");
  });

  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);
  await sendIntakeSubmissionDigest(formId);
  const exhausted = await getDoc(COLLECTIONS.teamIntakeForms, formId);
  assert.deepEqual(exhausted.pendingDigestAttempts, {});
  assert.equal(exhausted.pendingDigestSince, null);

  reject = false;
  const nextSince = nowIso();
  await setDoc(
    COLLECTIONS.teamIntakeForms,
    formId,
    {
      pendingDigestSince: nextSince,
      pendingDigestBatchId: "batch-two",
      pendingDigestAttempts: {},
    },
    { merge: true },
  );
  await setDoc(COLLECTIONS.teamIntakeSubmissions, "second", {
    submissionId: "second",
    formId,
    churchId,
    firstName: "Jordan",
    submittedAt: nextSince,
    digestBatchId: "batch-two",
  });
  await sendIntakeSubmissionDigest(formId);

  assert.equal(sent.length, 4);
  assert.ok(sent.every((entry) => entry.to === recipient));
  assert.notEqual(sent[0].idempotencyKey, sent[3].idempotencyKey);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("Firestore batch handoff preserves submissions at each delivery boundary", async () => {
  for (const boundary of [
    "before-query",
    "during-send",
    "before-clear",
    "after-clear",
  ]) {
    const formId = `intake_handoff_${boundary}_${++formCounter}`;
    const churchId = `intake_handoff_church_${formCounter}`;
    const since = nowIso();
    const db = createFirestore({
      [COLLECTIONS.teamIntakeForms]: {
        [formId]: {
          formId,
          churchId,
          name: "Fall availability",
          pendingDigestSince: since,
          pendingDigestBatchId: "first-batch",
          pendingDigestAttempts: {},
        },
      },
      [COLLECTIONS.teamIntakeSubmissions]: {
        first: {
          submissionId: "first",
          formId,
          churchId,
          firstName: "Avery",
          submittedAt: since,
          digestBatchId: "first-batch",
        },
      },
    });
    setServerFirestoreForTests(db);
    setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
    const emails = [];
    let releaseSend;
    let sendStarted;
    const started = new Promise((resolve) => {
      sendStarted = resolve;
    });
    const followup = () =>
      persistIntakeSubmissionForServerTests({
        submissionId: `second-${boundary}`,
        formId,
        churchId,
        status: "new",
        firstName: "Jordan",
        submittedAt: nowIso(),
      });
    setSendEmailForServerTests(async (payload) => {
      emails.push(payload.textBody);
      if (boundary === "during-send" && emails.length === 1) {
        sendStarted();
        await new Promise((resolve) => {
          releaseSend = resolve;
        });
      }
    });

    if (boundary === "before-query") {
      db.beforeTransaction = async () => {
        db.transactionNumber = (db.transactionNumber || 0) + 1;
        if (db.transactionNumber !== 2 || db.injected) return;
        db.injected = true;
        await followup();
      };
    }
    if (boundary === "before-clear") {
      db.beforeTransaction = async () => {
        db.transactionNumber = (db.transactionNumber || 0) + 1;
        if (db.transactionNumber === 3) await followup();
      };
    }

    const firstDigest = sendIntakeSubmissionDigest(formId);
    if (boundary === "during-send") {
      await started;
      await followup();
      releaseSend();
    }
    await firstDigest;
    if (boundary === "after-clear") await followup();
    await sendIntakeSubmissionDigest(formId);

    if (boundary === "before-query") {
      assert.equal(
        emails.length,
        1,
        "work arriving before the query joins the active batch",
      );
      assert.match(emails[0], /Avery/);
      assert.match(emails[0], /Jordan/);
      continue;
    }
    assert.equal(
      emails.length,
      2,
      `${boundary}: each batch should be sent once`,
    );
    assert.match(emails[0], /Avery/);
    assert.doesNotMatch(emails[0], /Jordan/);
    assert.match(emails[1], /Jordan/);
    assert.doesNotMatch(emails[1], /Avery/);
  }
});

test("separate module instances honor the Firestore lease and expired claims recover", async () => {
  const secondInstance =
    await import("../authService.js?intake-second-instance");
  const formId = `intake_lease_${++formCounter}`;
  const churchId = `intake_lease_church_${formCounter}`;
  const since = nowIso();
  const db = createFirestore({
    [COLLECTIONS.teamIntakeForms]: {
      [formId]: {
        formId,
        churchId,
        name: "Fall availability",
        pendingDigestSince: since,
        pendingDigestBatchId: "lease-batch",
        pendingDigestAttempts: {},
      },
    },
    [COLLECTIONS.teamIntakeSubmissions]: {
      first: {
        submissionId: "first",
        formId,
        churchId,
        firstName: "Avery",
        submittedAt: since,
        digestBatchId: "lease-batch",
      },
    },
  });
  setServerFirestoreForTests(db);
  secondInstance.setServerFirestoreForTests(db);
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  secondInstance.setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  let release;
  let started;
  const waiting = new Promise((resolve) => {
    started = resolve;
  });
  let sends = 0;
  setSendEmailForServerTests(async () => {
    sends += 1;
    started();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  secondInstance.setSendEmailForServerTests(async () => {
    sends += 1;
  });

  const first = sendIntakeSubmissionDigest(formId);
  await waiting;
  await secondInstance.sendIntakeSubmissionDigest(formId);
  release();
  await first;
  assert.equal(sends, 1);

  const expiredId = `intake_expired_lease_${++formCounter}`;
  const expiredSince = nowIso();
  await setDoc(COLLECTIONS.teamIntakeForms, expiredId, {
    formId: expiredId,
    churchId,
    name: "Fall availability",
    pendingDigestSince: expiredSince,
    pendingDigestBatchId: "expired-batch",
    pendingDigestAttempts: {},
    pendingDigestClaim: {
      claimId: "abandoned-claim",
      batchId: "expired-batch",
      since: expiredSince,
      attempts: {},
      leaseUntil: Date.now() - 1,
    },
  });
  await setDoc(COLLECTIONS.teamIntakeSubmissions, "expired-first", {
    submissionId: "expired-first",
    formId: expiredId,
    churchId,
    firstName: "Morgan",
    submittedAt: expiredSince,
    digestBatchId: "expired-batch",
  });
  setSendEmailForServerTests(async () => {
    sends += 1;
  });
  await sendIntakeSubmissionDigest(expiredId);
  assert.equal(sends, 2);
  secondInstance.setServerFirestoreForTests(null);
});

test("a committed submission survives a missed scheduler and transaction retry", async () => {
  const formId = `intake_crash_recovery_${++formCounter}`;
  const churchId = `intake_crash_church_${formCounter}`;
  const db = createFirestore({
    [COLLECTIONS.teamIntakeForms]: {
      [formId]: { formId, churchId, name: "Fall availability" },
    },
  });
  setServerFirestoreForTests(db);
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  const sends = [];
  setSendEmailForServerTests(async (payload) => sends.push(payload.to));
  db.retryTransactions = 1;
  const submittedAt = nowIso();
  await persistIntakeSubmissionForServerTests({
    submissionId: "durable-submission",
    formId,
    churchId,
    status: "new",
    firstName: "Avery",
    submittedAt,
  });
  assert.equal(db.transactionCallbackRuns, 1);
  assert.equal(
    db.read(COLLECTIONS.teamIntakeSubmissions, "durable-submission")
      .digestBatchId,
    db.read(COLLECTIONS.teamIntakeForms, formId).pendingDigestBatchId,
  );
  assert.equal(
    sends.length,
    0,
    "simulated process stop happens before timer scheduling",
  );

  await setDoc(
    COLLECTIONS.teamIntakeForms,
    formId,
    {
      pendingDigestSince: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    },
    { merge: true },
  );
  await recoverPendingIntakeSubmissionDigests();

  assert.deepEqual(sends, ["lead@example.test"]);
  assert.equal(
    (await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince,
    null,
  );
});

test("recovery advances past the first 100 pending forms", async () => {
  const churchId = `intake_recovery_page_${++formCounter}`;
  const forms = {};
  const submissions = {};
  for (let index = 0; index < 105; index += 1) {
    const formId = `intake_page_${String(index).padStart(3, "0")}`;
    const since = new Date(Date.now() - 25 * 60 * 1000 + index).toISOString();
    const batchId = `batch-${index}`;
    forms[formId] = {
      formId,
      churchId,
      name: "Fall availability",
      pendingDigestSince: since,
      pendingDigestBatchId: batchId,
      pendingDigestAttempts: {},
    };
    submissions[`submission-${index}`] = {
      submissionId: `submission-${index}`,
      formId,
      churchId,
      firstName: `Person${index}`,
      submittedAt: since,
      digestBatchId: batchId,
    };
  }
  const db = createFirestore({
    [COLLECTIONS.teamIntakeForms]: forms,
    [COLLECTIONS.teamIntakeSubmissions]: submissions,
  });
  setServerFirestoreForTests(db);
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  let sends = 0;
  setSendEmailForServerTests(async () => {
    sends += 1;
  });

  await recoverPendingIntakeSubmissionDigests();
  assert.equal(sends, 100);
  await recoverPendingIntakeSubmissionDigests();
  assert.equal(sends, 105);
});
