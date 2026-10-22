import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import type {
  NotificationBatch,
  NotificationIntent,
  SmsDeliveryAttempt,
  SmsMemberEligibility,
  TeamIntakeForm,
  TeamIntakeRecipient,
  TeamPosition,
  TeamRecord,
  TeamRosterMember,
} from "../../../api/authTypes";
import { getAvailabilityNotificationBatch } from "../../../api/auth";
import AvailabilityBatchReview from "./AvailabilityBatchReview";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";
import { getAvailabilityRecipientRows } from "../availabilityRecipientSelection";
import { dispatchReviewedAvailabilityBatch, prepareAvailabilityBatchForMembers } from "../availabilityBatchActions";
import { memberName } from "../teamsUtils";

const AvailabilityFormSendFlow = ({
  churchId,
  form,
  members,
  positions,
  teams,
  recipients,
  eligibilityByMemberId,
  notificationIntents,
  smsDeliveryAttempts,
  historyLoaded,
  historyError,
  onRetryHistory,
  onBatchUpdated,
  privacySafe = false,
  onClose,
  dialog = false,
}: {
  churchId: string;
  form: TeamIntakeForm;
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  recipients: TeamIntakeRecipient[];
  eligibilityByMemberId?: Record<string, Pick<SmsMemberEligibility, "eligible"> & Partial<Pick<SmsMemberEligibility, "status">>>;
  notificationIntents: NotificationIntent[];
  smsDeliveryAttempts: SmsDeliveryAttempt[];
  historyLoaded: boolean;
  historyError: string;
  onRetryHistory: () => void;
  onBatchUpdated?: (batch: NotificationBatch) => void;
  privacySafe?: boolean;
  onClose: () => void;
  dialog?: boolean;
}) => {
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [selectedRetryIds, setSelectedRetryIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [recipientFilter, setRecipientFilter] = useState(dialog ? "first" : "all");
  const [busy, setBusy] = useState(false);
  const sendLockRef = useRef(false);
  const [reviewedBatchState, setReviewedBatchState] = useState<{
    batch: NotificationBatch;
    formIdentity: string;
    recipientEligibilityIdentity: string;
    selectionIdentity: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!historyLoaded) setConfirmOpen(false);
  }, [historyLoaded]);

  const contextIdentity = `${churchId}:${form.formId}`;
  const formReviewIdentity = JSON.stringify({
    formId: form.formId,
    name: form.name,
    startDate: form.startDate,
    endDate: form.endDate,
    responseDeadline: form.responseDeadline || "",
    availabilityServices: form.availabilityServices || [],
    teamIds: [...(form.teamIds || [])].sort(),
    enabledFields: [...(form.enabledFields || [])].sort(),
    availabilityOccurrences: form.availabilityOccurrences || [],
    requireEmail: Boolean(form.requireEmail),
    welcomeMessage: form.welcomeMessage || "",
    positionsMessage: form.positionsMessage || "",
    availabilityMessage: form.availabilityMessage || "",
    notesMessage: form.notesMessage || "",
    active: form.active,
    archivedAt: form.archivedAt || "",
  });
  const currentContextRef = useRef(contextIdentity);
  currentContextRef.current = contextIdentity;
  const previousContextRef = useRef(contextIdentity);
  const currentFormReviewRef = useRef(formReviewIdentity);
  currentFormReviewRef.current = formReviewIdentity;
  const previousFormReviewRef = useRef(formReviewIdentity);

  useEffect(() => {
    if (previousContextRef.current === contextIdentity) return;
    previousContextRef.current = contextIdentity;
    previousFormReviewRef.current = formReviewIdentity;
    setDeselectedIds(new Set());
    setSelectedRetryIds(new Set());
    setReviewedBatchState(null);
    setConfirmOpen(false);
    setNotice("Form changed. Choose recipients and review the messages again.");
  }, [contextIdentity, formReviewIdentity]);

  useEffect(() => {
    if (previousFormReviewRef.current === formReviewIdentity) return;
    previousFormReviewRef.current = formReviewIdentity;
    setReviewedBatchState(null);
    setConfirmOpen(false);
    setNotice("Form details changed. Review the messages again before sending.");
  }, [formReviewIdentity]);

  const invalidateReview = () => {
    const hadReview = Boolean(reviewedBatchState || confirmOpen);
    setReviewedBatchState((current) => current?.batch.status === "prepared" ? null : current);
    setConfirmOpen(false);
    if (hadReview) setNotice("Recipients changed. Review the messages again before sending.");
  };

  const activeMembers = useMemo(() => members.filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))), [members]);
  const rows = useMemo(() => getAvailabilityRecipientRows({
    members: activeMembers,
    positions,
    teams,
    recipients,
    eligibilityByMemberId,
    notificationIntents,
    smsDeliveryAttempts,
    form,
    intentType: "availability_request",
  }), [activeMembers, eligibilityByMemberId, form, notificationIntents, positions, recipients, smsDeliveryAttempts, teams]);
  const activeBatch = reviewedBatchState?.batch || null;
  const recipientEligibilityIdentity = JSON.stringify(rows.map(({ member, memberTeamIds, recipient, eligibility, eligible, reason, previousDeliveryStatus }) => [
    member.memberId,
    memberName(member),
    member.phoneNumber || "",
    [...memberTeamIds].sort(),
    eligibility.status,
    eligibility.eligible,
    eligible,
    reason,
    recipient?.respondedAt || "",
    recipient?.revokedAt || "",
    previousDeliveryStatus,
  ]));
  const currentRecipientEligibilityRef = useRef(recipientEligibilityIdentity);
  currentRecipientEligibilityRef.current = recipientEligibilityIdentity;
  const previousRecipientEligibilityRef = useRef(recipientEligibilityIdentity);
  useEffect(() => {
    if (previousRecipientEligibilityRef.current === recipientEligibilityIdentity) return;
    previousRecipientEligibilityRef.current = recipientEligibilityIdentity;
    const hadPreparedReview = reviewedBatchState?.batch.status === "prepared" &&
      !reviewedBatchState.batch.summary.sent && !reviewedBatchState.batch.summary.failed && !reviewedBatchState.batch.summary.uncertain;
    setReviewedBatchState((current) => current?.batch.status === "prepared" ? null : current);
    setConfirmOpen(false);
    if (hadPreparedReview) setNotice("Recipient eligibility changed. Review the messages again before sending.");
  }, [confirmOpen, recipientEligibilityIdentity, reviewedBatchState]);
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter((row) => {
    const { member, memberTeamIds } = row;
    return (!teamFilter || memberTeamIds.has(teamFilter)) &&
    (!query || memberName(member).toLocaleLowerCase().includes(query)) &&
    (recipientFilter !== "first" || (row.eligible && !row.previousDeliveryStatus)) &&
    (recipientFilter !== "outstanding" || (row.recipient && !row.recipient.respondedAt && !row.recipient.revokedAt));
  });
  const visibleEligibleIds = historyLoaded ? visibleRows.filter(({ eligible }) => eligible).map(({ member }) => member.memberId) : [];
  const selectedEligibleIds = rows.filter(({ member, eligible, previousDeliveryStatus }) =>
    eligible && (previousDeliveryStatus === "failed" ? selectedRetryIds.has(member.memberId) : !deselectedIds.has(member.memberId)),
  ).map(({ member }) => member.memberId);
  const selectionIdentity = JSON.stringify(selectedEligibleIds);
  const selectionIdentityRef = useRef(selectionIdentity);
  selectionIdentityRef.current = selectionIdentity;
  const batchIdentityMatches = Boolean(reviewedBatchState &&
    reviewedBatchState.formIdentity === formReviewIdentity &&
    reviewedBatchState.recipientEligibilityIdentity === recipientEligibilityIdentity &&
    reviewedBatchState.selectionIdentity === selectionIdentity);
  const batchHasProgress = Boolean(reviewedBatchState && (
    reviewedBatchState.batch.status !== "prepared" || reviewedBatchState.batch.summary.sent > 0 ||
    reviewedBatchState.batch.summary.failed > 0 || reviewedBatchState.batch.summary.uncertain > 0
  ));
  const reviewedBatch = activeBatch?.formId === form.formId && activeBatch.churchId === churchId &&
    reviewedBatchState?.formIdentity === formReviewIdentity &&
    (batchIdentityMatches || batchHasProgress) ? activeBatch : null;
  const visibleSelectionCount = visibleEligibleIds.filter((id) => selectedEligibleIds.includes(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleSelectionCount === visibleEligibleIds.length;
  const someVisibleSelected = visibleSelectionCount > 0 && !allVisibleSelected;
  const retryableMemberIds = new Set(rows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "failed").map(({ member }) => member.memberId));
  const updateRecipientSelection = (memberIds: string[], selected: boolean) => {
    const nextDeselected = new Set(deselectedIds);
    const nextRetries = new Set(selectedRetryIds);
    memberIds.forEach((memberId) => {
      if (retryableMemberIds.has(memberId)) {
        if (selected) nextRetries.add(memberId);
        else nextRetries.delete(memberId);
      } else if (selected) nextDeselected.delete(memberId);
      else nextDeselected.add(memberId);
    });
    const deselectionsChanged = nextDeselected.size !== deselectedIds.size || [...nextDeselected].some((id) => !deselectedIds.has(id));
    const retriesChanged = nextRetries.size !== selectedRetryIds.size || [...nextRetries].some((id) => !selectedRetryIds.has(id));
    if (!deselectionsChanged && !retriesChanged) return;
    setDeselectedIds(nextDeselected);
    setSelectedRetryIds(nextRetries);
    invalidateReview();
  };
  const formTeamIds = new Set(form.teamIds || []);
  const teamOptions = [
    { value: "", label: "All teams" },
    ...teams
      .filter((team) => !team.archivedAt && (!formTeamIds.size || formTeamIds.has(team.teamId)))
      .map((team) => ({ value: team.teamId, label: team.name })),
  ];
  if (privacySafe) teamOptions[0].label = "All managed Teams";
  const statusRows = rows.filter(({ reason }) => reason !== "Outside this form’s team scope");
  const statusCounts = {
    ready: rows.filter(({ eligible }) => eligible).length,
    consentNeeded: statusRows.filter(({ eligibility }) => eligibility.status === "consent_needed").length,
    optedOut: statusRows.filter(({ eligibility }) => eligibility.status === "opted_out").length,
    missingPhone: statusRows.filter(({ eligibility }) => eligibility.status === "no_mobile").length,
    sent: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "sent").length,
    responded: statusRows.filter(({ recipient }) => Boolean(recipient?.respondedAt)).length,
    failed: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "failed").length,
    needsStatusCheck: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "uncertain").length,
  };

  const reviewMessages = async () => {
    if (!historyLoaded || busy || selectedEligibleIds.length === 0) return;
    const requestedContext = contextIdentity;
    const requestedFormId = form.formId;
    const requestedFormIdentity = formReviewIdentity;
    const requestedRecipientEligibilityIdentity = recipientEligibilityIdentity;
    const requestedMemberIds = [...selectedEligibleIds];
    const requestedSelectionIdentity = JSON.stringify(requestedMemberIds);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const batch = await prepareAvailabilityBatchForMembers({
        churchId,
        formId: requestedFormId,
        intentType: "availability_request",
        memberIds: requestedMemberIds,
      });
      if (
        currentContextRef.current !== requestedContext ||
        currentFormReviewRef.current !== requestedFormIdentity ||
        currentRecipientEligibilityRef.current !== requestedRecipientEligibilityIdentity ||
        selectionIdentityRef.current !== requestedSelectionIdentity
      ) return;
      onBatchUpdated?.(batch);
      setReviewedBatchState({
        batch,
        formIdentity: requestedFormIdentity,
        recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
        selectionIdentity: requestedSelectionIdentity,
      });
      setConfirmOpen(true);
    } catch (caught) {
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "Could not prepare form messages.");
      }
    } finally {
      setBusy(false);
    }
  };

  const sendBatch = async () => {
    if (!historyLoaded || !reviewedBatch || reviewedBatch.summary.eligible === 0 || reviewedBatch.formId !== form.formId || reviewedBatch.churchId !== churchId || busy || sendLockRef.current) return;
    sendLockRef.current = true;
    const requestedContext = contextIdentity;
    const requestedChurchId = churchId;
    const requestedFormIdentity = formReviewIdentity;
    const requestedRecipientEligibilityIdentity = recipientEligibilityIdentity;
    const requestedSelectionIdentity = selectionIdentity;
    const batchToSend = reviewedBatch;
    setBusy(true);
    setError("");
    try {
      const response = await dispatchReviewedAvailabilityBatch(requestedChurchId, batchToSend);
      if (currentContextRef.current !== requestedContext || currentFormReviewRef.current !== requestedFormIdentity) return;
      onBatchUpdated?.(response.batch);
      setReviewedBatchState({
        batch: response.batch,
        formIdentity: requestedFormIdentity,
        recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
        selectionIdentity: requestedSelectionIdentity,
      });
      setConfirmOpen(false);
      setNotice("");
    } catch (caught) {
      setConfirmOpen(false);
      setReviewedBatchState(null);
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "We couldn't confirm whether these texts were sent. Check message history before trying again.");
      }
      try {
        const latest = await getAvailabilityNotificationBatch(requestedChurchId, batchToSend.batchId);
        if (currentContextRef.current === requestedContext && currentFormReviewRef.current === requestedFormIdentity) {
          onBatchUpdated?.(latest.batch);
          setReviewedBatchState({
            batch: latest.batch,
            formIdentity: requestedFormIdentity,
            recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
            selectionIdentity: requestedSelectionIdentity,
          });
        }
      } catch {
        // Keep the reviewed batch available so the operator can check it in Messages.
      }
    } finally {
      sendLockRef.current = false;
      setBusy(false);
    }
  };

  const toggleVisible = (checked: boolean) => updateRecipientSelection(visibleEligibleIds, checked);

  const eligibilitySummary = (<dl className="grid grid-cols-2 gap-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3 text-sm sm:grid-cols-4 lg:grid-cols-8" aria-label="Recipient status summary">
        <div><dt className="text-gray-400">Ready to send</dt><dd className="font-medium text-emerald-200">{statusCounts.ready}</dd></div>
        <div><dt className="text-gray-400">Consent needed</dt><dd className="text-gray-200">{statusCounts.consentNeeded}</dd></div>
        {!privacySafe ? <div><dt className="text-gray-400">Opted out</dt><dd className="text-gray-200">{statusCounts.optedOut}</dd></div> : null}
        <div><dt className="text-gray-400">No valid phone number</dt><dd className="text-gray-200">{statusCounts.missingPhone}</dd></div>
        <div><dt className="text-gray-400">Already sent</dt><dd className="text-gray-200">{statusCounts.sent}</dd></div>
        <div><dt className="text-gray-400">Already responded</dt><dd className="text-gray-200">{statusCounts.responded}</dd></div>
        <div><dt className="text-gray-400">Failed previously</dt><dd className="text-amber-200">{statusCounts.failed}</dd></div>
        <div><dt className="text-gray-400">Needs a status check</dt><dd className="text-amber-200">{statusCounts.needsStatusCheck}</dd></div>
      </dl>);
  const recipientDiagnostics = dialog ? <details className="text-xs text-gray-300"><summary className="cursor-pointer">Eligibility details ({rows.filter((row) => !row.eligible).length} unavailable)</summary><div className="mt-2 space-y-2">{eligibilitySummary}<ul className="max-h-40 space-y-1 overflow-y-auto">{rows.filter((row) => !row.eligible).map((row) => <li key={row.member.memberId}><span className="text-gray-200">{memberName(row.member)}</span> — {row.reason}</li>)}</ul></div></details> : eligibilitySummary;
  let continueLabel = `Review and send ${selectedEligibleIds.length} message${selectedEligibleIds.length === 1 ? "" : "s"}`;
  if (dialog) continueLabel = "Continue to review";
  if (busy) continueLabel = "Preparing messages...";
  const selectionFooter = <div className={dialog ? "shrink-0 border-t border-gray-700 bg-gray-800 px-4 py-3" : "flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between"}>
    <p className="text-xs text-gray-300" aria-live="polite">{!historyLoaded ? "Checking recipient eligibility..." : selectedEligibleIds.length ? `${selectedEligibleIds.length} of ${statusCounts.ready} eligible ${statusCounts.ready === 1 ? "volunteer" : "volunteers"} selected.` : "Select at least one eligible volunteer to continue."}</p>
    <div className="mt-2 flex items-center justify-end gap-2">
      {dialog ? <Button variant="tertiary" disabled={busy} onClick={onClose}>Cancel</Button> : null}
      <Button variant={dialog ? "cta" : "primary"} disabled={busy || !historyLoaded || !selectedEligibleIds.length} isLoading={busy} onClick={() => void reviewMessages()}>{continueLabel}</Button>
    </div>
  </div>;

  const selection = (
    <section className={dialog ? "min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-3" : "space-y-4 rounded-lg border border-sky-700 bg-gray-900/60 p-4"} aria-labelledby="send-form-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="send-form-heading" className={dialog ? "sr-only" : "font-semibold text-white"}>{dialog ? "Select recipients" : "Send form"}</h2><p className="text-sm text-gray-300">First-time recipients are selected automatically. Select a previous failure to retry it.</p></div>
        {!dialog ? <Button variant="textLink" disabled={busy} onClick={onClose}>Close</Button> : null}
      </div>
      {!dialog && historyLoaded ? recipientDiagnostics : null}
      {!historyLoaded ? historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-700/70 bg-amber-950/30 p-3 text-sm text-amber-100" role="alert">
          <span>{historyError}</span>
          <Button variant="secondary" disabled={busy} onClick={onRetryHistory}>Retry status check</Button>
        </div>
      ) : <p role="status" className="text-sm text-gray-300">Loading consent and message history…</p> : null}
      <div className={dialog ? "grid gap-2 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2"}>
        {dialog ? <Select label="Recipients" size="sm" labelFontSize="text-xs" labelClassName="text-gray-300" value={recipientFilter} onChange={setRecipientFilter} disabled={busy || !historyLoaded} options={[{ value: "all", label: "Specific members" }, { value: "first", label: "Eligible first-time recipients" }, { value: "outstanding", label: "Outstanding requests" }]} /> : null}
        {(!dialog || teamOptions.length > 2) ? <Select label="Team" size={dialog ? "sm" : "default"} labelFontSize={dialog ? "text-xs" : "text-sm"} labelClassName={dialog ? "text-gray-300" : undefined} value={teamFilter} onChange={setTeamFilter} options={teamOptions} disabled={busy || !historyLoaded} /> : null}
        <Input label="Search members" labelFontSize={dialog ? "text-xs" : "text-sm"} labelClassName={dialog ? "text-gray-300" : undefined} className={dialog ? "sm:col-span-2" : undefined} value={search} onChange={(value) => setSearch(String(value))} placeholder="Search by name" disabled={busy || !historyLoaded} />
      </div>
      <div className={dialog ? "max-h-[32vh] overflow-y-auto rounded-md border border-gray-700 bg-gray-900" : "max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950/50"}>
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2">
          <div className="flex items-center gap-3"><Checkbox aria-label={`Select all ${visibleEligibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={busy || !visibleEligibleIds.length} onCheckedChange={(checked) => toggleVisible(checked === true)} /><span className="text-sm text-gray-200">Select eligible members shown</span><span className="text-xs text-gray-300">{visibleRows.length} shown</span></div>
          <div className="flex items-center gap-3"><span aria-live="polite" className="text-sm text-gray-300">{selectedEligibleIds.length} selected</span><Button variant="textLink" disabled={busy || !historyLoaded || !selectedEligibleIds.length} onClick={() => updateRecipientSelection(selectedEligibleIds, false)}>Clear</Button></div>
        </div>
        <div className="divide-y divide-gray-800" role="list" aria-label="Form recipients">
          {visibleRows.length ? visibleRows.map(({ member, eligible, reason, previousDeliveryStatus }) => <div key={member.memberId} className="flex min-h-10 items-center gap-3 px-3 py-2" role="listitem"><Checkbox label={<MemberNameWithIndicator name={memberName(member)} memberId={member.memberId} className="flex-1" />} checked={selectedEligibleIds.includes(member.memberId)} disabled={busy || !historyLoaded || !eligible} onCheckedChange={(checked) => updateRecipientSelection([member.memberId], checked === true)} className="flex-1" />{!eligible ? <span className="max-w-[50%] text-right text-xs text-amber-200">{reason}</span> : <span className="shrink-0 text-xs text-emerald-200">{previousDeliveryStatus === "failed" ? "Previous send failed · select to retry" : "First message · ready"}</span>}</div>) : <p className="p-4 text-sm text-gray-300">{dialog && recipientFilter === "first" ? "No first-time recipients are ready. Choose Specific members to review eligibility or previous failures." : "No members match these filters."}</p>}
        </div>
      </div>
      {dialog && historyLoaded && (rows.some((row) => !row.eligible) || statusCounts.failed > 0) ? recipientDiagnostics : null}
      {!dialog ? selectionFooter : null}
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      {reviewedBatch && batchHasProgress && dialog ? <p role="status" className="text-sm text-gray-200">{reviewedBatch.summary.sent} sent · {reviewedBatch.summary.failed} failed · {reviewedBatch.summary.uncertain} unconfirmed. Check recipient history for delivery updates.</p> : null}
      {reviewedBatch && batchHasProgress && !dialog ? <AvailabilityBatchReview batch={reviewedBatch} formName={form.name} busy={busy || !historyLoaded} privacySafe={privacySafe} mode="status" /> : null}
    </section>
  );

  const reviewContent = reviewedBatch ? <div className="space-y-3">
    {dialog ? <p className="text-sm text-gray-300">{selectedEligibleIds.length} volunteers selected</p> : null}
    <AvailabilityBatchReview batch={reviewedBatch} formName={form.name} busy={busy} privacySafe={privacySafe} mode="confirmation" />
  </div> : null;
  const reviewFooter = <div className={dialog ? "flex shrink-0 items-center justify-between gap-2 border-t border-gray-700 bg-gray-800 px-4 py-3" : "mt-4 flex flex-col-reverse justify-end gap-2 border-t border-gray-700 pt-4 sm:flex-row"}>
    <Button variant={dialog ? "tertiary" : "secondary"} disabled={busy} onClick={() => setConfirmOpen(false)}>{dialog ? "Back" : "Cancel"}</Button>
    <div className="flex items-center gap-2">
      {dialog ? <Button variant="tertiary" disabled={busy} onClick={onClose}>Cancel</Button> : null}
      {reviewedBatch && reviewedBatch.summary.eligible > 0 ? <Button variant={dialog ? "cta" : "primary"} disabled={busy || !historyLoaded} isLoading={busy} onClick={() => void sendBatch()}>Send {reviewedBatch.summary.eligible} message{reviewedBatch.summary.eligible === 1 ? "" : "s"}</Button> : null}
    </div>
  </div>;
  const confirmation = <>{reviewContent}{reviewFooter}</>;
  const reviewing = Boolean(confirmOpen && reviewedBatch && historyLoaded);

  if (dialog) return <Modal isOpen onClose={onClose} title={reviewing ? "Review text messages" : "Send requests"} size="md" busy={busy} contentPadding="p-0" contentClassName="flex flex-col overflow-hidden">
    <ol className="flex shrink-0 items-center gap-4 border-b border-gray-700 px-4 pb-3 text-sm" aria-label="Send request steps">
      <li aria-current={!reviewing ? "step" : undefined} className={!reviewing ? "font-semibold text-cyan-300" : "text-gray-300"}>1. Select recipients</li>
      <li aria-current={reviewing ? "step" : undefined} className={reviewing ? "font-semibold text-cyan-300" : "text-gray-300"}>2. Review and send</li>
    </ol>
    {reviewing ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{reviewContent}</div> : selection}
    {reviewing ? reviewFooter : selectionFooter}
  </Modal>;

  return <>{selection}
      <Modal isOpen={confirmOpen && Boolean(reviewedBatch) && historyLoaded} onClose={() => setConfirmOpen(false)} title="Review text messages" description="Check who will receive this form and read the personalized messages. Choose Send to send them." size="lg" busy={busy}>
        {confirmation}
      </Modal>
    </>;

};

export default AvailabilityFormSendFlow;
