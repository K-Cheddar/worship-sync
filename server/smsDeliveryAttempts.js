export const SMS_DELIVERY_STATUSES = [
  "pending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
];

const STATUS_RANK = new Map([
  ["pending", 0],
  ["accepted", 1],
  ["sent", 2],
  ["delivered", 3],
  ["undelivered", 3],
  ["failed", 3],
]);

const FINAL_STATUSES = new Set(["delivered", "undelivered", "failed"]);

export const normalizeSmsDeliveryStatus = (value, fallback = "accepted") => {
  const status = String(value || "").trim().toLowerCase();
  return SMS_DELIVERY_STATUSES.includes(status) ? status : fallback;
};

/** Keep final provider callbacks from being regressed by delayed callbacks. */
export const nextSmsDeliveryStatus = (current, incoming) => {
  const currentStatus = normalizeSmsDeliveryStatus(current, "pending");
  const incomingStatus = normalizeSmsDeliveryStatus(incoming, currentStatus);
  if (currentStatus === incomingStatus) return currentStatus;
  if (FINAL_STATUSES.has(currentStatus)) return currentStatus;
  if ((STATUS_RANK.get(incomingStatus) || 0) < (STATUS_RANK.get(currentStatus) || 0)) {
    return currentStatus;
  }
  return incomingStatus;
};

// Shared by claims, results, recovery and callbacks in the fallback store.
const deliveryLocks = new WeakMap();
export const withSmsDeliveryLock = (store, key, task) => {
  let locks = deliveryLocks.get(store);
  if (!locks) { locks = new Map(); deliveryLocks.set(store, locks); }
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.then(() => undefined, () => undefined);
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return current;
};

export const hasConfirmedSmsEvidence = (attempt) => Boolean(attempt && (
  attempt.providerMessageId || attempt.outcome === "confirmed" ||
  ["accepted", "sent", "delivered", "undelivered"].includes(attempt.status)
));

/** All delivery writers read inside this boundary. Twilio is outside it. */
export const createSmsDeliveryReconciler = ({
  COLLECTIONS = { smsDeliveryAttempts: "smsDeliveryAttempts", notificationIntents: "notificationIntents" },
  getDoc, setDoc, requireFirestore = () => null, nowIso,
}) => async ({ attemptId, churchId, intentId, expectedIntent, update = {}, recovery = false, isStaleSending, callbackToken, callbackPhone, callbackAccount, requireProviderMessageId = false }) => {
  const db = requireFirestore();
  const apply = async (read, write) => {
    const attempt = attemptId ? await read(COLLECTIONS.smsDeliveryAttempts, attemptId) : null;
    const relatedId = intentId || attempt?.notificationIntentId;
    const intent = relatedId ? await read(COLLECTIONS.notificationIntents, relatedId) : null;
    const ignored = { ignored: true, updated: false, intent, attempt };
    // A matching intent pointer lets recovery fence a missing attempt as unknown.
    const recoveryOwnsMissingAttempt = (recovery || update.outcome === "not_sent") && attemptId && !attempt &&
      intent?.attemptId === attemptId && intent?.status === "sending";
    if (attemptId && ((!attempt && !recoveryOwnsMissingAttempt) ||
        (attempt?.attemptId && attempt.attemptId !== attemptId))) return ignored;
    if (churchId && attempt && attempt.churchId !== churchId) return ignored;
    if (attemptId && intentId && attempt && attempt.notificationIntentId !== intentId) return ignored;
    if (callbackToken !== undefined && (!attempt?.callbackToken || attempt.callbackToken !== callbackToken)) return ignored;
    if (callbackPhone && callbackPhone !== attempt?.phoneNumberSnapshot) return ignored;
    if (callbackAccount && attempt?.providerAccountId && callbackAccount !== attempt.providerAccountId) return ignored;
    if (requireProviderMessageId && attempt?.providerMessageId !== update.providerMessageId) return ignored;
    if (update.providerMessageId && attempt?.providerMessageId && update.providerMessageId !== attempt.providerMessageId) return ignored;
    if (intent && attempt && (intent.churchId !== attempt.churchId ||
        intent.memberId !== attempt.memberId || (intent.recipientId || intent.memberId) !== attempt.recipientId ||
        intent.sourceId !== attempt.sourceId)) return ignored;
    if (intent?.attemptId === attemptId && attempt &&
        ["batchId", "formId", "occurrenceId", "cellKey", "intentType"].some((key) =>
          attempt[key] !== undefined && String(attempt[key] || "") !== String(intent[key] || ""))) return ignored;
    if (intent?.attemptId === attemptId && intent?.providerMessageId && update.providerMessageId && intent.providerMessageId !== update.providerMessageId) return ignored;
    let neverStarted = false;
    if (recovery) {
      if (!intent || intent.churchId !== churchId || intent.attemptId !== expectedIntent.attemptId ||
          ["sourceId", "memberId", "recipientId", "batchId", "sendStartedAt", "approvedByUid"].some((key) => intent[key] !== expectedIntent[key])) return ignored;
      if (!hasConfirmedSmsEvidence(attempt) && !intent.providerMessageId && intent.status !== "sent" && (intent.status !== "sending" || !isStaleSending(intent))) return ignored;
    }
    const now = nowIso();
    const intentEvidence = intent?.attemptId === attemptId && Boolean(intent.providerMessageId || (intent.status === "sent" && (!intent.providerAcceptedAttemptId || intent.providerAcceptedAttemptId === attemptId)));
    // Absence or a legacy marker is ambiguous; only persisted false proves no provider call began.
    neverStarted = Boolean(attempt && attemptId && intent?.attemptId === attemptId &&
      (recovery || update.outcome === "not_sent") && !hasConfirmedSmsEvidence(attempt) &&
      !intentEvidence && !intent?.providerMessageId && attempt.providerCallStarted === false);
    const notSentWithoutDurableStartEvidence = update.outcome === "not_sent" &&
      attempt?.providerCallStarted !== false;
    const effectiveUpdate = neverStarted ? {
      status: "failed", outcome: "not_sent",
      failureCode: "dispatch_interrupted_before_provider",
      failureMessage: "The message was not sent because sending stopped before contacting the provider.",
    } : notSentWithoutDurableStartEvidence ? {
      status: "pending", outcome: "unknown",
      failureCode: "provider_start_unconfirmed",
      failureMessage: "Delivery status could not be confirmed because durable evidence that sending had not started is unavailable.",
    } : update;
    let nextAttempt = attempt;
    if (attempt) {
      const confirmed = hasConfirmedSmsEvidence(attempt) || intentEvidence || Boolean(effectiveUpdate.providerMessageId) || effectiveUpdate.outcome === "confirmed";
      // Definitive rejection also survives a later generic interrupted handler.
      const definitive = ["failed", "not_sent"].includes(attempt.outcome);
      const patch = confirmed ? {
        ...((effectiveUpdate.providerMessageId || (intentEvidence && intent.providerMessageId)) ? { providerMessageId: effectiveUpdate.providerMessageId || intent.providerMessageId } : {}),
        outcome: "confirmed", status: nextSmsDeliveryStatus(
          hasConfirmedSmsEvidence(attempt) ? attempt.status : "pending",
          (effectiveUpdate.outcome === "confirmed" || effectiveUpdate.providerMessageId) ? effectiveUpdate.status || "accepted" : attempt.status || "accepted"),
        acceptedAt: attempt.acceptedAt || (intentEvidence && intent.sentAt) || now,
      } : definitive ? {} : effectiveUpdate;
      if (confirmed && (effectiveUpdate.outcome === "confirmed" || effectiveUpdate.providerMessageId) && effectiveUpdate.status === patch.status) {
        for (const key of ["failureCode", "failureMessage"]) if (effectiveUpdate[key]) patch[key] = effectiveUpdate[key];
        if (["sent", "delivered", "undelivered", "failed"].includes(patch.status)) {
          const timestamp = `${patch.status}At`;
          patch[timestamp] = attempt[timestamp] || now;
        }
      }
      const changed = Object.entries(patch).some(([key, value]) => attempt[key] !== value);
      nextAttempt = changed ? { ...attempt, ...patch, updatedAt: now } : attempt;
      // In memory this checkpoint precedes intent adoption so a failed second
      // write remains repairable. Firestore commits both documents atomically.
      if (changed) await write(COLLECTIONS.smsDeliveryAttempts, attemptId, { ...patch, updatedAt: now });
    }
    let nextIntent = intent;
    if (intent && (!attempt || intent.attemptId === attemptId)) {
      const confirmed = hasConfirmedSmsEvidence(nextAttempt) || intent.status === "sent" || intent.providerMessageId || intent.providerAcceptedAttemptId;
      const outcome = nextAttempt?.outcome || effectiveUpdate.outcome;
      const patch = confirmed ? {
        status: "sent", outcome: "confirmed",
        ...(hasConfirmedSmsEvidence(nextAttempt) ? { providerAcceptedAttemptId: intent.providerAcceptedAttemptId || attemptId } : {}),
        ...(nextAttempt?.providerMessageId ? { providerMessageId: nextAttempt.providerMessageId } : {}),
        sentAt: intent.sentAt || nextAttempt?.acceptedAt || now,
      } : ["failed", "not_sent"].includes(outcome) ? {
        status: neverStarted ? "preview" : "failed", outcome,
        ...(!neverStarted ? { approvalSnapshot: null } : {}),
      } : { status: "unknown", outcome: "unknown" };
      if (Object.entries(patch).some(([key, value]) => intent[key] !== value)) {
        nextIntent = { ...intent, ...patch, updatedAt: now };
        await write(COLLECTIONS.notificationIntents, relatedId, { ...patch, updatedAt: now });
      }
    }
    // A late callback belongs to its original attempt. Keep the newer attempt
    // pointer/status intact, but permanently fence further sends of this intent.
    if (intent && attempt && intent.attemptId !== attemptId && hasConfirmedSmsEvidence(nextAttempt) && !intent.providerAcceptedAttemptId) {
      nextIntent = { ...intent, providerAcceptedAttemptId: attemptId, updatedAt: now };
      await write(COLLECTIONS.notificationIntents, relatedId, { providerAcceptedAttemptId: attemptId, updatedAt: now });
    }
    return { updated: nextIntent !== intent || nextAttempt !== attempt, intent: nextIntent, attempt: nextAttempt };
  };
  if (db) return db.runTransaction(async (transaction) => apply(
    async (collection, id) => {
      const snapshot = await transaction.get(db.collection(collection).doc(id));
      return snapshot.exists ? snapshot.data() : null;
    },
    (collection, id, patch) => transaction.set(db.collection(collection).doc(id), patch, { merge: true }),
  ));
  // SID lookup is attribution only; actual state is reread under the intent lock.
  const discovered = !intentId && attemptId ? await getDoc(COLLECTIONS.smsDeliveryAttempts, attemptId) : null;
  return withSmsDeliveryLock(getDoc, `${churchId || discovered?.churchId}|${intentId || discovered?.notificationIntentId || attemptId}`, () => apply(
    getDoc, (collection, id, patch) => setDoc(collection, id, patch, { merge: true }),
  ));
};
