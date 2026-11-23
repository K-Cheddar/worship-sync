import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock3 } from "lucide-react";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Modal from "../components/Modal/Modal";
import Select from "../components/Select/Select";
import SegmentedControl from "../components/SegmentedControl/SegmentedControl";
import { SERVICE_OCCURRENCE_GRID_CLASS_NAME } from "../components/ServiceOccurrenceCard/ServiceOccurrenceCard";
import { cn } from "../utils/cnHelper";
import { GlobalInfoContext } from "../context/globalInfo";
import { useToast } from "../context/toastContext";
import { getMyVolunteerAvailability, submitMyVolunteerAvailability, updateMySchedulingPreferences } from "../api/auth";
import type {
  PersonalScheduleAccess,
  VolunteerAvailabilityOperations,
  VolunteerAvailabilityRead,
  VolunteerAvailabilityRequest,
  VolunteerAvailabilityRequestSummary,
  VolunteerAvailabilitySave,
  VolunteerAvailabilitySaveResult,
  VolunteerSchedulingPreferences,
  VolunteerSchedulingPreferencesSave,
} from "./myScheduleOperations";
import {
  DEFAULT_SERVING_FREQUENCY,
  emptyRecurringAvailability,
  recurringAvailabilityLabel,
  recurringAvailabilityWeekOptions,
  servingFrequencyLabel,
  servingFrequencyOptions,
} from "./Teams/memberPreferences";
import { VolunteerNavigationGuardProvider, useVolunteerNavigationGuard } from "./VolunteerNavigationGuard";
import {
  formatAvailabilityDeadline,
  formatAvailabilityOccurrence,
  formatAvailabilityOccurrenceTime,
  isAvailabilityOccurrencePast,
  createAvailabilityCheckboxSubmission,
  getAvailabilityChoice,
  getAvailabilityCounts,
  hasAvailabilityResponseSubmission,
  organizeAvailabilityOccurrences,
  setAvailabilityChoice,
  type AvailabilityOrganizeMode,
  type AvailabilityChoice,
} from "./myAvailabilityUtils";
import { getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";

type AnswerMap = VolunteerAvailabilityRequest["availability"];
const AVAILABILITY_ORGANIZE_OPTIONS = [
  { value: "byDate" as const, label: "By date" },
  { value: "byService" as const, label: "By service" },
];

const copyAnswers = (answers: AnswerMap): AnswerMap => ({ ...answers });

const availabilityMapsMatch = (
  first: AnswerMap,
  second: AnswerMap,
  occurrenceIds: string[],
) => occurrenceIds.every((id) => (first[id] || "") === (second[id] || ""));

const answersForScope = (answers: AnswerMap, occurrenceIds: string[]): AnswerMap =>
  Object.fromEntries(occurrenceIds.flatMap((id) =>
    answers[id] === "available" || answers[id] === "unavailable"
      ? [[id, answers[id]]]
      : [],
  ));

const expandProjectedAnswers = (
  request: VolunteerAvailabilityRequest,
  answers: AnswerMap,
): AnswerMap => Object.fromEntries(request.occurrences.flatMap((occurrence) => {
  const answer = answers[occurrence.occurrenceId];
  if (answer !== "available" && answer !== "unavailable") return [];
  return (occurrence.responseOccurrenceIds?.length
    ? occurrence.responseOccurrenceIds
    : [occurrence.occurrenceId]).map((occurrenceId) => [occurrenceId, answer]);
}));

const answerLabel = (answer: AvailabilityChoice | undefined) => {
  if (answer === "available") return "Available";
  if (answer === "unavailable") return "Unavailable";
  return "Not answered";
};

const requestKey = (request: Pick<VolunteerAvailabilityRequest, "formId" | "recipientId">) =>
  request.formId + ":" + request.recipientId;

const AvailabilitySelectionToolbar = ({
  organizeMode,
  onOrganizeChange,
  selectionLabel,
  selectAllDisabled,
  onSelectAll,
}: {
  organizeMode: AvailabilityOrganizeMode;
  onOrganizeChange: (mode: AvailabilityOrganizeMode) => void;
  selectionLabel: string;
  selectAllDisabled?: boolean;
  onSelectAll?: () => void;
}) => (
  <div className="grid min-w-0 gap-3 rounded-lg border border-gray-700/80 bg-gray-900/50 p-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      {onSelectAll ? (
        <Button type="button" variant="secondary" className="min-h-[44px]" disabled={selectAllDisabled} onClick={onSelectAll}>
          Select all
        </Button>
      ) : null}
      <span role="status" aria-live="polite" className="text-xs text-gray-300">
        {selectionLabel}
      </span>
    </div>
    <div className="flex min-w-0 flex-col gap-1">
      <span className="px-0.5 text-xs font-semibold text-gray-200">Organize</span>
      <SegmentedControl
        ariaLabel="Organize availability services"
        variant="compact"
        fullWidth
        value={organizeMode}
        onChange={onOrganizeChange}
        options={AVAILABILITY_ORGANIZE_OPTIONS}
      />
    </div>
  </div>
);

const RequestCard = ({
  request,
  onOpen,
  disabled,
}: {
  request: VolunteerAvailabilityRequestSummary;
  onOpen: () => void;
  disabled: boolean;
}) => {
  const hasSubmission = hasAvailabilityResponseSubmission(request);
  const action = hasSubmission ? "Change response" : "Respond";

  return (
    <li>
      <button
        type="button"
        className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:cursor-not-allowed disabled:opacity-60 sm:p-4"
        onClick={onOpen}
        disabled={disabled}
        aria-label={`${action} ${request.name || "availability request"}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-gray-100">{request.name || "Availability request"}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            {request.responseDeadline ? (
              <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" size={13} />Due {formatAvailabilityDeadline(request.responseDeadline)}</span>
            ) : null}
            <span>{hasSubmission ? "Response submitted" : "Response needed"}</span>
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-teal-200">{action}</span>
      </button>
    </li>
  );
};

const AvailabilityRequestEditor = ({
  request,
  serviceTimeZone,
  saving,
  availabilityNeedsRefresh,
  saveAvailability,
  refreshAvailability,
  onSavingChange,
  onDirtyChange,
  onSaved,
  onBack,
}: {
  request: VolunteerAvailabilityRequest;
  serviceTimeZone: string | null;
  saving: boolean;
  availabilityNeedsRefresh: boolean;
  saveAvailability: VolunteerAvailabilityOperations["saveAvailability"];
  refreshAvailability: () => Promise<VolunteerAvailabilityRead | null>;
  onSavingChange: (saving: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (answers: AnswerMap, result: VolunteerAvailabilitySaveResult, read: VolunteerAvailabilityRead | null) => void;
  onBack: () => void;
}) => {
  const { showToast } = useToast();
  const hasSubmission = hasAvailabilityResponseSubmission(request);
  const savedCounts = getAvailabilityCounts(request);
  const hasSavedAnswers = savedCounts.available + savedCounts.unavailable > 0;
  const startsWithThreeStateData = (savedCounts.unanswered > 0 && hasSavedAnswers) ||
    (hasSubmission && savedCounts.total > 0 && savedCounts.available + savedCounts.unavailable === 0);
  const [draft, setDraft] = useState<AnswerMap>(() => copyAnswers(request.availability));
  const [detailedEditing, setDetailedEditing] = useState(startsWithThreeStateData);
  const [organizeMode, setOrganizeMode] = useState<AvailabilityOrganizeMode>("byDate");
  const [baseline, setBaseline] = useState(() => ({
    answers: copyAnswers(request.availability),
    revisions: { ...request.availabilityRevision },
  }));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [resolvedConflictIds, setResolvedConflictIds] = useState<string[]>([]);
  const [conflictRequest, setConflictRequest] = useState<VolunteerAvailabilityRequest | null>(null);
  const [conflictReviewOpen, setConflictReviewOpen] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [requestUnavailable, setRequestUnavailable] = useState(false);
  const [serverAllowsEdits, setServerAllowsEdits] = useState(request.editable);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const uncertainPayloadRef = useRef<AnswerMap | null>(null);
  const occurrenceIds = useMemo(
    () => request.occurrences.map(({ occurrenceId }) => occurrenceId),
    [request.occurrences],
  );
  const rawOccurrenceIds = useMemo(() => [...new Set(request.occurrences.flatMap((occurrence) =>
    occurrence.responseOccurrenceIds?.length ? occurrence.responseOccurrenceIds : [occurrence.occurrenceId],
  ))], [request.occurrences]);
  const conflictingOccurrenceIds = useMemo(() => [...new Set([
    ...(request.conflictingOccurrenceIds || []),
    ...request.occurrences.filter((occurrence) => occurrence.hasConflictingAnswers)
      .map((occurrence) => occurrence.occurrenceId),
  ])], [request.conflictingOccurrenceIds, request.occurrences]);
  const occurrenceGroups = useMemo(() => organizeAvailabilityOccurrences({
    occurrences: request.occurrences,
    mode: organizeMode,
    serviceTimeZone,
  }), [request.occurrences, organizeMode, serviceTimeZone]);
  const draftForScope = answersForScope(draft, occurrenceIds);
  const baselineAnswersForScope = answersForScope(baseline.answers, occurrenceIds);
  const isDirty = !availabilityMapsMatch(draftForScope, baselineAnswersForScope, occurrenceIds) || resolvedConflictIds.length > 0;
  const draftAnswerCount = occurrenceIds.filter((id) =>
    draft[id] === "available" || draft[id] === "unavailable",
  ).length;
  const draftAvailableCount = occurrenceIds.filter((id) => draft[id] === "available").length;
  const draftUnansweredCount = occurrenceIds.length - draftAnswerCount;
  const useThreeStateEditor = detailedEditing ||
    conflictingOccurrenceIds.length > 0 ||
    (startsWithThreeStateData && draftUnansweredCount > 0) ||
    (hasSubmission && occurrenceIds.length > 0 && draftAnswerCount === 0);
  const checkboxSubmission = createAvailabilityCheckboxSubmission(occurrenceIds, draftForScope);
  const pendingAnswers = useThreeStateEditor ? draftForScope : checkboxSubmission;
  const pendingCounts = {
    available: occurrenceIds.filter((id) => pendingAnswers[id] === "available").length,
    unavailable: occurrenceIds.filter((id) => pendingAnswers[id] === "unavailable").length,
    unanswered: occurrenceIds.filter((id) => !Object.hasOwn(pendingAnswers, id)).length,
  };
  const hasRevisionSnapshot = rawOccurrenceIds.every((id) =>
    Number.isInteger(baseline.revisions[id]) && baseline.revisions[id] >= 0,
  );
  const currentRequest = conflictRequest || request;
  const canEdit = serverAllowsEdits && request.editable && currentRequest.editable &&
    !availabilityNeedsRefresh && !recoveryRequired && !requestUnavailable;
  const canSubmitInitialResponse = hasSubmission || !useThreeStateEditor || draftAnswerCount > 0 ||
    hasSavedAnswers || resolvedConflictIds.length > 0;
  const unresolvedConflicts = conflictingOccurrenceIds.filter((id) => !resolvedConflictIds.includes(id));
  const canSave = canEdit && (isDirty || !hasSubmission) && canSubmitInitialResponse &&
    unresolvedConflicts.length === 0 && hasRevisionSnapshot && occurrenceIds.length > 0 &&
    !saving && !isSaving && !conflictRequest;
  const getDraftChoice = (occurrenceId: string) => {
    if (unresolvedConflicts.includes(occurrenceId) && draft[occurrenceId] === undefined) return undefined;
    return getAvailabilityChoice(draft, occurrenceId);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      onDirtyChange(false);
      onSavingChange(false);
    };
  }, [onDirtyChange, onSavingChange]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange(isSaving);
  }, [isSaving, onSavingChange]);

  const applyLatest = useCallback((latest: VolunteerAvailabilityRequest) => {
    setConflictRequest(latest);
    setServerAllowsEdits(latest.editable);
    setConflictReviewOpen(false);
    setRecoveryRequired(false);
    setRecoveryError("");
    setRecoveryMessage(latest.editable
      ? "Your draft is still here. Review the latest saved answers before you try again."
      : "This request is now closed. Your previous responses are shown below.");
  }, []);

  const refreshLatest = useCallback(async ({ uncertain = false }: { uncertain?: boolean } = {}) => {
    setRecoveryError("");
    const read = await refreshAvailability();
    if (!mountedRef.current) return "failed" as const;
    if (!read) {
      setRecoveryRequired(true);
      setRecoveryError("Could not load the latest saved answers. Your draft is still here. Refresh before trying again.");
      return "failed" as const;
    }
    const latest = read.requests.find((item) => requestKey(item) === requestKey(request));
    if (!latest) {
      setRequestUnavailable(true);
      setServerAllowsEdits(false);
      setConflictRequest(null);
      setRecoveryRequired(true);
      setRecoveryMessage("This availability request is no longer available. Your unsaved responses are still here, but can't be saved.");
      return "unavailable" as const;
    }
    if (uncertain && uncertainPayloadRef.current &&
        hasAvailabilityResponseSubmission(latest) && availabilityMapsMatch(
      latest.availability,
      uncertainPayloadRef.current,
      occurrenceIds,
    )) {
      const latestAnswers = answersForScope(latest.availability, occurrenceIds);
      setBaseline({ answers: latestAnswers, revisions: { ...latest.availabilityRevision } });
      setDraft(latestAnswers);
      uncertainPayloadRef.current = null;
      setServerAllowsEdits(latest.editable);
      onSaved(latestAnswers, {
        success: true,
        submissionId: latest.submissionId,
        submittedAt: latest.respondedAt,
      }, read);
      showToast("Your saved availability is up to date.", "success");
      return "saved" as const;
    }
    applyLatest(latest);
    return "review" as const;
  }, [applyLatest, onSaved, refreshAvailability, request, occurrenceIds, showToast]);

  const submit = async () => {
    if (saveInFlightRef.current || !canSave) return;
    if (!hasRevisionSnapshot) {
      setRecoveryRequired(true);
      setRecoveryError("Refresh this request to get the latest save details before editing.");
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    setRecoveryError("");
    const submittedAnswers = copyAnswers(pendingAnswers);
    const payload: VolunteerAvailabilitySave = {
      recipientId: request.recipientId,
      availability: expandProjectedAnswers(request, submittedAnswers),
      availabilityRevision: { ...baseline.revisions },
    };
    try {
      const result = await saveAvailability(payload);
      if (!mountedRef.current) return;
      if (!result?.success || !result.submissionId) {
        throw new Error("Could not confirm that save. Refresh the latest answers before trying again.");
      }
      const read = await refreshAvailability();
      if (!mountedRef.current) return;
      onSaved(submittedAnswers, result, read);
      showToast("Availability response saved.", "success");
    } catch (error) {
      if (!mountedRef.current) return;
      const status = getApiErrorStatus(error);
      uncertainPayloadRef.current = submittedAnswers;
      setRecoveryRequired(true);
      let recovery: "failed" | "unavailable" | "saved" | "review";
      if (status === 409) {
        setRecoveryMessage("This availability changed while you were editing. Your draft is still here.");
        recovery = await refreshLatest();
      } else {
        setRecoveryMessage("We couldn't confirm that save. Your draft is still here.");
        recovery = await refreshLatest({ uncertain: true });
      }
      if (mountedRef.current && status !== 409 && recovery !== "saved") {
        showApiErrorToast(showToast, error, "Could not confirm your availability. Review the latest answers before trying again.");
      }
    } finally {
      saveInFlightRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  };

  const reviewOrSave = () => {
    if (!canSave) return;
    if (!hasSubmission) {
      setConfirmationOpen(true);
      return;
    }
    void submit();
  };

  const confirmSubmission = () => {
    setConfirmationOpen(false);
    void submit();
  };

  const chooseAvailability = (occurrenceId: string, choice: AvailabilityChoice) => {
    setDraft((current) => setAvailabilityChoice(current, occurrenceId, choice));
    if (conflictingOccurrenceIds.includes(occurrenceId)) {
      setResolvedConflictIds((current) => current.includes(occurrenceId) ? current : [...current, occurrenceId]);
    }
  };

  const reviewLatest = () => {
    if (!conflictRequest) return;
    setConflictReviewOpen(true);
  };

  const keepDraftAgainstLatest = () => {
    if (!conflictRequest?.editable) return;
    const latestAnswers = answersForScope(conflictRequest.availability, occurrenceIds);
    setBaseline({ answers: latestAnswers, revisions: { ...conflictRequest.availabilityRevision } });
    setServerAllowsEdits(true);
    setConflictRequest(null);
    setConflictReviewOpen(false);
    setRecoveryRequired(false);
    setRecoveryMessage("Latest answers reviewed. Save your draft to submit it against the current revision.");
    uncertainPayloadRef.current = null;
  };

  const useLatestAnswers = () => {
    if (!conflictRequest) return;
    const latestAnswers = answersForScope(conflictRequest.availability, occurrenceIds);
    setBaseline({ answers: latestAnswers, revisions: { ...conflictRequest.availabilityRevision } });
    setDraft(latestAnswers);
    setServerAllowsEdits(conflictRequest.editable);
    setConflictRequest(null);
    setConflictReviewOpen(false);
    setRecoveryRequired(false);
    setRecoveryMessage("");
    uncertainPayloadRef.current = null;
    showToast("Latest saved answers loaded.", "success");
  };

  return (
    <section className="space-y-4" aria-labelledby="availability-editor-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="availability-editor-title" className="text-base font-semibold text-gray-100">
            {request.name || "Availability request"}
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            {request.responseDeadline ? "Due " + formatAvailabilityDeadline(request.responseDeadline) : ""}
            {request.responseDeadline && !requestUnavailable && currentRequest.editable && hasAvailabilityResponseSubmission(currentRequest) ? " · " : ""}
            {requestUnavailable
              ? "This availability request is no longer available."
              : currentRequest.editable
                ? hasAvailabilityResponseSubmission(currentRequest) ? "Response submitted" : ""
                : "Closed"}
          </p>
          {request.availabilityMessage ? (
            <p className="mt-2 whitespace-pre-line text-sm text-gray-300">{request.availabilityMessage}</p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" className="shrink-0" onClick={onBack}>Back to requests</Button>
      </div>

      {requestUnavailable ? (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          This request is no longer available. Your unsaved responses are still here, but can't be saved.
        </p>
      ) : null}

      {recoveryMessage || recoveryError ? (
        <div role="alert" className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p>{recoveryError || recoveryMessage}</p>
          {recoveryRequired && recoveryError ? (
            <Button type="button" variant="secondary" disabled={saving || isSaving}
              isLoading={saving} onClick={() => void refreshLatest({ uncertain: Boolean(uncertainPayloadRef.current) })}>
              {saving ? "Refreshing saved answers…" : "Refresh saved answers"}
            </Button>
          ) : null}
          {conflictRequest ? (
            <div className="space-y-3">
              <Button type="button" variant="secondary" aria-expanded={conflictReviewOpen} onClick={reviewLatest}>
                {conflictReviewOpen ? "Latest answers reviewed" : "Review latest saved answers"}
              </Button>
              {conflictReviewOpen ? (
                <div className="space-y-3 rounded-md border border-gray-700 bg-gray-950/50 p-3">
                  <p className="text-sm text-gray-200">Compare the answers from when you opened this request, the latest saved answers, and your draft.</p>
                  <ul className="space-y-3">
                    {request.occurrences.map((occurrence) => {
                      const id = occurrence.occurrenceId;
                      return (
                        <li key={id} className="space-y-1 border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                          <p className="font-medium text-gray-100">{formatAvailabilityOccurrence(occurrence, serviceTimeZone)}</p>
                          <dl className="grid gap-1 text-xs sm:grid-cols-3 sm:gap-3">
                            <div><dt className="text-gray-500">When you opened it</dt><dd className="text-gray-300">{answerLabel(getAvailabilityChoice(baseline.answers, id))}</dd></div>
                            <div><dt className="text-gray-500">Latest saved</dt><dd className="text-gray-300">{answerLabel(getAvailabilityChoice(conflictRequest.availability, id))}</dd></div>
                            <div><dt className="text-gray-500">Your draft</dt><dd className="text-gray-300">{answerLabel(getAvailabilityChoice(draft, id))}</dd></div>
                          </dl>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    {conflictRequest.editable ? (
                      <Button type="button" variant="secondary" onClick={keepDraftAgainstLatest}>Keep my draft and continue</Button>
                    ) : null}
                    <Button type="button" variant="tertiary" onClick={useLatestAnswers}>Use latest answers</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasRevisionSnapshot && request.editable && !availabilityNeedsRefresh ? (
        <p role="alert" className="text-sm text-amber-200">Refresh this request before editing so the latest save details are available.</p>
      ) : null}

      {request.occurrences.length === 0 ? (
        <p className="text-sm text-gray-300">This request has no service dates.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Select services you can serve</h3>
            {useThreeStateEditor ? (
              <p className="mt-1 text-xs text-gray-400">Not answered stays unanswered when you save.</p>
            ) : null}
          </div>

          {!useThreeStateEditor ? (
            <>
              <AvailabilitySelectionToolbar
                organizeMode={organizeMode}
                onOrganizeChange={setOrganizeMode}
                selectionLabel={`${draftAvailableCount} of ${occurrenceIds.length} selected`}
                selectAllDisabled={!canEdit || isSaving || saving || confirmationOpen || draftAvailableCount === occurrenceIds.length}
                onSelectAll={() => setDraft(Object.fromEntries(
                  occurrenceIds.map((id) => [id, "available" as const]),
                ))}
              />
              <fieldset disabled={!canEdit || isSaving || saving || confirmationOpen} className="min-w-0 space-y-4">
                <legend className="sr-only">Available services</legend>
                {occurrenceGroups.map((group) => (
                  <section key={group.key} aria-label={group.label} className="space-y-2">
                    <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-200">
                      {group.label}
                      {group.occurrences.filter((occurrence) => isAvailabilityOccurrencePast(occurrence)).length ? (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
                          {group.occurrences.filter((occurrence) => isAvailabilityOccurrencePast(occurrence)).length} past
                        </span>
                      ) : null}
                    </h4>
                    <ul className={SERVICE_OCCURRENCE_GRID_CLASS_NAME}>
                      {group.occurrences.map((occurrence) => {
                        const dateTime = formatAvailabilityOccurrence(occurrence, serviceTimeZone);
                        const visibleTime = organizeMode === "byDate"
                          ? formatAvailabilityOccurrenceTime(occurrence, serviceTimeZone)
                          : dateTime;
                        const isSelected = draft[occurrence.occurrenceId] === "available";
                        return (
                          <li key={occurrence.occurrenceId} className="min-w-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => setDraft((current) => setAvailabilityChoice(current, occurrence.occurrenceId, checked ? "available" : "unavailable"))}
                              label={<span className="flex min-w-0 flex-col gap-1">
                                <span className="whitespace-normal break-words font-semibold leading-snug">{occurrence.name || "Service"}</span>
                                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                                  {visibleTime ? <time dateTime={occurrence.startsAt}>{visibleTime}</time> : null}
                                </span>
                              </span>}
                              aria-label={`${occurrence.name || "Service"} · ${dateTime}`}
                              className={cn(
                                "min-h-[76px] max-md:min-h-[76px] w-full items-start rounded-lg border p-3 text-left transition-colors focus-within:ring-2 focus-within:ring-teal-300",
                                isSelected
                                  ? "border-teal-400/70 bg-teal-950/45 shadow-sm"
                                  : "border-gray-700 bg-gray-900/50 hover:border-gray-500 hover:bg-gray-900/80",
                              )}
                              labelClassName="py-1"
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </fieldset>
              {hasSubmission || hasSavedAnswers ? (
                <Button type="button" variant="textLink" disabled={!canEdit || isSaving || saving || confirmationOpen}
                  onClick={() => setDetailedEditing(true)}>
                  Edit individual answer states
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {detailedEditing && draftUnansweredCount === 0 && draftAnswerCount === occurrenceIds.length ? (
                <Button type="button" variant="textLink" disabled={!canEdit || isSaving || saving || confirmationOpen}
                  onClick={() => setDetailedEditing(false)}>
                  Use service checkboxes
                </Button>
              ) : null}
              <AvailabilitySelectionToolbar
                organizeMode={organizeMode}
                onOrganizeChange={setOrganizeMode}
                selectionLabel={`${draftAnswerCount} of ${occurrenceIds.length} answered`}
              />
              <fieldset disabled={!canEdit || isSaving || saving || confirmationOpen} className="min-w-0 space-y-4">
                <legend className="sr-only">Availability for each service</legend>
                {occurrenceGroups.map((group) => (
                  <section key={group.key} aria-label={group.label} className="space-y-2">
                    <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-200">
                      {group.label}
                      {group.occurrences.filter((occurrence) => isAvailabilityOccurrencePast(occurrence)).length ? (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
                          {group.occurrences.filter((occurrence) => isAvailabilityOccurrencePast(occurrence)).length} past
                        </span>
                      ) : null}
                    </h4>
                    <ul className={SERVICE_OCCURRENCE_GRID_CLASS_NAME}>
                      {group.occurrences.map((occurrence) => {
                        const dateTime = formatAvailabilityOccurrence(occurrence, serviceTimeZone);
                        const visibleTime = organizeMode === "byDate"
                          ? formatAvailabilityOccurrenceTime(occurrence, serviceTimeZone)
                          : dateTime;
                        return (
                          <li key={occurrence.occurrenceId} className="min-w-0">
                            <fieldset className="min-w-0 rounded-lg border border-gray-700/80 bg-gray-900/35 p-3 sm:p-4">
                              <legend className="max-w-full px-1 text-sm font-semibold text-gray-100">
                                <span className="whitespace-normal break-words">{occurrence.name || "Service"}</span>
                                <span className="block text-xs font-normal text-gray-400">
                                  {visibleTime ? <time dateTime={occurrence.startsAt}>{visibleTime}</time> : null}
                                </span>
                              </legend>
                              {conflictingOccurrenceIds.includes(occurrence.occurrenceId) ? (
                                <p className="px-1 text-xs text-amber-200">
                                  {currentRequest.editable
                                    ? "Saved answers conflict. Choose an option to reconcile this service."
                                    : "Saved answers conflict. Ask your team administrator to review this request."}
                                </p>
                              ) : null}
                              <div role="radiogroup" aria-label={"Availability for " + (occurrence.name || "service") + " on " + dateTime}
                                className="grid gap-2 pt-1 sm:grid-cols-3">
                                {([
                                  ["available", "Available"],
                                  ["unavailable", "Unavailable"],
                                  ["not-answered", "Not answered"],
                                ] as const).map(([choice, label]) => (
                                  <label key={choice} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-gray-700 bg-gray-900/50 px-2.5 py-2 text-sm text-gray-200 has-[:checked]:border-teal-400/60 has-[:checked]:bg-teal-950/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-300">
                                    <input
                                      type="radio"
                                      name={"availability-" + request.formId + "-" + occurrence.occurrenceId}
                                      value={choice}
                                      checked={getDraftChoice(occurrence.occurrenceId) === choice}
                                      onChange={() => chooseAvailability(occurrence.occurrenceId, choice)}
                                      className="size-4 accent-teal-400"
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </fieldset>
            </>
          )}
        </div>
      )}

      {currentRequest.editable && availabilityNeedsRefresh && !recoveryError ? (
        <p className="text-sm text-gray-400">Your draft is kept. Refresh the latest saved answers before trying again.</p>
      ) : null}
      {currentRequest.editable && availabilityNeedsRefresh && !recoveryError ? (
        <Button type="button" variant="secondary" disabled={saving || isSaving} isLoading={saving}
          onClick={() => void refreshLatest({ uncertain: Boolean(uncertainPayloadRef.current) })}>
          {saving ? "Refreshing saved answers…" : "Refresh saved answers"}
        </Button>
      ) : null}
      {!currentRequest.editable ? (
        <p className="rounded-md border border-gray-700 bg-gray-900/40 p-3 text-sm text-gray-300">
          This availability request is closed. Your previous responses are shown below.
        </p>
      ) : null}
      {currentRequest.editable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="cta" disabled={!canSave} isLoading={saving || isSaving}
            aria-busy={saving || isSaving} onClick={reviewOrSave}>
            {saving || isSaving ? "Saving availability…" : hasSubmission ? "Save response" : "Review response"}
          </Button>
          {isDirty ? <span className="text-xs text-gray-400">Unsaved changes</span> : null}
          {saving || isSaving ? <span role="status" aria-live="polite" className="sr-only">Saving availability responses…</span> : null}
        </div>
      ) : null}

      <Modal
        isOpen={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        title="Confirm your availability"
        size="sm"
        contentPadding="px-4 pb-4 pt-0"
      >
        <p className="mb-3 text-sm text-gray-200">
          {pendingCounts.available === 0 && pendingCounts.unanswered === 0
            ? "You haven't selected any services. Are you unavailable for all of them?"
            : `You're about to submit ${pendingCounts.available} available, ${pendingCounts.unavailable} unavailable${pendingCounts.unanswered ? `, and ${pendingCounts.unanswered} unanswered` : ""} services.`}
        </p>
        <p className="mb-6 text-xs text-gray-400">
          {pendingCounts.available} available · {pendingCounts.unavailable} unavailable · {pendingCounts.unanswered} unanswered
        </p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setConfirmationOpen(false)}>Cancel</Button>
          <Button type="button" variant="cta" disabled={saving || isSaving} isLoading={saving || isSaving}
            onClick={confirmSubmission}>
            Submit response
          </Button>
        </div>
      </Modal>
    </section>
  );
};

const preferenceSnapshot = (preferences: VolunteerSchedulingPreferences | null) => ({
  servingFrequency: preferences?.servingFrequency || DEFAULT_SERVING_FREQUENCY,
  recurringAvailability: preferences?.recurringAvailability || emptyRecurringAvailability(),
  updatedAt: preferences?.updatedAt || "",
});

const preferenceValuesMatch = (
  first: ReturnType<typeof preferenceSnapshot>,
  second: ReturnType<typeof preferenceSnapshot>,
) => first.servingFrequency === second.servingFrequency &&
  first.recurringAvailability.includeLastWeekOfMonth === second.recurringAvailability.includeLastWeekOfMonth &&
  [...first.recurringAvailability.weeksOfMonth].sort().join(",") ===
    [...second.recurringAvailability.weeksOfMonth].sort().join(",");

const SchedulingPreferencesPanel = ({
  preferences,
  loading,
  savePreferences,
  refreshPreferences,
  onSaved,
}: {
  preferences: VolunteerSchedulingPreferences | null;
  loading: boolean;
  savePreferences?: (request: VolunteerSchedulingPreferencesSave) => Promise<{
    success: boolean;
    schedulingPreferences: VolunteerSchedulingPreferences;
  }>;
  refreshPreferences: () => Promise<VolunteerSchedulingPreferences | null>;
  onSaved: (preferences: VolunteerSchedulingPreferences) => void;
}) => {
  const { setDirtySource, setSavingSource } = useVolunteerNavigationGuard();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => preferenceSnapshot(preferences));
  const [baseline, setBaseline] = useState(() => preferenceSnapshot(preferences));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rejectedAsStale, setRejectedAsStale] = useState(false);
  const [conflictLatest, setConflictLatest] = useState<VolunteerSchedulingPreferences | null>(null);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const latestBaseline = preferenceSnapshot(conflictLatest || preferences);
  const isDirty = !preferenceValuesMatch(draft, baseline);
  const hasConflict = editing && (rejectedAsStale || Boolean(
    preferences && preferences.updatedAt !== baseline.updatedAt,
  ));
  const canSave = Boolean(savePreferences && editing && isDirty && !saving && !hasConflict);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setDirtySource("my-scheduling-preferences", editing && isDirty);
    return () => setDirtySource("my-scheduling-preferences", false);
  }, [editing, isDirty, setDirtySource]);

  useEffect(() => {
    setSavingSource("my-scheduling-preferences", saving);
    return () => setSavingSource("my-scheduling-preferences", false);
  }, [saving, setSavingSource]);

  useEffect(() => {
    if (editing) return;
    const next = preferenceSnapshot(preferences);
    setDraft(next);
    setBaseline(next);
  }, [editing, preferences]);

  const beginEditing = () => {
    const current = preferenceSnapshot(preferences);
    setDraft(current);
    setBaseline(current);
    setError("");
    setRejectedAsStale(false);
    setConflictLatest(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (saving) return;
    const current = preferenceSnapshot(preferences);
    setDraft(current);
    setBaseline(current);
    setEditing(false);
    setError("");
    setRejectedAsStale(false);
    setConflictLatest(null);
  };

  const refreshLatest = async () => {
    if (refreshing) return null;
    setRefreshing(true);
    setError("");
    try {
      const latest = await refreshPreferences();
      if (mountedRef.current && latest) {
        setConflictLatest(latest);
        setRejectedAsStale(true);
      } else if (mountedRef.current) {
        setError("Could not load the latest saved preferences. Your edits are still here.");
      }
      return latest;
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  };

  const save = async () => {
    if (!canSave || !savePreferences || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await savePreferences({
        servingFrequency: draft.servingFrequency,
        recurringAvailability: {
          weeksOfMonth: [...draft.recurringAvailability.weeksOfMonth].sort(),
          includeLastWeekOfMonth: draft.recurringAvailability.includeLastWeekOfMonth,
        },
        expectedUpdatedAt: baseline.updatedAt,
      });
      if (!mountedRef.current) return;
      if (!result?.success || !result.schedulingPreferences) {
        throw new Error("Could not confirm your scheduling preferences were saved.");
      }
      const saved = preferenceSnapshot(result.schedulingPreferences);
      setDraft(saved);
      setBaseline(saved);
      setEditing(false);
      setRejectedAsStale(false);
      setConflictLatest(null);
      onSaved(result.schedulingPreferences);
      showToast("Scheduling preferences saved.", "success");
    } catch (saveError) {
      if (!mountedRef.current) return;
      if (getApiErrorStatus(saveError) === 409) {
        setRejectedAsStale(true);
        setError("Your saved preferences changed while you were editing. Your edits are still here.");
        try {
          const latest = await refreshPreferences();
          if (mountedRef.current && latest) setConflictLatest(latest);
        } catch {
          if (mountedRef.current) setError("Your saved preferences changed while you were editing. Your edits are still here. Refresh the latest values before saving.");
        }
      } else {
        setError("We couldn't confirm that save. Your edits are still here; checking the latest saved preferences.");
        try {
          const latest = await refreshPreferences();
          if (!mountedRef.current) return;
          if (!latest) {
            setRejectedAsStale(true);
            setError("We couldn't confirm that save or load the latest preferences. Your edits are still here.");
          } else if (latest.updatedAt !== baseline.updatedAt) {
            const latestValues = preferenceSnapshot(latest);
            if (preferenceValuesMatch(latestValues, draft)) {
              setDraft(latestValues);
              setBaseline(latestValues);
              setEditing(false);
              setRejectedAsStale(false);
              setConflictLatest(null);
              onSaved(latest);
              showToast("Scheduling preferences are up to date.", "success");
            } else {
              setRejectedAsStale(true);
              setConflictLatest(latest);
              setError("Your save may have completed, but newer preferences are now stored. Review the latest values before saving again.");
            }
          } else {
            setError("We couldn't confirm that save. Your edits are still here and the saved revision is unchanged, so you can retry.");
            showApiErrorToast(showToast, saveError, "Could not save your scheduling preferences.");
          }
        } catch {
          if (mountedRef.current) {
            setRejectedAsStale(true);
            setError("We couldn't confirm that save or load the latest preferences. Your edits are still here.");
          }
        }
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const keepDraft = () => {
    if (!hasConflict) return;
    setBaseline(latestBaseline);
    setRejectedAsStale(false);
    setConflictLatest(null);
    setError("Latest saved values reviewed. Save your edits again to replace them.");
  };

  const useLatest = () => {
    if (!hasConflict) return;
    setDraft(latestBaseline);
    setBaseline(latestBaseline);
    setRejectedAsStale(false);
    setConflictLatest(null);
    setError("");
    setEditing(false);
  };

  const summary = preferenceSnapshot(preferences);
  const weekSummary = recurringAvailabilityLabel(summary.recurringAvailability);

  return (
    <section aria-labelledby="scheduling-preferences-heading" className="space-y-3 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="scheduling-preferences-heading" tabIndex={-1} className="text-sm font-semibold text-gray-100">Scheduling preferences</h2>
          {preferences ? (
            <p className="mt-1 text-sm text-gray-300">
              <span>{servingFrequencyLabel(summary.servingFrequency)}</span>{" "}
              <span aria-hidden="true">·</span>{" "}
              <span>{weekSummary}</span>
            </p>
          ) : <p className="mt-1 text-sm text-gray-400">
            {loading ? "Loading saved preferences…" : "Preferences are unavailable right now."}
          </p>}
        </div>
        {preferences && savePreferences && !editing ? (
          <Button type="button" variant="secondary" onClick={beginEditing}>Edit preferences</Button>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-4 border-t border-gray-700 pt-3">
          <Select
            label="Serving frequency"
            value={draft.servingFrequency}
            options={servingFrequencyOptions}
            disabled={saving}
            onChange={(value) => setDraft((current) => ({ ...current, servingFrequency: value as typeof current.servingFrequency }))}
          />
          <fieldset disabled={saving} className="space-y-2">
            <legend className="pb-1 text-sm font-semibold text-gray-200">Recurring availability weeks</legend>
            <p className="text-xs text-gray-400">An empty selection allows every week. These weeks remain scheduling eligibility rules.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recurringAvailabilityWeekOptions.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={draft.recurringAvailability.weeksOfMonth.includes(option.value)}
                  onCheckedChange={(checked) => setDraft((current) => ({
                    ...current,
                    recurringAvailability: {
                      ...current.recurringAvailability,
                      weeksOfMonth: checked
                        ? [...new Set([...current.recurringAvailability.weeksOfMonth, option.value])].sort()
                        : current.recurringAvailability.weeksOfMonth.filter((week) => week !== option.value),
                    },
                  }))}
                  label={option.label}
                  className="min-h-[44px] rounded-md border border-gray-700 bg-gray-950/40 px-3 py-2"
                />
              ))}
              <Checkbox
                checked={draft.recurringAvailability.includeLastWeekOfMonth}
                onCheckedChange={(checked) => setDraft((current) => ({
                  ...current,
                  recurringAvailability: { ...current.recurringAvailability, includeLastWeekOfMonth: checked },
                }))}
                label="Last week of the month"
                className="min-h-[44px] rounded-md border border-gray-700 bg-gray-950/40 px-3 py-2"
              />
            </div>
          </fieldset>
          {hasConflict ? (
            <div role="alert" className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p>{error || "Your saved preferences changed while you were editing. Review the latest values before saving."}</p>
              <p>Latest saved: {servingFrequencyLabel(latestBaseline.servingFrequency)} · {recurringAvailabilityLabel(latestBaseline.recurringAvailability)}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={!conflictLatest} onClick={keepDraft}>Keep my edits</Button>
                <Button type="button" variant="tertiary" disabled={!conflictLatest} onClick={useLatest}>Use latest values</Button>
              </div>
              {!conflictLatest ? (
                <Button type="button" variant="secondary" disabled={saving || refreshing} isLoading={refreshing} onClick={() => void refreshLatest()}>
                  {refreshing ? "Refreshing preferences…" : "Refresh latest values"}
                </Button>
              ) : null}
            </div>
          ) : error ? <p role="alert" className="text-sm text-amber-200">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="cta" disabled={!canSave} isLoading={saving} onClick={() => void save()}>
              {saving ? "Saving preferences…" : "Save preferences"}
            </Button>
            <Button type="button" variant="tertiary" disabled={saving} onClick={cancelEditing}>Cancel</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

type AvailabilityWorkspaceSectionsProps = {
  churchId: string;
  ownerKey: string;
  operations: VolunteerAvailabilityOperations;
  fallbackPreferences: VolunteerSchedulingPreferences | null;
  initialRecipientId?: string;
  focusAvailability: boolean;
};

const summaryFromRequest = (request: VolunteerAvailabilityRequest): VolunteerAvailabilityRequestSummary => ({
  recipientId: request.recipientId,
  formId: request.formId,
  name: request.name,
  responseDeadline: request.responseDeadline,
  respondedAt: request.respondedAt,
  submissionId: request.submissionId,
  editable: request.editable,
});

const AvailabilityWorkspaceSectionsView = ({
  churchId,
  ownerKey,
  operations,
  fallbackPreferences,
  initialRecipientId,
  focusAvailability,
}: AvailabilityWorkspaceSectionsProps) => {
  const { requestDiscardAction, setDirtySource, setSavingSource } = useVolunteerNavigationGuard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [requestSummaries, setRequestSummaries] = useState<VolunteerAvailabilityRequestSummary[]>([]);
  const [summaryPreferences, setSummaryPreferences] = useState<VolunteerSchedulingPreferences | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [serviceTimeZone, setServiceTimeZone] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saveRecoveryMessage, setSaveRecoveryMessage] = useState("");
  const [pastRequests, setPastRequests] = useState<VolunteerAvailabilityRequestSummary[] | null>(null);
  const [pastRequestsVisible, setPastRequestsVisible] = useState(false);
  const [pastRequestsLoading, setPastRequestsLoading] = useState(false);
  const [pastRequestsError, setPastRequestsError] = useState("");
  const [pastRequestToRetry, setPastRequestToRetry] = useState<VolunteerAvailabilityRequestSummary | null>(null);
  const [openingRecipientId, setOpeningRecipientId] = useState("");
  const [requestToRetry, setRequestToRetry] = useState<VolunteerAvailabilityRequestSummary | null>(null);
  const [openRequestError, setOpenRequestError] = useState("");
  const [editorRequest, setEditorRequest] = useState<VolunteerAvailabilityRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const readSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const pastReadSequenceRef = useRef(0);
  const openRequestSequenceRef = useRef(0);
  const initialLoadOwnerRef = useRef("");
  const initialDetailRecipientRef = useRef("");
  const summaryMutationSequenceRef = useRef(0);
  const preferencesMutationSequenceRef = useRef(0);
  const summaryMutationByKeyRef = useRef(new Map<string, number>());
  const requestsRef = useRef<HTMLElement | null>(null);
  const preferencesRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const didFocusRef = useRef(false);
  const activeRequest = editorRequest;
  const schedulingPreferences = summaryLoaded ? summaryPreferences : fallbackPreferences;

  const updateDirty = useCallback((dirty: boolean) => {
    setDirtySource("my-availability-response", dirty);
  }, [setDirtySource]);

  const updateSaving = useCallback((isSaving: boolean) => {
    setSavingSource("my-availability-response", isSaving);
    setSaving(isSaving);
  }, [setSavingSource]);

  const markSummaryMutation = useCallback((request: VolunteerAvailabilityRequestSummary) => {
    const key = requestKey(request);
    const sequence = ++summaryMutationSequenceRef.current;
    summaryMutationByKeyRef.current.set(key, sequence);
    setRequestSummaries((current) => request.editable
      ? [...current.filter((item) => requestKey(item) !== key), request]
      : current.filter((item) => requestKey(item) !== key));
  }, []);

  const loadSummary = useCallback(async ({ initial = false }: { initial?: boolean } = {}) => {
    if (!churchId) {
      setLoadError("Your church could not be loaded. Refresh the page and try again.");
      if (initial) setLoadState("error");
      return null;
    }
    const sequence = ++readSequenceRef.current;
    const requestedOwner = ownerKey;
    const startedMutationSequence = summaryMutationSequenceRef.current;
    const startedPreferencesMutationSequence = preferencesMutationSequenceRef.current;
    if (initial) setLoadState("loading");
    else setRefreshing(true);
    setLoadError("");
    try {
      const result = await operations.loadAvailability({ summary: true });
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== readSequenceRef.current) return null;
      if (!result?.success || !Array.isArray(result.requestSummaries)) {
        throw new Error("Could not load your availability requests.");
      }

      const incoming = result.requestSummaries.filter((request) => request.editable);
      setRequestSummaries((current) => {
        const incomingByKey = new Map(incoming.map((request) => [requestKey(request), request]));
        const merged = incoming.flatMap((request) => {
          const key = requestKey(request);
          const mutationSequence = summaryMutationByKeyRef.current.get(key) || 0;
          if (mutationSequence <= startedMutationSequence) return [request];
          const mutation = current.find((item) => requestKey(item) === key);
          return mutation ? [mutation] : [];
        });
        current.forEach((request) => {
          const key = requestKey(request);
          const mutationSequence = summaryMutationByKeyRef.current.get(key) || 0;
          if (mutationSequence > startedMutationSequence && !incomingByKey.has(key) && request.editable) merged.push(request);
        });
        return merged;
      });
      if (preferencesMutationSequenceRef.current === startedPreferencesMutationSequence) {
        setSummaryPreferences(result.schedulingPreferences || null);
      }
      setSummaryLoaded(true);
      setServiceTimeZone(result.serviceTimeZone || null);
      setLoadState("ready");
      return result;
    } catch (error) {
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== readSequenceRef.current) return null;
      const message = error instanceof Error && error.message
        ? error.message
        : "Could not load your availability requests. Try again.";
      setLoadError(message);
      if (initial) setLoadState("error");
      return null;
    } finally {
      if (mountedRef.current && ownerKeyRef.current === requestedOwner && sequence === readSequenceRef.current) {
        setRefreshing(false);
      }
    }
  }, [churchId, operations, ownerKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (initialLoadOwnerRef.current === ownerKey) return;
    initialLoadOwnerRef.current = ownerKey;
    void loadSummary({ initial: true });
  }, [loadSummary, ownerKey]);

  const refreshAvailability = useCallback(async (recipientId: string) => {
    const sequence = ++detailSequenceRef.current;
    const requestedOwner = ownerKey;
    try {
      const result = await operations.loadAvailability({ recipientId });
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== detailSequenceRef.current) return null;
      if (!result?.success || !Array.isArray(result.requests)) throw new Error("Could not load the latest saved answers.");
      const current = result.requests.find((request) => request.recipientId === recipientId) || null;
      if (current) {
        markSummaryMutation(summaryFromRequest(current));
        if (result.serviceTimeZone) setServiceTimeZone(result.serviceTimeZone);
      } else {
        const existing = requestSummaries.find((request) => request.recipientId === recipientId);
        if (existing) markSummaryMutation({ ...existing, editable: false });
      }
      return result;
    } catch {
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== detailSequenceRef.current) return null;
      return null;
    }
  }, [markSummaryMutation, operations, ownerKey, requestSummaries]);

  const refreshPreferences = useCallback(async () => {
    const read = await loadSummary();
    return read?.schedulingPreferences || null;
  }, [loadSummary]);

  const loadPastRequests = useCallback(async () => {
    setPastRequestsVisible(true);
    setPastRequestsError("");
    if (pastRequests) return;
    const sequence = ++pastReadSequenceRef.current;
    const requestedOwner = ownerKey;
    setPastRequestsLoading(true);
    try {
      const result = await operations.loadAvailability({ summary: true, history: true });
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner ||
          sequence !== pastReadSequenceRef.current) return;
      if (!result?.success || !Array.isArray(result.requestSummaries)) {
        throw new Error("Could not load past availability requests.");
      }
      setPastRequests(result.requestSummaries.filter((request) => !request.editable));
      if (result.serviceTimeZone) setServiceTimeZone(result.serviceTimeZone);
    } catch (error) {
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner ||
          sequence !== pastReadSequenceRef.current) return;
      setPastRequestsError(error instanceof Error && error.message
        ? error.message
        : "Could not load past availability requests. Try again.");
    } finally {
      if (mountedRef.current && ownerKeyRef.current === requestedOwner &&
          sequence === pastReadSequenceRef.current) setPastRequestsLoading(false);
    }
  }, [operations, ownerKey, pastRequests]);

  const openRequest = useCallback(async (summary: VolunteerAvailabilityRequestSummary) => {
    if (openingRecipientId) return;
    const sequence = ++openRequestSequenceRef.current;
    const requestedOwner = ownerKey;
    setOpeningRecipientId(summary.recipientId);
    setRequestToRetry(summary);
    setOpenRequestError("");
    setSaveRecoveryMessage("");
    setPastRequestsError("");
    try {
      const result = await refreshAvailability(summary.recipientId);
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner ||
          sequence !== openRequestSequenceRef.current) return;
      const fullRequest = result?.requests.find((candidate) => candidate.recipientId === summary.recipientId) || null;
      if (!result) {
        setOpenRequestError("Could not load this availability request. Your schedule is still available; try again.");
        return;
      }
      if (!fullRequest) {
        markSummaryMutation({ ...summary, editable: false });
        setPastRequests((current) => current?.filter((candidate) => candidate.recipientId !== summary.recipientId) ?? current);
        setRequestToRetry(null);
        setPastRequestToRetry(null);
        setOpenRequestError("This availability request is no longer available. It was removed from the list.");
        return;
      }
      if (fullRequest.editable) {
        setPastRequests((current) => current?.filter((candidate) => candidate.recipientId !== fullRequest.recipientId) ?? current);
      }
      setRequestToRetry(null);
      setEditorRequest(fullRequest);
      updateDirty(false);
    } catch (error) {
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner ||
          sequence !== openRequestSequenceRef.current) return;
      setOpenRequestError(error instanceof Error && error.message
        ? error.message
        : "Could not open this availability request. Try again.");
    } finally {
      if (mountedRef.current && ownerKeyRef.current === requestedOwner &&
          sequence === openRequestSequenceRef.current) setOpeningRecipientId("");
    }
  }, [markSummaryMutation, openingRecipientId, ownerKey, refreshAvailability, updateDirty]);

  const handleSaved = useCallback((
    _answers: AnswerMap,
    result: VolunteerAvailabilitySaveResult,
    read: VolunteerAvailabilityRead | null,
  ) => {
    const savedRequest = editorRequest;
    if (read) {
      const detail = savedRequest && read.requests.find((request) => requestKey(request) === requestKey(savedRequest));
      if (detail) markSummaryMutation({
        ...summaryFromRequest(detail),
        submissionId: detail.submissionId || result.submissionId,
        respondedAt: detail.respondedAt || result.submittedAt || savedRequest.respondedAt,
      });
      if (read.serviceTimeZone) setServiceTimeZone(read.serviceTimeZone);
      setSaveRecoveryMessage("");
    } else if (savedRequest) {
      markSummaryMutation({
        ...summaryFromRequest(savedRequest),
        submissionId: result.submissionId,
        respondedAt: result.submittedAt || savedRequest.respondedAt,
      });
      setSaveRecoveryMessage("Your response was saved. Open the request again to load the latest answers before editing.");
    }
    setEditorRequest(null);
    updateDirty(false);
    updateSaving(false);
  }, [editorRequest, markSummaryMutation, updateDirty, updateSaving]);

  const openRequestAfterGuard = (request: VolunteerAvailabilityRequestSummary) => {
    requestDiscardAction(() => {
      void openRequest(request);
    });
  };

  const closeEditor = () => requestDiscardAction(() => {
    setEditorRequest(null);
    setRequestToRetry(null);
    updateDirty(false);
    if (initialRecipientId && searchParams.has("availabilityRequest")) {
      const next = new URLSearchParams(searchParams);
      next.delete("availabilityRequest");
      setSearchParams(next, { replace: true });
    }
  });

  useEffect(() => {
    if (!initialRecipientId || initialDetailRecipientRef.current === initialRecipientId) return;
    initialDetailRecipientRef.current = initialRecipientId;
    const summary = requestSummaries.find((request) => request.recipientId === initialRecipientId) || {
      recipientId: initialRecipientId,
      formId: "",
      name: "Availability request",
      responseDeadline: "",
      respondedAt: "",
      submissionId: "",
      editable: true,
    };
    void openRequest(summary);
  }, [initialRecipientId, openRequest, requestSummaries]);

  useEffect(() => {
    if (!focusAvailability || didFocusRef.current || loadState === "loading") return;
    if (initialRecipientId && !activeRequest && !openRequestError) return;
    const target = activeRequest
      ? editorRef.current
      : requestSummaries.length || pastRequestsVisible
        ? requestsRef.current
        : preferencesRef.current;
    if (!target) return;
    target.scrollIntoView?.({ block: "start" });
    const heading = target.querySelector<HTMLElement>("h2");
    heading?.focus({ preventScroll: true });
    didFocusRef.current = true;
  }, [activeRequest, focusAvailability, initialRecipientId, loadState, openRequestError, pastRequestsVisible, requestSummaries.length]);

  const activeRequests = requestSummaries.filter((request) => request.editable).sort((a, b) => {
    const aSubmitted = hasAvailabilityResponseSubmission(a);
    const bSubmitted = hasAvailabilityResponseSubmission(b);
    if (aSubmitted !== bSubmitted) return Number(aSubmitted) - Number(bSubmitted);
    return (a.responseDeadline || "").localeCompare(b.responseDeadline || "") || a.name.localeCompare(b.name);
  });

  const preferenceLoading = !summaryLoaded && !fallbackPreferences && loadState === "loading";
  const retryOpenRequest = requestToRetry;

  return (
    <div className="space-y-4">
      <div ref={preferencesRef}>
        <SchedulingPreferencesPanel
          preferences={schedulingPreferences}
          loading={preferenceLoading}
          savePreferences={operations.saveSchedulingPreferences}
          refreshPreferences={refreshPreferences}
          onSaved={(preferences) => {
            preferencesMutationSequenceRef.current += 1;
            setSummaryPreferences(preferences);
            setSummaryLoaded(true);
          }}
        />
      </div>

      {loadState === "loading" ? (
        <div role="status" aria-live="polite" className="space-y-2 text-sm text-gray-400">
          <p>Checking availability requests…</p>
          <div aria-hidden="true" className="h-12 animate-pulse rounded-md bg-gray-800/70" />
        </div>
      ) : null}
      {loadState === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
          <p>{loadError || "Could not load your availability requests. Try again."}</p>
          <Button type="button" variant="secondary" disabled={refreshing} isLoading={refreshing}
            onClick={() => void loadSummary({ initial: true })}>
            {refreshing ? "Refreshing…" : "Retry"}
          </Button>
        </div>
      ) : null}
      {saveRecoveryMessage ? (
        <p role="status" className="text-sm text-amber-200">{saveRecoveryMessage}</p>
      ) : null}

      {activeRequest ? (
        <section ref={editorRef} className="scroll-mt-4">
          <AvailabilityRequestEditor
            key={ownerKey + ":" + requestKey(activeRequest)}
            request={activeRequest}
            serviceTimeZone={serviceTimeZone}
            saving={saving}
            availabilityNeedsRefresh={false}
            saveAvailability={operations.saveAvailability}
            refreshAvailability={() => refreshAvailability(activeRequest.recipientId)}
            onSavingChange={updateSaving}
            onDirtyChange={updateDirty}
            onSaved={handleSaved}
            onBack={closeEditor}
          />
        </section>
      ) : (
        <>
          {activeRequests.length ? (
            <section ref={requestsRef} aria-labelledby="availability-requests-heading" className="scroll-mt-4 space-y-2">
              <h2 id="availability-requests-heading" tabIndex={-1} className="text-sm font-semibold text-gray-100">Availability requests</h2>
              <ul className="space-y-2">
                {activeRequests.map((request) => (
                  <RequestCard
                    key={requestKey(request)}
                    request={request}
                    onOpen={() => openRequestAfterGuard(request)}
                    disabled={Boolean(openingRecipientId)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {openRequestError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-200">
              <p>{openRequestError}</p>
              {retryOpenRequest ? (
                <Button type="button" variant="secondary" disabled={Boolean(openingRecipientId)}
                  isLoading={openingRecipientId === retryOpenRequest.recipientId}
                  onClick={() => void openRequest(retryOpenRequest)}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}

          {loadState === "ready" && !activeRequests.length && !pastRequestsVisible ? (
            <div className="flex justify-start">
              <Button type="button" variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs text-gray-400 underline underline-offset-2"
                aria-expanded={false} disabled={pastRequestsLoading}
                onClick={() => void loadPastRequests()}>
                Show past availability requests
              </Button>
            </div>
          ) : null}

          {activeRequests.length ? (
            <Button
              type="button"
              variant="tertiary"
              className="h-auto min-h-0 px-0 py-0 text-xs text-gray-400 underline underline-offset-2 hover:text-gray-200"
              aria-expanded={pastRequestsVisible}
              disabled={pastRequestsLoading || Boolean(openingRecipientId)}
              isLoading={pastRequestsLoading}
              onClick={() => {
                if (pastRequestsVisible) setPastRequestsVisible(false);
                else void loadPastRequests();
              }}
            >
              {pastRequestsVisible ? "Hide past requests" : "Show past requests"}
            </Button>
          ) : null}

          {pastRequestsVisible ? (
            <section aria-label="Past availability requests" className="space-y-2">
              {pastRequestsLoading ? <p role="status" className="text-sm text-gray-400">Loading past requests…</p> : null}
              {pastRequestsError ? (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
                  <p>{pastRequestsError}</p>
                  <Button type="button" variant="secondary" disabled={pastRequestsLoading || Boolean(openingRecipientId)}
                    onClick={() => pastRequestToRetry
                      ? void openRequest(pastRequestToRetry)
                      : void loadPastRequests()}>
                    Try again
                  </Button>
                </div>
              ) : null}
              {pastRequests && pastRequests.length === 0 && !pastRequestsLoading ? (
                <p className="text-xs text-gray-400">No past requests.</p>
              ) : null}
              {pastRequests?.length ? (
                <ul className="space-y-2">
                  {pastRequests.map((request) => (
                    <li key={request.formId + ":" + request.recipientId}>
                      <Button type="button" variant="secondary" className="w-full justify-between gap-3 text-left"
                        disabled={pastRequestsLoading || Boolean(openingRecipientId)}
                        isLoading={openingRecipientId === request.recipientId}
                        onClick={() => {
                          setPastRequestToRetry(request);
                          void openRequest(request);
                        }}>
                        <span className="min-w-0">
                          <span className="block truncate">{request.name || "Availability request"}</span>
                          <span className="block text-xs text-gray-400">
                            {hasAvailabilityResponseSubmission(request) ? "Response submitted" : "No response submitted"}
                            {request.responseDeadline ? " · Closed " + formatAvailabilityDeadline(request.responseDeadline) : " · Closed"}
                          </span>
                        </span>
                        <span aria-hidden="true">›</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button type="button" variant="tertiary" className="h-auto min-h-0 px-0 py-0 text-xs text-gray-400 underline underline-offset-2"
                aria-expanded={pastRequestsVisible} onClick={() => setPastRequestsVisible(false)}>
                Hide past requests
              </Button>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};

export const VolunteerAvailabilitySections = ({
  access,
  ownerKey,
  churchId: churchIdOverride,
  fallbackPreferences = null,
  initialRecipientId,
  focusAvailability = false,
  navigationGuardProvided = false,
}: {
  access?: PersonalScheduleAccess;
  churchId?: string;
  ownerKey?: string;
  fallbackPreferences?: VolunteerSchedulingPreferences | null;
  initialRecipientId?: string;
  focusAvailability?: boolean;
  navigationGuardProvided?: boolean;
}) => {
  const context = useContext(GlobalInfoContext);
  const churchId = access?.churchId || churchIdOverride || context?.churchId || "";
  const identity = access
    ? "personal:" + churchId + ":" + access.memberId + ":" + (access.sessionKey || "session")
    : "human:" + churchId + ":" + (context?.userId || "");
  const stableOwnerKey = ownerKey || identity;
  const signedInOperations = useMemo<VolunteerAvailabilityOperations>(() => ({
    loadAvailability: (options) => getMyVolunteerAvailability(churchId, options || { summary: true }),
    saveAvailability: (request) => submitMyVolunteerAvailability(
      churchId,
      request.recipientId,
      request.availability,
      request.availabilityRevision,
    ),
    saveSchedulingPreferences: (request) => updateMySchedulingPreferences(churchId, request),
  }), [churchId]);
  const personalOperations = access?.operations;
  const operations = useMemo<VolunteerAvailabilityOperations>(() => personalOperations
    ? {
        loadAvailability: personalOperations.loadAvailability || (() => Promise.reject(
          new Error("Your personal session can't load availability requests."),
        )),
        saveAvailability: personalOperations.saveAvailability || (() => Promise.reject(
          new Error("Your personal session can't save availability responses."),
        )),
        ...(personalOperations.saveSchedulingPreferences
          ? { saveSchedulingPreferences: personalOperations.saveSchedulingPreferences }
          : {}),
      }
    : signedInOperations, [personalOperations, signedInOperations]);

  const view = (
    <AvailabilityWorkspaceSectionsView
      key={stableOwnerKey}
      churchId={churchId}
      ownerKey={stableOwnerKey}
      operations={operations}
      fallbackPreferences={fallbackPreferences}
      initialRecipientId={initialRecipientId}
      focusAvailability={focusAvailability}
    />
  );
  return navigationGuardProvided ? view : (
    <VolunteerNavigationGuardProvider>{view}</VolunteerNavigationGuardProvider>
  );
};
