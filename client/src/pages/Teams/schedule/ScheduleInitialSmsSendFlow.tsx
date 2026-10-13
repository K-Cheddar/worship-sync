import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import type { NotificationBatch, ScheduleInitialSmsBatchHistoryEntry, ScheduleInitialSmsRecipient, TeamSchedule } from "../../../api/authTypes";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getScheduleInitialSmsRecipients,
  prepareScheduleInitialSmsBatch,
} from "../../../api/auth";
import AvailabilityBatchReview from "../components/AvailabilityBatchReview";

const DISPATCH_READINESS_MESSAGE = "Review is saved. Bulk SMS sending is paused until dispatch can safely continue and recover after a restart.";

const formatAssignmentDate = (assignment: ScheduleInitialSmsRecipient["assignments"][number], timeZone: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(assignment.serviceDate || "")) {
    const [year, month, day] = assignment.serviceDate.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
    });
  }
  const start = new Date(assignment.startsAt || "");
  if (Number.isNaN(start.getTime())) return "Date TBD";
  try {
    return start.toLocaleDateString("en-US", { timeZone: timeZone || "UTC", weekday: "short", month: "short", day: "numeric" });
  } catch {
    return start.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  }
};

const ScheduleInitialSmsSendFlow = ({
  churchId,
  schedule,
  scheduleName,
  teamName,
  timeZone,
  onClose,
}: {
  churchId: string;
  schedule: TeamSchedule;
  scheduleName: string;
  teamName: string;
  timeZone: string;
  onClose: () => void;
}) => {
  const ownerIdentity = `${churchId}:${schedule.scheduleId}`;
  const scheduleSourceIdentity = useMemo(() => JSON.stringify({
    scheduleId: schedule.scheduleId,
    teamId: schedule.teamId,
    published: schedule.published !== false,
    assignments: schedule.assignments,
    occurrences: schedule.occurrences || [],
  }), [schedule.assignments, schedule.occurrences, schedule.published, schedule.scheduleId, schedule.teamId]);
  const [rows, setRows] = useState<ScheduleInitialSmsRecipient[]>([]);
  const [summary, setSummary] = useState({ assigned: 0, total: 0, eligible: 0, alreadySent: 0, failed: 0, uncertain: 0, missingConsent: 0, optedOut: 0, missingPhone: 0, ineligible: 0 });
  const [selectedOnLoad, setSelectedOnLoad] = useState<string[]>([]);
  const [hasPreparedSelection, setHasPreparedSelection] = useState(false);
  const [privacySafe, setPrivacySafe] = useState(false);
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [selectedRetryIds, setSelectedRetryIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [serverBatch, setServerBatch] = useState<NotificationBatch | null>(null);
  const [recentBatches, setRecentBatches] = useState<ScheduleInitialSmsBatchHistoryEntry[]>([]);
  const [reviewedBatchState, setReviewedBatchState] = useState<{
    batch: NotificationBatch;
    ownerIdentity: string;
    sourceIdentity: string;
    recipientIdentity: string;
    selectionIdentity: string;
  } | null>(null);
  const currentOwnerRef = useRef(ownerIdentity);
  const currentSourceRef = useRef(scheduleSourceIdentity);
  const loadSequenceRef = useRef(0);
  const progressSequenceRef = useRef(0);
  const initializedSelectionForRef = useRef("");
  const previousSourceRef = useRef(scheduleSourceIdentity);
  currentOwnerRef.current = ownerIdentity;
  currentSourceRef.current = scheduleSourceIdentity;

  const loadRecipients = useCallback(async () => {
    const requestOwner = ownerIdentity;
    const requestSource = scheduleSourceIdentity;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    setLoadError("");
    setError("");
    try {
      const response = await getScheduleInitialSmsRecipients(churchId, schedule.scheduleId);
      if (loadSequenceRef.current !== sequence || currentOwnerRef.current !== requestOwner || currentSourceRef.current !== requestSource) return;
      if (!response.historyComplete) throw new Error("Message history could not be fully checked. Retry the status check before selecting recipients.");
      setRows(response.recipients || []);
      setSummary(response.summary);
      setPrivacySafe(Boolean(response.privacySafe));
      setSelectedOnLoad(response.selectedMemberIds || []);
      setHasPreparedSelection(Boolean(response.hasPreparedSelection));
      setServerBatch(response.currentBatch || null);
      setRecentBatches(response.recentBatches || []);
      if (initializedSelectionForRef.current !== requestOwner) {
        const selected = new Set(response.selectedMemberIds || []);
        setDeselectedIds(new Set(response.recipients.filter((row) => row.eligible && row.previousDeliveryStatus !== "failed" && response.hasPreparedSelection && !selected.has(row.memberId)).map((row) => row.memberId)));
        setSelectedRetryIds(new Set(response.recipients.filter((row) => row.eligible && row.previousDeliveryStatus === "failed" && selected.has(row.memberId)).map((row) => row.memberId)));
        initializedSelectionForRef.current = requestOwner;
      }
    } catch (caught) {
      if (loadSequenceRef.current === sequence && currentOwnerRef.current === requestOwner) {
        setLoadError(caught instanceof Error ? caught.message : "Could not load schedule SMS recipients.");
        setRows([]);
      }
    } finally {
      if (loadSequenceRef.current === sequence && currentOwnerRef.current === requestOwner) setLoading(false);
    }
  }, [churchId, ownerIdentity, schedule.scheduleId, scheduleSourceIdentity]);

  useEffect(() => {
    void loadRecipients();
    return () => { loadSequenceRef.current += 1; };
  }, [loadRecipients]);

  useEffect(() => {
    if (previousSourceRef.current === scheduleSourceIdentity) return;
    previousSourceRef.current = scheduleSourceIdentity;
    setReviewedBatchState(null);
    setNotice("Schedule assignments changed. Review the current recipients and messages again.");
  }, [scheduleSourceIdentity]);

  const recipientIdentity = useMemo(() => JSON.stringify(rows.map((row) => [
    row.memberId,
    row.memberName,
    row.eligible,
    row.eligibilityStatus,
    row.exclusionReason,
    row.previousDeliveryStatus,
    row.assignments,
  ])), [rows]);
  const currentRecipientIdentityRef = useRef(recipientIdentity);
  const currentSelectionIdentityRef = useRef("");
  currentRecipientIdentityRef.current = recipientIdentity;
  const selectedIds = useMemo(() => rows.filter((row) => row.eligible && (
    row.previousDeliveryStatus === "failed"
      ? selectedRetryIds.has(row.memberId)
      : !deselectedIds.has(row.memberId)
  )).map((row) => row.memberId), [deselectedIds, rows, selectedRetryIds]);
  const selectionIdentity = JSON.stringify(selectedIds);
  currentSelectionIdentityRef.current = selectionIdentity;
  const reviewedBatch = reviewedBatchState?.batch.scheduleId === schedule.scheduleId &&
    reviewedBatchState.ownerIdentity === ownerIdentity &&
    reviewedBatchState.sourceIdentity === scheduleSourceIdentity &&
    reviewedBatchState.recipientIdentity === recipientIdentity &&
    reviewedBatchState.selectionIdentity === selectionIdentity
    ? reviewedBatchState.batch
    : null;
  const visibleBatch = serverBatch || reviewedBatch;
  const batchIsActive = Boolean(serverBatch && ["approved", "dispatching"].includes(serverBatch.status));
  const serverBatchId = serverBatch?.batchId;
  const serverBatchStatus = serverBatch?.status;

  useEffect(() => {
    if (!serverBatchId || !serverBatchStatus || !["approved", "dispatching"].includes(serverBatchStatus)) return undefined;
    const requestOwner = ownerIdentity;
    const requestBatchId = serverBatchId;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      const sequence = ++progressSequenceRef.current;
      try {
        const response = await getAvailabilityNotificationBatch(churchId, requestBatchId);
        if (cancelled || sequence !== progressSequenceRef.current || currentOwnerRef.current !== requestOwner || response.batch.batchId !== requestBatchId) return;
        setServerBatch(response.batch);
      } catch (caught) {
        if (cancelled || sequence !== progressSequenceRef.current || currentOwnerRef.current !== requestOwner) return;
        setError(caught instanceof Error ? caught.message : "Could not refresh schedule SMS progress.");
        if (timer) clearInterval(timer);
        timer = null;
      }
    };
    timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      progressSequenceRef.current += 1;
      if (timer) clearInterval(timer);
    };
  }, [churchId, ownerIdentity, serverBatchId, serverBatchStatus]);
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter((row) => !query || row.memberName.toLocaleLowerCase().includes(query));
  const visibleEligibleIds = visibleRows.filter((row) => row.eligible).map((row) => row.memberId);
  const visibleSelectedCount = visibleEligibleIds.filter((id) => selectedIds.includes(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleSelectedCount === visibleEligibleIds.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  const updateSelection = (memberIds: string[], selected: boolean) => {
    const nextDeselected = new Set(deselectedIds);
    const nextRetries = new Set(selectedRetryIds);
    memberIds.forEach((memberId) => {
      const row = rows.find((candidate) => candidate.memberId === memberId);
      if (row?.previousDeliveryStatus === "failed") {
        if (selected) nextRetries.add(memberId);
        else nextRetries.delete(memberId);
      } else if (selected) nextDeselected.delete(memberId);
      else nextDeselected.add(memberId);
    });
    setDeselectedIds(nextDeselected);
    setSelectedRetryIds(nextRetries);
    setReviewedBatchState(null);
    if (!batchIsActive) setServerBatch(null);
    setNotice("Recipients changed. Review the messages again.");
  };

  const reviewMessages = async () => {
    if (!rows.length || loading || loadError || busy || !selectedIds.length) return;
    const requestOwner = ownerIdentity;
    const requestSource = scheduleSourceIdentity;
    const requestRecipients = recipientIdentity;
    const requestSelection = selectionIdentity;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await prepareScheduleInitialSmsBatch(churchId, schedule.scheduleId, [...selectedIds]);
      if (currentOwnerRef.current !== requestOwner || currentSourceRef.current !== requestSource || currentRecipientIdentityRef.current !== requestRecipients || currentSelectionIdentityRef.current !== requestSelection) return;
      if (response.batch.churchId !== churchId || response.batch.scheduleId !== schedule.scheduleId) return;
      setPrivacySafe(Boolean(response.privacySafe));
      setReviewedBatchState({
        batch: response.batch,
        ownerIdentity: requestOwner,
        sourceIdentity: requestSource,
        recipientIdentity: requestRecipients,
        selectionIdentity: requestSelection,
      });
      setServerBatch(null);
      setNotice("Messages are ready to review. Nothing has been sent.");
    } catch (caught) {
      if (currentOwnerRef.current === requestOwner && currentSourceRef.current === requestSource) {
        setError(caught instanceof Error ? caught.message : "Could not prepare schedule messages.");
      }
    } finally {
      if (currentOwnerRef.current === requestOwner) setBusy(false);
    }
  };

  const confirmBatch = async () => {
    if (!reviewedBatch || busy || loading) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await dispatchAvailabilityNotificationBatch(churchId, reviewedBatch.batchId, reviewedBatch.approvalVersion);
      setServerBatch(response.batch);
      setReviewedBatchState(null);
      setNotice("Batch approved. Sending will continue while this schedule stays open or you close this panel.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not approve this schedule SMS batch.");
    } finally {
      setBusy(false);
    }
  };

  const statusReason = (row: ScheduleInitialSmsRecipient) => row.eligible
    ? row.previousDeliveryStatus === "failed" ? "Previous send failed · select to retry" : "First send · SMS ready"
    : row.exclusionReason || "Not eligible for SMS.";

  return (
    <section className="space-y-4 p-4 sm:p-5" aria-labelledby="schedule-sms-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="schedule-sms-heading" className="text-lg font-semibold text-white">Send schedule by SMS</h2>
          <p className="text-sm text-gray-300">{scheduleName} · {teamName} · one message per assigned volunteer</p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button>
      </div>
      {schedule.published === false ? (
        <p role="alert" className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">Publish this schedule before reviewing or sending messages.</p>
      ) : null}
      <dl className="grid grid-cols-2 gap-2 rounded border border-gray-700 bg-gray-950/40 p-3 text-sm sm:grid-cols-4">
        <div><dt className="text-gray-400">Assigned volunteers</dt><dd className="text-white">{summary.assigned}</dd></div>
        <div><dt className="text-gray-400">Eligible</dt><dd className="text-white">{summary.eligible}</dd></div>
        <div><dt className="text-gray-400">Selected</dt><dd className="text-white">{selectedIds.length}</dd></div>
        <div><dt className="text-gray-400">Already sent</dt><dd className="text-white">{summary.alreadySent}</dd></div>
        <div><dt className="text-gray-400">Consent needed</dt><dd className="text-white">{summary.missingConsent}</dd></div>
        {!privacySafe ? <div><dt className="text-gray-400">Opted out</dt><dd className="text-white">{summary.optedOut}</dd></div> : null}
        <div><dt className="text-gray-400">Missing/invalid phone</dt><dd className="text-white">{summary.missingPhone}</dd></div>
        <div><dt className="text-gray-400">Failed · retry requires selection</dt><dd className="text-amber-200">{summary.failed}</dd></div>
        <div><dt className="text-gray-400">Sending or uncertain</dt><dd className="text-amber-200">{summary.uncertain}</dd></div>
      </dl>
      {recentBatches.length ? (
        <details className="rounded border border-gray-700 bg-gray-950/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-200">Recent schedule SMS batches ({recentBatches.length})</summary>
          <ul className="mt-2 divide-y divide-gray-800">
            {recentBatches.map((batch) => {
              const approvedAt = new Date(batch.approvedAt);
              const approvedLabel = Number.isNaN(approvedAt.getTime()) ? "Approval time unavailable" : `Approved ${approvedAt.toLocaleString()}`;
              const statusLabel = batch.status === "complete" ? "Completed" : batch.status === "paused" ? "Paused" : "Partial results";
              return (
                <li key={batch.reviewVersion} className="py-2 text-sm text-gray-300">
                  <p>{approvedLabel} · {statusLabel}</p>
                  <p className="text-xs text-gray-400">{batch.selected} selected · {batch.summary.accepted} accepted · {batch.summary.delivered} delivered · {batch.summary.failed} failed · {batch.summary.uncertain} uncertain · {batch.summary.awaiting} awaiting · {batch.summary.excluded} excluded</p>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {!loading && !loadError && schedule.published !== false ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input label="Search volunteers" value={search} onChange={(value) => setSearch(String(value))} placeholder="Search by name" disabled={busy} />
            <p className="self-end pb-2 text-sm text-gray-400">Team scope: {teamName}</p>
          </div>
          <div className="max-h-80 overflow-y-auto rounded border border-gray-700 bg-gray-950/50">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-3">
              <div className="flex items-center gap-3">
                <Checkbox aria-label={`Select all ${visibleEligibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={busy || batchIsActive || !visibleEligibleIds.length} onCheckedChange={(checked) => updateSelection(visibleEligibleIds, checked === true)} />
                <span className="text-sm text-gray-200">Select eligible volunteers shown</span>
                <span className="text-xs text-gray-400">{visibleRows.length} shown</span>
              </div>
              <div className="flex items-center gap-3"><span aria-live="polite" className="text-sm text-gray-300">{selectedIds.length} selected</span><Button variant="textLink" disabled={busy || batchIsActive || !selectedIds.length} onClick={() => updateSelection(selectedIds, false)}>Clear</Button></div>
            </div>
            <div className="divide-y divide-gray-800" role="list" aria-label="Schedule SMS recipients">
              {visibleRows.length ? visibleRows.map((row) => (
                <div key={row.memberId} className="space-y-1 px-3 py-3" role="listitem">
                  <div className="flex flex-wrap items-center gap-3">
                    <Checkbox label={row.memberName} checked={selectedIds.includes(row.memberId)} disabled={busy || batchIsActive || !row.eligible} onCheckedChange={(checked) => updateSelection([row.memberId], checked === true)} className="flex-1" />
                    <span className={`text-xs ${row.eligible ? "text-emerald-200" : "text-amber-200"}`}>{statusReason(row)}</span>
                  </div>
                  <details className="pl-7 text-xs text-gray-400">
                    <summary className="cursor-pointer">{row.assignments.length} assignment{row.assignments.length === 1 ? "" : "s"}</summary>
                    <ul className="mt-1 space-y-1">
                      {row.assignments.map((assignment) => <li key={assignment.occurrenceId}>{assignment.serviceName} · {formatAssignmentDate(assignment, timeZone)} — {assignment.positions.map(({ positionName }) => positionName).join(", ")}</li>)}
                    </ul>
                  </details>
                  {row.maskedPhoneNumber ? <p className="pl-7 text-xs text-gray-500">{row.maskedPhoneNumber}</p> : null}
                </div>
              )) : <p className="p-4 text-sm text-gray-400">No assigned volunteers match this search.</p>}
            </div>
          </div>
          {selectedOnLoad.length > 0 && hasPreparedSelection ? <p className="text-xs text-gray-400">Your previous recipient selection is restored. Review again to refresh every assignment and consent check.</p> : null}
          <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-gray-400">{selectedIds.length ? `${selectedIds.length} of ${summary.eligible} eligible volunteer${summary.eligible === 1 ? "" : "s"} selected.` : "Select at least one eligible volunteer to review."}</p>
            <Button disabled={busy || batchIsActive || !selectedIds.length} isLoading={busy} onClick={() => void reviewMessages()}>Review {selectedIds.length} message{selectedIds.length === 1 ? "" : "s"}</Button>
          </div>
        </>
      ) : null}
      {loading ? <p role="status" className="text-sm text-gray-300">Checking schedule assignments, consent, and message history…</p> : null}
      {loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100"><span>{loadError}</span><Button variant="secondary" disabled={loading || busy} isLoading={loading} onClick={() => void loadRecipients()}>Retry status check</Button></div> : null}
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      {visibleBatch ? <AvailabilityBatchReview batch={visibleBatch} formName={scheduleName} busy={busy || loading} privacySafe={privacySafe} readinessMessage={batchIsActive ? "Approved messages are being processed. You can close this panel and return to the schedule later." : DISPATCH_READINESS_MESSAGE} onConfirm={reviewedBatch ? () => void confirmBatch() : undefined} /> : null}
    </section>
  );
};

export default ScheduleInitialSmsSendFlow;
