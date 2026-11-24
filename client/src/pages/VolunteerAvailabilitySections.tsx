import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Clock3, MoreHorizontal } from "lucide-react";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Modal from "../components/Modal/Modal";
import Select from "../components/Select/Select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/DropdownMenu";
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
  MyScheduleMember,
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
  type AvailabilityChoice,
} from "./myAvailabilityUtils";
import { getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";

type AnswerMap = VolunteerAvailabilityRequest["availability"];

const availabilityScopeSignature = (request: VolunteerAvailabilityRequest) => JSON.stringify(
  request.occurrences
    .map((occurrence) => [
      occurrence.occurrenceId,
      [...new Set(occurrence.responseOccurrenceIds?.length
        ? occurrence.responseOccurrenceIds
        : [occurrence.occurrenceId])].sort(),
    ] as const)
    .sort(([firstId], [secondId]) => firstId.localeCompare(secondId)),
);

const sameAvailabilityScope = (
  first: VolunteerAvailabilityRequest,
  second: VolunteerAvailabilityRequest,
) => availabilityScopeSignature(first) === availabilityScopeSignature(second);

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

const hasUnresolvedAvailabilityConflicts = (request: VolunteerAvailabilityRequest) =>
  Boolean(request.conflictingOccurrenceIds?.length) ||
  request.occurrences.some((occurrence) => occurrence.hasConflictingAnswers);

const AvailabilitySelectionToolbar = ({
  selectionLabel,
  selectAllDisabled,
  onSelectAll,
}: {
  selectionLabel: string;
  selectAllDisabled?: boolean;
  onSelectAll?: () => void;
}) => (
  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
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
      <div
        className="flex min-h-[76px] w-full flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3 sm:p-4"
        role="group"
        aria-label={request.name || "Availability request"}
        data-availability-request-key={requestKey(request)}
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
        <Button
          type="button"
          variant={hasSubmission ? "secondary" : "cta"}
          className="min-h-[44px] max-md:min-h-[44px]! shrink-0"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`${action} ${request.name || "availability request"}`}
        >
          {action}
        </Button>
      </div>
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
  onSaved: (
    answers: AnswerMap,
    result: VolunteerAvailabilitySaveResult,
    read: VolunteerAvailabilityRead | null,
    authoritativeRequest: VolunteerAvailabilityRequest,
  ) => void;
  onBack: () => void;
}) => {
  const { showToast } = useToast();
  const [requestSnapshot, setRequestSnapshot] = useState(request);
  const hasSubmission = hasAvailabilityResponseSubmission(requestSnapshot);
  const savedCounts = getAvailabilityCounts(requestSnapshot);
  const hasSavedAnswers = savedCounts.available + savedCounts.unavailable > 0;
  const [draft, setDraft] = useState<AnswerMap>(() => copyAnswers(requestSnapshot.availability));
  const [explicitlyClearedIds, setExplicitlyClearedIds] = useState<string[]>([]);
  const [baseline, setBaseline] = useState(() => ({
    answers: copyAnswers(requestSnapshot.availability),
    revisions: { ...requestSnapshot.availabilityRevision },
  }));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [resolvedConflictIds, setResolvedConflictIds] = useState<string[]>([]);
  const [conflictRequest, setConflictRequest] = useState<VolunteerAvailabilityRequest | null>(null);
  const [conflictReviewOpen, setConflictReviewOpen] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [requestUnavailable, setRequestUnavailable] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const uncertainPayloadRef = useRef<AnswerMap | null>(null);
  const occurrenceIds = useMemo(
    () => requestSnapshot.occurrences.map(({ occurrenceId }) => occurrenceId),
    [requestSnapshot.occurrences],
  );
  const rawOccurrenceIds = useMemo(() => [...new Set(requestSnapshot.occurrences.flatMap((occurrence) =>
    occurrence.responseOccurrenceIds?.length ? occurrence.responseOccurrenceIds : [occurrence.occurrenceId],
  ))], [requestSnapshot.occurrences]);
  const conflictingOccurrenceIds = useMemo(() => [...new Set([
    ...(requestSnapshot.conflictingOccurrenceIds || []),
    ...requestSnapshot.occurrences.filter((occurrence) => occurrence.hasConflictingAnswers)
      .map((occurrence) => occurrence.occurrenceId),
  ])], [requestSnapshot.conflictingOccurrenceIds, requestSnapshot.occurrences]);
  const occurrenceGroups = useMemo(() => organizeAvailabilityOccurrences({
    occurrences: requestSnapshot.occurrences,
    mode: "byDate",
    serviceTimeZone,
  }), [requestSnapshot.occurrences, serviceTimeZone]);
  const historicalUnansweredIds = useMemo(() => new Set(
    hasSubmission || hasSavedAnswers || conflictingOccurrenceIds.length
      ? requestSnapshot.unansweredOccurrenceIds
      : [],
  ), [conflictingOccurrenceIds.length, hasSavedAnswers, hasSubmission, requestSnapshot.unansweredOccurrenceIds]);
  const unansweredIdsForSubmission = useMemo(() => new Set([
    ...historicalUnansweredIds,
    ...explicitlyClearedIds,
  ]), [explicitlyClearedIds, historicalUnansweredIds]);
  const draftForScope = answersForScope(draft, occurrenceIds);
  const baselineAnswersForScope = answersForScope(baseline.answers, occurrenceIds);
  const isDirty = !availabilityMapsMatch(draftForScope, baselineAnswersForScope, occurrenceIds) || resolvedConflictIds.length > 0;
  const draftAvailableCount = occurrenceIds.filter((id) => draft[id] === "available").length;
  const pendingAnswers = createAvailabilityCheckboxSubmission(
    occurrenceIds,
    draftForScope,
    unansweredIdsForSubmission,
  );
  const pendingCounts = {
    available: occurrenceIds.filter((id) => pendingAnswers[id] === "available").length,
    unavailable: occurrenceIds.filter((id) => pendingAnswers[id] === "unavailable").length,
    unanswered: occurrenceIds.filter((id) => !Object.hasOwn(pendingAnswers, id)).length,
  };
  const hasRevisionSnapshot = rawOccurrenceIds.every((id) =>
    Number.isInteger(baseline.revisions[id]) && baseline.revisions[id] >= 0,
  );
  const currentRequest = conflictRequest || requestSnapshot;
  const canEdit = requestSnapshot.editable && currentRequest.editable &&
    !availabilityNeedsRefresh && !recoveryRequired && !requestUnavailable;
  const unresolvedConflicts = conflictingOccurrenceIds.filter((id) => !resolvedConflictIds.includes(id));
  const selectableOccurrenceIds = occurrenceIds.filter((id) => !unresolvedConflicts.includes(id));
  const canSave = canEdit && (isDirty || !hasSubmission) &&
    unresolvedConflicts.length === 0 && hasRevisionSnapshot && occurrenceIds.length > 0 &&
    !saving && !isSaving && !conflictRequest;

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
    const latest = read.requests.find((item) => requestKey(item) === requestKey(requestSnapshot));
    if (!latest) {
      setRequestUnavailable(true);
      setConflictRequest(null);
      setRecoveryRequired(true);
      setRecoveryMessage("This availability request is no longer available. Your unsaved responses are still here, but can't be saved.");
      return "unavailable" as const;
    }
    if (uncertain && uncertainPayloadRef.current && sameAvailabilityScope(requestSnapshot, latest) &&
        !hasUnresolvedAvailabilityConflicts(latest) &&
        hasAvailabilityResponseSubmission(latest) && availabilityMapsMatch(
      latest.availability,
      uncertainPayloadRef.current,
      occurrenceIds,
    )) {
      const latestAnswers = answersForScope(latest.availability, occurrenceIds);
      setBaseline({ answers: latestAnswers, revisions: { ...latest.availabilityRevision } });
      setDraft(latestAnswers);
      setRequestSnapshot(latest);
      setExplicitlyClearedIds([]);
      setResolvedConflictIds([]);
      setConflictRequest(null);
      setRecoveryRequired(false);
      setRecoveryMessage("");
      setRequestUnavailable(false);
      uncertainPayloadRef.current = null;
      onSaved(latestAnswers, {
        success: true,
        submissionId: latest.submissionId,
        submittedAt: latest.respondedAt,
        recipientId: latest.recipientId,
        requestSummary: {
          recipientId: latest.recipientId,
          formId: latest.formId,
          name: latest.name,
          responseDeadline: latest.responseDeadline,
          respondedAt: latest.respondedAt,
          submissionId: latest.submissionId,
          editable: latest.editable,
        },
      }, read, latest);
      showToast("Your saved availability is up to date.", "success");
      return "saved" as const;
    }
    applyLatest(latest);
    return "review" as const;
  }, [applyLatest, onSaved, refreshAvailability, requestSnapshot, occurrenceIds, showToast]);

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
      recipientId: requestSnapshot.recipientId,
      availability: expandProjectedAnswers(requestSnapshot, submittedAnswers),
      availabilityRevision: { ...baseline.revisions },
    };
    try {
      const result = await saveAvailability(payload);
      if (!mountedRef.current) return;
      if (!result?.success || !result.submissionId) {
        throw new Error("Could not confirm that save. Refresh the latest answers before trying again.");
      }
      const summary = result.requestSummary;
      const summaryIsAuthoritative = Boolean(
        summary &&
        result.recipientId === requestSnapshot.recipientId &&
        summary.recipientId === requestSnapshot.recipientId &&
        summary.formId === requestSnapshot.formId &&
        typeof summary.name === "string" &&
        typeof summary.responseDeadline === "string" &&
        summary.submissionId === result.submissionId &&
        Boolean(result.submittedAt) &&
        summary.respondedAt === result.submittedAt &&
        summary.editable === true,
      );
      if (summaryIsAuthoritative) {
        onSaved(submittedAnswers, result, null, requestSnapshot);
        showToast("Availability response saved.", "success");
        return;
      }

      const read = await refreshAvailability();
      if (!mountedRef.current) return;
      const latest = read?.requests.find((item) => requestKey(item) === requestKey(requestSnapshot));
      if (!read) throw new Error("Could not confirm that save. Refresh the latest answers before trying again.");
      if (latest && sameAvailabilityScope(requestSnapshot, latest) &&
          !hasUnresolvedAvailabilityConflicts(latest) &&
          hasAvailabilityResponseSubmission(latest) && latest.submissionId === result.submissionId &&
          availabilityMapsMatch(latest.availability, submittedAnswers, occurrenceIds)) {
        onSaved(submittedAnswers, result, read, latest);
        showToast("Availability response saved.", "success");
        return;
      }
      if (latest) {
        uncertainPayloadRef.current = submittedAnswers;
        setRecoveryRequired(true);
        setRecoveryMessage("Your request changed while you were editing. Review the latest saved answers before continuing.");
        applyLatest(latest);
        return;
      }
      setRequestUnavailable(true);
      setConflictRequest(null);
      setRecoveryRequired(true);
      setRecoveryMessage("This availability request is no longer available. Your unsaved responses are still here, but can't be saved.");
      return;
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
    if (!hasSubmission || (pendingCounts.available === 0 && pendingCounts.unanswered === 0)) {
      setConfirmationOpen(true);
      return;
    }
    void submit();
  };

  const confirmSubmission = () => {
    setConfirmationOpen(false);
    void submit();
  };

  const transitionAvailability = (
    changes: Array<{ occurrenceId: string; choice: AvailabilityChoice }>,
    resolveConflicts = true,
  ) => {
    const changesById = new Map(changes.map(({ occurrenceId, choice }) => [occurrenceId, choice]));
    setDraft((current) => changes.reduce((next, { occurrenceId, choice }) =>
      setAvailabilityChoice(next, occurrenceId, choice), current));
    setExplicitlyClearedIds((current) => {
      const next = new Set(current);
      changesById.forEach((choice, occurrenceId) => {
        if (choice === "not-answered") next.add(occurrenceId);
        else next.delete(occurrenceId);
      });
      return [...next];
    });
    if (resolveConflicts) {
      const resolvedChanges = [...changesById.keys()].filter((id) => conflictingOccurrenceIds.includes(id));
      if (resolvedChanges.length) {
        setResolvedConflictIds((current) => [...new Set([...current, ...resolvedChanges])]);
      }
    }
  };

  const chooseAvailability = (occurrenceId: string, choice: AvailabilityChoice) =>
    transitionAvailability([{ occurrenceId, choice }]);

  const clearAvailability = (occurrenceId: string) => chooseAvailability(occurrenceId, "not-answered");

  const reviewLatest = () => {
    if (!conflictRequest) return;
    setConflictReviewOpen(true);
  };

  const keepDraftAgainstLatest = () => {
    if (!conflictRequest?.editable) return;
    if (!sameAvailabilityScope(requestSnapshot, conflictRequest)) {
      setConflictReviewOpen(true);
      setRecoveryMessage("The services in this request changed. Use the latest answers to reload the updated service list before continuing.");
      return;
    }
    const latestAnswers = answersForScope(conflictRequest.availability, occurrenceIds);
    const originalAnswers = answersForScope(baseline.answers, occurrenceIds);
    const currentAnswers = answersForScope(draft, occurrenceIds);
    const explicitlyCleared = new Set(explicitlyClearedIds);
    const resolved = new Set(resolvedConflictIds);
    const mergedDraft = Object.fromEntries(occurrenceIds.flatMap((id) => {
      const locallyChanged = explicitlyCleared.has(id) || resolved.has(id) ||
        (currentAnswers[id] || "") !== (originalAnswers[id] || "");
      const answer = locallyChanged ? currentAnswers[id] : latestAnswers[id];
      return answer === "available" || answer === "unavailable" ? [[id, answer]] : [];
    }));
    const latestConflictIds = new Set([
      ...(conflictRequest.conflictingOccurrenceIds || []),
      ...conflictRequest.occurrences.filter((occurrence) => occurrence.hasConflictingAnswers)
        .map((occurrence) => occurrence.occurrenceId),
    ]);
    const retainedResolvedIds = resolvedConflictIds.filter((id) => latestConflictIds.has(id));
    const retainedClearedIds = explicitlyClearedIds.filter((id) => !Object.hasOwn(mergedDraft, id));
    const draftHasLocalChanges = !availabilityMapsMatch(mergedDraft, latestAnswers, occurrenceIds) ||
      retainedResolvedIds.length > 0;

    setRequestSnapshot(conflictRequest);
    setBaseline({ answers: latestAnswers, revisions: { ...conflictRequest.availabilityRevision } });
    setDraft(mergedDraft);
    setExplicitlyClearedIds(retainedClearedIds);
    setResolvedConflictIds(retainedResolvedIds);
    setConflictRequest(null);
    setConflictReviewOpen(false);
    setRecoveryRequired(false);
    setRecoveryError("");
    setRecoveryMessage(draftHasLocalChanges
      ? "Your draft was compared with the latest answers. Save to submit your changes."
      : "Latest saved answers are up to date.");
    uncertainPayloadRef.current = null;
  };

  const useLatestAnswers = () => {
    if (!conflictRequest) return;
    const latestOccurrenceIds = conflictRequest.occurrences.map(({ occurrenceId }) => occurrenceId);
    const latestAnswers = answersForScope(conflictRequest.availability, latestOccurrenceIds);
    setRequestSnapshot(conflictRequest);
    setBaseline({ answers: latestAnswers, revisions: { ...conflictRequest.availabilityRevision } });
    setDraft(latestAnswers);
    setExplicitlyClearedIds([]);
    setResolvedConflictIds([]);
    setConflictRequest(null);
    setConflictReviewOpen(false);
    setRecoveryRequired(false);
    setRecoveryError("");
    setRecoveryMessage("");
    setRequestUnavailable(false);
    uncertainPayloadRef.current = null;
    showToast("Latest saved answers loaded.", "success");
  };

  return (
    <section className="space-y-4" aria-labelledby="availability-editor-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="availability-editor-title" tabIndex={-1} className="text-base font-semibold text-gray-100">
            {requestSnapshot.name || "Availability request"}
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            {requestSnapshot.responseDeadline ? "Due " + formatAvailabilityDeadline(requestSnapshot.responseDeadline) : ""}
            {requestSnapshot.responseDeadline && !requestUnavailable && currentRequest.editable && hasAvailabilityResponseSubmission(currentRequest) ? " · " : ""}
            {requestUnavailable
              ? "This availability request is no longer available."
              : currentRequest.editable
                ? hasAvailabilityResponseSubmission(currentRequest) ? "Response submitted" : ""
                : "Closed"}
          </p>
          {requestSnapshot.availabilityMessage ? (
            <p className="mt-2 whitespace-pre-line text-sm text-gray-300">{requestSnapshot.availabilityMessage}</p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" className="min-h-[44px] shrink-0" onClick={onBack}>Back to My Schedule</Button>
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
                    {sameAvailabilityScope(requestSnapshot, conflictRequest) ? requestSnapshot.occurrences.map((occurrence) => {
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
                    }) : null}
                  </ul>
                  {!sameAvailabilityScope(requestSnapshot, conflictRequest) ? (
                    <p className="text-sm text-amber-200">The service list changed while you were editing. Reload the latest answers before continuing.</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {conflictRequest.editable ? (
                      <Button type="button" variant="secondary" disabled={!sameAvailabilityScope(requestSnapshot, conflictRequest)} onClick={keepDraftAgainstLatest}>Keep my draft and continue</Button>
                    ) : null}
                    <Button type="button" variant="tertiary" onClick={useLatestAnswers}>Use latest answers</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasRevisionSnapshot && requestSnapshot.editable && !availabilityNeedsRefresh ? (
        <p role="alert" className="text-sm text-amber-200">Refresh this request before editing so the latest save details are available.</p>
      ) : null}

      {requestSnapshot.occurrences.length === 0 ? (
        <p className="text-sm text-gray-300">This request has no service dates.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">Select services you can serve</h3>
          </div>
          <AvailabilitySelectionToolbar
            selectionLabel={draftAvailableCount + " of " + occurrenceIds.length + " selected"}
            selectAllDisabled={!canEdit || isSaving || saving || confirmationOpen ||
              selectableOccurrenceIds.every((id) => draft[id] === "available")}
            onSelectAll={() => transitionAvailability(
              selectableOccurrenceIds.map((occurrenceId) => ({ occurrenceId, choice: "available" })),
              false,
            )}
          />
          <fieldset disabled={!canEdit || isSaving || saving || confirmationOpen} className="min-w-0 space-y-4">
            <legend className="sr-only">Services you can serve</legend>
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
                    const occurrenceId = occurrence.occurrenceId;
                    const name = occurrence.name || "Service";
                    const dateTime = formatAvailabilityOccurrence(occurrence, serviceTimeZone);
                    const visibleTime = formatAvailabilityOccurrenceTime(occurrence, serviceTimeZone);
                    const isSelected = draft[occurrenceId] === "available";
                    const isUnanswered = unansweredIdsForSubmission.has(occurrenceId);
                    const hasConflict = unresolvedConflicts.includes(occurrenceId);
                    const canClearAnswer = canEdit && draft[occurrenceId] !== undefined &&
                      (Object.hasOwn(requestSnapshot.availability, occurrenceId) || historicalUnansweredIds.has(occurrenceId));
                    return (
                      <li key={occurrenceId} className="min-w-0">
                        <div
                          role="group"
                          aria-label={"I can serve at " + name + ", " + dateTime}
                          className="relative min-w-0"
                        >
                          <Checkbox
                            checked={isSelected}
                            disabled={!canEdit || isSaving || saving || confirmationOpen}
                            onCheckedChange={(checked) => chooseAvailability(occurrenceId, checked ? "available" : "unavailable")}
                            label={<span className="flex min-w-0 flex-col gap-1">
                              <span className="whitespace-normal break-words font-semibold leading-snug">{name}</span>
                              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                                {visibleTime ? <time dateTime={occurrence.startsAt}>{visibleTime}</time> : null}
                              </span>
                            </span>}
                            aria-label={"I can serve at " + name + ", " + dateTime}
                            className={cn(
                              "min-h-[64px] max-md:min-h-[64px]! w-full items-start rounded-lg border p-3 pr-14 text-left transition-colors focus-within:ring-2 focus-within:ring-teal-300 sm:p-4 sm:pr-14",
                              isSelected
                                ? "border-teal-400/70 bg-teal-950/40"
                                : "border-gray-700/80 bg-gray-900/35 hover:border-gray-500",
                            )}
                            labelClassName="py-0"
                          />
                          {canClearAnswer ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="tertiary"
                                  svg={MoreHorizontal}
                                  iconSize="sm"
                                  aria-label={`More actions for ${name}`}
                                  title="More service actions"
                                  className="absolute right-1.5 top-1.5 z-10 size-10 justify-center rounded-md"
                                  disabled={isSaving || saving || confirmationOpen}
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => clearAvailability(occurrenceId)}>
                                  Clear response
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                          {hasConflict && currentRequest.editable ? (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs text-amber-200">Saved answers conflict. Choose how to resolve this service.</p>
                              <Select
                                label="Resolve answer"
                                labelFontSize="text-xs"
                                size="sm"
                                value={draft[occurrenceId] || ""}
                                options={[
                                  { value: "", label: "Choose an answer" },
                                  { value: "available", label: "Available" },
                                  { value: "unavailable", label: "Unavailable" },
                                  { value: "not-answered", label: "Not answered" },
                                ]}
                                disabled={!canEdit || isSaving || saving || confirmationOpen}
                                aria-label={"Resolve saved answers for " + name + " on " + dateTime}
                                onChange={(value) => {
                                  if (value === "available" || value === "unavailable" || value === "not-answered") {
                                    chooseAvailability(occurrenceId, value);
                                  }
                                }}
                              />
                            </div>
                          ) : null}
                          {isUnanswered && !hasConflict ? (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="text-xs text-gray-400">Not answered</span>
                              {currentRequest.editable ? (
                                <Button type="button" variant="textLink" className="min-h-[44px]" disabled={!canEdit || isSaving || saving || confirmationOpen}
                                  onClick={() => chooseAvailability(occurrenceId, "unavailable")}>
                                  Mark unavailable
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </fieldset>
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
            {saving || isSaving ? "Saving availability…" : hasSubmission ? "Save changes" : "Review response"}
          </Button>
          {isDirty ? <span className="text-xs text-gray-400">Unsaved changes</span> : null}
          {saving || isSaving ? <span role="status" aria-live="polite" className="sr-only">Saving availability responses…</span> : null}
        </div>
      ) : null}

      <Modal
        isOpen={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        title="Review your response"
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
    memberSnapshot: MyScheduleMember;
  }>;
  refreshPreferences: () => Promise<VolunteerSchedulingPreferences | null>;
  onSaved: (preferences: VolunteerSchedulingPreferences, member: MyScheduleMember) => void;
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
  const sectionRef = useRef<HTMLElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasEditingRef = useRef(false);
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
    if (editing && !wasEditingRef.current) {
      sectionRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
    } else if (!editing && wasEditingRef.current) {
      editButtonRef.current?.focus();
    }
    wasEditingRef.current = editing;
  }, [editing]);

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
      if (!result?.success || !result.schedulingPreferences || !result.memberSnapshot) {
        throw new Error("Could not confirm your scheduling preferences were saved.");
      }
      const saved = preferenceSnapshot(result.schedulingPreferences);
      setDraft(saved);
      setBaseline(saved);
      setEditing(false);
      setRejectedAsStale(false);
      setConflictLatest(null);
      onSaved(result.schedulingPreferences, result.memberSnapshot);
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
    <section ref={sectionRef} aria-labelledby="scheduling-preferences-heading" className="space-y-3 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3">
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
          <Button ref={editButtonRef} type="button" variant="secondary" onClick={beginEditing}>Edit preferences</Button>
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
  onMemberUpdated?: (member: MyScheduleMember) => void;
  onMemberObserved?: (member: MyScheduleMember) => void;
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
  onMemberUpdated,
  onMemberObserved,
  initialRecipientId,
  focusAvailability,
}: AvailabilityWorkspaceSectionsProps) => {
  const { requestDiscardAction, requestNavigation, setDirtySource, setSavingSource } = useVolunteerNavigationGuard();
  const location = useLocation();
  const navigate = useNavigate();
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
  const editorReturnFocusKeyRef = useRef<string | null>(null);
  const pendingEditorReturnFocusKeyRef = useRef<string | null>(null);
  const wasEditorOpenRef = useRef(false);
  const didFocusRef = useRef(false);
  const activeRequest = initialRecipientId && editorRequest?.recipientId === initialRecipientId
    ? editorRequest
    : null;
  const schedulingPreferences = (() => {
    if (!summaryLoaded) return fallbackPreferences;
    if (!summaryPreferences) return null;
    if (!fallbackPreferences) return summaryPreferences;
    const summaryRevision = Date.parse(summaryPreferences.updatedAt || "");
    const memberRevision = Date.parse(fallbackPreferences.updatedAt || "");
    return Number.isFinite(summaryRevision) && Number.isFinite(memberRevision) && memberRevision > summaryRevision
      ? fallbackPreferences
      : summaryPreferences;
  })();

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

  const loadSummary = useCallback(async ({
    initial = false,
    includeMemberSnapshot = false,
  }: { initial?: boolean; includeMemberSnapshot?: boolean } = {}) => {
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
      const result = await operations.loadAvailability({
        summary: true,
        ...(includeMemberSnapshot ? { includeMemberSnapshot: true } : {}),
      });
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
      if (result.memberSnapshot) onMemberObserved?.(result.memberSnapshot);
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
  }, [churchId, onMemberObserved, operations, ownerKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setDirtySource("my-availability-response", false);
      setSavingSource("my-availability-response", false);
    };
  }, [setDirtySource, setSavingSource]);

  useEffect(() => {
    if (initialLoadOwnerRef.current === ownerKey) return;
    if (initialRecipientId) return;
    initialLoadOwnerRef.current = ownerKey;
    void loadSummary({ initial: true });
  }, [initialRecipientId, loadSummary, ownerKey]);

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
    const read = await loadSummary({ includeMemberSnapshot: Boolean(onMemberObserved) });
    return read?.schedulingPreferences || null;
  }, [loadSummary, onMemberObserved]);

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
    if (openingRecipientId === summary.recipientId) return;
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

  const navigateToOverview = useCallback(() => {
    const routeState = location.state as { availabilityEditorFromOverview?: unknown } | null;
    if (routeState?.availabilityEditorFromOverview === true) {
      navigate(-1);
      return;
    }
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.delete("availabilityRequest");
    const serializedSearch = nextSearch.toString();
    navigate({
      pathname: location.pathname,
      search: serializedSearch ? "?" + serializedSearch : "",
      hash: location.hash,
    }, { replace: true, state: null });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  const handleSaved = useCallback((
    _answers: AnswerMap,
    result: VolunteerAvailabilitySaveResult,
    read: VolunteerAvailabilityRead | null,
    authoritativeRequest: VolunteerAvailabilityRequest,
  ) => {
    if (read) {
      const detail = read.requests.find((request) => requestKey(request) === requestKey(authoritativeRequest));
      if (detail) markSummaryMutation({
        ...summaryFromRequest(detail),
        submissionId: detail.submissionId || result.submissionId,
        respondedAt: detail.respondedAt || result.submittedAt || authoritativeRequest.respondedAt,
      });
      else if (result.requestSummary) {
        markSummaryMutation({ ...result.requestSummary, editable: false });
      }
      if (read.serviceTimeZone) setServiceTimeZone(read.serviceTimeZone);
      setSaveRecoveryMessage("");
    } else if (result.requestSummary) {
      markSummaryMutation(result.requestSummary);
      setSaveRecoveryMessage("");
    } else {
      markSummaryMutation({
        ...summaryFromRequest(authoritativeRequest),
        submissionId: result.submissionId,
        respondedAt: result.submittedAt || authoritativeRequest.respondedAt,
      });
      setSaveRecoveryMessage("Your response was saved. Open the request again to load the latest answers before editing.");
    }
    updateDirty(false);
    updateSaving(false);
    navigateToOverview();
  }, [markSummaryMutation, navigateToOverview, updateDirty, updateSaving]);

  const openRequestAfterGuard = (request: VolunteerAvailabilityRequestSummary) => {
    editorReturnFocusKeyRef.current = requestKey(request);
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.set("availabilityRequest", request.recipientId);
    requestNavigation({
      pathname: location.pathname,
      search: "?" + nextSearch.toString(),
      hash: location.hash,
    }, { state: { availabilityEditorFromOverview: true } });
  };

  const closeEditor = () => requestDiscardAction(() => {
    setRequestToRetry(null);
    updateDirty(false);
    navigateToOverview();
  });

  useEffect(() => {
    if (!initialRecipientId) {
      initialDetailRecipientRef.current = "";
      openRequestSequenceRef.current += 1;
      detailSequenceRef.current += 1;
      setOpeningRecipientId("");
      setEditorRequest(null);
      return;
    }
    const detailKey = ownerKey + "\u0000" + initialRecipientId;
    if (initialDetailRecipientRef.current === detailKey) return;
    initialDetailRecipientRef.current = detailKey;
    setEditorRequest(null);
    setOpenRequestError("");
    const routeState = location.state as { availabilityEditorFromOverview?: unknown } | null;
    if (routeState?.availabilityEditorFromOverview !== true) editorReturnFocusKeyRef.current = null;
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
  }, [initialRecipientId, location.state, openRequest, ownerKey, requestSummaries]);

  useEffect(() => {
    if (!initialRecipientId || activeRequest) return;
    editorRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [activeRequest, initialRecipientId]);

  useEffect(() => {
    const editorOpen = Boolean(activeRequest);
    if (editorOpen && !wasEditorOpenRef.current) {
      pendingEditorReturnFocusKeyRef.current = null;
      editorRef.current?.scrollIntoView?.({ block: "nearest" });
      editorRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      wasEditorOpenRef.current = true;
    } else if (!editorOpen && !initialRecipientId && wasEditorOpenRef.current) {
      const returnKey = editorReturnFocusKeyRef.current;
      wasEditorOpenRef.current = false;
      editorReturnFocusKeyRef.current = null;
      if (returnKey) {
        pendingEditorReturnFocusKeyRef.current = returnKey;
      } else {
        const fallback = requestsRef.current?.querySelector<HTMLElement>("h2") ||
          preferencesRef.current?.querySelector<HTMLElement>("h2");
        fallback?.focus({ preventScroll: true });
      }
    }

    const pendingKey = pendingEditorReturnFocusKeyRef.current;
    if (!editorOpen && !initialRecipientId && pendingKey) {
      const returnTarget = Array.from(
        requestsRef.current?.querySelectorAll<HTMLElement>("[data-availability-request-key]") || [],
      ).find((element) => element.dataset.availabilityRequestKey === pendingKey) || null;
      if (returnTarget?.isConnected) {
        pendingEditorReturnFocusKeyRef.current = null;
        const focusTarget = returnTarget.querySelector<HTMLElement>("button") || returnTarget;
        const restoreFocus = () => {
          if (focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
        };
        if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreFocus);
        else window.setTimeout(restoreFocus, 0);
      } else if (summaryLoaded && loadState !== "loading") {
        pendingEditorReturnFocusKeyRef.current = null;
        const fallback = requestsRef.current?.querySelector<HTMLElement>("h2") ||
          preferencesRef.current?.querySelector<HTMLElement>("h2");
        fallback?.focus({ preventScroll: true });
      }
    }
  }, [activeRequest, initialRecipientId, loadState, requestSummaries, summaryLoaded]);

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
  const renderActiveEditor = (request: VolunteerAvailabilityRequest) => (
    <section ref={editorRef} className="scroll-mt-4">
      <AvailabilityRequestEditor
        key={ownerKey + ":" + requestKey(request)}
        request={request}
        serviceTimeZone={serviceTimeZone}
        saving={saving}
        availabilityNeedsRefresh={false}
        saveAvailability={operations.saveAvailability}
        refreshAvailability={() => refreshAvailability(request.recipientId)}
        onSavingChange={updateSaving}
        onDirtyChange={updateDirty}
        onSaved={handleSaved}
        onBack={closeEditor}
      />
    </section>
  );

  return initialRecipientId ? (
    <div className="space-y-4">
      {activeRequest ? renderActiveEditor(activeRequest) : (
        <section ref={editorRef} className="space-y-3" aria-labelledby="availability-request-loading-title">
          <Button type="button" variant="secondary" className="min-h-[44px]" onClick={closeEditor}>
            Back to My Schedule
          </Button>
          <h2 id="availability-request-loading-title" tabIndex={-1} className="text-sm font-semibold text-gray-100">
            {openRequestError ? "Availability request unavailable" : "Loading availability request"}
          </h2>
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
          ) : (
            <p role="status" aria-live="polite" className="text-sm text-gray-400">
              Loading this authorized request…
            </p>
          )}
        </section>
      )}
    </div>
  ) : (
    <div className="space-y-4">
      <div ref={preferencesRef}>
        <SchedulingPreferencesPanel
          preferences={schedulingPreferences}
          loading={preferenceLoading}
          savePreferences={operations.saveSchedulingPreferences}
          refreshPreferences={refreshPreferences}
          onSaved={(preferences, member) => {
            preferencesMutationSequenceRef.current += 1;
            setSummaryPreferences(preferences);
            setSummaryLoaded(true);
            onMemberUpdated?.(member);
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
                          openRequestAfterGuard(request);
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
    </div>
  );
};

export const VolunteerAvailabilitySections = ({
  access,
  ownerKey,
  churchId: churchIdOverride,
  fallbackPreferences = null,
  onMemberUpdated,
  onMemberObserved,
  initialRecipientId,
  focusAvailability = false,
  navigationGuardProvided = false,
}: {
  access?: PersonalScheduleAccess;
  churchId?: string;
  ownerKey?: string;
  fallbackPreferences?: VolunteerSchedulingPreferences | null;
  onMemberUpdated?: (member: MyScheduleMember) => void;
  onMemberObserved?: (member: MyScheduleMember) => void;
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
      onMemberUpdated={onMemberUpdated}
      onMemberObserved={onMemberObserved}
      initialRecipientId={initialRecipientId}
      focusAvailability={focusAvailability}
    />
  );
  return navigationGuardProvided ? view : (
    <VolunteerNavigationGuardProvider>{view}</VolunteerNavigationGuardProvider>
  );
};
