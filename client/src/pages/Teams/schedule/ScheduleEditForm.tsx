import { memo, useEffect, useMemo, useRef, useState } from "react";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import Button from "../../../components/Button/Button";
import DeleteModal from "../../../components/Modal/DeleteModal";
import Modal from "../../../components/Modal/Modal";
import DatePicker from "@/components/ui/DatePicker";
import { clampPlainDateToMin } from "@/utils/plainDate";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import {
  filterServicesWithOccurrencesInRange,
  generateScheduleOccurrences,
} from "@/utils/teamScheduleOccurrences";
import {
  archiveTeamSchedule,
  createTeamSchedule,
  deleteTeamSchedule,
  updateTeamSchedule,
  type TeamSchedulePayload,
} from "../../../api/auth";
import type { TeamSchedule } from "../../../api/authTypes";
import { useToast } from "../../../context/toastContext";
import useDebouncedEffect from "../../../hooks/useDebouncedEffect";
import generateRandomId from "../../../utils/generateRandomId";
import MultiCheckboxGroup from "../components/MultiCheckboxGroup";
import {
  inputStackClassName,
  panelFormScrollPaddingClassName,
  panelHeaderPaddingClassName,
  panelShellClassName,
  teamsPanelMaxHeightClassName,
} from "../teamsStyles";
import { cn } from "@/utils/cnHelper";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  formatServiceTiming,
  isActive,
  scheduleDraftsMatch,
} from "../teamsUtils";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import {
  buildScheduleDraft,
  rekeyAssignmentsByServiceDate,
  rekeyScheduleOccurrenceRowsByServiceDate,
  remapAssignmentsToOccurrences,
  SCHEDULE_DRAFT_PERSIST_DELAY_MS,
  type ScheduleEditFormProps,
} from "./scheduleDraftUtils";
import {
  formatSuggestedScheduleName,
  getCreateScheduleDefaultRange,
  getCreateScheduleDefaultServiceIds,
  resolveScheduleNameForSave,
} from "./scheduleCreateDefaults";
import TeamsCrossSectionLink from "../components/TeamsCrossSectionLink";
import {
  buildSectionReturnTo,
  TEAMS_SECTION_PATHS,
} from "../teamsReturnNavigation";

const ScheduleEditForm = ({
  mode,
  draftKey,
  persistedDraft,
  selectedSchedule,
  copySourceSchedule,
  defaultTeamId,
  defaultServiceIds,
  defaultRange,
  services,
  activeTeams,
  seedSchedules,
  churchId,
  canEdit,
  onDraftChange,
  onDraftFlush,
  onDraftClear,
  onScheduleSaved,
  onScheduleRemoved,
  setSelectedScheduleId,
  onCancel,
}: ScheduleEditFormProps) => {
  const { showToast } = useToast();
  const editingSchedule = mode === "edit" ? selectedSchedule : null;
  const scheduleForDraft = editingSchedule;
  const [draft, setDraft] = useState<TeamSchedulePayload>(() =>
    buildScheduleDraft({
      persistedDraft,
      selectedSchedule: scheduleForDraft,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    }),
  );
  const [saving, setSaving] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [scheduleConflictWarning, setScheduleConflictWarning] = useState<{
    fingerprint: string;
    conflicts: Array<{ teamId?: string; scheduleName?: string; conflictingOccurrenceId?: string; occurrenceId: string }>;
  } | null>(null);
  const draftRef = useRef(draft);
  const skipNextPersistRef = useRef(false);
  // After a successful create we clear the intent-specific draft; skip the
  // unmount flush and the resulting one-time prop reconciliation so they cannot
  // rewrite or replace the just-saved form state.
  const skipUnmountFlushRef = useRef(false);
  const skipNextPersistedDraftResetRef = useRef(false);
  // The last draft we synced from the schedule/persisted source. If the live
  // draft has diverged from this, the operator has unsaved edits in progress and
  // a remote-driven reset must not clobber them.
  const syncedBaselineRef = useRef(draft);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const nextDraft = buildScheduleDraft({
      persistedDraft,
      selectedSchedule: scheduleForDraft,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    });
    skipNextPersistRef.current = true;
    syncedBaselineRef.current = nextDraft;
    setDraft(nextDraft);
    // Defaults are read from the render that opened this schedule/draft. Do not
    // re-seed when create defaults recalculate (schedules sync, team filter
    // load) or an in-progress edit/create would be wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the active schedule changes
  }, [draftKey, mode, scheduleForDraft?.scheduleId]);

  useEffect(() => {
    const nextDraft = buildScheduleDraft({
      persistedDraft,
      selectedSchedule: scheduleForDraft,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    });
    if (skipNextPersistedDraftResetRef.current) {
      skipNextPersistedDraftResetRef.current = false;
      syncedBaselineRef.current = draftRef.current;
      return;
    }
    if (scheduleDraftsMatch(draftRef.current, nextDraft)) {
      syncedBaselineRef.current = nextDraft;
      return;
    }
    // Live SSE or bootstrap recovery replaces the selectedSchedule object whenever another
    // admin edits this schedule (including assignment-only changes). If the
    // operator has unsaved edits in this form — the draft has diverged from the
    // last synced baseline — don't overwrite their work with the remote version.
    // Their edits win until they save or cancel.
    if (!scheduleDraftsMatch(draftRef.current, syncedBaselineRef.current)) {
      return;
    }
    skipNextPersistRef.current = true;
    syncedBaselineRef.current = nextDraft;
    setDraft(nextDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remote draft/schedule sync only
  }, [persistedDraft, mode, scheduleForDraft]);

  useDebouncedEffect(
    () => {
      if (!canEdit) return;
      if (skipNextPersistRef.current) {
        skipNextPersistRef.current = false;
        return;
      }
      onDraftChange(draftKey, draftRef.current);
    },
    [canEdit, draft, draftKey, onDraftChange],
    SCHEDULE_DRAFT_PERSIST_DELAY_MS,
  );

  useEffect(
    () => () => {
      if (!canEdit) return;
      if (skipUnmountFlushRef.current) return;
      onDraftFlush(draftKey, draftRef.current);
    },
    [canEdit, draftKey, onDraftFlush],
  );

  const isCopy = mode === "copy";
  const isGeneratedPeriodSchedule =
    mode === "edit" && editingSchedule?.source === "generated-period";
  const hasPendingChanges = !scheduleDraftsMatch(draft, syncedBaselineRef.current);
  useTeamsUnsavedChanges(hasPendingChanges);

  const suggestedName = useMemo(
    () =>
      formatSuggestedScheduleName(draft.startDate || "", draft.endDate || ""),
    [draft.endDate, draft.startDate],
  );

  const applyTeamCreateDefaults = (teamId: string) => {
    const range = getCreateScheduleDefaultRange({
      teamId,
      schedules: seedSchedules,
    });
    const serviceIds = getCreateScheduleDefaultServiceIds({
      teamId,
      schedules: seedSchedules,
      services,
      range,
    });
    setDraft((current) => ({
      ...current,
      teamId,
      startDate: range.startDate,
      endDate: range.endDate,
      serviceIds,
    }));
  };

  const draftOccurrences = useMemo(
    () =>
      generateScheduleOccurrences({
        services,
        serviceIds: draft.serviceIds,
        startDate: draft.startDate || "",
        endDate: draft.endDate || "",
      }),
    [draft.endDate, draft.serviceIds, draft.startDate, services],
  );

  const serviceOptions = useMemo(() => {
    const serviceIdsWithOccurrences = new Set(
      draft.startDate && draft.endDate
        ? filterServicesWithOccurrencesInRange({
          services: services.filter(isActive),
          startDate: draft.startDate,
          endDate: draft.endDate,
        }).map((service) => service.serviceId)
        : [],
    );

    return services.map((service) => ({
      id: service.serviceId,
      label: [service.name, formatServiceTiming(service)]
        .filter(Boolean)
        .join(" - "),
      archived: Boolean(service.archivedAt),
      // Keep date-inapplicable services visible so operators can understand why
      // they are unavailable for this range; selected legacy services can still
      // be removed by the checkbox control.
      unavailable:
        Boolean(draft.startDate && draft.endDate) &&
        !service.archivedAt &&
        !serviceIdsWithOccurrences.has(service.serviceId),
      unavailableLabel: "no occurrences in this range",
    }));
  }, [draft.endDate, draft.startDate, services]);

  const saveSchedule = async (confirmedOccurrenceConflictFingerprint?: string) => {
    if (!canEdit) return;
    const isCreate = mode !== "edit";
    const occurrenceDataSource = editingSchedule || copySourceSchedule;
    const currentDraft = draftRef.current;
    const resolvedName = resolveScheduleNameForSave({
      name: currentDraft.name || "",
      startDate: currentDraft.startDate || "",
      endDate: currentDraft.endDate || "",
    });
    if (!resolvedName) {
      showToast("Enter a schedule name or choose a date range.", "error");
      return;
    }
    const draftForSave = { ...currentDraft, name: resolvedName };
    if (draftForSave.name !== currentDraft.name) {
      setDraft(draftForSave);
      draftRef.current = draftForSave;
    }
    onDraftFlush(draftKey, draftForSave);
    try {
      const occurrences = isGeneratedPeriodSchedule && editingSchedule
        ? editingSchedule.occurrences || []
        : generateScheduleOccurrences({
          services,
          serviceIds: draftForSave.serviceIds,
          startDate: draftForSave.startDate || "",
          endDate: draftForSave.endDate || "",
        });
      // Creating a schedule (including a copy): remap the draft's assignments
      // onto the freshly generated occurrences by service + chronological index,
      // so a copied schedule keeps its people even when the date range shifts.
      // For a blank new schedule this is a no-op (no source occurrences). Editing
      // an existing schedule re-keys by (service, date) so assignments survive the
      // occurrence-id change when services are combined/un-combined after the fact.
      const assignments = editingSchedule
        ? rekeyAssignmentsByServiceDate({
          sourceOccurrences: draftForSave.occurrences || [],
          targetOccurrences: occurrences,
          assignments: draftForSave.assignments || {},
        })
        : remapAssignmentsToOccurrences({
          sourceOccurrences: draftForSave.occurrences || [],
          targetOccurrences: occurrences,
          assignments: draftForSave.assignments || {},
        });
      const payload = {
        ...draftForSave,
        ...(isGeneratedPeriodSchedule && editingSchedule
          ? {
            teamId: editingSchedule.teamId,
            startDate: editingSchedule.startDate || "",
            endDate: editingSchedule.endDate || "",
            serviceIds: editingSchedule.serviceIds || [],
            occurrences: editingSchedule.occurrences,
          }
          : { occurrences }),
        assignments,
        ...(occurrenceDataSource?.microphoneAssignments
          ? {
            microphoneAssignments: rekeyScheduleOccurrenceRowsByServiceDate({
              sourceOccurrences: occurrenceDataSource.occurrences || [],
              targetOccurrences: occurrences,
              rows: occurrenceDataSource.microphoneAssignments,
            }),
          }
          : {}),
        ...(occurrenceDataSource?.iemAssignments
          ? {
            iemAssignments: rekeyScheduleOccurrenceRowsByServiceDate({
              sourceOccurrences: occurrenceDataSource.occurrences || [],
              targetOccurrences: occurrences,
              rows: occurrenceDataSource.iemAssignments,
            }),
          }
          : {}),
        ...(occurrenceDataSource?.additionalPositionSlots
          ? {
            additionalPositionSlots: rekeyScheduleOccurrenceRowsByServiceDate({
              sourceOccurrences: occurrenceDataSource.occurrences || [],
              targetOccurrences: occurrences,
              rows: occurrenceDataSource.additionalPositionSlots,
            }),
          }
          : {}),
        ...(confirmedOccurrenceConflictFingerprint
          ? { confirmedOccurrenceConflictFingerprint }
          : {}),
      };
      setSaving(true);
      const localScheduleId =
        editingSchedule?.scheduleId || `local-schedule-${generateRandomId()}`;
      const optimisticSchedule: TeamSchedule = {
        churchId,
        scheduleId: localScheduleId,
        name: payload.name.trim(),
        description: payload.description || "",
        teamId: payload.teamId,
        startDate: payload.startDate,
        endDate: payload.endDate,
        serviceIds: payload.serviceIds,
        occurrences,
        assignments,
        ...(payload.guests !== undefined ? { guests: payload.guests } : {}),
        microphoneAssignments: payload.microphoneAssignments,
        iemAssignments: payload.iemAssignments,
        additionalPositionSlots: payload.additionalPositionSlots,
        archivedAt: editingSchedule?.archivedAt || null,
        ...(editingSchedule?.source ? { source: editingSchedule.source } : {}),
        ...(editingSchedule?.generatedPeriodKey
          ? { generatedPeriodKey: editingSchedule.generatedPeriodKey }
          : {}),
      };
      onScheduleSaved(optimisticSchedule);
      const response = editingSchedule
        ? await updateTeamSchedule(churchId, editingSchedule.scheduleId, payload)
        : await createTeamSchedule(churchId, payload);
      if (isCreate) {
        onScheduleSaved(response.schedule, localScheduleId);
        // Drop this intent-specific draft after a successful create. Skip the
        // unmount flush so cleanup cannot rewrite the cleared key.
        skipUnmountFlushRef.current = true;
        skipNextPersistedDraftResetRef.current = true;
        syncedBaselineRef.current = draftForSave;
        onDraftClear(draftKey);
      } else {
        onScheduleSaved(response.schedule);
      }
      setSelectedScheduleId(response.schedule.scheduleId);
      setScheduleConflictWarning(null);
    } catch (error) {
      const details = (error as { details?: unknown } | null)?.details;
      if (details && typeof details === "object") {
        const conflict = details as { conflictFingerprint?: unknown; occurrenceConflicts?: unknown };
        if (typeof conflict.conflictFingerprint === "string" && Array.isArray(conflict.occurrenceConflicts)) {
          setScheduleConflictWarning({
            fingerprint: conflict.conflictFingerprint,
            conflicts: conflict.occurrenceConflicts as Array<{ teamId?: string; scheduleName?: string; conflictingOccurrenceId?: string; occurrenceId: string }>,
          });
          if (editingSchedule) onScheduleSaved(editingSchedule);
          return;
        }
      }
      if (editingSchedule) onScheduleSaved(editingSchedule);
      showApiErrorToast(showToast, error, "Could not save this schedule.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSchedule = async () => {
    if (!canEdit) return;
    if (!editingSchedule) return;
    const schedule = editingSchedule;
    setDeletingSchedule(false);
    if (schedule.scheduleId.startsWith("local-")) {
      onScheduleRemoved(schedule.scheduleId);
      setSelectedScheduleId("");
      return;
    }
    setDeleteBusy(true);
    onScheduleRemoved(schedule.scheduleId);
    setSelectedScheduleId("");
    try {
      await deleteTeamSchedule(churchId, schedule.scheduleId);
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not delete this schedule.");
      onScheduleSaved(schedule);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <section
        className={cn(
          panelShellClassName,
          "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden",
          teamsPanelMaxHeightClassName,
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-start justify-between gap-3",
            panelHeaderPaddingClassName,
          )}
        >
          <h2 className="text-lg font-semibold">
            {mode === "create-custom"
              ? "New schedule"
              : mode === "copy"
                ? "Copy schedule"
                : isGeneratedPeriodSchedule
                  ? "Schedule details"
                  : "Edit schedule"}
          </h2>
          {canEdit && editingSchedule ? (
            <EntityFormDangerActions
              archived={Boolean(editingSchedule.archivedAt)}
              canEdit={canEdit}
              archiveLabel="Archive schedule"
              deleteLabel="Delete schedule"
              menuLabel="Schedule actions"
              onArchive={
                editingSchedule.archivedAt
                  ? undefined
                  : async () => {
                    if (!canEdit) return;
                    const archivedSchedule = {
                      ...editingSchedule,
                      archivedAt: new Date().toISOString(),
                    };
                    onScheduleSaved(archivedSchedule);
                    try {
                      await archiveTeamSchedule(churchId, editingSchedule.scheduleId);
                    } catch (error) {
                      showApiErrorToast(showToast, error, "Could not archive this schedule.");
                      onScheduleSaved(editingSchedule);
                    }
                  }
              }
              onDelete={() => setDeletingSchedule(true)}
            />
          ) : null}
        </div>
        <div
          className={cn(
            "scrollbar-variable mt-4 min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
            panelFormScrollPaddingClassName,
          )}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {!isGeneratedPeriodSchedule ? <div className={inputStackClassName}>
              <Select
                label="Team"
                value={draft.teamId}
                onChange={(teamId) => {
                  if (mode === "edit") {
                    setDraft((current) => ({ ...current, teamId }));
                    return;
                  }
                  applyTeamCreateDefaults(teamId);
                }}
                options={activeTeams.map((team) => ({
                  label: team.name,
                  value: team.teamId,
                }))}
                disabled={!canEdit || activeTeams.length === 0}
              />
              {activeTeams.length === 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-gray-400">
                  No teams yet.{" "}
                  <TeamsCrossSectionLink
                    to={TEAMS_SECTION_PATHS.groups}
                    returnTo={buildSectionReturnTo(TEAMS_SECTION_PATHS.schedules)}
                    className="cursor-pointer"
                  >
                    Create a team
                  </TeamsCrossSectionLink>{" "}
                  to start scheduling.
                </p>
              ) : null}
            </div> : null}
            {!isGeneratedPeriodSchedule ? <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
              <DatePicker
                label="Start date"
                value={draft.startDate || ""}
                onChange={(startDate) =>
                  setDraft((current) => ({
                    ...current,
                    startDate,
                    endDate: clampPlainDateToMin(
                      current.endDate || "",
                      startDate,
                    ),
                  }))
                }
              />
              <DatePicker
                label="End date"
                value={draft.endDate || ""}
                min={draft.startDate || undefined}
                onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
              />
            </div> : null}
            {!isGeneratedPeriodSchedule ? <div className="lg:col-span-2">
              <MultiCheckboxGroup
                label="Services"
                options={serviceOptions}
                value={draft.serviceIds}
                onChange={(serviceIds) => setDraft((current) => ({ ...current, serviceIds }))}
              />
              <p className={cn(
                "mt-2 text-xs",
                draftOccurrences.length > 0 ? "text-gray-400" : "text-amber-300",
              )}>
                {draftOccurrences.length > 0
                  ? `${draftOccurrences.length} service occurrences will appear in this schedule.`
                  : "No service occurrences match this date range. Choose another range or service."}
              </p>
              {isCopy ? (
                <p className="mt-1 text-xs text-gray-400">
                  Set the new date range. Assignments stay with matching services and
                  move to replacement services when needed.
                </p>
              ) : null}
            </div> : null}
            <Input
              className={inputStackClassName}
              label="Name"
              value={draft.name}
              onChange={(name) => setDraft((current) => ({ ...current, name: String(name) }))}
              helperText={
                mode !== "edit" && !draft.name.trim() && suggestedName
                  ? `Saved as “${suggestedName}” unless you enter a name.`
                  : undefined
              }
            />
            <TextArea
              className="lg:col-span-2"
              label="Description"
              value={draft.description || ""}
              textareaClassName="min-h-20"
              onChange={(description) => setDraft((current) => ({ ...current, description }))}
            />
            {isGeneratedPeriodSchedule ? (
              <p className="text-sm text-gray-400 lg:col-span-2">
                This schedule stays tied to its service period. Copy it to change the team, dates, or services.
              </p>
            ) : null}
          </div>
        </div>
        <FormActionButtons
          pinFooter
          entityLabel="schedule"
          isCreate={mode !== "edit"}
          isSaving={saving}
          onSave={() => void saveSchedule()}
          onCancel={onCancel}
          hasPendingChanges={hasPendingChanges}
          disabled={
            !canEdit ||
            saving ||
            (!draft.name.trim() && !suggestedName) ||
            !draft.teamId ||
            draft.serviceIds.length === 0 ||
            draftOccurrences.length === 0
          }
        />
      </section>
      <DeleteModal
        isOpen={deletingSchedule}
        onClose={() => setDeletingSchedule(false)}
        onConfirm={() => void confirmDeleteSchedule()}
        itemName={editingSchedule?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the schedule"
        warningMessage="This cannot be undone, including all of its assignments. Archive instead to keep a record."
      />
      <Modal
        isOpen={Boolean(scheduleConflictWarning)}
        onClose={() => setScheduleConflictWarning(null)}
        title="Schedule conflict"
        size="sm"
        description="Confirm whether to save this schedule despite a team conflict."
      >
        <div className="space-y-4">
          {scheduleConflictWarning?.conflicts.length ? (
            <ul className="max-h-48 space-y-2 overflow-y-auto rounded border border-gray-700 p-3 text-sm text-gray-300">
              {scheduleConflictWarning.conflicts.map((conflict, index) => {
                const teamName = activeTeams.find((team) => team.teamId === conflict.teamId)?.name;
                return (
                  <li key={`${conflict.teamId || "team"}:${conflict.conflictingOccurrenceId || conflict.occurrenceId}:${index}`}>
                    {teamName || conflict.teamId || "Another team"}
                    {conflict.scheduleName ? ` · ${conflict.scheduleName}` : ""}
                    {conflict.conflictingOccurrenceId ? ` · ${conflict.conflictingOccurrenceId}` : ""}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-amber-300">The conflict set changed. There are no current overlaps; confirm again to continue.</p>
          )}
          <p className="text-sm text-gray-400">
            Confirm if this is intentional.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              onClick={() => setScheduleConflictWarning(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                const pending = scheduleConflictWarning;
                setScheduleConflictWarning(null);
                if (pending) void saveSchedule(pending.fingerprint);
              }}
            >
              Save anyway
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default memo(ScheduleEditForm);
