import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "../../../components/Modal/ConfirmDialog";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import {
  getAvailabilityNotificationBatch,
  getNotificationIntentPreview,
  getNotificationIntents,
  sendNotificationIntent,
} from "../../../api/auth";
import type { NotificationBatch, NotificationIntent, NotificationIntentType } from "../../../api/authTypes";
import { useTeamsPage } from "../TeamsPageContext";
import AvailabilityBatchReview from "../components/AvailabilityBatchReview";
import SmsConfirmationModal from "../components/SmsConfirmationModal";
import { getAvailabilityRecipientRows } from "../availabilityRecipientSelection";
import { dispatchReviewedAvailabilityBatch, prepareAvailabilityBatchForMembers } from "../availabilityBatchActions";

const memberName = (member: { firstName?: string; lastName?: string }) =>
  [member.firstName, member.lastName].filter(Boolean).join(" ") || "Volunteer";

const intentLabel = (intent: NotificationIntent) => {
  if (intent.intentType === "availability_request") return "Form response request";
  if (intent.intentType === "availability_reminder") return `Form reminder${intent.reminderRound ? ` · round ${intent.reminderRound}` : ""}`;
  if (intent.intentType === "assignment_notification") return "Assignment notification";
  if (intent.intentType === "assignment_confirmation") return "Assignment response";
  if (intent.intentType === "schedule_change") return "Schedule change";
  return "Replacement invitation";
};

const statusLabel: Record<NotificationIntent["status"], string> = {
  preview: "Preview",
  ready: "Ready",
  sending: "Sending",
  sent: "Accepted by provider",
  failed: "Failed · review before retry",
  unknown: "Uncertain · check SMS history",
  suppressed: "Not sent",
};

const TeamsMessagesPage = () => {
  const { churchId, pageData, canEditTeams } = useTeamsPage();
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const [intentType, setIntentType] = useState<Extract<NotificationIntentType, "availability_request" | "availability_reminder">>("availability_request");
  const [formId, setFormId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [activeBatch, setActiveBatch] = useState<NotificationBatch | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [intents, setIntents] = useState<NotificationIntent[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [individualSmsPreview, setIndividualSmsPreview] = useState<{
    churchId: string;
    intentId: string;
    approvalVersion: string;
    recipientName: string;
    phoneNumberSnapshot: string;
    message: string;
    segmentCount: number;
  } | null>(null);
  const individualSmsSendLockRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const didRestoreInitialBatchRef = useRef(false);

  const forms = useMemo(() => pageData.intakeForms.filter((form) => !form.archivedAt), [pageData.intakeForms]);
  const members = useMemo(
    () => [...pageData.members].filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [pageData.members],
  );
  const teamOptions = useMemo(() => [
    { value: "", label: "All teams" },
    ...pageData.teams.filter((team) => !team.archivedAt).map((team) => ({ value: team.teamId, label: team.name })),
  ], [pageData.teams]);
  const allRecipientRows = useMemo(() => {
    const selectedForm = forms.find((form) => form.formId === formId);
    return getAvailabilityRecipientRows({
      members,
      positions: pageData.positions,
      teams: pageData.teams,
      recipients: pageData.intakeRecipients,
      eligibilityByMemberId: pageData.smsEligibilityByMemberId,
      form: selectedForm,
      intentType,
    });
  }, [forms, formId, intentType, members, pageData.intakeRecipients, pageData.positions, pageData.smsEligibilityByMemberId, pageData.teams]);
  const query = memberSearch.trim().toLocaleLowerCase();
  const recipientRows = allRecipientRows.filter(({ member, memberTeamIds }) =>
      (!teamFilter || memberTeamIds.has(teamFilter)) &&
      (!query || memberName(member).toLocaleLowerCase().includes(query)),
    );
  const visibleEligibleIds = recipientRows.filter((row) => row.eligible).map(({ member }) => member.memberId);
  const selectedVisibleCount = visibleEligibleIds.filter((id) => selectedMemberIds.includes(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && selectedVisibleCount === visibleEligibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedEligibleIds = allRecipientRows.filter(({ member, eligible }) => eligible && selectedMemberIds.includes(member.memberId)).map(({ member }) => member.memberId);
  const reviewedBatch = activeBatch?.churchId === churchId && activeBatch.formId === formId && activeBatch.intentType === intentType ? activeBatch : null;

  useEffect(() => {
    let active = true;
    setIntents([]);
    setNextCursor("");
    setActiveBatch(null);
    if (!churchId || !canEditTeams || !formId) return () => { active = false; };
    setLoading(true);
    getNotificationIntents(churchId, { formId })
      .then((response) => { if (active) { setIntents(response.intents); setNextCursor(response.nextCursor || ""); } })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load message history."); })
      .finally(() => { if (active) setLoading(false); });
    const savedBatchId = !didRestoreInitialBatchRef.current
      ? window.localStorage.getItem(`worshipsync:last-notification-batch:${churchId}:${formId}`)
      : null;
    if (savedBatchId) {
      getAvailabilityNotificationBatch(churchId, savedBatchId)
        .then((response) => {
          if (active && response.batch.formId === formId && response.batch.intentType === intentType) {
            setSelectedMemberIds(response.batch.selectedMemberIds);
            setActiveBatch(response.batch);
          }
        })
        .catch(() => { if (active) window.localStorage.removeItem(`worshipsync:last-notification-batch:${churchId}:${formId}`); });
    }
    didRestoreInitialBatchRef.current = true;
    return () => { active = false; };
  }, [churchId, canEditTeams, formId, intentType]);

  const refreshIntents = async () => {
    const requestedChurch = churchId;
    if (!formId) return;
    const response = await getNotificationIntents(requestedChurch, { formId });
    if (churchIdRef.current === requestedChurch) { setIntents(response.intents); setNextCursor(response.nextCursor || ""); }
  };

  const loadOlderIntents = async () => {
    if (!nextCursor || loading || sending) return;
    const requestedChurch = churchId;
    setLoading(true);
    try {
      const response = await getNotificationIntents(requestedChurch, { formId, cursor: nextCursor });
      if (churchIdRef.current === requestedChurch) {
        setIntents((current) => [...current, ...response.intents]);
        setNextCursor(response.nextCursor || "");
      }
    } catch (caught) {
      if (churchIdRef.current === requestedChurch) setError(caught instanceof Error ? caught.message : "Could not load older message history.");
    } finally {
      if (churchIdRef.current === requestedChurch) setLoading(false);
    }
  };

  const invalidateReview = (message = "Review details changed. Review the messages again before sending.") => {
    const hadReview = Boolean(activeBatch || confirmOpen);
    setActiveBatch(null);
    setConfirmOpen(false);
    setNotice(hadReview ? message : "");
  };

  const updateSelectedMemberIds = (nextIds: string[]) => {
    const next = [...new Set(nextIds)];
    if (next.length === selectedMemberIds.length && next.every((id) => selectedMemberIds.includes(id))) return;
    setSelectedMemberIds(next);
    invalidateReview("Recipients changed. Review the messages again before sending.");
  };

  const toggleMember = (memberId: string, checked: boolean) => {
    updateSelectedMemberIds(checked ? [...selectedMemberIds, memberId] : selectedMemberIds.filter((id) => id !== memberId));
  };

  const toggleVisibleMembers = (checked: boolean) => {
    updateSelectedMemberIds(checked
      ? [...selectedMemberIds, ...visibleEligibleIds]
      : selectedMemberIds.filter((id) => !visibleEligibleIds.includes(id)));
  };

  const makePreview = async () => {
    if (!formId || selectedEligibleIds.length === 0 || loading || sending) return;
    const ownerChurch = churchId;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const reviewedFormId = formId;
      const reviewedIntentType = intentType;
      const reviewedMemberIds = [...selectedEligibleIds];
      const batch = await prepareAvailabilityBatchForMembers({
        churchId: ownerChurch,
        formId: reviewedFormId,
        intentType: reviewedIntentType,
        memberIds: reviewedMemberIds,
      });
      if (churchIdRef.current !== ownerChurch || formId !== reviewedFormId || intentType !== reviewedIntentType || JSON.stringify(selectedEligibleIds) !== JSON.stringify(reviewedMemberIds)) return;
      setActiveBatch(batch);
      await refreshIntents();
      setNotice("Batch prepared. Review recipients and message details; nothing has been sent.");
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) setError(caught instanceof Error ? caught.message : "Could not prepare the message batch.");
    } finally {
      if (churchIdRef.current === ownerChurch) setLoading(false);
    }
  };

  const confirmBatch = async () => {
    if (!activeBatch || activeBatch.churchId !== churchId || activeBatch.formId !== formId || activeBatch.intentType !== intentType || sending || loading) return;
    const ownerChurch = churchId;
    setConfirmOpen(false);
    setSending(true);
    setError("");
    setNotice("Sending the selected batch…");
    try {
      const response = await dispatchReviewedAvailabilityBatch(ownerChurch, activeBatch);
      if (churchIdRef.current !== ownerChurch || formId !== activeBatch.formId || intentType !== activeBatch.intentType) return;
      setActiveBatch(response.batch);
      await refreshIntents();
      setNotice(`Batch updated: ${response.batch.summary.sent} accepted by provider, ${response.batch.summary.failed} failed, ${response.batch.summary.uncertain} uncertain.`);
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) {
        setError(caught instanceof Error ? caught.message : "The batch status could not be confirmed.");
        try {
          const latest = await getAvailabilityNotificationBatch(ownerChurch, activeBatch.batchId);
          if (churchIdRef.current === ownerChurch) setActiveBatch(latest.batch);
        } catch { /* Keep the stored batch id so the operator can refresh it. */ }
      }
    } finally {
      if (churchIdRef.current === ownerChurch) setSending(false);
    }
  };

  const sendIndividual = async (intent: NotificationIntent) => {
    if (sending || loading || individualSmsPreview) return;
    const ownerChurch = churchId;
    setError("");
    setSending(true);
    try {
      const prepared = await getNotificationIntentPreview(ownerChurch, intent.intentId);
      if (churchIdRef.current !== ownerChurch) return;
      if (!prepared.preview.eligible) {
        setError("This volunteer is not currently eligible for SMS. Check the form, phone number, and consent.");
        await refreshIntents();
        return;
      }
      const member = members.find((item) => item.memberId === intent.memberId);
      setIndividualSmsPreview({
        churchId: ownerChurch,
        intentId: prepared.preview.intentId,
        approvalVersion: prepared.preview.approvalVersion,
        recipientName: member ? memberName(member) : "Volunteer",
        phoneNumberSnapshot: prepared.preview.phoneNumberSnapshot,
        message: prepared.preview.message,
        segmentCount: prepared.preview.segmentCount,
      });
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) setError(caught instanceof Error ? caught.message : "Could not send this message.");
    } finally {
      if (churchIdRef.current === ownerChurch) setSending(false);
    }
  };

  const sendIndividualPreview = async () => {
    const preview = individualSmsPreview;
    if (!preview || individualSmsSendLockRef.current) return;
    if (churchIdRef.current !== preview.churchId) {
      setIndividualSmsPreview(null);
      return;
    }
    individualSmsSendLockRef.current = true;
    const ownerChurch = preview.churchId;
    setIndividualSmsPreview(null);
    setSending(true);
    setError("");
    try {
      const response = await sendNotificationIntent(ownerChurch, preview.intentId, preview.approvalVersion);
      if (churchIdRef.current !== ownerChurch) return;
      setNotice(response.success ? "SMS accepted by the provider." : response.errorMessage || "The SMS was not confirmed as sent.");
      try {
        await refreshIntents();
      } catch {
        if (churchIdRef.current === ownerChurch) setError("The SMS outcome was recorded, but message history could not be refreshed.");
      }
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) {
        setError(caught instanceof Error ? caught.message : "Could not confirm the SMS outcome. Check message history before retrying.");
        try { await refreshIntents(); } catch { /* Preserve the send outcome message. */ }
      }
    } finally {
      individualSmsSendLockRef.current = false;
      if (churchIdRef.current === ownerChurch) setSending(false);
    }
  };

  const cancelIndividualPreview = () => {
    if (individualSmsSendLockRef.current) return;
    setIndividualSmsPreview(null);
  };

  if (!canEditTeams) {
    return <div className="p-6 text-sm text-gray-300">Teams edit permission is required to prepare or send volunteer messages.</div>;
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="teams-messages-heading">
      <header className="space-y-1">
        <h1 id="teams-messages-heading" className="text-xl font-semibold text-white">Volunteer messages</h1>
        <p className="text-sm text-gray-300">Review the selected volunteers and message before every send. Scheduling events only create drafts.</p>
      </header>

      <section className="space-y-5 rounded-xl border border-gray-700 bg-gray-900/40 p-4 shadow-sm sm:p-6" aria-labelledby="availability-preview-heading">
        <div>
          <h2 id="availability-preview-heading" className="font-semibold text-white">Intake form SMS</h2>
          <p className="mt-1 text-sm text-gray-400">Requests use the selected intake form and each volunteer’s existing secure response link.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Message" value={intentType} disabled={loading || sending} onChange={(value) => {
            const nextType = value as typeof intentType;
            if (nextType === intentType) return;
            setIntentType(nextType);
            invalidateReview("Message type changed. Review the messages again before sending.");
          }} options={[
            { value: "availability_request", label: "Request form responses" },
            { value: "availability_reminder", label: "Remind nonresponders" },
          ]} />
          <Select label="Intake form" value={formId} disabled={loading || sending} onChange={(value) => {
            if (value === formId) return;
            setFormId(value);
            setSelectedMemberIds([]);
            invalidateReview("Form changed. Choose recipients and review the messages again.");
          }} options={forms.map((form) => ({
            value: form.formId,
            label: `${form.name} · ${form.startDate}–${form.endDate}${form.active ? "" : " · closed"}`,
          }))} />
        </div>
        <div className="space-y-3 border-t border-gray-700 pt-4" aria-labelledby="recipients-heading">
          <div>
            <h3 id="recipients-heading" className="font-semibold text-white">Recipients</h3>
            <p className="mt-1 text-sm text-gray-400">Choose who should receive this message. Selections stay selected when you change filters.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Team" value={teamFilter} disabled={loading || sending} onChange={setTeamFilter} options={teamOptions} />
            <Input label="Search volunteers" value={memberSearch} onChange={(value) => setMemberSearch(String(value))} placeholder="Search by name" disabled={loading || sending} />
          </div>
          <div className="max-h-80 touch-pan-y overflow-y-auto overscroll-contain rounded-lg border border-gray-700 bg-gray-950/50">
            <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-gray-700 bg-gray-900 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Checkbox aria-label={`Select all ${visibleEligibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={loading || sending || !visibleEligibleIds.length} onCheckedChange={(checked) => toggleVisibleMembers(checked === true)} />
                <span className="text-sm text-gray-200">Select all {visibleEligibleIds.length} eligible shown</span>
                <span className="text-xs text-gray-400">{recipientRows.length} shown</span>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-sm text-gray-300" aria-live="polite">{selectedMemberIds.length} selected</span>
                <Button variant="textLink" disabled={loading || sending || !selectedMemberIds.length} onClick={() => updateSelectedMemberIds([])}>Clear</Button>
              </div>
            </div>
            <div className="divide-y divide-gray-800" role="list" aria-label="Volunteer recipients">
              {recipientRows.length ? recipientRows.map(({ member, eligible, reason }) => (
                <div key={member.memberId} className="flex min-h-12 items-center gap-3 px-3 py-2.5" role="listitem">
                  <Checkbox label={memberName(member)} checked={selectedMemberIds.includes(member.memberId)} disabled={loading || sending || !eligible} onCheckedChange={(checked) => toggleMember(member.memberId, checked)} className="flex-1" />
                  {!eligible ? <span className="shrink-0 text-xs text-amber-200">{reason || "Choose a form first"}</span> : null}
                </div>
              )) : <p className="p-4 text-sm text-gray-400">No volunteers match these filters.</p>}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-400">{!formId ? "Choose an intake form to review messages." : selectedEligibleIds.length ? `${selectedEligibleIds.length} eligible volunteer${selectedEligibleIds.length === 1 ? "" : "s"} selected.` : "Select at least one eligible volunteer to continue."}</p>
          <Button disabled={loading || sending || !formId || selectedEligibleIds.length === 0} isLoading={loading} onClick={() => void makePreview()}>Review {selectedEligibleIds.length} message{selectedEligibleIds.length === 1 ? "" : "s"}</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      </section>

      {reviewedBatch ? <AvailabilityBatchReview batch={reviewedBatch} formName={forms.find(({ formId: id }) => id === formId)?.name || "Intake form"} busy={sending || loading} onConfirm={() => setConfirmOpen(true)} /> : null}

      <section className="space-y-3" aria-labelledby="preview-list-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="preview-list-heading" className="font-semibold text-white">{formId ? "Recent messages" : "Message history"}</h2>
          {formId ? <Button variant="textLink" disabled={loading || sending} onClick={() => { void refreshIntents().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not refresh message history.")); }}>Refresh</Button> : null}
        </div>
        {!formId ? <p className="text-sm text-gray-400">Choose an intake form to load its bounded message history.</p> : null}
        {loading && !intents.length ? <p className="text-sm text-gray-400">Loading form message history…</p> : null}
        {formId && !intents.length && !loading ? <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">No volunteer messages for this form yet.</p> : null}
        {intents.map((intent) => {
          const member = members.find((item) => item.memberId === intent.memberId);
          const actionable = ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false;
          return <article key={intent.intentId} className="space-y-2 rounded border border-gray-700 bg-gray-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-medium text-white">{intentLabel(intent)} · {member ? memberName(member) : "Roster member"}</h3><p className="text-xs text-gray-400">{new Date(intent.createdAt).toLocaleString()} · {statusLabel[intent.status]}{intent.respondedAt ? " · responded" : " · waiting"}</p></div>
              {actionable ? <Button disabled={sending || loading || Boolean(individualSmsPreview)} isLoading={sending} onClick={() => void sendIndividual(intent)}>Send one SMS</Button> : null}
            </div>
            {intent.messagePreview ? <p className="rounded bg-gray-900 px-3 py-2 text-sm text-gray-200">{intent.messagePreview}</p> : null}
            {intent.previewError ? <p className="text-sm text-amber-200">Not ready to send: {intent.previewError}</p> : null}
            {intent.attemptId ? <p className="text-xs text-gray-400">Delivery: {intent.attemptStatus || "pending"}{intent.attemptOutcome ? ` · ${intent.attemptOutcome}` : ""}</p> : null}
          </article>;
        })}
        {nextCursor ? <Button variant="secondary" disabled={loading || sending} isLoading={loading} onClick={() => void loadOlderIntents()}>Load older history</Button> : null}
      </section>

      {individualSmsPreview ? <SmsConfirmationModal
        isOpen
        recipientName={individualSmsPreview.recipientName}
        phoneNumberSnapshot={individualSmsPreview.phoneNumberSnapshot}
        message={individualSmsPreview.message}
        segmentCount={individualSmsPreview.segmentCount}
        busy={sending}
        onCancel={cancelIndividualPreview}
        onSend={() => void sendIndividualPreview()}
      /> : null}

      {confirmOpen && reviewedBatch ? (
        <ConfirmDialog
          open title="Send this form?"
          description="Review the selected volunteers before sending this form."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void confirmBatch()}
          confirmLabel={`Send ${reviewedBatch.summary.eligible} message${reviewedBatch.summary.eligible === 1 ? "" : "s"}`}
          busy={sending}
        >
          <p className="mb-4 text-sm text-gray-200">Send exactly {reviewedBatch.summary.eligible} selected message{reviewedBatch.summary.eligible === 1 ? "" : "s"} for this intake form? This batch totals {reviewedBatch.summary.totalSegments} SMS segments. Volunteers excluded from the reviewed list will not be contacted.</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-gray-300">
              {reviewedBatch.recipients.filter((recipient) => recipient.eligible).map((recipient) => <li key={recipient.memberId}>{recipient.memberName} · {recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber}</li>)}
            </ul>
        </ConfirmDialog>
      ) : null}
    </main>
  );
};

export default TeamsMessagesPage;
