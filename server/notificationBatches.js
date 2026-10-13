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
      ["approved", "dispatching", "complete", "partial", "paused"].includes(current.status)) {
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
    return { ...row, ...patch, memberId };
  });
  if (!found) return null;
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

// Polling and execution stay separate from HTTP. Storage callbacks must use
// transactions in production; this loop owns no process-local send lock.
export const createScheduleBatchDispatcher = ({
  listCandidates,
  claim,
  renew,
  saveRecipientProgress,
  release,
  isStillAuthorized,
  processRecipient,
  getRecipientState,
  createOwnerToken,
  now = () => Date.now(),
  pollIntervalMs = 5000,
  leaseMs = 90000,
  maxRecipientsPerRun = 2,
  logger = console,
}) => {
  let timer = null;
  let stopping = false;
  let inFlight = null;

  const runBatch = async (batch, ownerToken) => {
    const ownership = { ownerToken, generation: batch.dispatchGeneration };
    const renewLease = async () => Boolean(await renew(batch.batchId, ownership, now(), leaseMs));
    if (!(await isStillAuthorized(batch))) {
      await release(batch.batchId, ownership, now(), "paused");
      return;
    }

    let processed = 0;
    const batchRecipientByMemberId = new Map((batch.recipients || []).map((recipient) => [recipient.memberId, recipient]));
    for (const recipient of batch.approval?.recipients || []) {
      if (stopping) break;
      if (!recipient.intentId || !recipient.approvalVersion) continue;
      const saved = batchRecipientByMemberId.get(recipient.memberId);
      if (["sent", "failed", "unknown", "suppressed", "excluded"].includes(saved?.status)) continue;
      if (processed >= maxRecipientsPerRun) break;
      if (!(await isStillAuthorized(batch))) {
        await release(batch.batchId, ownership, now(), "paused");
        return;
      }
      if (!(await renewLease())) return;
      const before = await getRecipientState(recipient, batch);
      if (["sent", "unknown", "sending", "suppressed"].includes(before?.status)) {
        await saveRecipientProgress(batch.batchId, ownership, recipient.memberId, before);
        continue;
      }
      if (before?.status === "failed") {
        await saveRecipientProgress(batch.batchId, ownership, recipient.memberId, before);
        continue;
      }
      if (!["preview", "ready"].includes(before?.status)) {
        await saveRecipientProgress(batch.batchId, ownership, recipient.memberId, before || { status: "excluded" });
        continue;
      }
      processed += 1;
      try {
        const result = await processRecipient({ batch, recipient, ownership });
        if (result?.pause) {
          await release(batch.batchId, ownership, now(), "paused");
          return;
        }
        const current = await getRecipientState(recipient, batch);
        await saveRecipientProgress(batch.batchId, ownership, recipient.memberId, {
          ...(current || {}),
          ...(result?.errorMessage ? { exclusionReason: result.errorMessage } : {}),
        });
      } catch (error) {
        // Intent and attempt records are authoritative after provider work.
        // Leave the lease recoverable; never infer a failed send from a thrown
        // dispatcher error or overwrite a newer owner's progress.
        logger.error?.("Schedule SMS batch execution stopped", {
          batchId: batch.batchId,
          generation: ownership.generation,
          error: error?.message || "execution failed",
        });
        return;
      }
    }

    if (stopping) {
      await release(batch.batchId, ownership, now(), "approved");
      return;
    }
    const latestStates = await Promise.all(
      (batch.approval?.recipients || []).map((recipient) => getRecipientState(recipient, batch)),
    );
    const done = latestStates.every((item) => !["preview", "ready", "sending"].includes(item?.status));
    const failed = latestStates.some((item) => ["failed", "unknown"].includes(item?.status));
    await release(batch.batchId, ownership, now(), done ? (failed ? "partial" : "complete") : "approved");
  };

  const runOnce = async () => {
    if (stopping || inFlight) return inFlight;
    inFlight = (async () => {
      const batches = await listCandidates();
      for (const candidate of batches || []) {
        if (stopping) break;
        const ownerToken = createOwnerToken();
        const claimed = await claim(candidate, ownerToken, now(), leaseMs);
        if (!claimed) continue;
        await runBatch(claimed, ownerToken);
        break;
      }
    })();
    try {
      await inFlight;
    } catch (error) {
      logger.error?.("Schedule SMS dispatcher scan failed", error?.message || error);
    } finally {
      inFlight = null;
    }
  };

  const scheduleNext = (delay = pollIntervalMs) => {
    if (stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      await runOnce();
      scheduleNext();
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
    async stop() {
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (inFlight) await inFlight;
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
