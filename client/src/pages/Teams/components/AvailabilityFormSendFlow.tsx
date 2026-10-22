import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";
import Checkbox from "../../../components/Checkbox/Checkbox";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import { RadioGroup } from "../../../components/RadioButton/RadioButton";
import RadioButton from "../../../components/RadioButton/RadioButton";
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
import { abandonPreparedAvailabilityBatch, getAvailabilityNotificationBatch } from "../../../api/auth";
import AvailabilityBatchReview from "./AvailabilityBatchReview";
import { MemberNameWithIndicator } from "./CurrentUserMemberIndicator";
import { getAvailabilityRecipientRows, type AvailabilityAudienceType } from "../availabilityRecipientSelection";
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
  initialAudience = "not_contacted",
  initialMemberIds = [],
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
  initialAudience?: AvailabilityAudienceType;
  initialMemberIds?: string[];
}) => {
  const [audienceType, setAudienceType] = useState<AvailabilityAudienceType>(initialAudience);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[] | null>(
    initialMemberIds.length ? [...initialMemberIds] : initialAudience === "not_contacted" ? null : [],
  );
  const [showRecipients, setShowRecipients] = useState(dialog ? initialAudience !== "not_contacted" : true);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
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
  const [dispatchOutcomeUncertain, setDispatchOutcomeUncertain] = useState(false);
  const [uncertainResendAcknowledged, setUncertainResendAcknowledged] = useState(false);
  const [recoveryBatchId, setRecoveryBatchId] = useState<string | null>(null);
  const recoveryBatchIdRef = useRef<string | null>(null);
  recoveryBatchIdRef.current = recoveryBatchId;
  const statusCheckLockRef = useRef(false);
  const ignoreNextEligibilityChangeRef = useRef(false);
  const restoredBatchContextRef = useRef("");

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
  const onBatchUpdatedRef = useRef(onBatchUpdated);
  onBatchUpdatedRef.current = onBatchUpdated;
  const pendingDispatchStorageKey = `worshipsync:pending-notification-dispatch:${churchId}:${form.formId}`;
  const lastBatchStorageKey = `worshipsync:last-notification-batch:${churchId}:${form.formId}`;
  const normalizeAudience = (value: string): AvailabilityAudienceType => value === "first" ? "not_contacted" : value === "reminder" ? "nonresponders" : value === "specific" ? "specific" : value as AvailabilityAudienceType;

  const storePendingDispatch = (batchId: string) => {
    recoveryBatchIdRef.current = batchId;
    setRecoveryBatchId(batchId);
    setDispatchOutcomeUncertain(true);
    try { window.localStorage.setItem(pendingDispatchStorageKey, batchId); } catch { /* In-memory recovery remains available. */ }
  };
  const clearPendingDispatch = (batchId: string) => {
    const recoveryId = recoveryBatchIdRef.current;
    if (recoveryId && recoveryId !== batchId) return;
    let storedId = "";
    try {
      storedId = window.localStorage.getItem(pendingDispatchStorageKey) || "";
      if (storedId && storedId !== batchId) return;
      if (storedId === batchId) {
        window.localStorage.removeItem(pendingDispatchStorageKey);
      }
    } catch { /* Keep UI recovery available if browser storage is unavailable. */ }
    recoveryBatchIdRef.current = null;
    setRecoveryBatchId((current) => current === batchId ? null : current);
    if (recoveryId === batchId || storedId === batchId) setDispatchOutcomeUncertain(false);
  };
  const clearPendingDispatchRef = useRef(clearPendingDispatch);
  clearPendingDispatchRef.current = clearPendingDispatch;

  useEffect(() => {
    if (previousContextRef.current === contextIdentity) return;
    previousContextRef.current = contextIdentity;
    previousFormReviewRef.current = formReviewIdentity;
    setSelectedMemberIds(audienceType === "not_contacted" ? null : []);
    setReviewedBatchState(null);
    setConfirmOpen(false);
    setDispatchOutcomeUncertain(false);
    setRecoveryBatchId(null);
    recoveryBatchIdRef.current = null;
    setNotice("Form changed. Choose recipients and review the messages again.");
  }, [audienceType, contextIdentity, formReviewIdentity]);

  useEffect(() => {
    if (previousFormReviewRef.current === formReviewIdentity) return;
    previousFormReviewRef.current = formReviewIdentity;
    setReviewedBatchState(null);
    setConfirmOpen(false);
    setNotice("Form details changed. Review the messages again before sending.");
  }, [formReviewIdentity]);

  useEffect(() => {
    if (restoredBatchContextRef.current === contextIdentity) return;
    let active = true;
    let savedBatchId = "";
    try { savedBatchId = window.localStorage.getItem(pendingDispatchStorageKey) || window.localStorage.getItem(lastBatchStorageKey) || ""; } catch { /* No durable browser storage. */ }
    if (!savedBatchId && !historyLoaded) return () => { active = false; };
    if (!savedBatchId) {
      const candidateIntent = notificationIntents
        .filter((intent) => intent.formId === form.formId && intent.batchId && ["preview", "ready"].includes(intent.status))
        .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0];
      savedBatchId = candidateIntent?.batchId || "";
    }
    if (!savedBatchId) {
      restoredBatchContextRef.current = contextIdentity;
      return () => { active = false; };
    }
    setRecoveryBatchId(savedBatchId);
    recoveryBatchIdRef.current = savedBatchId;
    setDispatchOutcomeUncertain(true);
    getAvailabilityNotificationBatch(churchId, savedBatchId).then(({ batch }) => {
      if (!active || currentContextRef.current !== contextIdentity || currentFormReviewRef.current !== formReviewIdentity) return;
      if (batch.churchId !== churchId || batch.formId !== form.formId || batch.intentType === "schedule_initial_notification") return;
      if (batch.status === "abandoned") {
        clearPendingDispatchRef.current(savedBatchId);
        try {
          if (window.localStorage.getItem(lastBatchStorageKey) === savedBatchId) window.localStorage.removeItem(lastBatchStorageKey);
        } catch { /* The batch is server-side abandoned even if browser storage is unavailable. */ }
        setDispatchOutcomeUncertain(false);
        setRecoveryBatchId(null);
        recoveryBatchIdRef.current = null;
        restoredBatchContextRef.current = contextIdentity;
        return;
      }
      const restoredAudience = normalizeAudience(batch.audienceType || (batch.intentType === "availability_reminder" ? "reminder" : "first"));
      ignoreNextEligibilityChangeRef.current = true;
      setAudienceType(restoredAudience);
      setSelectedMemberIds(batch.selectedMemberIds);
      const restoredRows = getAvailabilityRecipientRows({
        members: members.filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))), positions, teams, recipients, eligibilityByMemberId,
        notificationIntents, smsDeliveryAttempts, form, intentType: "availability_request", audienceType: restoredAudience,
      });
      const restoredSelection = restoredRows
        .filter(({ member, eligible }) => eligible && batch.selectedMemberIds.includes(member.memberId))
        .map(({ member }) => member.memberId);
      setReviewedBatchState({
        batch,
        formIdentity: formReviewIdentity,
        recipientEligibilityIdentity: currentRecipientEligibilityRef.current,
        selectionIdentity: JSON.stringify([restoredAudience, restoredSelection]),
      });
      onBatchUpdatedRef.current?.(batch);
      if (batch.status === "prepared") {
        setDispatchOutcomeUncertain(false);
        if (batch.summary.eligible > 0) {
          setConfirmOpen(true);
          setNotice("Your reviewed messages are ready. Nothing was sent yet.");
        } else {
          setConfirmOpen(false);
          setNotice("This prepared message needs a fresh review because no recipients are currently eligible.");
        }
      } else if (batch.status === "dispatching") {
        setDispatchOutcomeUncertain(true);
      } else {
        clearPendingDispatchRef.current(savedBatchId);
      }
      restoredBatchContextRef.current = contextIdentity;
    }).catch(() => {
      if (active && currentContextRef.current === contextIdentity && currentFormReviewRef.current === formReviewIdentity) {
        setError("Delivery status is still unknown. Check the batch status before preparing another message.");
        restoredBatchContextRef.current = contextIdentity;
      }
    });
    return () => { active = false; };
  }, [churchId, contextIdentity, eligibilityByMemberId, form, form.formId, formReviewIdentity, historyLoaded, lastBatchStorageKey, members, notificationIntents, pendingDispatchStorageKey, positions, recipients, smsDeliveryAttempts, teams]);

  const invalidateReview = () => {
    if (dispatchOutcomeUncertain) return;
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
    audienceType,
  }), [activeMembers, audienceType, eligibilityByMemberId, form, notificationIntents, positions, recipients, smsDeliveryAttempts, teams]);
  const activeBatch = reviewedBatchState?.batch || null;
  const recipientEligibilityIdentity = JSON.stringify(rows.map(({ member, memberTeamIds, recipient, eligibility, eligible, reason, previousDeliveryStatus, hasPreviousRequest, previousSentAt }) => [
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
    hasPreviousRequest,
    previousSentAt,
  ]));
  const currentRecipientEligibilityRef = useRef(recipientEligibilityIdentity);
  currentRecipientEligibilityRef.current = recipientEligibilityIdentity;
  const previousRecipientEligibilityRef = useRef(recipientEligibilityIdentity);
  useEffect(() => {
    if (previousRecipientEligibilityRef.current === recipientEligibilityIdentity) return;
    previousRecipientEligibilityRef.current = recipientEligibilityIdentity;
    if (ignoreNextEligibilityChangeRef.current) {
      ignoreNextEligibilityChangeRef.current = false;
      return;
    }
    const hadPreparedReview = reviewedBatchState?.batch.status === "prepared" &&
      !reviewedBatchState.batch.summary.sent && !reviewedBatchState.batch.summary.failed && !reviewedBatchState.batch.summary.uncertain;
    setReviewedBatchState((current) => current?.batch.status === "prepared" ? null : current);
    setConfirmOpen(false);
    if (hadPreparedReview) setNotice("Recipient eligibility changed. Review the messages again before sending.");
  }, [confirmOpen, recipientEligibilityIdentity, reviewedBatchState]);
  const query = search.trim().toLocaleLowerCase();
  const audienceRows = rows.filter((row) => {
    if (audienceType === "not_contacted") return !row.hasAcceptedRequest && !row.hasUncertainRequest;
    if (audienceType === "nonresponders") return !row.recipient?.respondedAt && !row.hasUncertainRequest;
    return true;
  });
  const filteredRows = audienceRows.filter((row) => {
    const { member, memberTeamIds } = row;
    return (!teamFilter || memberTeamIds.has(teamFilter)) &&
    (!query || memberName(member).toLocaleLowerCase().includes(query));
  });
  const defaultFirstSelectedIds = rows
    .filter(({ eligible, hasAcceptedRequest, hasUncertainRequest }) => eligible && !hasAcceptedRequest && !hasUncertainRequest)
    .map(({ member }) => member.memberId);
  const effectiveSelectedMemberIds = selectedMemberIds === null ? defaultFirstSelectedIds : selectedMemberIds;
  const visibleRows = showSelectedOnly
    ? rows.filter(({ member }) => effectiveSelectedMemberIds.includes(member.memberId))
    : filteredRows;
  const visibleEligibleIds = historyLoaded ? visibleRows.filter(({ eligible }) => eligible).map(({ member }) => member.memberId) : [];
  const selectedEligibleIds = historyLoaded ? rows
    .filter(({ member, eligible }) => eligible && effectiveSelectedMemberIds.includes(member.memberId))
    .map(({ member }) => member.memberId) : [];
  const selectionIdentity = JSON.stringify([audienceType, selectedEligibleIds]);
  const selectionIdentityRef = useRef(selectionIdentity);
  selectionIdentityRef.current = selectionIdentity;
  const batchIdentityMatches = Boolean(reviewedBatchState &&
    reviewedBatchState.formIdentity === formReviewIdentity &&
    reviewedBatchState.recipientEligibilityIdentity === recipientEligibilityIdentity &&
    reviewedBatchState.selectionIdentity === selectionIdentity);
  const batchHasProgress = Boolean(reviewedBatchState && (
    reviewedBatchState.batch.status !== "prepared" || reviewedBatchState.batch.summary.sent > 0 ||
    reviewedBatchState.batch.summary.failed > 0 || reviewedBatchState.batch.summary.uncertain > 0
  )) || dispatchOutcomeUncertain;
  const intentType = "availability_request" as const;
  const reviewedBatch = activeBatch?.formId === form.formId && activeBatch.churchId === churchId &&
    ["availability_request", "availability_reminder"].includes(activeBatch.intentType) && normalizeAudience(activeBatch.audienceType || "first") === audienceType &&
    reviewedBatchState?.formIdentity === formReviewIdentity &&
    (batchIdentityMatches || batchHasProgress) ? activeBatch : null;
  const visibleSelectionCount = visibleEligibleIds.filter((id) => selectedEligibleIds.includes(id)).length;
  const allVisibleSelected = visibleEligibleIds.length > 0 && visibleSelectionCount === visibleEligibleIds.length;
  const someVisibleSelected = visibleSelectionCount > 0 && !allVisibleSelected;
  const updateRecipientSelection = (memberIds: string[], selected: boolean) => {
    if (dispatchOutcomeUncertain) return;
    const next = new Set(effectiveSelectedMemberIds);
    memberIds.forEach((memberId) => selected ? next.add(memberId) : next.delete(memberId));
    const nextIds = [...next];
    if (nextIds.length === effectiveSelectedMemberIds.length && nextIds.every((id) => effectiveSelectedMemberIds.includes(id))) return;
    setSelectedMemberIds(nextIds);
    invalidateReview();
  };
  const changeAudience = (nextAudience: AvailabilityAudienceType) => {
    if (dispatchOutcomeUncertain || audienceType === nextAudience) return;
    setAudienceType(nextAudience);
    const nextRows = getAvailabilityRecipientRows({
      members: activeMembers, positions, teams, recipients, eligibilityByMemberId,
      notificationIntents, smsDeliveryAttempts, form, intentType: "availability_request", audienceType: nextAudience,
    });
    const nextEligibleIds = nextRows.filter(({ eligible, recipient, hasAcceptedRequest, hasUncertainRequest }) =>
      eligible && (nextAudience === "not_contacted"
        ? !hasAcceptedRequest && !hasUncertainRequest
        : nextAudience === "nonresponders" ? !recipient?.respondedAt && !hasUncertainRequest : true),
    ).map(({ member }) => member.memberId);
    setSelectedMemberIds(nextAudience === "specific" ? [...initialMemberIds] : nextEligibleIds);
    setShowRecipients(nextAudience !== "not_contacted");
    setUncertainResendAcknowledged(false);
    setShowSelectedOnly(false);
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
  const firstEligibleCount = rows.filter(({ eligible, hasAcceptedRequest, hasUncertainRequest }) => eligible && !hasAcceptedRequest && !hasUncertainRequest).length;
  const reminderEligibleCount = rows.filter(({ eligible, recipient, hasUncertainRequest }) => eligible && !recipient?.respondedAt && !hasUncertainRequest).length;
  const statusCounts = {
    ready: audienceType === "not_contacted" ? firstEligibleCount : audienceType === "nonresponders" ? reminderEligibleCount : rows.filter(({ eligible }) => eligible).length,
    consentNeeded: statusRows.filter(({ eligibility }) => eligibility.status === "consent_needed").length,
    optedOut: statusRows.filter(({ eligibility }) => eligibility.status === "opted_out").length,
    missingPhone: statusRows.filter(({ eligibility }) => eligibility.status === "no_mobile").length,
    sent: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "sent").length,
    responded: statusRows.filter(({ recipient }) => Boolean(recipient?.respondedAt)).length,
    failed: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "failed").length,
    needsStatusCheck: statusRows.filter(({ previousDeliveryStatus }) => previousDeliveryStatus === "uncertain").length,
  };

  const reviewMessages = async () => {
    if (!historyLoaded || busy || dispatchOutcomeUncertain || selectedEligibleIds.length === 0) return;
    const requestedContext = contextIdentity;
    const requestedFormId = form.formId;
    const requestedFormIdentity = formReviewIdentity;
    const requestedRecipientEligibilityIdentity = recipientEligibilityIdentity;
    const requestedMemberIds = [...selectedEligibleIds];
    const requestedSelectionIdentity = selectionIdentity;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const batch = await prepareAvailabilityBatchForMembers({
        churchId,
        formId: requestedFormId,
        intentType,
        audienceType,
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
      if (batch.summary.eligible > 0) {
        setUncertainResendAcknowledged(false);
        setConfirmOpen(true);
      } else {
        setConfirmOpen(false);
        setNotice("No selected volunteers are eligible for this message. Review the eligibility details and update your selection.");
      }
    } catch (caught) {
      if (currentContextRef.current === requestedContext) {
        setError(caught instanceof Error ? caught.message : "Could not prepare form messages.");
      }
    } finally {
      setBusy(false);
    }
  };

  const sendBatch = async () => {
    if (!historyLoaded || dispatchOutcomeUncertain || !reviewedBatch || reviewedBatch.summary.eligible === 0 || reviewedBatch.formId !== form.formId || reviewedBatch.churchId !== churchId || busy || sendLockRef.current) return;
    if (reviewedBatch.recipients.some(({ eligible, previousDeliveryStatus }) => eligible && previousDeliveryStatus === "uncertain") && !uncertainResendAcknowledged) return;
    sendLockRef.current = true;
    const requestedContext = contextIdentity;
    const requestedChurchId = churchId;
    const requestedFormIdentity = formReviewIdentity;
    const requestedRecipientEligibilityIdentity = recipientEligibilityIdentity;
    const requestedSelectionIdentity = selectionIdentity;
    const batchToSend = reviewedBatch;
    storePendingDispatch(batchToSend.batchId);
    setBusy(true);
    setError("");
    try {
      const acknowledgedIds = uncertainResendAcknowledged
        ? batchToSend.recipients.filter((row) => row.eligible && row.previousDeliveryStatus === "uncertain").map((row) => row.memberId)
        : [];
      const response = await dispatchReviewedAvailabilityBatch(requestedChurchId, batchToSend, acknowledgedIds);
      if (currentContextRef.current !== requestedContext || currentFormReviewRef.current !== requestedFormIdentity) return;
      onBatchUpdated?.(response.batch);
      setReviewedBatchState({
        batch: response.batch,
        formIdentity: requestedFormIdentity,
        recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
        selectionIdentity: requestedSelectionIdentity,
      });
      setConfirmOpen(false);
      setUncertainResendAcknowledged(false);
      setNotice("");
      if (["prepared", "dispatching"].includes(response.batch.status)) {
        storePendingDispatch(batchToSend.batchId);
      } else {
        clearPendingDispatch(batchToSend.batchId);
      }
    } catch (caught) {
      const ownsCurrentReview = currentContextRef.current === requestedContext &&
        currentFormReviewRef.current === requestedFormIdentity;
      if (ownsCurrentReview) {
        setReviewedBatchState({
          batch: batchToSend,
          formIdentity: requestedFormIdentity,
          recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
          selectionIdentity: requestedSelectionIdentity,
        });
        setError("We couldn't confirm the send result. Checking the saved message status now.");
      }
      try {
        const latest = await getAvailabilityNotificationBatch(requestedChurchId, batchToSend.batchId);
        if (ownsCurrentReview && currentContextRef.current === requestedContext && currentFormReviewRef.current === requestedFormIdentity) {
          onBatchUpdated?.(latest.batch);
          setReviewedBatchState({
            batch: latest.batch,
            formIdentity: requestedFormIdentity,
            recipientEligibilityIdentity: requestedRecipientEligibilityIdentity,
            selectionIdentity: requestedSelectionIdentity,
          });
          if (latest.batch.status === "prepared") {
            clearPendingDispatch(batchToSend.batchId);
            setDispatchOutcomeUncertain(false);
            setConfirmOpen(true);
            setError("No message was sent. Your reviewed messages are still ready; try Send again. If your session expired, sign in again first.");
          } else if (latest.batch.status === "dispatching") {
            storePendingDispatch(batchToSend.batchId);
            setConfirmOpen(false);
            setError("We couldn't confirm whether these messages were sent. Check message status before starting a new message.");
          } else {
            clearPendingDispatch(batchToSend.batchId);
            setConfirmOpen(false);
            setError(latest.batch.summary.uncertain > 0
              ? "We couldn't confirm whether some messages were sent. Check message status before starting a new message."
              : latest.batch.summary.sent > 0
                ? "Some messages were accepted by the provider. Delivery updates are shown separately."
                : "This message operation is complete. Review the results below.");
          }
        }
      } catch {
        if (ownsCurrentReview && currentContextRef.current === requestedContext && currentFormReviewRef.current === requestedFormIdentity) {
          setConfirmOpen(false);
          setError("We couldn't check whether these messages were sent. Check the saved message status before trying again.");
        }
      }
    } finally {
      sendLockRef.current = false;
      setBusy(false);
    }
  };

  const checkBatchStatus = async () => {
    const batchId = reviewedBatchState?.batch.batchId || recoveryBatchId;
    if (!batchId || busy || statusCheckLockRef.current) return;
    statusCheckLockRef.current = true;
    const requestedContext = contextIdentity;
    const requestedFormIdentity = formReviewIdentity;
    setBusy(true);
    setError("");
    try {
      const latest = await getAvailabilityNotificationBatch(churchId, batchId);
      if (currentContextRef.current !== requestedContext || currentFormReviewRef.current !== requestedFormIdentity) return;
      if (latest.batch.churchId !== churchId || latest.batch.formId !== form.formId || latest.batch.intentType === "schedule_initial_notification") {
        setError("That batch does not belong to this availability form.");
        return;
      }
      if (latest.batch.status === "abandoned") {
        clearPendingDispatch(batchId);
        try {
          if (window.localStorage.getItem(lastBatchStorageKey) === batchId) window.localStorage.removeItem(lastBatchStorageKey);
        } catch { /* The batch is server-side abandoned. */ }
        setReviewedBatchState(null);
        setConfirmOpen(false);
        setDispatchOutcomeUncertain(false);
        setNotice("This unsent review was discarded. No message was sent.");
        return;
      }
      const restoredAudience = normalizeAudience(latest.batch.audienceType || (latest.batch.intentType === "availability_reminder" ? "reminder" : "first"));
      ignoreNextEligibilityChangeRef.current = true;
      setAudienceType(restoredAudience);
      setSelectedMemberIds(latest.batch.selectedMemberIds);
      const restoredRows = getAvailabilityRecipientRows({
        members: members.filter((member) => !member.archivedAt).sort((a, b) => memberName(a).localeCompare(memberName(b))), positions, teams, recipients, eligibilityByMemberId,
        notificationIntents, smsDeliveryAttempts, form, intentType: "availability_request", audienceType: restoredAudience,
      });
      const restoredSelection = restoredRows
        .filter(({ member, eligible }) => eligible && latest.batch.selectedMemberIds.includes(member.memberId))
        .map(({ member }) => member.memberId);
      setReviewedBatchState({
        batch: latest.batch,
        formIdentity: requestedFormIdentity,
        recipientEligibilityIdentity: currentRecipientEligibilityRef.current,
        selectionIdentity: JSON.stringify([restoredAudience, restoredSelection]),
      });
      onBatchUpdated?.(latest.batch);
      if (latest.batch.status === "prepared") {
        clearPendingDispatch(batchId);
        setDispatchOutcomeUncertain(false);
        if (latest.batch.summary.eligible > 0) {
          setConfirmOpen(true);
          setNotice("This message was prepared but not sent. Review it and send when ready.");
        } else {
          setConfirmOpen(false);
          setNotice("No recipients are currently eligible. Update your selection and review the message again.");
        }
      } else if (latest.batch.status === "dispatching") {
        storePendingDispatch(batchId);
        setNotice("We couldn't confirm whether this message was sent. Check its status before starting a new message.");
      } else {
        clearPendingDispatch(batchId);
        setNotice("");
      }
    } catch {
      if (currentContextRef.current === requestedContext && currentFormReviewRef.current === requestedFormIdentity) {
        setError("Could not check the batch status. The batch is still protected from another send; try checking again.");
      }
    } finally {
      statusCheckLockRef.current = false;
      setBusy(false);
    }
  };

  const abandonPreparedReview = async () => {
    const batch = reviewedBatchState?.batch;
    if (!batch || batch.status !== "prepared" || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await abandonPreparedAvailabilityBatch(churchId, batch.batchId);
      if (currentContextRef.current !== contextIdentity || currentFormReviewRef.current !== formReviewIdentity) return;
      clearPendingDispatch(batch.batchId);
      try {
        if (window.localStorage.getItem(lastBatchStorageKey) === batch.batchId) window.localStorage.removeItem(lastBatchStorageKey);
      } catch { /* Server-side abandonment still prevents this batch from sending. */ }
      setReviewedBatchState(null);
      setConfirmOpen(false);
      setUncertainResendAcknowledged(false);
      onBatchUpdated?.(result.batch);
      setNotice("Unsent review discarded. No message was sent. You can prepare a new review.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not discard this unsent review.");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisible = (checked: boolean) => updateRecipientSelection(visibleEligibleIds, checked);

  const excludedRows = rows.filter((row) => !row.eligible || (audienceType === "not_contacted" && (row.hasAcceptedRequest || row.hasUncertainRequest)) ||
    (audienceType === "nonresponders" && (Boolean(row.recipient?.respondedAt) || row.hasUncertainRequest)));
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
  const recipientDiagnostics = dialog ? <details className="text-xs text-gray-300"><summary className="cursor-pointer">Eligibility details ({excludedRows.length} excluded)</summary><div className="mt-2 space-y-2">{eligibilitySummary}<ul className="max-h-40 space-y-1 overflow-y-auto">{excludedRows.map((row) => <li key={row.member.memberId}><span className="text-gray-200">{memberName(row.member)}</span> — {row.reason || (row.hasPreviousRequest ? "Previously contacted. Choose Specific volunteers to send another message." : "Not eligible for this audience.")}</li>)}</ul></div></details> : eligibilitySummary;
  let continueLabel = "Review and send " + selectedEligibleIds.length + " message" + (selectedEligibleIds.length === 1 ? "" : "s");
  if (dialog) continueLabel = "Continue to review";
  if (busy) continueLabel = "Preparing messages...";
  const selectionFooter = <div className={dialog ? "shrink-0 border-t border-gray-700 bg-gray-800 px-4 py-3" : "flex flex-col gap-3 border-t border-gray-700 pt-4 sm:flex-row sm:items-center sm:justify-between"}>
    <p className="text-sm text-gray-200" aria-live="polite">{!historyLoaded ? "Checking recipient eligibility..." : selectedEligibleIds.length + " selected · " + statusCounts.ready + " ready to send"}</p>
    <div className="mt-2 flex items-center justify-end gap-2">
      {dialog ? <Button variant="tertiary" disabled={busy} onClick={onClose}>Cancel</Button> : null}
      <Button variant={dialog ? "cta" : "primary"} disabled={busy || dispatchOutcomeUncertain || !historyLoaded || !selectedEligibleIds.length} isLoading={busy} onClick={() => void reviewMessages()}>{continueLabel}</Button>
    </div>
  </div>;

  const hiddenSelectedCount = Math.max(0, selectedEligibleIds.length - visibleEligibleIds.filter((id) => selectedEligibleIds.includes(id)).length);
  const audienceLabel = audienceType === "not_contacted" ? "Not yet contacted" : audienceType === "nonresponders" ? "Haven't responded" : "Choose people";
  const audienceDescription = audienceType === "not_contacted"
    ? "Select volunteers who have not received a confirmed message for this form."
    : audienceType === "nonresponders"
      ? "Select volunteers who have not submitted availability, including people previously contacted."
      : "Choose specific volunteers, including people previously contacted or already responded.";
  const emptyMessage = audienceType === "not_contacted"
    ? "No volunteers are ready for a first message. Choose people to review a new message for someone already contacted."
    : audienceType === "nonresponders"
      ? "No eligible volunteers are waiting to respond."
      : "No volunteers are eligible to receive a text right now.";
  const selection = (
    <section className={dialog ? "min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-3" : "space-y-4 rounded-lg border border-sky-700 bg-gray-900/60 p-4"} aria-labelledby="send-form-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="send-form-heading" className={dialog ? "sr-only" : "font-semibold text-white"}>{dialog ? "Select recipients" : "Send requests"}</h2><p className="text-sm text-gray-300">Choose who should receive an availability message.</p></div>
        {!dialog ? <Button variant="textLink" disabled={busy} onClick={onClose}>Close</Button> : null}
      </div>
      {!historyLoaded ? historyError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-700/70 bg-amber-950/30 p-3 text-sm text-amber-100" role="alert">
          <span>{historyError}</span>
          <Button variant="secondary" disabled={busy} onClick={onRetryHistory}>Retry status check</Button>
        </div>
      ) : <p role="status" className="text-sm text-gray-300">Loading consent and message history…</p> : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-white">Audience</legend>
        <RadioGroup aria-label="Message audience" value={audienceType} onValueChange={(value) => changeAudience(value as AvailabilityAudienceType)} className="grid gap-2">
          <RadioButton optionValue="not_contacted" label="Not yet contacted" hideLabelColon helperText="Select volunteers who have not received a confirmed message for this form." className="w-full justify-between rounded-md border border-gray-700 bg-gray-950/40 p-3" labelClassName="text-white" helperTextClassName="text-gray-400" disabled={busy || dispatchOutcomeUncertain || !historyLoaded} />
          <RadioButton optionValue="nonresponders" label="Haven't responded" hideLabelColon helperText="Include volunteers who were contacted before but have not submitted availability." className="w-full justify-between rounded-md border border-gray-700 bg-gray-950/40 p-3" labelClassName="text-white" helperTextClassName="text-gray-400" disabled={busy || dispatchOutcomeUncertain || !historyLoaded} />
          <RadioButton optionValue="specific" label="Choose people" hideLabelColon helperText="Choose anyone eligible, including previously contacted or already responded volunteers." className="w-full justify-between rounded-md border border-gray-700 bg-gray-950/40 p-3" labelClassName="text-white" helperTextClassName="text-gray-400" disabled={busy || dispatchOutcomeUncertain || !historyLoaded} />
        </RadioGroup>
      </fieldset>
      {historyLoaded ? <div className="rounded-md border border-gray-700 bg-gray-950/40 px-3 py-2">
        <p className="text-base font-semibold text-white">{selectedEligibleIds.length} selected</p>
        <p className="text-xs text-gray-300">{statusCounts.ready} ready to send · {excludedRows.length} excluded for eligibility, response, or message history</p>
      </div> : null}
      {reviewedBatch?.status === "prepared" && reviewedBatch.summary.eligible === 0 ? <div role="status" className="space-y-2 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
        <p>No selected volunteers can receive this message right now. Update your selection or refresh eligibility.</p>
        <ul className="space-y-1">{reviewedBatch.recipients.filter(({ eligible }) => !eligible).map((recipient) => <li key={recipient.memberId}>{recipient.memberName}: {recipient.exclusionReason || "Not eligible for this message."}</li>)}</ul>
        <Button variant="textLink" disabled={busy} onClick={onRetryHistory}>Refresh eligibility</Button>
      </div> : null}
      {audienceType === "not_contacted" ? <Button variant="textLink" disabled={busy || dispatchOutcomeUncertain || !historyLoaded} onClick={() => { setShowRecipients((current) => !current); setShowSelectedOnly(false); }}>
        {showRecipients ? "Hide recipients" : "Change recipients"}
      </Button> : null}
      {showRecipients ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">{audienceLabel}: {audienceDescription}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {teamOptions.length > 2 ? <Select label="Team" size="sm" labelFontSize="text-xs" labelClassName="text-gray-300" value={teamFilter} onChange={(value) => { setTeamFilter(value); setShowSelectedOnly(false); }} disabled={busy || dispatchOutcomeUncertain || !historyLoaded} options={teamOptions} /> : null}
            <Input label="Search volunteers" labelFontSize="text-xs" labelClassName="text-gray-300" value={search} onChange={(value) => { setSearch(String(value)); setShowSelectedOnly(false); }} placeholder="Search by name" disabled={busy || dispatchOutcomeUncertain || !historyLoaded} />
          </div>
          {hiddenSelectedCount > 0 ? <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-100">
            <span>{hiddenSelectedCount} selected volunteer{hiddenSelectedCount === 1 ? " is" : "s are"} hidden by these filters.</span>
            <Button variant="textLink" disabled={busy} onClick={() => setShowSelectedOnly(true)}>{showSelectedOnly ? "Back to filters" : "Show selected"}</Button>
          </p> : showSelectedOnly ? <Button variant="textLink" disabled={busy} onClick={() => setShowSelectedOnly(false)}>Back to filters</Button> : null}
          <div className="max-h-[32vh] overflow-y-auto rounded-md border border-gray-700 bg-gray-900">
            {visibleRows.filter(({ eligible }) => eligible).length ? <>
              <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-700 bg-gray-900 px-3 py-2">
                <div className="flex items-center gap-3"><Checkbox aria-label={"Select all " + visibleEligibleIds.length + " eligible shown"} checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} disabled={busy || !visibleEligibleIds.length} onCheckedChange={(checked) => toggleVisible(checked === true)} /><span className="text-sm text-gray-200">Select eligible volunteers shown</span><span className="text-xs text-gray-300">{visibleRows.length} shown</span></div>
                <div className="flex items-center gap-3"><span aria-live="polite" className="text-sm text-gray-300">{selectedEligibleIds.length} selected</span><Button variant="textLink" disabled={busy || !selectedEligibleIds.length} onClick={() => updateRecipientSelection(selectedEligibleIds, false)}>Clear</Button></div>
              </div>
              <div className="divide-y divide-gray-800" role="list" aria-label="Form recipients">
                {visibleRows.filter(({ eligible }) => eligible).map((row) => {
                  const { member, recipient, eligible, reason, previousDeliveryStatus, previousSentAt } = row;
                  const responded = Boolean(recipient?.respondedAt);
                  const sentDate = previousSentAt ? new Date(previousSentAt).toLocaleDateString() : "";
                  const previousLabel = responded ? "Already responded"
                    : previousDeliveryStatus === "sent" ? "Previously sent" + (sentDate ? " · " + sentDate : "")
                      : previousDeliveryStatus === "uncertain" ? "Previous delivery unconfirmed · check message history"
                        : previousDeliveryStatus === "failed" ? "Previous send failed · this will be a new message"
                          : "Ready for a first message";
                  return <div key={member.memberId} className="flex min-h-10 items-center gap-3 px-3 py-2" role="listitem">
                    <Checkbox label={<MemberNameWithIndicator name={memberName(member)} memberId={member.memberId} className="flex-1" />} checked={selectedEligibleIds.includes(member.memberId)} disabled={busy || dispatchOutcomeUncertain || !historyLoaded || !eligible} onCheckedChange={(checked) => updateRecipientSelection([member.memberId], checked === true)} className="flex-1" />
                    <span className="max-w-[52%] text-right text-xs text-gray-300">{previousLabel || reason}</span>
                  </div>;
                })}
              </div>
            </> : <p role="status" className="p-4 text-sm text-gray-300">{filteredRows.length ? emptyMessage : "No volunteers match these filters."}</p>}
          </div>
        </div>
      ) : audienceType === "not_contacted" && statusCounts.ready === 0 ? <p role="status" className="rounded-md border border-gray-700 bg-gray-950/40 p-3 text-sm text-gray-300">{emptyMessage}</p> : null}
      {historyLoaded && excludedRows.length ? recipientDiagnostics : null}
      {!dialog ? selectionFooter : null}
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-sky-200">{notice}</p> : null}
      {dispatchOutcomeUncertain && !reviewedBatch ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100"><span>Delivery status is unknown for batch {recoveryBatchId || "saved"}. Do not prepare another message until status is checked.</span><Button variant="secondary" disabled={busy} isLoading={busy} onClick={() => void checkBatchStatus()}>Check batch status</Button></div> : null}
      {reviewedBatch && (batchHasProgress || dispatchOutcomeUncertain) ? <div className="space-y-2"><AvailabilityBatchReview batch={reviewedBatch} formName={form.name} busy={busy || !historyLoaded} privacySafe={privacySafe} mode="status" outcomeUncertain={dispatchOutcomeUncertain} /><Button variant="secondary" disabled={busy} isLoading={busy} onClick={() => void checkBatchStatus()}>Check batch status</Button></div> : null}
    </section>
  );

  const reviewContent = reviewedBatch ? <div className="space-y-3">
    {dialog ? <p className="text-sm text-gray-300">{selectedEligibleIds.length} volunteers selected</p> : null}
    {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
    <AvailabilityBatchReview batch={reviewedBatch} formName={form.name} busy={busy} privacySafe={privacySafe} mode="confirmation" uncertainResendAcknowledged={uncertainResendAcknowledged} onUncertainResendAcknowledgedChange={setUncertainResendAcknowledged} onAbandonPrepared={() => void abandonPreparedReview()} />
  </div> : null;
  const reviewFooter = <div className={dialog ? "flex shrink-0 items-center justify-between gap-2 border-t border-gray-700 bg-gray-800 px-4 py-3" : "mt-4 flex flex-col-reverse justify-end gap-2 border-t border-gray-700 pt-4 sm:flex-row"}>
    <Button variant={dialog ? "tertiary" : "secondary"} disabled={busy} onClick={() => setConfirmOpen(false)}>{dialog ? "Back" : "Cancel"}</Button>
    <div className="flex items-center gap-2">
      {dialog ? <Button variant="tertiary" disabled={busy} onClick={onClose}>Cancel</Button> : null}
      {reviewedBatch && reviewedBatch.summary.eligible > 0 ? <Button variant={dialog ? "cta" : "primary"} disabled={busy || dispatchOutcomeUncertain || !historyLoaded || (reviewedBatch.recipients.some(({ eligible, previousDeliveryStatus }) => eligible && previousDeliveryStatus === "uncertain") && !uncertainResendAcknowledged)} isLoading={busy} onClick={() => void sendBatch()}>Send {reviewedBatch.summary.eligible} message{reviewedBatch.summary.eligible === 1 ? "" : "s"}</Button> : null}
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
