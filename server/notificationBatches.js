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
