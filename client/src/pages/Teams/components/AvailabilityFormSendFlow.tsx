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
  onClose,
}: {
  churchId: string;
  form: TeamIntakeForm;
  members: TeamRosterMember[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  recipients: TeamIntakeRecipient[];
  eligibilityByMemberId?: Record<string, SmsMemberEligibility>;
  notificationIntents: NotificationIntent[];
  smsDeliveryAttempts: SmsDeliveryAttempt[];
  historyLoaded: boolean;
  historyError: string;
  onRetryHistory: () => void;
  onBatchUpdated?: (batch: NotificationBatch) => void;
  onClose: () => void;
}) => {
  const [deselectedIds, setDeselectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewedBatchState, setReviewedBatchState] = useState<{
    batch: NotificationBatch;
    formIdentity: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const contextIdentity = `${churchId}:${form.formId}`;
  const formReviewIdentity = JSON.stringify({
    formId: form.formId,
    name: form.name,
    startDate: form.startDate,
    endDate: form.endDate,
    responseDeadline: form.responseDeadline || "",
    teamIds: [...(form.teamIds || [])].sort(),
    enabledFields: [...(form.enabledFields || [])].sort(),
    availabilityOccurrences: form.availabilityOccurrences || [],
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
    setReviewedBatchState(null);
    setConfirmOpen(false);
    if (hadReview) setNotice("Recipients changed. Review the messages again before sending.");
  };

  const updateRecipientSelection = (memberIds: string[], selected: boolean) => {
    const next = new Set(deselectedIds);
    memberIds.forEach((memberId) => {
      if (selected) next.delete(memberId);
      else next.add(memberId);
    });
    if (next.size === deselectedIds.size && [...next].every((id) => deselectedIds.has(id))) return;
    setDeselectedIds(next);
    invalidateReview();
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
  const reviewedBatch = activeBatch?.formId === form.formId && activeBatch.churchId === churchId && reviewedBatchState?.formIdentity === formReviewIdentity ? activeBatch : null;
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(({ member, memberTeamIds }) =>
    (!teamFilter || memberTeamIds.has(teamFilter)) &&
    (!query || memberName(member).toLocaleLowerCase().includes(query)),
  );
  const visibleEligibleIds = historyLoaded ? visibleRows.filter(({ eligible }) => eligible).map(({ member }) => member.memberId) : [];
  const selectedEligibleIds = historyLoaded ? rows.filter(({ member, eligible }) => eligible && !deselectedIds.has(member.memberId)).map(({ member }) => member.memberId) : [];
  const selectionIdentityRef = useRef(JSON.stringify(selectedEligibleIds));
  selectionIdentityRef.current = JSON.stringify(selectedEligibleIds);
  const visibleSelectionCount = visibleEligibleIds.filter((id) => !deselectedIds.has(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleSelectionCount === visibleEligibleIds.length;
  const someVisibleSelected = visibleSelectionCount > 0 && !allVisibleSelected;
  const teamOptions = [
    { value: "", label: "All teams" },
    ...teams.filter((team) => !team.archivedAt).map((team) => ({ value: team.teamId, label: team.name })),
  ];
  const statusRows = rows.filter(({ reason }) => reason !== "Outside this form’s team scope");
  const statusCounts = {
    ready: rows.filter(({ eligible }) => eligible).length,
    consentNeeded: statusRows.filter(({ eligibility }) => eligibility.status === "consent_needed").length,
    optedOut: statusRows.filter(({ eligibility }) => eligibility.status === "opted_out").length,
    missingPhone: statusRows.filter(({ eligibility }) => eligibility.status === "no_mobile").length,
    sent: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "sent").length,
    responded: statusRows.filter(({ recipient }) => Boolean(recipient?.respondedAt)).length,
    failed: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "failed").length,
    uncertain: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "uncertain").length,
  };

  const reviewMessages = async () => {
    if (!historyLoaded || busy || selectedEligibleIds.length === 0) return;
    const requestedContext = contextIdentity;
    const requestedFormId = form.formId;
    const requestedFormIdentity = formReviewIdentity;
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
        selectionIdentityRef.current !== requestedSelectionIdentity
      ) return;
      onBatchUpdated?.(batch);
      setReviewedBatchState({ batch, formIdentity: requestedFormIdentity });
      setNotice("Messages are ready to review. Nothing has been sent.");
    } catch (caught) {
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "Could not prepare form messages.");
      }
    } finally {
      setBusy(false);
    }
  };

  const sendBatch = async () => {
    if (!reviewedBatch || reviewedBatch.formId !== form.formId || reviewedBatch.churchId !== churchId || busy) return;
    const requestedContext = contextIdentity;
    const requestedFormIdentity = formReviewIdentity;
    const batchToSend = reviewedBatch;
    setBusy(true);
    setError("");
    try {
      const response = await dispatchReviewedAvailabilityBatch(churchId, batchToSend);
      if (currentContextRef.current !== requestedContext || currentFormReviewRef.current !== requestedFormIdentity) return;
      onBatchUpdated?.(response.batch);
      setReviewedBatchState({ batch: response.batch, formIdentity: requestedFormIdentity });
      setConfirmOpen(false);
      setNotice("Send finished. Delivery and response status are shown below.");
    } catch (caught) {
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "The send status could not be confirmed. Check Messages before retrying.");
      }
      try {
        const latest = await getAvailabilityNotificationBatch(churchId, batchToSend.batchId);
        if (currentContextRef.current === requestedContext && currentFormReviewRef.current === requestedFormIdentity) {
          onBatchUpdated?.(latest.batch);
          setReviewedBatchState({ batch: latest.batch, formIdentity: requestedFormIdentity });
        }
      } catch {
        // Keep the reviewed batch available so the operator can check it in Messages.
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleVisible = (checked: boolean) => updateRecipientSelection(visibleEligibleIds, checked);

  return (
    <section className="space-y-4 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="send-form-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="send-form-heading" className="font-semibold text-white">Send form</h2><p className="text-sm text-gray-400">Eligible members are selected automatically. Uncheck anyone you don’t want to contact.</p></div>
        <Button variant="textLink" disabled={busy} onClick={onClose}>Close</Button>
      </div>
      {historyLoaded ? <dl className="grid grid-cols-2 gap-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3 text-sm sm:grid-cols-4 lg:grid-cols-8" aria-label="Recipient status summary">
        <div><dt className="text-gray-400">Ready to send</dt><dd className="font-medium text-emerald-200">{statusCounts.ready}</dd></div>
        <div><dt className="text-gray-400">Consent needed</dt><dd className="text-gray-200">{statusCounts.consentNeeded}</dd></div>
        <div><dt className="text-gray-400">Opted out</dt><dd className="text-gray-200">{statusCounts.optedOut}</dd></div>
        <div><dt className="text-gray-400">Missing/invalid phone</dt><dd className="text-gray-200">{statusCounts.missingPhone}</dd></div>
        <div><dt className="text-gray-400">Already sent</dt><dd className="text-gray-200">{statusCounts.sent}</dd></div>
        <div><dt className="text-gray-400">Already responded</dt><dd className="text-gray-200">{statusCounts.responded}</dd></div>
        <div><dt className="text-gray-400">Failed previously</dt><dd className="text-amber-200">{statusCounts.failed}</dd></div>
        <div><dt className="text-gray-400">Uncertain</dt><dd className="text-amber-200">{statusCounts.uncertain}</dd></div>
      </dl> : null}
      {!historyLoaded ? historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-700/70 bg-amber-950/30 p-3 text-sm text-amber-100" role="alert">
          <span>{historyError}</span>
          <Button variant="secondary" disabled={busy} onClick={onRetryHistory}>Retry status check</Button>
        </div>
      ) : <p role="status" className="text-sm text-gray-300">Loading consent and message history…</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Team" value={teamFilter} onChange={setTeamFilter} options={teamOptions} disabled={busy || !historyLoaded} />
        <Input label="Search members" value={search} onChange={(value) => setSearch(String(value))} placeholder="Search by name" disabled={busy || !historyLoaded} />
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950/50">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-3">
          <div className="flex items-center gap-3"><Checkbox aria-label={`Select all ${visibleEligibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={busy || !visibleEligibleIds.length} onCheckedChange={(checked) => toggleVisible(checked === true)} /><span className="text-sm text-gray-200">Select eligible members shown</span><span className="text-xs text-gray-400">{visibleRows.length} shown</span></div>
          <div className="flex items-center gap-3"><span aria-live="polite" className="text-sm text-gray-300">{selectedEligibleIds.length} selected</span><Button variant="textLink" disabled={busy || !selectedEligibleIds.length} onClick={() => updateRecipientSelection(selectedEligibleIds, false)}>Clear</Button></div>
        </div>
        <div className="divide-y divide-gray-800" role="list" aria-label="Form recipients">
          {visibleRows.length ? visibleRows.map(({ member, eligible, reason, previousDeliveryStatus }) => <div key={member.memberId} className="flex min-h-12 items-center gap-3 px-3 py-2.5" role="listitem"><Checkbox label={memberName(member)} checked={eligible && !deselectedIds.has(member.memberId)} disabled={busy || !historyLoaded || !eligible} onCheckedChange={(checked) => updateRecipientSelection([member.memberId], checked === true)} className="flex-1" />{!eligible ? <span className="shrink-0 text-xs text-amber-200">{reason}</span> : <span className="shrink-0 text-xs text-emerald-200">{previousDeliveryStatus === "failed" ? "SMS ready · previous attempt failed" : "SMS ready"}</span>}</div>) : <p className="p-4 text-sm text-gray-400">No members match these filters.</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-400">{selectedEligibleIds.length ? `${selectedEligibleIds.length} of ${statusCounts.ready} eligible member${statusCounts.ready === 1 ? "" : "s"} selected.` : "Select at least one eligible member to continue."}</p><Button disabled={busy || !historyLoaded || !selectedEligibleIds.length} isLoading={busy} onClick={() => void reviewMessages()}>Review {selectedEligibleIds.length} message{selectedEligibleIds.length === 1 ? "" : "s"}</Button></div>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      {reviewedBatch ? <AvailabilityBatchReview batch={reviewedBatch} formName={form.name} busy={busy} onConfirm={() => setConfirmOpen(true)} /> : null}
      <Modal isOpen={confirmOpen && Boolean(reviewedBatch)} onClose={() => setConfirmOpen(false)} title="Send this form?" description="Review who will receive this form by SMS." size="sm">
        {reviewedBatch ? <div className="space-y-4 text-sm text-gray-200">
          <p>Send {reviewedBatch.summary.eligible} messages for {form.name}? This will use {reviewedBatch.summary.totalSegments} SMS segments. Excluded members will not be contacted.</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-gray-300">{reviewedBatch.recipients.filter(({ eligible }) => eligible).map((recipient) => <li key={recipient.memberId}>{recipient.memberName} · {recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber}</li>)}</ul>
          <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</Button><Button disabled={busy} isLoading={busy} onClick={() => void sendBatch()}>Send {reviewedBatch.summary.eligible} message{reviewedBatch.summary.eligible === 1 ? "" : "s"}</Button></div>
        </div> : null}
      </Modal>
    </section>
  );
};

export default AvailabilityFormSendFlow;
