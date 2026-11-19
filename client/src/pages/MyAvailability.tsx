import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AppPageShell from "../components/AppPageShell/AppPageShell";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Modal from "../components/Modal/Modal";
import { GlobalInfoContext } from "../context/globalInfo";
import { useToast } from "../context/toastContext";
import { getMyVolunteerAvailability, submitMyVolunteerAvailability } from "../api/auth";
import type {
  PersonalScheduleAccess,
  VolunteerAvailabilityOperations,
  VolunteerAvailabilityRead,
  VolunteerAvailabilityRequest,
  VolunteerAvailabilitySave,
  VolunteerAvailabilitySaveResult,
} from "./myScheduleOperations";
import VolunteerSelfServiceNavigation from "./VolunteerSelfServiceNavigation";
import {
  formatAvailabilityDeadline,
  formatAvailabilityOccurrence,
  formatAvailabilityRequestDateRange,
  createAvailabilityCheckboxSubmission,
  getAvailabilityChoice,
  getAvailabilityCounts,
  getAvailabilityRequestGroup,
  getAvailabilityRequestStatus,
  hasAvailabilityResponseSubmission,
  setAvailabilityChoice,
  type AvailabilityChoice,
} from "./myAvailabilityUtils";
import { getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";

type LoadOptions = { initial?: boolean; lockEditingOnFailure?: boolean };
type PendingNavigation =
  | { to: string }
  | { action: () => void }
  | { historyDelta: number };
type AnswerMap = VolunteerAvailabilityRequest["availability"];

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

const answerLabel = (answer: AvailabilityChoice | undefined) => {
  if (answer === "available") return "Available";
  if (answer === "unavailable") return "Unavailable";
  return "Not answered";
};

const requestKey = (request: VolunteerAvailabilityRequest) =>
  request.formId + ":" + request.recipientId;

const RequestCard = ({
  request,
  serviceTimeZone,
  onOpen,
  disabled,
}: {
  request: VolunteerAvailabilityRequest;
  serviceTimeZone: string | null;
  onOpen: () => void;
  disabled: boolean;
}) => {
  const counts = getAvailabilityCounts(request);
  const group = getAvailabilityRequestGroup(request);
  const status = getAvailabilityRequestStatus(request);
  const hasSubmission = hasAvailabilityResponseSubmission(request);
  const statusLine = group === "closed"
    ? hasSubmission ? "Closed · Response submitted" : "Closed · No response submitted"
    : status;
  const dateRange = formatAvailabilityRequestDateRange(request, serviceTimeZone);

  return (
    <li>
      <button
        type="button"
        className="flex min-h-11 w-full flex-col gap-2 rounded-lg border border-gray-700/80 bg-gray-900/40 p-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300 disabled:cursor-not-allowed disabled:opacity-60 sm:p-4"
        onClick={onOpen}
        disabled={disabled}
        aria-label={"Open " + (request.name || "availability request")}
      >
        <span className="flex w-full flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <span className="font-semibold text-gray-100">{request.name || "Availability request"}</span>
          <span className="text-xs font-medium text-gray-300">{statusLine}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
          <span>{counts.total} {counts.total === 1 ? "service date" : "service dates"}</span>
          {request.responseDeadline ? (
            <span className="inline-flex items-center gap-1"><Clock3 aria-hidden="true" size={13} />Due {formatAvailabilityDeadline(request.responseDeadline)}</span>
          ) : null}
        </span>
        <span className="text-xs text-gray-300">
          {counts.available} available · {counts.unavailable} unavailable · {counts.unanswered} unanswered
        </span>
        {dateRange ? <span className="text-xs text-gray-400">Services span {dateRange}</span> : null}
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
  const [baseline, setBaseline] = useState(() => ({
    answers: copyAnswers(request.availability),
    revisions: { ...request.availabilityRevision },
  }));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
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
  const draftForScope = answersForScope(draft, occurrenceIds);
  const baselineAnswersForScope = answersForScope(baseline.answers, occurrenceIds);
  const isDirty = !availabilityMapsMatch(draftForScope, baselineAnswersForScope, occurrenceIds);
  const draftAnswerCount = occurrenceIds.filter((id) =>
    draft[id] === "available" || draft[id] === "unavailable",
  ).length;
  const draftAvailableCount = occurrenceIds.filter((id) => draft[id] === "available").length;
  const draftUnansweredCount = occurrenceIds.length - draftAnswerCount;
  const useThreeStateEditor = detailedEditing ||
    (startsWithThreeStateData && draftUnansweredCount > 0) ||
    (hasSubmission && occurrenceIds.length > 0 && draftAnswerCount === 0);
  const checkboxSubmission = createAvailabilityCheckboxSubmission(occurrenceIds, draftForScope);
  const pendingAnswers = useThreeStateEditor ? draftForScope : checkboxSubmission;
  const pendingCounts = {
    available: occurrenceIds.filter((id) => pendingAnswers[id] === "available").length,
    unavailable: occurrenceIds.filter((id) => pendingAnswers[id] === "unavailable").length,
    unanswered: occurrenceIds.filter((id) => !Object.hasOwn(pendingAnswers, id)).length,
  };
  const hasRevisionSnapshot = occurrenceIds.every((id) =>
    Number.isInteger(baseline.revisions[id]) && baseline.revisions[id] >= 0,
  );
  const currentRequest = conflictRequest || request;
  const canEdit = serverAllowsEdits && request.editable && currentRequest.editable &&
    !availabilityNeedsRefresh && !recoveryRequired && !requestUnavailable;
  const canSubmitInitialResponse = hasSubmission || !useThreeStateEditor || draftAnswerCount > 0 || hasSavedAnswers;
  const canSave = canEdit && (isDirty || !hasSubmission) && canSubmitInitialResponse &&
    hasRevisionSnapshot && occurrenceIds.length > 0 &&
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
      availability: submittedAnswers,
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
            {request.responseDeadline ? "Due " + formatAvailabilityDeadline(request.responseDeadline) + " · " : ""}
            {requestUnavailable
              ? "This availability request is no longer available."
              : currentRequest.editable
                ? hasAvailabilityResponseSubmission(currentRequest)
                  ? "Response submitted. You can update your answers."
                  : "Not yet submitted. You can still choose your response."
                : "This availability request is closed. Your previous responses are shown below."}
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
            <h3 className="text-sm font-semibold text-gray-100">Which services are you available to serve?</h3>
            {useThreeStateEditor ? (
              <p className="mt-1 text-xs text-gray-400">Choose Available, Unavailable, or Not answered for each service. Not answered stays unanswered when you save.</p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">Checked means available. When you submit, unchecked services will be unavailable.</p>
            )}
          </div>

          {!useThreeStateEditor ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canEdit || isSaving || saving || confirmationOpen || draftAvailableCount === occurrenceIds.length}
                  onClick={() => setDraft((current) => Object.fromEntries(
                    occurrenceIds.map((id) => [id, "available" as const]),
                  ))}
                >
                  Select all
                </Button>
                <span className="text-xs text-gray-400">{draftAvailableCount} of {occurrenceIds.length} selected</span>
              </div>
              <fieldset disabled={!canEdit || isSaving || saving || confirmationOpen} className="space-y-2">
                {request.occurrences.map((occurrence) => {
                  const dateTime = formatAvailabilityOccurrence(occurrence, serviceTimeZone);
                  return (
                    <Checkbox
                      key={occurrence.occurrenceId}
                      checked={draft[occurrence.occurrenceId] === "available"}
                      onCheckedChange={(checked) => setDraft((current) => setAvailabilityChoice(
                        current,
                        occurrence.occurrenceId,
                        checked ? "available" : "unavailable",
                      ))}
                      label={<span className="flex min-w-0 flex-col gap-0.5">
                        <span className="font-medium">{occurrence.name || "Service"}</span>
                        <span className="text-xs text-gray-400">{dateTime}</span>
                      </span>}
                      aria-label={`${occurrence.name || "Service"} · ${dateTime}`}
                      className="min-h-12 rounded-md border border-gray-700 bg-gray-900/50 p-3 has-[:checked]:border-teal-400/60 has-[:checked]:bg-teal-950/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-300"
                    />
                  );
                })}
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
              <fieldset disabled={!canEdit || isSaving || saving || confirmationOpen} className="space-y-3">
                {request.occurrences.map((occurrence) => (
                  <fieldset key={occurrence.occurrenceId} className="rounded-lg border border-gray-700/80 p-3 sm:p-4">
                    <legend className="px-1 text-sm font-semibold text-gray-100">
                      {occurrence.name || "Service"} · {formatAvailabilityOccurrence(occurrence, serviceTimeZone)}
                    </legend>
                    <div role="radiogroup" aria-label={"Availability for " + (occurrence.name || "service") +
                      " on " + formatAvailabilityOccurrence(occurrence, serviceTimeZone)}
                      className="grid gap-2 pt-2 sm:grid-cols-3">
                      {([
                        ["available", "Available"],
                        ["unavailable", "Unavailable"],
                        ["not-answered", "Not answered"],
                      ] as const).map(([choice, label]) => (
                        <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-gray-700 bg-gray-900/50 px-3 py-2 text-sm text-gray-200 has-[:checked]:border-teal-400/60 has-[:checked]:bg-teal-950/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-300">
                          <input
                            type="radio"
                            name={"availability-" + request.formId + "-" + occurrence.occurrenceId}
                            value={choice}
                            checked={getAvailabilityChoice(draft, occurrence.occurrenceId) === choice}
                            onChange={() => setDraft((current) => setAvailabilityChoice(current, occurrence.occurrenceId, choice))}
                            className="size-4 accent-teal-400"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
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

const MyAvailabilityView = ({
  access,
  churchId,
  ownerKey,
  operations,
}: {
  access?: PersonalScheduleAccess;
  churchId: string;
  ownerKey: string;
  operations: VolunteerAvailabilityOperations;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [requests, setRequests] = useState<VolunteerAvailabilityRequest[]>([]);
  const [serviceTimeZone, setServiceTimeZone] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [availabilityNeedsRefresh, setAvailabilityNeedsRefresh] = useState(false);
  const [editorRequest, setEditorRequest] = useState<VolunteerAvailabilityRequest | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [blockedBySave, setBlockedBySave] = useState(false);
  const mountedRef = useRef(false);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const readSequenceRef = useRef(0);
  const editorDirtyRef = useRef(false);
  const savingRef = useRef(false);
  const historyIndexRef = useRef<number | null>(null);
  const restoreHistoryPopRef = useRef(false);
  const allowHistoryPopRef = useRef(false);
  const hasUnsavedChanges = editorDirty || saving;
  const activeRequest = editorRequest;

  const updateDirty = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
    setEditorDirty(dirty);
  }, []);

  const updateSaving = useCallback((isSaving: boolean) => {
    savingRef.current = isSaving;
    setSaving(isSaving);
  }, []);

  const loadRequests = useCallback(async ({ initial = false, lockEditingOnFailure = false }: LoadOptions = {}) => {
    if (!churchId) {
      setLoadError("Your church could not be loaded. Refresh the page and try again.");
      setLoadState("error");
      return null;
    }
    const sequence = ++readSequenceRef.current;
    const requestedOwner = ownerKey;
    if (initial) setLoadState("loading");
    else setRefreshing(true);
    setLoadError("");
    try {
      const result = await operations.loadAvailability();
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== readSequenceRef.current) return null;
      if (!result?.success || !Array.isArray(result.requests)) throw new Error("Could not load your availability requests.");
      setRequests(result.requests);
      setServiceTimeZone(result.serviceTimeZone || null);
      setAvailabilityNeedsRefresh(false);
      setLoadState("ready");
      return result;
    } catch (error) {
      if (!mountedRef.current || ownerKeyRef.current !== requestedOwner || sequence !== readSequenceRef.current) return null;
      const message = error instanceof Error && error.message
        ? error.message
        : "Could not load your availability requests. Try again.";
      setLoadError(message);
      if (initial) setLoadState("error");
      if (lockEditingOnFailure) setAvailabilityNeedsRefresh(true);
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
    void loadRequests({ initial: true });
  }, [loadRequests]);

  const refreshAvailability = useCallback(
    () => loadRequests({ lockEditingOnFailure: true }),
    [loadRequests],
  );

  const needsResponse = requests.filter((request) => getAvailabilityRequestGroup(request) === "needs-response");
  const submittedResponses = requests.filter((request) => getAvailabilityRequestGroup(request) === "submitted-responses");
  const closedRequests = requests.filter((request) => getAvailabilityRequestGroup(request) === "closed");

  const requestAction = (action: () => void) => {
    if (savingRef.current) {
      setBlockedBySave(true);
      return;
    }
    if (editorDirtyRef.current) {
      setPendingNavigation({ action });
      return;
    }
    action();
  };

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleAnchorClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("#") && !href.startsWith("#/")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const to = href.startsWith("#/") ? href.slice(1) : destination.pathname + destination.search + destination.hash;
      if (savingRef.current) setBlockedBySave(true);
      else setPendingNavigation({ to });
    };
    document.addEventListener("click", handleAnchorClick, true);
    return () => document.removeEventListener("click", handleAnchorClick, true);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const historyState = window.history.state as { idx?: unknown } | null;
    historyIndexRef.current = typeof historyState?.idx === "number" ? historyState.idx : null;
  }, [location.key]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handlePopState = (event: PopStateEvent) => {
      if (allowHistoryPopRef.current) {
        allowHistoryPopRef.current = false;
        return;
      }
      if (restoreHistoryPopRef.current) {
        restoreHistoryPopRef.current = false;
        return;
      }
      const targetIndex = (event.state as { idx?: unknown } | null)?.idx;
      const currentIndex = historyIndexRef.current;
      if (typeof targetIndex !== "number" || currentIndex === null || targetIndex === currentIndex) return;
      const delta = targetIndex - currentIndex;
      event.stopImmediatePropagation();
      restoreHistoryPopRef.current = true;
      if (savingRef.current) setBlockedBySave(true);
      else setPendingNavigation({ historyDelta: delta });
      window.history.go(-delta);
    };
    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, [hasUnsavedChanges]);

  const finishNavigation = () => {
    if (savingRef.current) return;
    const pending = pendingNavigation;
    setPendingNavigation(null);
    setBlockedBySave(false);
    if (!pending) return;
    if ("to" in pending) navigate(pending.to);
    else if ("action" in pending) pending.action();
    else {
      allowHistoryPopRef.current = true;
      window.history.go(pending.historyDelta);
    }
  };

  const closeNavigationDialog = () => {
    setPendingNavigation(null);
    setBlockedBySave(false);
  };

  const handleSaved = useCallback((
    answers: AnswerMap,
    result: VolunteerAvailabilitySaveResult,
    read: VolunteerAvailabilityRead | null,
  ) => {
    if (read) {
      const savedRequest = editorRequest;
      setRequests(read.requests.map((request) => {
        if (!savedRequest || requestKey(request) !== requestKey(savedRequest)) return request;
        return {
          ...request,
          submissionId: request.submissionId || result.submissionId,
          respondedAt: request.respondedAt || result.submittedAt || savedRequest.respondedAt,
        };
      }));
      setServiceTimeZone(read.serviceTimeZone || null);
      setAvailabilityNeedsRefresh(false);
      setLoadError("");
    }
    if (!read) {
      const savedRequest = editorRequest;
      if (savedRequest) {
        const unansweredOccurrenceIds = savedRequest.occurrences
          .map(({ occurrenceId }) => occurrenceId)
          .filter((id) => !Object.hasOwn(answers, id));
        setRequests((current) => current.map((request) => requestKey(request) === requestKey(savedRequest)
          ? {
              ...request,
              availability: copyAnswers(answers),
              unansweredOccurrenceIds,
              submissionId: result.submissionId,
              respondedAt: result.submittedAt || request.respondedAt,
            }
          : request));
      }
      setAvailabilityNeedsRefresh(true);
      setLoadError("Your response was saved. Refresh to confirm the latest answers before editing again.");
    }
    setEditorRequest(null);
    setEditorDirty(false);
    setSaving(false);
  }, [editorRequest]);

  const openRequest = (request: VolunteerAvailabilityRequest) => {
    requestAction(() => {
      setEditorRequest(request);
      setEditorDirty(false);
    });
  };

  const backToRequests = () => requestAction(() => {
    setEditorRequest(null);
    setEditorDirty(false);
  });

  const personalSchedulePath = access ? "/s?view=schedule#time-off" : "/my-schedule#time-off";

  return (
    <AppPageShell
      title="My Availability"
      icon={CalendarDays}
      iconColorClass="text-teal-300"
      description="Review service-date requests and update your responses."
      showAccountNavigation={!access}
      contentClassName="max-w-4xl"
    >
      <div className="flex w-full flex-col gap-4">
        <VolunteerSelfServiceNavigation access={access} active="availability" />
        <div className="space-y-2 text-sm text-gray-300">
          <p>An unanswered date means you haven't responded. It doesn't mean you're unavailable.</p>
          <p>
            For time off, <Link to={personalSchedulePath} className="text-teal-200 underline decoration-teal-400/60 underline-offset-2 hover:text-white">open Time Off in My Schedule</Link>.
          </p>
        </div>

        {loadState === "loading" ? (
          <div role="status" aria-live="polite" className="space-y-2 text-sm text-gray-400">
            <p>Loading availability requests…</p>
            <div aria-hidden="true" className="h-12 animate-pulse rounded-md bg-gray-800/70" />
            <div aria-hidden="true" className="h-12 animate-pulse rounded-md bg-gray-800/70" />
          </div>
        ) : null}

        {loadState === "error" ? (
          <div role="alert" className="space-y-3 text-sm text-gray-300">
            <p>{loadError || "Could not load your availability requests. Try again."}</p>
            <Button type="button" variant="secondary" disabled={refreshing} isLoading={refreshing}
              onClick={() => void loadRequests({ initial: true, lockEditingOnFailure: true })}>
              {refreshing ? "Refreshing availability…" : "Retry loading availability"}
            </Button>
          </div>
        ) : null}

        {loadState === "ready" && availabilityNeedsRefresh && !activeRequest ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p>{loadError || "Refresh saved availability before editing another request."}</p>
            <Button type="button" variant="secondary" disabled={refreshing} isLoading={refreshing}
              onClick={() => void refreshAvailability()}>
              {refreshing ? "Refreshing availability…" : "Refresh availability"}
            </Button>
          </div>
        ) : null}

        {loadState === "ready" && !activeRequest ? (
          requests.length === 0 ? (
            <p className="text-sm text-gray-300">No availability requests right now.</p>
          ) : (
            <div className="space-y-6">
              <section aria-labelledby="availability-needs-response-heading" className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="availability-needs-response-heading" className="text-sm font-semibold text-gray-100">Needs response</h2>
                  <p className="text-xs text-gray-400">
                    {needsResponse.length === 0
                      ? "No requests need a response."
                      : needsResponse.length + " " + (needsResponse.length === 1 ? "request needs" : "requests need") + " a response."}
                  </p>
                </div>
                {needsResponse.length ? (
                  <ul className="space-y-2">
                    {needsResponse.map((request) => (
                      <RequestCard key={requestKey(request)} request={request} serviceTimeZone={serviceTimeZone}
                        onOpen={() => openRequest(request)} disabled={availabilityNeedsRefresh} />
                    ))}
                  </ul>
                ) : null}
              </section>

              {submittedResponses.length ? (
                <section aria-labelledby="availability-submitted-responses-heading" className="space-y-3">
                  <h2 id="availability-submitted-responses-heading" className="text-sm font-semibold text-gray-100">Submitted responses</h2>
                  <ul className="space-y-2">
                    {submittedResponses.map((request) => (
                      <RequestCard key={requestKey(request)} request={request} serviceTimeZone={serviceTimeZone}
                        onOpen={() => openRequest(request)} disabled={availabilityNeedsRefresh} />
                    ))}
                  </ul>
                </section>
              ) : null}

              {closedRequests.length ? (
                <section aria-labelledby="availability-closed-heading" className="space-y-3">
                  <h2 id="availability-closed-heading" className="text-sm font-semibold text-gray-100">Closed</h2>
                  <ul className="space-y-2">
                    {closedRequests.map((request) => (
                      <RequestCard key={requestKey(request)} request={request} serviceTimeZone={serviceTimeZone}
                        onOpen={() => openRequest(request)} disabled={availabilityNeedsRefresh} />
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )
        ) : null}

        {activeRequest ? (
          <AvailabilityRequestEditor
            key={ownerKey + ":" + requestKey(activeRequest)}
            request={activeRequest}
            serviceTimeZone={serviceTimeZone}
            saving={saving}
            availabilityNeedsRefresh={availabilityNeedsRefresh}
            saveAvailability={operations.saveAvailability}
            refreshAvailability={refreshAvailability}
            onSavingChange={updateSaving}
            onDirtyChange={updateDirty}
            onSaved={handleSaved}
            onBack={backToRequests}
          />
        ) : null}
      </div>

      <Modal
        isOpen={Boolean(pendingNavigation || blockedBySave)}
        onClose={closeNavigationDialog}
        title={blockedBySave ? "Saving availability" : "Unsaved changes"}
        size="sm"
        showCloseButton={false}
        contentPadding="px-4 pb-4 pt-0"
      >
        {blockedBySave ? (
          <>
            <p className="mb-6 text-sm text-gray-200">A save is in progress. Wait for it to finish before leaving this page.</p>
            <div className="flex justify-end"><Button variant="secondary" onClick={closeNavigationDialog}>Stay on page</Button></div>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-gray-200">You have unsaved responses. Do you want to discard them and leave?</p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={closeNavigationDialog}>Stay</Button>
              <Button variant="destructive" onClick={finishNavigation}>Discard changes</Button>
            </div>
          </>
        )}
      </Modal>
    </AppPageShell>
  );
};

const MyAvailability = ({ access }: { access?: PersonalScheduleAccess }) => {
  const context = useContext(GlobalInfoContext);
  const churchId = access?.churchId || context?.churchId || "";
  const identity = access
    ? "personal:" + churchId + ":" + access.memberId + ":" + (access.sessionKey || "session")
    : "human:" + churchId + ":" + (context?.userId || "");
  const signedInOperations = useMemo<VolunteerAvailabilityOperations>(() => ({
    loadAvailability: () => getMyVolunteerAvailability(churchId),
    saveAvailability: (request) => submitMyVolunteerAvailability(
      churchId,
      request.recipientId,
      request.availability,
      request.availabilityRevision,
    ),
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
      }
    : signedInOperations, [personalOperations, signedInOperations]);

  return <MyAvailabilityView key={identity} access={access} churchId={churchId} ownerKey={identity} operations={operations} />;
};

export default MyAvailability;

