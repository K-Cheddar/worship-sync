// Transport-independent batch mechanics. Source adapters own recipient selection,
// secure links, authorization and source freshness; sendReviewedIntent must use
// the existing durable intent claim and final eligibility validation.
export const notificationBatchReviewVersion = (hashValue, batch) => hashValue(JSON.stringify({
  batchId: batch.batchId,
  selectedMemberIds: batch.selectedMemberIds,
  recipients: batch.recipients.map((row) => ({
    intentId: row.intentId || "", approvalVersion: row.approvalVersion || "", segmentCount: row.segmentCount || 0,
  })),
}));

// Call only inside the datastore transaction (or fallback-store lock).
export const claimReviewedNotificationBatch = ({
  current, churchId, approvalVersion, actorUid, now, isStaleSending, httpError,
}) => {
  if (!current || current.churchId !== churchId) throw httpError(404, "Message batch not found.");
  if (!approvalVersion || approvalVersion !== current.reviewVersion) throw httpError(409, "This batch preview changed or expired. Review the current batch and confirm again.");
  if (current.status === "dispatching" && !isStaleSending({ sendStartedAt: current.dispatchStartedAt })) throw httpError(409, "This message batch is already being sent.");
  const recoverableStatus = current.status === "dispatching" ? "partial" : current.status;
  if (!["prepared", "partial"].includes(recoverableStatus)) throw httpError(409, "This message batch has already been completed.");
  return { ...current, status: "dispatching", approvedByUid: actorUid, confirmedAt: now, dispatchStartedAt: now, updatedAt: now };
};

export const approveReviewedScheduleBatch = ({
  current, churchId, scheduleId, approvalVersion, actorUid, approvedRecipients,
  now, httpError,
}) => {
  if (!current || current.churchId !== churchId || current.scheduleId !== scheduleId ||
      current.sourceType !== "team_schedule" || current.intentType !== "schedule_initial_notification") {
    throw httpError(404, "Message batch not found.");
  }
  if (!approvalVersion || approvalVersion !== current.reviewVersion) {
    throw httpError(409, "This schedule review changed. Review the current messages again.");
  }
  if (current.approval?.reviewVersion === approvalVersion &&
      ["approved", "dispatching", "complete", "partial"].includes(current.status)) {
    return current;
  }
  if (current.status !== "prepared" || !actorUid) {
    throw httpError(409, "This schedule review is no longer available for approval.");
  }
  return {
    ...current,
    status: "approved",
    dispatchPriorityAt: Number.isFinite(Date.parse(now)) ? Date.parse(now) : Number(current.dispatchPriorityAt || 0),
    approval: {
      reviewVersion: approvalVersion,
      actorUid,
      approvedAt: now,
      recipients: approvedRecipients,
    },
    approvedByUid: actorUid,
    approvedAt: now,
    approvedReviewVersion: approvalVersion,
    updatedAt: now,
  };
};

export const claimApprovedScheduleBatch = ({
  current, churchId, ownerToken, now, leaseMs, httpError,
}) => {
  if (!current || current.churchId !== churchId || current.sourceType !== "team_schedule" ||
      current.intentType !== "schedule_initial_notification" || !current.approval?.actorUid ||
      current.approval.reviewVersion !== current.reviewVersion) {
    return null;
  }
  const activeLease = current.status === "dispatching" &&
    String(current.dispatchOwnerToken || "") &&
    Number(current.dispatchLeaseExpiresAt || 0) > now;
  if (activeLease) return null;
  if (!new Set(["approved", "dispatching"]).has(current.status)) return null;
  if (!ownerToken || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw httpError(500, "A valid dispatcher lease is required.");
  }
  const generation = Number(current.dispatchGeneration || 0) + 1;
  return {
    ...current,
    status: "dispatching",
    dispatchOwnerToken: ownerToken,
    dispatchGeneration: generation,
    dispatchLeaseExpiresAt: now + leaseMs,
    dispatchHeartbeatAt: now,
    dispatchStartedAt: current.dispatchStartedAt || now,
    updatedAt: new Date(now).toISOString(),
  };
};

export const ownsScheduleBatchLease = (current, ownership) => Boolean(
  current && ownership && current.status === "dispatching" &&
  current.dispatchOwnerToken === ownership.ownerToken &&
  Number(current.dispatchGeneration) === Number(ownership.generation),
);

export const renewScheduleBatchLease = ({ current, ownership, now, leaseMs }) => {
  if (!ownsScheduleBatchLease(current, ownership)) return null;
  return {
    ...current,
    dispatchLeaseExpiresAt: now + leaseMs,
    dispatchHeartbeatAt: now,
    updatedAt: new Date(now).toISOString(),
  };
};

export const updateScheduleBatchRecipient = ({ current, ownership, memberId, patch, now }) => {
  if (!ownsScheduleBatchLease(current, ownership)) return null;
  let found = false;
  const recipients = (current.recipients || []).map((row) => {
    if (row.memberId !== memberId) return row;
    found = true;
    if (Object.entries(patch || {}).every(([key, value]) => row[key] === value)) return row;
    return { ...row, ...patch, memberId };
  });
  if (!found) return null;
  if (recipients.every((row, index) => row === current.recipients[index])) return current;
  return { ...current, recipients, updatedAt: new Date(now).toISOString() };
};

export const releaseScheduleBatchLease = ({ current, ownership, now, status }) => {
  if (!ownsScheduleBatchLease(current, ownership)) return null;
  return {
    ...current,
    status,
    dispatchOwnerToken: "",
    dispatchLeaseExpiresAt: 0,
    dispatchHeartbeatAt: now,
    ...(status === "approved" ? { dispatchPriorityAt: now } : {}),
    ...(status === "complete" ? { completedAt: new Date(now).toISOString() } : {}),
    updatedAt: new Date(now).toISOString(),
  };
};

const SCHEDULE_SMS_DISPATCH_COORDINATOR_ID = "internal-schedule-sms-dispatch-coordinator";

const readFirestoreDocument = async (transaction, db, collection, id) => {
  const snapshot = await transaction.get(db.collection(collection).doc(id));
  return snapshot.exists ? { batchId: snapshot.id, ...snapshot.data() } : null;
};

const writeFirestoreDocument = (transaction, db, collection, id, data) =>
  transaction.set(db.collection(collection).doc(id), data, { merge: false });

const isMissingScheduleBatchIndex = (error) =>
  error?.code === 9 || error?.code === "failed-precondition" || /index(?:es)? required|requires an index/i.test(String(error?.message || ""));

/**
 * Shared Firestore boundary for discovery, batch leases and the app-wide
 * segment-rate coordinator. The coordinator lives in the existing batches
 * collection but uses a query-excluded intentType and a fixed internal ID.
 */
export const createScheduleBatchStoreOperations = ({
  requireFirestore,
  COLLECTIONS,
  getDoc,
  setDoc,
  queryDocs,
  runMemoryClaim,
  httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode }),
}) => {
  const persistBatchChange = async (batchId, update) => {
    const db = requireFirestore();
    if (db) {
      return db.runTransaction(async (transaction) => {
        const ref = db.collection(COLLECTIONS.notificationBatches).doc(batchId);
        const current = await readFirestoreDocument(transaction, db, COLLECTIONS.notificationBatches, batchId);
        const next = update(current);
        if (next && next !== current) transaction.set(ref, next, { merge: false });
        return next;
      });
    }
    return runMemoryClaim(batchId, async () => {
      const current = await getDoc(COLLECTIONS.notificationBatches, batchId);
      const next = update(current);
      if (next && next !== current) await setDoc(COLLECTIONS.notificationBatches, batchId, next, { merge: false });
      return next;
    });
  };

  const runCoordinatorTransaction = async (id, update) => {
    const db = requireFirestore();
    if (db) {
      return db.runTransaction(async (transaction) => {
        const ref = db.collection(COLLECTIONS.notificationBatches).doc(id);
        const current = await readFirestoreDocument(transaction, db, COLLECTIONS.notificationBatches, id);
        const result = update(current);
        if (result?.next && result.next !== current) writeFirestoreDocument(transaction, db, COLLECTIONS.notificationBatches, id, result.next);
        return result?.value ?? result?.next ?? null;
      });
    }
    return runMemoryClaim(id, async () => {
      const current = await getDoc(COLLECTIONS.notificationBatches, id);
      const result = update(current);
      if (result?.next && result.next !== current) {
        await setDoc(COLLECTIONS.notificationBatches, id, result.next, { merge: false });
      }
      return result?.value ?? result?.next ?? null;
    });
  };

  return {
    listCandidates: async () => {
      const filters = [
        { field: "intentType", value: "schedule_initial_notification" },
        { field: "status", op: "in", value: ["approved", "dispatching"] },
      ];
      const db = requireFirestore();
      if (db) {
        try {
          const snapshot = await db.collection(COLLECTIONS.notificationBatches)
            .where("intentType", "==", "schedule_initial_notification")
            .where("status", "in", ["approved", "dispatching"])
            .orderBy("dispatchPriorityAt", "asc")
            .limit(30)
            .get();
          return snapshot.docs.map((doc) => ({ batchId: doc.id, ...doc.data() }));
        } catch (error) {
          if (!isMissingScheduleBatchIndex(error)) throw error;
          const indexError = new Error(
            "Schedule SMS recovery cannot discover approved batches because the notificationBatches(intentType, status, dispatchPriorityAt) Firestore index is missing. Deploy it with `npm run firebase:update-indexes` to the intended Firebase project, then confirm the index is ready.",
            { cause: error },
          );
          indexError.code = "schedule_sms_dispatch_index_missing";
          throw indexError;
        }
      }
      return (await queryDocs(COLLECTIONS.notificationBatches, filters, { limit: 30 }))
        .sort((left, right) => Number(left.dispatchPriorityAt || 0) - Number(right.dispatchPriorityAt || 0));
    },
    claim: async (candidate, ownerToken, now, leaseMs) => {
      const db = requireFirestore();
      const update = (current) => {
        const next = claimApprovedScheduleBatch({ current, churchId: candidate.churchId, ownerToken, now, leaseMs, httpError });
        return next ? { next, value: next } : null;
      };
      if (db) {
        return db.runTransaction(async (transaction) => {
          const ref = db.collection(COLLECTIONS.notificationBatches).doc(candidate.batchId);
          const current = await readFirestoreDocument(transaction, db, COLLECTIONS.notificationBatches, candidate.batchId);
          const result = update(current);
          if (result?.next) writeFirestoreDocument(transaction, db, COLLECTIONS.notificationBatches, candidate.batchId, result.next);
          return result?.value || null;
        });
      }
      return runMemoryClaim(candidate.batchId, async () => {
        const current = await getDoc(COLLECTIONS.notificationBatches, candidate.batchId);
        const result = update(current);
        if (result?.next) await setDoc(COLLECTIONS.notificationBatches, candidate.batchId, result.next, { merge: false });
        return result?.value || null;
      });
    },
    renew: (batchId, ownership, now, leaseMs) => persistBatchChange(batchId, (current) =>
      renewScheduleBatchLease({ current, ownership, now, leaseMs })),
    saveRecipientProgress: (batchId, ownership, memberId, patch, now = Date.now()) => persistBatchChange(batchId, (current) =>
      updateScheduleBatchRecipient({ current, ownership, memberId, patch, now })),
    release: (batchId, ownership, now, status) => persistBatchChange(batchId, (current) =>
      releaseScheduleBatchLease({ current, ownership, now, status })),
    claimCoordinator: (ownerToken, now, leaseMs) => runCoordinatorTransaction(
      SCHEDULE_SMS_DISPATCH_COORDINATOR_ID,
      (current) => {
        if (current?.dispatchOwnerToken && Number(current.dispatchLeaseExpiresAt || 0) > now) return { value: null };
        const generation = Number(current?.dispatchGeneration || 0) + 1;
        const next = {
          ...(current || {}),
          batchId: SCHEDULE_SMS_DISPATCH_COORDINATOR_ID,
          intentType: "schedule_sms_dispatch_coordinator",
          status: "dispatching",
          dispatchOwnerToken: ownerToken,
          dispatchGeneration: generation,
          dispatchLeaseExpiresAt: now + leaseMs,
          dispatchHeartbeatAt: now,
          nextSendAvailableAt: Number(current?.nextSendAvailableAt || 0),
          updatedAt: new Date(now).toISOString(),
        };
        return { next, value: { ownerToken, generation } };
      },
    ),
    renewCoordinator: (ownership, now, leaseMs) => runCoordinatorTransaction(
      SCHEDULE_SMS_DISPATCH_COORDINATOR_ID,
      (current) => {
        if (!ownsScheduleBatchLease(current, ownership)) return { value: null };
        const next = {
          ...current,
          dispatchLeaseExpiresAt: now + leaseMs,
          dispatchHeartbeatAt: now,
          updatedAt: new Date(now).toISOString(),
        };
        return { next, value: ownership };
      },
    ),
    reserveProviderWindow: (ownership, now, leaseMs, segmentsPerSecond, segmentCount) => runCoordinatorTransaction(
      SCHEDULE_SMS_DISPATCH_COORDINATOR_ID,
      (current) => {
        if (!ownsScheduleBatchLease(current, ownership)) return { value: null };
        const availableAt = Math.max(now, Number(current.nextSendAvailableAt || 0));
        const durationMs = Math.max(1, Number(segmentCount || 1)) / segmentsPerSecond * 1000;
        const next = {
          ...current,
          nextSendAvailableAt: availableAt + durationMs,
          dispatchHeartbeatAt: now,
          dispatchLeaseExpiresAt: now + leaseMs,
          updatedAt: new Date(now).toISOString(),
        };
        return { next, value: Math.max(0, availableAt - now) };
      },
    ),
    releaseCoordinator: (ownership, now) => runCoordinatorTransaction(
      SCHEDULE_SMS_DISPATCH_COORDINATOR_ID,
      (current) => {
        if (!ownsScheduleBatchLease(current, ownership)) return { value: null };
        const next = {
          ...current,
          status: "idle",
          dispatchOwnerToken: "",
          dispatchLeaseExpiresAt: 0,
          dispatchHeartbeatAt: now,
          updatedAt: new Date(now).toISOString(),
        };
        return { next, value: next };
      },
    ),
  };
};

// Polling and execution stay separate from HTTP. Storage callbacks must use
// transactions in production; this loop owns no process-local send lock.
export const createScheduleBatchDispatcher = ({
  listCandidates,
  claim,
  renew,
  saveRecipientProgress,
  release,
  claimCoordinator = async (ownerToken) => ({ ownerToken, generation: 1 }),
  renewCoordinator = async () => true,
  reserveProviderWindow = async () => 0,
  releaseCoordinator = async () => true,
  isStillAuthorized,
  processRecipient,
  getRecipientState,
  createOwnerToken,
  now = () => Date.now(),
  pollIntervalMs = 5000,
  leaseMs = 90000,
  maxRecipientsPerRun = 10,
  maxConcurrentProviderRequests = 1,
  segmentsPerSecond = 0,
  logger = console,
}) => {
  let timer = null;
  let stopping = false;
  let inFlight = null;
  let lastScanErrorKey = "";
  let lastScanErrorAt = 0;

  const runBatch = async (batch, ownerToken, coordinatorOwnership) => {
    const ownership = { ownerToken, generation: batch.dispatchGeneration };
    const renewLease = async () => Boolean(await renew(batch.batchId, ownership, now(), leaseMs));
    const batchRecipientByMemberId = new Map((batch.recipients || []).map((recipient) => [recipient.memberId, recipient]));
    let paused = !(await isStillAuthorized(batch));
    let stoppedByError = false;
    let leaseLost = false;
    let processed = 0;
    let stateChanges = 0;
    let completed = false;
    let batchReleased = false;
    let finalStatus = "approved";
    const outcomes = { accepted: 0, failed: 0, unknown: 0, excluded: 0 };
    const recipients = (batch.approval?.recipients || []).filter((recipient) => {
      if (!recipient.intentId || !recipient.approvalVersion) return false;
      const saved = batchRecipientByMemberId.get(recipient.memberId);
      return !["sent", "failed", "unknown", "suppressed", "excluded"].includes(saved?.status);
    }).slice(0, maxRecipientsPerRun);

    const saveProgress = async (recipient, patch) => {
      const previous = batchRecipientByMemberId.get(recipient.memberId) || {};
      if (Object.entries(patch || {}).some(([key, value]) => previous[key] !== value)) stateChanges += 1;
      const savedBatch = await saveRecipientProgress(batch.batchId, ownership, recipient.memberId, patch, now());
      if (!savedBatch) {
        leaseLost = true;
        return false;
      }
      batchRecipientByMemberId.set(recipient.memberId, { ...previous, ...patch, memberId: recipient.memberId });
      return true;
    };

    const processOne = async (recipient) => {
      if (stopping || paused || stoppedByError || leaseLost) return;
      if (!(await isStillAuthorized(batch))) {
        paused = true;
        return;
      }
      if (!(await renewLease())) {
        leaseLost = true;
        return;
      }
      const before = await getRecipientState(recipient, batch);
      if (["sent", "failed", "unknown", "sending", "suppressed"].includes(before?.status) || !["preview", "ready"].includes(before?.status)) {
        await saveProgress(recipient, before || { status: "excluded" });
        return;
      }

      const segmentCount = Math.max(1, Number(recipient.segmentCount || 1));
      const waitMs = segmentsPerSecond > 0
        ? await reserveProviderWindow(coordinatorOwnership, now(), leaseMs, segmentsPerSecond, segmentCount)
        : 0;
      if (waitMs === null || waitMs === false) {
        leaseLost = true;
        return;
      }
      let remainingWait = Math.max(0, Number(waitMs || 0));
      while (remainingWait > 0 && !stopping) {
        const slice = Math.min(remainingWait, Math.max(1000, Math.floor(leaseMs / 3)));
        await new Promise((resolve) => setTimeout(resolve, slice));
        remainingWait -= slice;
        if (!(await renewLease()) || !(await renewCoordinator(coordinatorOwnership, now(), leaseMs))) {
          leaseLost = true;
          return;
        }
      }
      if (stopping) return;
      if (!(await isStillAuthorized(batch))) {
        paused = true;
        return;
      }
      if (!(await renewLease()) || !(await renewCoordinator(coordinatorOwnership, now(), leaseMs))) {
        leaseLost = true;
        return;
      }

      processed += 1;
      try {
        const result = await processRecipient({ batch, recipient, ownership, segmentCount });
        if (result?.pause) paused = true;
        const current = await getRecipientState(recipient, batch);
        if (current?.status === "sent") outcomes.accepted += 1;
        else if (current?.status === "failed") outcomes.failed += 1;
        else if (current?.status === "unknown") outcomes.unknown += 1;
        else if (current?.status === "excluded") outcomes.excluded += 1;
        await saveProgress(recipient, {
          ...(current || {}),
          ...(result?.errorMessage ? { exclusionReason: result.errorMessage } : {}),
        });
      } catch (error) {
        // Intent and attempt records remain authoritative. Do not log provider
        // messages or request details, which can contain private recipient data.
        stoppedByError = true;
        logger.error?.("schedule_sms.dispatch_recipient_error", {
          batchId: batch.batchId,
          generation: ownership.generation,
          errorCode: String(error?.code || "dispatch_error").slice(0, 80),
          errorName: String(error?.name || "Error").slice(0, 40),
        });
      }
    };

    const next = [...recipients];
    const workers = Array.from({ length: Math.max(1, maxConcurrentProviderRequests) }, async () => {
      while (next.length && !stopping && !paused && !stoppedByError && !leaseLost) {
        const recipient = next.shift();
        if (recipient) await processOne(recipient);
      }
    });
    await Promise.all(workers);

    if (stopping) {
      finalStatus = "approved";
      batchReleased = Boolean(await release(batch.batchId, ownership, now(), "approved"));
    } else if (paused) {
      finalStatus = "paused";
      batchReleased = Boolean(await release(batch.batchId, ownership, now(), "paused"));
    } else if (stoppedByError || leaseLost) {
      finalStatus = leaseLost ? "lease_lost" : "approved";
      if (!leaseLost) batchReleased = Boolean(await release(batch.batchId, ownership, now(), "approved"));
    } else {
      const latestStates = (batch.approval?.recipients || []).map((recipient) =>
        batchRecipientByMemberId.get(recipient.memberId) || recipient);
      const done = latestStates.every((item) => !["preview", "ready", "sending"].includes(item?.status));
      const failed = latestStates.some((item) => ["failed", "unknown"].includes(item?.status));
      completed = done;
      finalStatus = done ? (failed ? "partial" : "complete") : "approved";
      batchReleased = Boolean(await release(batch.batchId, ownership, now(), finalStatus));
    }

    logger.info?.("schedule_sms.batch_released", {
      batchId: batch.batchId,
      generation: ownership.generation,
      status: finalStatus,
      released: batchReleased,
      recipientCount: processed,
    });
    logger.info?.("schedule_sms.dispatch_pass", {
      batchId: batch.batchId,
      generation: ownership.generation,
      recipientCount: processed,
      accepted: outcomes.accepted,
      failed: outcomes.failed,
      unknown: outcomes.unknown,
      excluded: outcomes.excluded,
      status: finalStatus,
      paused,
      stoppedByError,
      leaseLost,
    });
    return { processed, stateChanges, completed, paused, stoppedByError, leaseLost };
  };

  const runOnce = async () => {
    if (stopping || inFlight) return inFlight;
    inFlight = (async () => {
      const batches = await listCandidates();
      let claimedBatch = false;
      let didProgress = false;
      for (const candidate of batches || []) {
        if (stopping) break;
        const ownerToken = createOwnerToken();
        const coordinatorOwnership = await claimCoordinator(ownerToken, now(), leaseMs);
        if (!coordinatorOwnership) return false;
        try {
          const claimed = await claim(candidate, ownerToken, now(), leaseMs);
          if (!claimed) continue;
          claimedBatch = true;
          const recovered = candidate.status === "dispatching" && Number(candidate.dispatchLeaseExpiresAt || 0) <= now();
          logger.info?.("schedule_sms.batch_claimed", {
            batchId: claimed.batchId,
            generation: claimed.dispatchGeneration,
            recovered,
          });
          const result = await runBatch(claimed, ownerToken, coordinatorOwnership);
          didProgress = Boolean(result?.processed || result?.stateChanges || result?.completed || result?.paused);
        } finally {
          await releaseCoordinator(coordinatorOwnership, now());
        }
        if (claimedBatch) break;
      }
      return didProgress;
    })();
    try {
      return await inFlight;
    } catch (error) {
      const errorCode = String(error?.code || "dispatch_scan_error").slice(0, 80);
      const errorAt = now();
      if (errorCode !== lastScanErrorKey || errorAt - lastScanErrorAt >= 60_000) {
        logger.error?.("schedule_sms.dispatch_scan_error", {
          errorCode,
          errorName: String(error?.name || "Error").slice(0, 40),
          message: String(error?.message || "Schedule SMS dispatcher scan failed").slice(0, 300),
        });
        lastScanErrorKey = errorCode;
        lastScanErrorAt = errorAt;
      }
      return false;
    } finally {
      inFlight = null;
    }
  };

  const scheduleNext = (delay = pollIntervalMs) => {
    if (stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const didWork = await runOnce();
      scheduleNext(didWork ? 0 : pollIntervalMs);
    }, delay);
    timer.unref?.();
  };

  return {
    runOnce,
    start() {
      if (stopping) return;
      scheduleNext(0);
    },
    wake() {
      if (stopping) return;
      scheduleNext(0);
    },
    async stop({ timeoutMs = 20000 } = {}) {
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (!inFlight) return true;
      let timeout;
      const timedOut = await Promise.race([
        inFlight.then(() => false, () => false),
        new Promise((resolve) => { timeout = setTimeout(() => resolve(true), timeoutMs); }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (timedOut) {
        logger.warn?.("schedule_sms.dispatch_shutdown_deadline", { timeoutMs });
        return false;
      }
      return true;
    },
  };
};

// Deliberately request-bound for compatibility. This is not a background runner
// or a lease: callers must not mistake stale timestamps for proof of process death.
export const executeReviewedNotificationBatch = async ({
  batch, getIntent, matchesSource, isStaleSending, markUnknownAfterInterruption,
  sendReviewedIntent, nowIso,
}) => {
  const results = [];
  for (const intentId of new Set(batch.intentIds || [])) {
    const current = await getIntent(intentId);
    const batchRecipient = (batch.recipients || []).find((row) => row.intentId === intentId);
    // Check ownership before recovery as well as sending. A foreign/stale row
    // must never mutate another church's or feature's intent.
    if (!current || current.churchId !== batch.churchId || current.batchId !== batch.batchId || !matchesSource(current)) {
      results.push({ intentId, status: "missing", outcome: "not_sent", error: "Review expired or changed." });
      continue;
    }
    if (current.status === "sending" && isStaleSending(current)) {
      const recovered = await markUnknownAfterInterruption(current);
      results.push({ intentId, status: recovered?.status || "unknown", outcome: recovered?.outcome || "unknown" });
      continue;
    }
    if (!batchRecipient?.approvalVersion || batchRecipient.approvalVersion !== current.approvalSnapshot?.approvalVersion) {
      results.push({ intentId, status: current.status, outcome: "not_sent", error: "Review expired or changed." });
      continue;
    }
    // Confirmed sends, definitive failures and unknown outcomes are never
    // re-sent by resuming a batch. Failures require deliberate preparation.
    if (!["preview", "ready"].includes(current.status)) {
      results.push({ intentId, status: current.status, outcome: current.outcome || "" });
      continue;
    }
    const response = await sendReviewedIntent({ intentId, approvalVersion: batchRecipient.approvalVersion });
    const refreshed = await getIntent(intentId);
    results.push({ intentId, status: refreshed?.status || "failed", outcome: refreshed?.outcome || (response?.success ? "confirmed" : ""), errorMessage: response?.errorMessage || "" });
  }
  const errorByIntentId = new Map(results.filter((row) => row.errorMessage).map((row) => [row.intentId, row.errorMessage]));
  const refreshedRecipients = await Promise.all((batch.recipients || []).map(async (row) => {
    const candidate = row.intentId ? await getIntent(row.intentId) : null;
    const intent = candidate?.churchId === batch.churchId && candidate?.batchId === batch.batchId && matchesSource(candidate) ? candidate : null;
    const errorMessage = errorByIntentId.get(row.intentId) || "";
    const currentSnapshot = intent?.approvalSnapshot;
    return {
      ...row,
      status: intent?.status || row.status,
      attemptId: intent?.attemptId || "",
      outcome: intent?.outcome || "",
      approvalVersion: currentSnapshot?.approvalVersion || "",
      eligible: Boolean(currentSnapshot?.approvalVersion && Number(currentSnapshot.expiresAt) > Date.now() && ["preview", "ready"].includes(intent?.status)),
      exclusionReason: errorMessage || (!currentSnapshot && ["preview", "ready"].includes(intent?.status) ? "This message needs a fresh preview." : row.exclusionReason),
      ...(/opted out/i.test(errorMessage) ? { eligibilityStatus: "opted_out" } : {}),
    };
  }));
  const allDone = refreshedRecipients.every((row) => !["preview", "ready", "sending"].includes(row.status));
  const anyFailure = refreshedRecipients.some((row) => ["failed", "unknown"].includes(row.status));
  return {
    ...batch,
    status: allDone && !anyFailure ? "sent" : "partial",
    recipients: refreshedRecipients,
    lastDispatchResults: results,
    completedAt: nowIso(),
    updatedAt: nowIso(),
  };
};
