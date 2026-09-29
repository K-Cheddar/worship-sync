import { useEffect, useMemo, useRef, useState } from "react";
import { Checkbox as UICheckbox } from "../../../components/ui/Checkbox";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import type {
  NotificationBatch,
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
  onBatchUpdated?: (batch: NotificationBatch) => void;
  onClose: () => void;
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeBatch, setActiveBatch] = useState<NotificationBatch | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const contextIdentity = `${churchId}:${form.formId}`;
  const currentContextRef = useRef(contextIdentity);
  currentContextRef.current = contextIdentity;
  const previousContextRef = useRef(contextIdentity);

  useEffect(() => {
    if (previousContextRef.current === contextIdentity) return;
    previousContextRef.current = contextIdentity;
    setSelectedIds([]);
    setActiveBatch(null);
    setConfirmOpen(false);
    setNotice("Form changed. Choose recipients and review the messages again.");
  }, [contextIdentity]);

  const invalidateReview = () => {
    const hadReview = Boolean(activeBatch || confirmOpen);
    setActiveBatch(null);
    setConfirmOpen(false);
    if (hadReview) setNotice("Recipients changed. Review the messages again before sending.");
  };

  const updateSelectedIds = (nextIds: string[]) => {
    const next = [...new Set(nextIds)];
    if (next.length === selectedIds.length && next.every((id) => selectedIds.includes(id))) return;
    setSelectedIds(next);
    invalidateReview();
  };

  const activeMembers = useMemo(() => members.filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))), [members]);
  const rows = useMemo(() => getAvailabilityRecipientRows({
    members: activeMembers,
    positions,
    teams,
    recipients,
    eligibilityByMemberId,
    form,
    intentType: "availability_request",
  }), [activeMembers, eligibilityByMemberId, form, positions, recipients, teams]);
  const reviewedBatch = activeBatch?.formId === form.formId && activeBatch.churchId === churchId ? activeBatch : null;
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(({ member, memberTeamIds }) =>
    (!teamFilter || memberTeamIds.has(teamFilter)) &&
    (!query || memberName(member).toLocaleLowerCase().includes(query)),
  );
  const visibleEligibleIds = visibleRows.filter(({ eligible }) => eligible).map(({ member }) => member.memberId);
  const selectedEligibleIds = rows.filter(({ member, eligible }) => eligible && selectedIds.includes(member.memberId)).map(({ member }) => member.memberId);
  const visibleSelectionCount = visibleEligibleIds.filter((id) => selectedIds.includes(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleSelectionCount === visibleEligibleIds.length;
  const someVisibleSelected = visibleSelectionCount > 0 && !allVisibleSelected;
  const teamOptions = [
    { value: "", label: "All teams" },
    ...teams.filter((team) => !team.archivedAt).map((team) => ({ value: team.teamId, label: team.name })),
  ];

  const reviewMessages = async () => {
    if (busy || selectedEligibleIds.length === 0) return;
    const requestedContext = contextIdentity;
    const requestedFormId = form.formId;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const batch = await prepareAvailabilityBatchForMembers({
        churchId,
        formId: requestedFormId,
        intentType: "availability_request",
        memberIds: selectedEligibleIds,
      });
      onBatchUpdated?.(batch);
      if (currentContextRef.current !== requestedContext) return;
      setActiveBatch(batch);
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
    if (!activeBatch || activeBatch.formId !== form.formId || activeBatch.churchId !== churchId || busy) return;
    const requestedContext = contextIdentity;
    const reviewedBatch = activeBatch;
    setBusy(true);
    setError("");
    try {
      const response = await dispatchReviewedAvailabilityBatch(churchId, reviewedBatch);
      onBatchUpdated?.(response.batch);
      if (currentContextRef.current !== requestedContext) return;
      setActiveBatch(response.batch);
      setConfirmOpen(false);
      setNotice("Send finished. Delivery and response status are shown below.");
    } catch (caught) {
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "The send status could not be confirmed. Check Messages before retrying.");
      }
      try {
        const latest = await getAvailabilityNotificationBatch(churchId, reviewedBatch.batchId);
        if (currentContextRef.current === requestedContext) {
          onBatchUpdated?.(latest.batch);
          setActiveBatch(latest.batch);
        }
      } catch {
        // Keep the reviewed batch available so the operator can check it in Messages.
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleVisible = (checked: boolean) => updateSelectedIds(checked
    ? [...selectedIds, ...visibleEligibleIds]
    : selectedIds.filter((id) => !visibleEligibleIds.includes(id)));

  return (
    <section className="space-y-4 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="send-form-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="send-form-heading" className="font-semibold text-white">Send form</h2><p className="text-sm text-gray-400">Choose members to receive {form.name} by SMS.</p></div>
        <Button variant="textLink" disabled={busy} onClick={onClose}>Close</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Team" value={teamFilter} onChange={setTeamFilter} options={teamOptions} disabled={busy} />
        <Input label="Search members" value={search} onChange={(value) => setSearch(String(value))} placeholder="Search by name" disabled={busy} />
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950/50">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-3">
          <div className="flex items-center gap-3"><UICheckbox aria-label={`Select all ${visibleEligibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={busy || !visibleEligibleIds.length} onCheckedChange={(checked) => toggleVisible(checked === true)} /><span className="text-sm text-gray-200">Select eligible members shown</span><span className="text-xs text-gray-400">{visibleRows.length} shown</span></div>
          <div className="flex items-center gap-3"><span aria-live="polite" className="text-sm text-gray-300">{selectedIds.length} selected</span><Button variant="textLink" disabled={busy || !selectedIds.length} onClick={() => updateSelectedIds([])}>Clear</Button></div>
        </div>
        <div className="divide-y divide-gray-800" role="list" aria-label="Form recipients">
          {visibleRows.length ? visibleRows.map(({ member, eligible, reason }) => <div key={member.memberId} className="flex min-h-12 items-center gap-3 px-3 py-2.5" role="listitem"><Checkbox label={memberName(member)} checked={selectedIds.includes(member.memberId)} disabled={busy || !eligible} onCheckedChange={(checked) => updateSelectedIds(checked ? [...selectedIds, member.memberId] : selectedIds.filter((id) => id !== member.memberId))} className="flex-1" />{!eligible ? <span className="shrink-0 text-xs text-amber-200">{reason}</span> : <span className="shrink-0 text-xs text-emerald-200">SMS ready</span>}</div>) : <p className="p-4 text-sm text-gray-400">No members match these filters.</p>}
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-gray-400">{selectedEligibleIds.length ? `${selectedEligibleIds.length} eligible member${selectedEligibleIds.length === 1 ? "" : "s"} selected.` : "Select at least one eligible member to continue."}</p><Button disabled={busy || !selectedEligibleIds.length} isLoading={busy} onClick={() => void reviewMessages()}>Review {selectedEligibleIds.length} message{selectedEligibleIds.length === 1 ? "" : "s"}</Button></div>
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
