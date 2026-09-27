process.env.WORSHIPSYNC_SERVER_TEST_SUPPORT = "1";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";
process.env.RESEND_API_KEY = "";

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const {
  COLLECTIONS,
  getDoc,
  nowIso,
  recoverPendingIntakeSubmissionDigests,
  sendIntakeSubmissionDigest,
  setDoc,
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
});

test("a digest with no eligible recipients closes without sending", async () => {
  setIntakeNotifyRecipientsForServerTests([]);
  const { formId } = await createPendingDigest();
  let sends = 0;
  setSendEmailForServerTests(async () => {
    sends += 1;
  });

  await sendIntakeSubmissionDigest(formId);

  assert.equal(sends, 0);
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince, null);
});

test("partial provider failure retries only the undelivered recipient", async () => {
  setIntakeNotifyRecipientsForServerTests(["lead@example.test", "other@example.test"]);
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
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince != null, true);
  rejectOther = false;
  await sendIntakeSubmissionDigest(formId);

  assert.deepEqual(sent, ["lead@example.test", "other@example.test", "other@example.test"]);
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince, null);
});

test("startup recovery sends an elapsed persisted digest", async () => {
  setIntakeNotifyRecipientsForServerTests(["lead@example.test"]);
  const pendingSince = new Date(Date.now() - 25 * 60 * 1000).toISOString();
  const { formId } = await createPendingDigest({ pendingSince });
  const sent = [];
  setSendEmailForServerTests(async ({ to }) => sent.push(to));

  await recoverPendingIntakeSubmissionDigests();

  assert.deepEqual(sent, ["lead@example.test"]);
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince, null);
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
  assert.equal((await getDoc(COLLECTIONS.teamIntakeForms, formId)).pendingDigestSince, null);
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
