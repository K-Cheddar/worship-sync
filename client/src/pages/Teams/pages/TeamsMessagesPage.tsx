import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Select from "../../../components/Select/Select";
import {
  dispatchAvailabilityNotificationBatch,
  getAvailabilityNotificationBatch,
  getNotificationIntentPreview,
  getNotificationIntents,
  prepareAvailabilityNotificationBatch,
  sendNotificationIntent,
} from "../../../api/auth";
import type { NotificationBatch, NotificationIntent, NotificationIntentType } from "../../../api/authTypes";
import { useTeamsPage } from "../TeamsPageContext";

const memberName = (member: { firstName?: string; lastName?: string }) =>
  [member.firstName, member.lastName].filter(Boolean).join(" ") || "Volunteer";

const intentLabel = (intent: NotificationIntent) => {
  if (intent.intentType === "availability_request") return "Availability request";
  if (intent.intentType === "availability_reminder") return `Availability reminder${intent.reminderRound ? ` · round ${intent.reminderRound}` : ""}`;
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

const requestKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const TeamsMessagesPage = () => {
  const { churchId, pageData, canEditTeams } = useTeamsPage();
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const [intentType, setIntentType] = useState<Extract<NotificationIntentType, "availability_request" | "availability_reminder">>("availability_request");
  const [formId, setFormId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [activeBatch, setActiveBatch] = useState<NotificationBatch | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [intents, setIntents] = useState<NotificationIntent[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const forms = useMemo(() => pageData.intakeForms.filter((form) => !form.archivedAt), [pageData.intakeForms]);
  const members = useMemo(
    () => [...pageData.members].filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [pageData.members],
  );

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
    const savedBatchId = window.localStorage.getItem(`worshipsync:last-notification-batch:${churchId}:${formId}`);
    if (savedBatchId) {
      getAvailabilityNotificationBatch(churchId, savedBatchId)
        .then((response) => { if (active) setActiveBatch(response.batch); })
        .catch(() => { if (active) window.localStorage.removeItem(`worshipsync:last-notification-batch:${churchId}:${formId}`); });
    }
    return () => { active = false; };
  }, [churchId, canEditTeams, formId]);

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

  const toggleMember = (memberId: string, checked: boolean) => {
    setSelectedMemberIds((current) => checked ? [...new Set([...current, memberId])] : current.filter((id) => id !== memberId));
  };

  const makePreview = async () => {
    if (!formId || selectedMemberIds.length === 0 || loading || sending) return;
    const ownerChurch = churchId;
    setError("");
    setNotice("");
    setLoading(true);
    const requestKeyStorageKey = `worshipsync:pending-notification-request:${ownerChurch}:${formId}:${intentType}`;
    const batchRequestKey = window.localStorage.getItem(requestKeyStorageKey) || requestKey();
    window.localStorage.setItem(requestKeyStorageKey, batchRequestKey);
    try {
      const response = await prepareAvailabilityNotificationBatch(ownerChurch, {
        intentType,
        formId,
        memberIds: selectedMemberIds,
        requestKey: batchRequestKey,
      });
      if (churchIdRef.current !== ownerChurch) return;
      setActiveBatch(response.batch);
      window.localStorage.setItem(`worshipsync:last-notification-batch:${ownerChurch}:${formId}`, response.batch.batchId);
      window.localStorage.removeItem(requestKeyStorageKey);
      await refreshIntents();
      setNotice("Batch prepared. Review recipients and message details; nothing has been sent.");
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) setError(caught instanceof Error ? caught.message : "Could not prepare the message batch.");
    } finally {
      if (churchIdRef.current === ownerChurch) setLoading(false);
    }
  };

  const confirmBatch = async () => {
    if (!activeBatch || sending || loading) return;
    const ownerChurch = churchId;
    setConfirmOpen(false);
    setSending(true);
    setError("");
    setNotice("Sending the selected batch…");
    try {
      const response = await dispatchAvailabilityNotificationBatch(ownerChurch, activeBatch.batchId, activeBatch.approvalVersion);
      if (churchIdRef.current !== ownerChurch) return;
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
    if (sending || loading) return;
    const ownerChurch = churchId;
    setError("");
    setSending(true);
    try {
      const prepared = await getNotificationIntentPreview(ownerChurch, intent.intentId);
      if (!prepared.preview.eligible) {
        setError("This volunteer is not currently eligible for SMS. Check the form, phone number, and consent.");
        await refreshIntents();
        return;
      }
      const member = members.find((item) => item.memberId === intent.memberId);
      if (!window.confirm(`Send this message to ${member ? memberName(member) : "this volunteer"} at ${prepared.preview.phoneNumberSnapshot}?\n\n${prepared.preview.message}\n\n${prepared.preview.segmentCount} SMS segment${prepared.preview.segmentCount === 1 ? "" : "s"}.`)) return;
      const response = await sendNotificationIntent(ownerChurch, intent.intentId, prepared.preview.approvalVersion);
      if (churchIdRef.current !== ownerChurch) return;
      setNotice(response.success ? "SMS accepted by the provider." : response.errorMessage || "The SMS was not confirmed as sent.");
      await refreshIntents();
    } catch (caught) {
      if (churchIdRef.current === ownerChurch) setError(caught instanceof Error ? caught.message : "Could not send this message.");
    } finally {
      if (churchIdRef.current === ownerChurch) setSending(false);
    }
  };

  if (!canEditTeams) {
    return <div className="p-6 text-sm text-gray-300">Teams edit permission is required to prepare or send volunteer messages.</div>;
  }

  const batchCanSend = Boolean(activeBatch && ["prepared", "partial"].includes(activeBatch.status) && activeBatch.recipients.some((recipient) => recipient.eligible));

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="teams-messages-heading">
      <header className="space-y-1">
        <h1 id="teams-messages-heading" className="text-xl font-semibold text-white">Volunteer messages</h1>
        <p className="text-sm text-gray-300">Review the selected volunteers and message before every send. Scheduling events only create drafts.</p>
      </header>

      <section className="space-y-4 rounded-lg border border-gray-700 bg-gray-900/60 p-4" aria-labelledby="availability-preview-heading">
        <div>
          <h2 id="availability-preview-heading" className="font-semibold text-white">Availability SMS</h2>
          <p className="mt-1 text-sm text-gray-400">Requests use the selected intake form and each volunteer’s existing secure response link.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Message" value={intentType} onChange={(value) => setIntentType(value as typeof intentType)} options={[
            { value: "availability_request", label: "Request availability" },
            { value: "availability_reminder", label: "Remind nonresponders" },
          ]} />
          <Select label="Intake form" value={formId} onChange={(value) => { setFormId(value); setSelectedMemberIds([]); setActiveBatch(null); }} options={forms.map((form) => ({
            value: form.formId,
            label: `${form.name} · ${form.startDate}–${form.endDate}${form.active ? "" : " · closed"}`,
          }))} />
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-gray-700 p-3">
          {members.length ? members.map((member) => <Checkbox key={member.memberId} label={memberName(member)} checked={selectedMemberIds.includes(member.memberId)} onCheckedChange={(checked) => toggleMember(member.memberId, checked)} />) : <p className="text-sm text-gray-400">No active volunteers are available.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading || sending || !formId || selectedMemberIds.length === 0} isLoading={loading} onClick={() => void makePreview()}>Prepare selected batch</Button>
          <Button variant="textLink" disabled={loading || sending || !formId} onClick={() => { void refreshIntents().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not refresh message history.")); }}>Refresh history</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      </section>

      {activeBatch ? (
        <section className="space-y-3 rounded-lg border border-sky-700 bg-gray-900/60 p-4" aria-labelledby="batch-review-heading">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="batch-review-heading" className="font-semibold text-white">Selected batch review</h2>
              <p className="text-sm text-gray-300">{activeBatch.intentType === "availability_reminder" ? `Reminder round ${activeBatch.reminderRound}` : "Initial availability request"} · {activeBatch.summary.selected} selected · {activeBatch.summary.eligible} eligible · {activeBatch.summary.awaitingDispatch} awaiting · {activeBatch.summary.alreadySent} already sent · {activeBatch.summary.excluded} excluded</p>
              <p className="text-sm text-gray-300">{activeBatch.summary.totalSegments} expected SMS segments · {activeBatch.status}</p>
            </div>
            {batchCanSend ? <Button disabled={sending || loading} onClick={() => setConfirmOpen(true)}>Review and send this batch</Button> : null}
          </div>
          <ul className="divide-y divide-gray-800">
            {activeBatch.recipients.map((recipient) => (
              <li key={recipient.memberId} className="space-y-1 py-3">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium text-white">{recipient.memberName}</span>
                  <span className="text-gray-300">{recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber || "No mobile"} · {recipient.eligibilityStatus || "not eligible"} · {recipient.segmentCount} segment{recipient.segmentCount === 1 ? "" : "s"}</span>
                </div>
                {recipient.message ? <p className="break-words rounded bg-gray-950 px-3 py-2 text-sm text-gray-200">{recipient.message}</p> : null}
                {!recipient.eligible && recipient.exclusionReason ? <p className="text-sm text-amber-200">Excluded: {recipient.exclusionReason}</p> : null}
                {recipient.attemptId ? <p className="text-xs text-gray-400">Attempt {recipient.attemptId} · {recipient.attemptStatus || recipient.status} {recipient.attemptOutcome ? `· ${recipient.attemptOutcome}` : ""}</p> : null}
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-gray-400">Provider accepted</dt><dd className="text-white">{activeBatch.summary.sent}</dd></div>
            <div><dt className="text-gray-400">Delivered</dt><dd className="text-white">{activeBatch.summary.delivered}</dd></div>
            <div><dt className="text-gray-400">Failed / uncertain</dt><dd className="text-white">{activeBatch.summary.failed} / {activeBatch.summary.uncertain}</dd></div>
            <div><dt className="text-gray-400">Responses / waiting</dt><dd className="text-white">{activeBatch.summary.responded} / {activeBatch.summary.waiting}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="preview-list-heading">
        <h2 id="preview-list-heading" className="font-semibold text-white">Message history for this form</h2>
        {!formId ? <p className="text-sm text-gray-400">Choose an intake form to load its bounded message history.</p> : null}
        {loading && !intents.length ? <p className="text-sm text-gray-400">Loading form message history…</p> : null}
        {formId && !intents.length && !loading ? <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">No volunteer messages for this form yet.</p> : null}
        {intents.map((intent) => {
          const member = members.find((item) => item.memberId === intent.memberId);
          const actionable = ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false;
          return <article key={intent.intentId} className="space-y-2 rounded border border-gray-700 bg-gray-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-medium text-white">{intentLabel(intent)} · {member ? memberName(member) : "Roster member"}</h3><p className="text-xs text-gray-400">{new Date(intent.createdAt).toLocaleString()} · {statusLabel[intent.status]}{intent.respondedAt ? " · responded" : " · waiting"}</p></div>
              {actionable ? <Button disabled={sending || loading} isLoading={sending} onClick={() => void sendIndividual(intent)}>Send one SMS</Button> : null}
            </div>
            {intent.messagePreview ? <p className="rounded bg-gray-900 px-3 py-2 text-sm text-gray-200">{intent.messagePreview}</p> : null}
            {intent.previewError ? <p className="text-sm text-amber-200">Not ready to send: {intent.previewError}</p> : null}
            {intent.attemptId ? <p className="text-xs text-gray-400">Delivery: {intent.attemptStatus || "pending"}{intent.attemptOutcome ? ` · ${intent.attemptOutcome}` : ""}</p> : null}
          </article>;
        })}
        {nextCursor ? <Button variant="secondary" disabled={loading || sending} isLoading={loading} onClick={() => void loadOlderIntents()}>Load older history</Button> : null}
      </section>

      {confirmOpen && activeBatch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="confirm-batch-heading" className="w-full max-w-lg space-y-4 rounded-lg border border-gray-600 bg-gray-900 p-5 shadow-xl">
            <h2 id="confirm-batch-heading" className="text-lg font-semibold text-white">Confirm this batch</h2>
            <p className="text-sm text-gray-200">Send exactly {activeBatch.summary.eligible} selected messages for this intake form? This batch totals {activeBatch.summary.totalSegments} SMS segments. Volunteers excluded from the reviewed list will not be contacted.</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm text-gray-300">
              {activeBatch.recipients.filter((recipient) => recipient.eligible).map((recipient) => <li key={recipient.memberId}>{recipient.memberName} · {recipient.phoneNumberSnapshot || recipient.maskedPhoneNumber}</li>)}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={sending} onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button disabled={sending} isLoading={sending} onClick={() => void confirmBatch()}>Confirm and send selected batch</Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
};

export default TeamsMessagesPage;
