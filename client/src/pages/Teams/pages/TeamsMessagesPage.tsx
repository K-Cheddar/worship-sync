import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "../../../components/Modal/Modal";
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
import type { NotificationBatch, NotificationIntent, NotificationIntentType, SmsDeliveryAttempt } from "../../../api/authTypes";
import { useTeamsPage } from "../TeamsPageContext";
import { MemberNameWithIndicator } from "../components/CurrentUserMemberIndicator";
import AvailabilityBatchReview from "../components/AvailabilityBatchReview";
import SmsConfirmationModal from "../components/SmsConfirmationModal";
import { getAvailabilityRecipientRows } from "../availabilityRecipientSelection";
import { dispatchReviewedAvailabilityBatch, prepareAvailabilityBatchForMembers } from "../availabilityBatchActions";
import { loadAvailabilityNotificationHistory } from "../availabilityNotificationHistory";

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
  preview: "Ready to review",
  ready: "Ready",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed · review before retry",
  unknown: "Could not confirm whether sent · check message history",
  suppressed: "Not sent",
};

const TeamsMessagesPage = () => {
  const { churchId, pageData, canEditTeams } = useTeamsPage();
  const churchIdRef = useRef(churchId);
  churchIdRef.current = churchId;
  const [intentType, setIntentType] = useState<Extract<NotificationIntentType, "availability_request" | "availability_reminder">>("availability_request");
  const [formId, setFormId] = useState("");
  const formIdRef = useRef(formId);
  formIdRef.current = formId;
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [activeBatch, setActiveBatch] = useState<NotificationBatch | null>(null);
  const activeBatchRef = useRef<NotificationBatch | null>(activeBatch);
  activeBatchRef.current = activeBatch;
  const [batchReviewIdentity, setBatchReviewIdentity] = useState<{
    contextIdentity: string;
    selectionIdentity: string;
    recipientEligibilityIdentity: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [intents, setIntents] = useState<NotificationIntent[]>([]);
  const [attempts, setAttempts] = useState<SmsDeliveryAttempt[]>([]);
  const [historyLoadedForFormId, setHistoryLoadedForFormId] = useState("");
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [preparingBatch, setPreparingBatch] = useState(false);
  const [sending, setSending] = useState(false);
  const [individualSmsPreview, setIndividualSmsPreview] = useState<{
    churchId: string;
    formId: string;
    intentType: typeof intentType;
    memberId: string;
    intentId: string;
    approvalVersion: string;
    recipientName: string;
    phoneNumberSnapshot: string;
    message: string;
    segmentCount: number;
  } | null>(null);
  const individualSmsSendLockRef = useRef(false);
  const batchSendLockRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const didRestoreInitialBatchRef = useRef(false);
  const batchPreparationSequenceRef = useRef(0);

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
      notificationIntents: intents,
      smsDeliveryAttempts: attempts,
      form: selectedForm,
      intentType,
    });
  }, [attempts, forms, formId, intentType, intents, members, pageData.intakeRecipients, pageData.positions, pageData.smsEligibilityByMemberId, pageData.teams]);
  const query = memberSearch.trim().toLocaleLowerCase();
  const recipientRows = allRecipientRows.filter(({ member, memberTeamIds }) =>
      (!teamFilter || memberTeamIds.has(teamFilter)) &&
      (!query || memberName(member).toLocaleLowerCase().includes(query)),
    );
  const visibleEligibleIds = recipientRows.filter((row) => row.eligible).map(({ member }) => member.memberId);
  const historyReady = Boolean(formId) && historyLoadedForFormId === formId;
  const selectableVisibleIds = historyReady ? visibleEligibleIds : [];
  const selectedVisibleCount = selectableVisibleIds.filter((id) => selectedMemberIds.includes(id)).length;
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const selectedEligibleIds = historyReady ? allRecipientRows.filter(({ member, eligible }) => eligible && selectedMemberIds.includes(member.memberId)).map(({ member }) => member.memberId) : [];
  const batchContextIdentity = `${churchId}:${formId}:${intentType}`;
  const selectionIdentity = JSON.stringify(selectedEligibleIds);
  const recipientEligibilityIdentity = JSON.stringify(allRecipientRows.map(({ member, memberTeamIds, recipient, eligibility, eligible, reason, previousDeliveryStatus }) => [
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
  const currentBatchContextRef = useRef(batchContextIdentity);
  currentBatchContextRef.current = batchContextIdentity;
  const currentSelectionIdentityRef = useRef(selectionIdentity);
  currentSelectionIdentityRef.current = selectionIdentity;
  const currentRecipientEligibilityIdentityRef = useRef(recipientEligibilityIdentity);
  currentRecipientEligibilityIdentityRef.current = recipientEligibilityIdentity;
  const batchReviewIsCurrent = Boolean(activeBatch && batchReviewIdentity &&
    batchReviewIdentity.contextIdentity === batchContextIdentity &&
    batchReviewIdentity.selectionIdentity === selectionIdentity &&
    batchReviewIdentity.recipientEligibilityIdentity === recipientEligibilityIdentity);
  const reviewedBatch = activeBatch?.churchId === churchId && activeBatch.formId === formId && activeBatch.intentType === intentType ? activeBatch : null;
  const showBatchStatus = Boolean(reviewedBatch && (
    reviewedBatch.status !== "prepared" || reviewedBatch.summary.sent > 0 || reviewedBatch.summary.delivered > 0 ||
    reviewedBatch.summary.failed > 0 || reviewedBatch.summary.uncertain > 0 || (reviewedBatch.summary.sending || 0) > 0
  ));

  useEffect(() => {
    if (!batchReviewIdentity || batchReviewIsCurrent) return;
    setBatchReviewIdentity(null);
    setConfirmOpen(false);
    setNotice("Review details changed. Prepare the messages again before sending.");
  }, [batchReviewIdentity, batchReviewIsCurrent]);

  useEffect(() => {
    batchPreparationSequenceRef.current += 1;
    setLoading(false);
    setPreparingBatch(false);
    let active = true;
    setIntents([]);
    setAttempts([]);
    setHistoryLoadedForFormId("");
    setHistoryLoadError("");
    setNextCursor("");
    setActiveBatch(null);
    setBatchReviewIdentity(null);
    setConfirmOpen(false);
    setIndividualSmsPreview(null);
    if (!churchId || !canEditTeams || !formId) return () => { active = false; };
    setLoading(true);
    loadAvailabilityNotificationHistory(churchId, formId)
      .then((history) => { if (active) { setIntents(history.intents); setAttempts(history.attempts); setNextCursor(""); setHistoryLoadedForFormId(formId); setHistoryLoadError(""); } })
      .catch((caught) => { if (active) { const message = caught instanceof Error ? caught.message : "Could not load message history."; setHistoryLoadError(message); } })
      .finally(() => { if (active) setLoading(false); });
    if (!churchId || !canEditTeams || !formId) return () => { active = false; };
    const savedBatchId = !didRestoreInitialBatchRef.current
      ? window.localStorage.getItem(`worshipsync:last-notification-batch:${churchId}:${formId}`)
      : null;
    if (savedBatchId) {
      getAvailabilityNotificationBatch(churchId, savedBatchId)
        .then((response) => {
          if (active && response.batch.formId === formId && response.batch.intentType === intentType) {
            setSelectedMemberIds(response.batch.selectedMemberIds);
            setActiveBatch(response.batch);
            setBatchReviewIdentity(null);
          }
        })
        .catch(() => { if (active) window.localStorage.removeItem(`worshipsync:last-notification-batch:${churchId}:${formId}`); });
    }
    didRestoreInitialBatchRef.current = true;
    return () => { active = false; };
  }, [churchId, canEditTeams, formId, intentType]);

  const refreshIntents = async () => {
    const requestedChurch = churchId;
    const requestedFormId = formId;
    if (!requestedFormId) return;
    setHistoryLoadedForFormId("");
    setHistoryLoadError("");
    try {
      const history = await loadAvailabilityNotificationHistory(requestedChurch, requestedFormId);
      if (churchIdRef.current === requestedChurch && formIdRef.current === requestedFormId) {
        setIntents(history.intents);
        setAttempts(history.attempts);
        setNextCursor("");
        setHistoryLoadedForFormId(requestedFormId);
      }
    } catch (caught) {
      if (churchIdRef.current === requestedChurch && formIdRef.current === requestedFormId) {
        setHistoryLoadError(caught instanceof Error ? caught.message : "Could not refresh message history.");
      }
      throw caught;
    }
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
    setActiveBatch((current) => current?.status === "prepared" ? null : current);
    setBatchReviewIdentity(null);
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
      ? [...selectedMemberIds, ...selectableVisibleIds]
      : selectedMemberIds.filter((id) => !selectableVisibleIds.includes(id)));
  };

  const makePreview = async () => {
    if (!historyReady || !formId || selectedEligibleIds.length === 0 || loading || sending) return;
    const ownerChurch = churchId;
    const requestedContextIdentity = batchContextIdentity;
    const requestedSelectionIdentity = selectionIdentity;
    const requestedRecipientEligibilityIdentity = recipientEligibilityIdentity;
    const requestedPreparationSequence = ++batchPreparationSequenceRef.current;
    setError("");
    setNotice("");
    setLoading(true);
    setPreparingBatch(true);
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
      if (
        churchIdRef.current !== ownerChurch ||
        currentBatchContextRef.current !== requestedContextIdentity ||
        currentSelectionIdentityRef.current !== requestedSelectionIdentity ||
        currentRecipientEligibilityIdentityRef.current !== requestedRecipientEligibilityIdentity
      ) return;
      setActiveBatch(batch);
      setBatchReviewIdentity({
        contextIdentity: requestedContextIdentity,
        selectionIdentity: requestedSelectionIdentity,
        recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
      });
      setConfirmOpen(true);
    } catch (caught) {
      if (churchIdRef.current === ownerChurch && currentBatchContextRef.current === requestedContextIdentity) setError(caught instanceof Error ? caught.message : "Could not prepare the message batch.");
    } finally {
      if (batchPreparationSequenceRef.current === requestedPreparationSequence) {
        setLoading(false);
        setPreparingBatch(false);
      }
    }
  };

  const confirmBatch = async () => {
    if (!batchReviewIsCurrent || !activeBatch || activeBatch.churchId !== churchId || activeBatch.formId !== formId || activeBatch.intentType !== intentType || sending || loading || batchSendLockRef.current) return;
    batchSendLockRef.current = true;
    const ownerChurch = churchId;
    const ownerFormId = formId;
    setConfirmOpen(false);
    setBatchReviewIdentity(null);
    setSending(true);
    setError("");
    setNotice("Sending messages...");
    try {
      const response = await dispatchReviewedAvailabilityBatch(ownerChurch, activeBatch);
      if (churchIdRef.current !== ownerChurch || formIdRef.current !== ownerFormId || currentBatchContextRef.current !== `${ownerChurch}:${ownerFormId}:${activeBatch.intentType}`) return;
      setActiveBatch(response.batch);
      const resolvedMemberIds = new Set(response.batch.recipients
        .filter((recipient) => ["sent", "failed", "unknown"].includes(recipient.status) || recipient.attemptOutcome === "unknown")
        .map((recipient) => recipient.memberId));
      setSelectedMemberIds((current) => current.filter((memberId) => !resolvedMemberIds.has(memberId)));
      await refreshIntents();
      setNotice("");
    } catch (caught) {
      if (churchIdRef.current === ownerChurch && formIdRef.current === ownerFormId) {
        setError(caught instanceof Error ? caught.message : "We couldn't confirm whether these messages were sent. Check message history before trying again.");
        try {
          const latest = await getAvailabilityNotificationBatch(ownerChurch, activeBatch.batchId);
          if (churchIdRef.current === ownerChurch && formIdRef.current === ownerFormId) setActiveBatch(latest.batch);
        } catch { /* Keep the stored batch id so the operator can refresh it. */ }
      }
    } finally {
      batchSendLockRef.current = false;
      setSending(false);
    }
  };

  const sendIndividual = async (intent: NotificationIntent) => {
    if (sending || loading || individualSmsPreview) return;
    const ownerChurch = churchId;
    const ownerFormId = formId;
    const ownerIntentType = intentType;
    setError("");
    setSending(true);
    try {
      const prepared = await getNotificationIntentPreview(ownerChurch, intent.intentId);
      if (churchIdRef.current !== ownerChurch || currentBatchContextRef.current !== `${ownerChurch}:${ownerFormId}:${ownerIntentType}`) return;
      if (!prepared.preview.eligible) {
        setError("This volunteer can't receive a text message right now. Check the form, phone number, and consent.");
        await refreshIntents();
        return;
      }
      const member = members.find((item) => item.memberId === intent.memberId);
      setIndividualSmsPreview({
        churchId: ownerChurch,
        formId: ownerFormId,
        intentType: ownerIntentType,
        memberId: intent.memberId,
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
      setSending(false);
    }
  };

  const refreshRelatedBatch = async (
    relatedBatch: NotificationBatch | null,
    ownerChurch: string,
    ownerFormId: string,
    ownerIntentType: typeof intentType,
    intentId: string,
  ) => {
    if (!relatedBatch || !relatedBatch.intentIds.includes(intentId)) return true;
    setActiveBatch((current) => current?.batchId === relatedBatch.batchId ? null : current);
    try {
      const latest = await getAvailabilityNotificationBatch(ownerChurch, relatedBatch.batchId);
      const currentBatch = activeBatchRef.current;
      if (
        currentBatchContextRef.current === `${ownerChurch}:${ownerFormId}:${ownerIntentType}` &&
        (!currentBatch || currentBatch.batchId === relatedBatch.batchId)
      ) setActiveBatch(latest.batch);
      return true;
    } catch {
      return false;
    }
  };

  const sendIndividualPreview = async () => {
    const preview = individualSmsPreview;
    if (!preview || individualSmsSendLockRef.current) return;
    if (churchIdRef.current !== preview.churchId || currentBatchContextRef.current !== `${preview.churchId}:${preview.formId}:${preview.intentType}`) {
      setIndividualSmsPreview(null);
      return;
    }
    individualSmsSendLockRef.current = true;
    const ownerChurch = preview.churchId;
    const ownerFormId = preview.formId;
    const ownerContextIdentity = `${ownerChurch}:${ownerFormId}:${preview.intentType}`;
    const relatedBatch = activeBatch?.churchId === ownerChurch && activeBatch.formId === ownerFormId && activeBatch.intentIds.includes(preview.intentId)
      ? activeBatch
      : null;
    setIndividualSmsPreview(null);
    setSending(true);
    setError("");
    setNotice("");
    let sendFeedback = "";
    let sendOutcome: "accepted" | "rejected" | "unknown" = "unknown";
    try {
      try {
        const response = await sendNotificationIntent(ownerChurch, preview.intentId, preview.approvalVersion);
        if (currentBatchContextRef.current !== ownerContextIdentity) return;
        setSelectedMemberIds((current) => current.filter((memberId) => memberId !== preview.memberId));
        if (response.success) {
          setIntents((current) => current.map((intent) => intent.intentId === preview.intentId
            ? response.intent || { ...intent, status: "sent" }
            : intent));
          sendOutcome = "accepted";
          sendFeedback = "Your text message was sent. Delivery updates may take a moment.";
        } else if (response.outcome === "failed") {
          sendOutcome = "rejected";
          sendFeedback = response.errorMessage || "This text message wasn't sent. Review message history before preparing a retry.";
        } else {
          setIntents((current) => current.map((intent) => intent.intentId === preview.intentId
            ? { ...intent, status: "unknown" }
            : intent));
          sendFeedback = "We couldn't confirm whether this text was sent. Check message history before trying again.";
        }
      } catch (caught) {
        if (currentBatchContextRef.current !== ownerContextIdentity) return;
        setSelectedMemberIds((current) => current.filter((memberId) => memberId !== preview.memberId));
        const errorRecord = caught instanceof Error
          ? caught as Error & { status?: number; details?: unknown }
          : null;
        const errorDetails = errorRecord?.details && typeof errorRecord.details === "object"
          ? errorRecord.details as { outcome?: unknown; errorMessage?: unknown }
          : null;
        const definiteRejection = errorDetails?.outcome === "failed" ||
          (errorDetails?.outcome !== "unknown" && typeof errorRecord?.status === "number" &&
            errorRecord.status >= 400 && errorRecord.status < 500 && errorRecord.status !== 409);
        const uncertainOutcome = !definiteRejection;
        sendOutcome = uncertainOutcome ? "unknown" : "rejected";
        if (errorDetails?.outcome === "failed") {
          setIntents((current) => current.map((intent) => intent.intentId === preview.intentId
            ? { ...intent, status: "failed", attemptOutcome: "failed" }
            : intent));
        } else if (uncertainOutcome) {
          setIntents((current) => current.map((intent) => intent.intentId === preview.intentId
            ? { ...intent, status: "unknown" }
            : intent));
        }
        if (uncertainOutcome) {
          sendFeedback = "We couldn't confirm whether this text was sent. Check message history before trying again.";
        } else if (typeof errorDetails?.errorMessage === "string") {
          sendFeedback = errorDetails.errorMessage;
        } else {
          sendFeedback = errorRecord?.message || "This text message wasn't sent. Review message history before preparing a retry.";
        }
      }

      if (currentBatchContextRef.current !== ownerContextIdentity) return;
      if (sendOutcome === "accepted") setNotice(sendFeedback);
      else setError(sendFeedback);

      const [historyRefresh, batchRefresh] = await Promise.allSettled([
        refreshIntents(),
        refreshRelatedBatch(relatedBatch, ownerChurch, ownerFormId, preview.intentType, preview.intentId),
      ]);
      if (currentBatchContextRef.current !== ownerContextIdentity) return;

      const historyRefreshFailed = historyRefresh.status === "rejected";
      const batchRefreshFailed = batchRefresh.status === "rejected" ||
        (batchRefresh.status === "fulfilled" && !batchRefresh.value);
      if (historyRefreshFailed || batchRefreshFailed) {
        let refreshFeedback: string;
        if (historyRefreshFailed && batchRefreshFailed) {
          refreshFeedback = "Message history and batch status couldn't be refreshed. Refresh the page to check both.";
        } else if (historyRefreshFailed) {
          refreshFeedback = "Message history couldn't be refreshed. Try refreshing it.";
        } else {
          refreshFeedback = "Batch status couldn't be refreshed. Refresh the page to check it.";
        }

        if (sendOutcome === "accepted" && historyRefreshFailed && !batchRefreshFailed) {
          setNotice("Your text message was sent, but we couldn't refresh message history. Try refreshing it.");
        } else if (sendOutcome === "accepted" && historyRefreshFailed && batchRefreshFailed) {
          setNotice("Your text message was sent. We couldn't refresh message history or batch status. Refresh the page to check both.");
        } else if (sendOutcome === "unknown" && historyRefreshFailed) {
          setError(batchRefreshFailed
            ? "We couldn't confirm whether this text was sent, and message history and batch status couldn't be refreshed. Refresh the page before deciding whether to try again."
            : "We couldn't confirm whether this text was sent, and message history couldn't be refreshed. Try refreshing it before deciding whether to try again.");
        } else if (sendOutcome === "accepted") {
          setNotice(`${sendFeedback} ${refreshFeedback}`);
        } else {
          setError(`${sendFeedback} ${refreshFeedback}`);
        }
      }
    } finally {
      individualSmsSendLockRef.current = false;
      setSending(false);
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
    <main data-mobile-header-scroll-owner="page" className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6" aria-labelledby="teams-messages-heading">
      <header className="space-y-1">
        <h1 id="teams-messages-heading" className="text-xl font-semibold text-white">Volunteer messages</h1>
        <p className="text-sm text-gray-300">Review the selected volunteers and messages before sending. Schedule changes only create drafts.</p>
      </header>

      <section className="space-y-5 rounded-xl border border-gray-700 bg-gray-900/40 p-4 shadow-sm sm:p-6" aria-labelledby="availability-preview-heading">
        <div>
          <h2 id="availability-preview-heading" className="font-semibold text-white">Intake form text messages</h2>
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
                <Checkbox aria-label={`Select all ${selectableVisibleIds.length} eligible shown`} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={loading || sending || !historyReady || !selectableVisibleIds.length} onCheckedChange={(checked) => toggleVisibleMembers(checked === true)} />
                <span className="text-sm text-gray-200">Select all {selectableVisibleIds.length} eligible shown</span>
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
                  <Checkbox label={<MemberNameWithIndicator name={memberName(member)} memberId={member.memberId} className="flex-1" />} checked={selectedMemberIds.includes(member.memberId)} disabled={loading || sending || !historyReady || !eligible} onCheckedChange={(checked) => toggleMember(member.memberId, checked)} className="flex-1" />
                  {!eligible ? <span className="shrink-0 text-xs text-amber-200">{reason || "Choose a form first"}</span> : null}
                </div>
              )) : <p className="p-4 text-sm text-gray-400">No volunteers match these filters.</p>}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-400">{!formId ? "Choose an intake form to review messages." : selectedEligibleIds.length ? `${selectedEligibleIds.length} eligible volunteer${selectedEligibleIds.length === 1 ? "" : "s"} selected.` : "Select at least one eligible volunteer to continue."}</p>
          <Button disabled={loading || sending || !historyReady || !formId || selectedEligibleIds.length === 0} isLoading={preparingBatch} onClick={() => void makePreview()}>{preparingBatch ? "Preparing messages..." : `Review and send ${selectedEligibleIds.length} message${selectedEligibleIds.length === 1 ? "" : "s"}`}</Button>
        </div>
        {formId && !historyReady ? historyLoadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-amber-100"><span>Could not verify consent and message history: {historyLoadError}</span><Button variant="secondary" disabled={loading || sending} onClick={() => void refreshIntents().catch(() => undefined)}>Retry status check</Button></div> : <p role="status" className="text-sm text-gray-400">Loading consent and message history before recipient selection.</p> : null}
        {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      </section>

      {showBatchStatus && reviewedBatch ? <AvailabilityBatchReview batch={reviewedBatch} formName={forms.find(({ formId: id }) => id === formId)?.name || "Intake form"} busy={sending || loading} mode="status" /> : null}

      <section className="space-y-3" aria-labelledby="preview-list-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="preview-list-heading" className="font-semibold text-white">{formId ? "Recent messages" : "Message history"}</h2>
          {formId ? <Button variant="textLink" disabled={loading || sending} onClick={() => { void refreshIntents().catch(() => undefined); }}>Refresh</Button> : null}
        </div>
        {!formId ? <p className="text-sm text-gray-400">Choose an intake form to load its bounded message history.</p> : null}
        {loading && !intents.length ? <p className="text-sm text-gray-400">Loading form message history…</p> : null}
        {historyReady && !intents.length && !loading ? <p className="rounded border border-gray-700 p-4 text-sm text-gray-400">No volunteer messages for this form yet.</p> : null}
        {intents.map((intent) => {
          const member = members.find((item) => item.memberId === intent.memberId);
          const actionable = ["preview", "ready"].includes(intent.status) && intent.previewEligible !== false;
          return <article key={intent.intentId} className="space-y-2 rounded border border-gray-700 bg-gray-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-medium text-white">
                  {intentLabel(intent)} ·{" "}
                  <MemberNameWithIndicator
                    name={member ? memberName(member) : "Roster member"}
                    memberId={member?.memberId}
                  />
                </h3>
                <p className="text-xs text-gray-400">{new Date(intent.createdAt).toLocaleString()} · {statusLabel[intent.status]}{intent.respondedAt ? " · responded" : " · waiting"}</p>
              </div>
            </div>
            {intent.messagePreview ? <p className="rounded bg-gray-900 px-3 py-2 text-sm text-gray-200">{intent.messagePreview}</p> : null}
            {intent.previewError ? <p className="text-sm text-amber-200">Not ready to send: {intent.previewError}</p> : null}
            {intent.attemptId ? <p className="text-xs text-gray-400">Delivery: {intent.attemptStatus === "pending" ? "Waiting for delivery confirmation" : intent.attemptStatus === "accepted" || intent.attemptStatus === "sent" ? "Sent · Waiting for delivery confirmation" : intent.attemptStatus === "delivered" ? "Delivered" : intent.attemptStatus === "undelivered" ? "Delivery failed" : intent.attemptOutcome === "unknown" ? "Could not confirm whether this was sent" : intent.attemptStatus || "Waiting for delivery confirmation"}</p> : null}
            {actionable ? <div className="flex items-center justify-between gap-3 border-t border-gray-800 pt-2"><p className="text-xs text-gray-500">Advanced action for this saved message.</p><Button variant="textLink" disabled={sending || loading || Boolean(individualSmsPreview)} isLoading={sending} onClick={() => void sendIndividual(intent)}>Send individually</Button></div> : null}
          </article>;
        })}
        {nextCursor ? <Button variant="secondary" disabled={loading || sending} isLoading={loading} onClick={() => void loadOlderIntents()}>Load older history</Button> : null}
      </section>

      {individualSmsPreview ? <SmsConfirmationModal
        isOpen
        recipientName={individualSmsPreview.recipientName}
        recipientMemberId={individualSmsPreview.memberId}
        phoneNumberSnapshot={individualSmsPreview.phoneNumberSnapshot}
        message={individualSmsPreview.message}
        segmentCount={individualSmsPreview.segmentCount}
        busy={sending}
        onCancel={cancelIndividualPreview}
        onSend={() => void sendIndividualPreview()}
      /> : null}

      <Modal
        isOpen={confirmOpen && Boolean(reviewedBatch) && batchReviewIsCurrent && historyReady}
        onClose={() => setConfirmOpen(false)}
        title="Review text messages"
        description="Check who will receive these messages and read each personalized message. Choose Send to send them."
        size="lg"
        busy={sending}
      >
        {reviewedBatch ? <div className="space-y-4">
          <AvailabilityBatchReview
            batch={reviewedBatch}
            formName={forms.find(({ formId: id }) => id === formId)?.name || "Intake form"}
            busy={sending}
            mode="confirmation"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t border-gray-700 pt-4 sm:flex-row">
            <Button variant="secondary" disabled={sending} onClick={() => setConfirmOpen(false)}>Cancel</Button>
            {reviewedBatch.summary.eligible > 0 ? <Button disabled={sending || !batchReviewIsCurrent} isLoading={sending} onClick={() => void confirmBatch()}>Send {reviewedBatch.summary.eligible} message{reviewedBatch.summary.eligible === 1 ? "" : "s"}</Button> : null}
          </div>
        </div> : null}
      </Modal>
    </main>
  );
};

export default TeamsMessagesPage;
