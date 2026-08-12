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
  getCellMemberIds,
  isActive,
  scheduleDraftsMatch,
} from "../teamsUtils";
import { formatScheduleSaveToast } from "../teamsSaveToasts";
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
  findCrossTeamScheduleOccurrenceConflicts,
  formatCrossTeamScheduleConflictWarning,
} from "./scheduleConflicts";

const ScheduleEditForm = ({
  draftKey,
  persistedDraft,
  selectedSchedule,
  defaultTeamId,
  defaultServiceIds,
  defaultRange,
  services,
  activeTeams,
  schedules,
  churchId,
  canEdit,
  onDraftChange,
  onDraftFlush,
  onScheduleSaved,
  onScheduleRemoved,
  setSelectedScheduleId,
  onCancel,
}: ScheduleEditFormProps) => {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<TeamSchedulePayload>(() =>
    buildScheduleDraft({
      persistedDraft,
      selectedSchedule,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    }),
  );
  const [saving, setSaving] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [scheduleConflictWarning, setScheduleConflictWarning] = useState("");
  const draftRef = useRef(draft);
  const skipNextPersistRef = useRef(false);
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
      selectedSchedule,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    });
    skipNextPersistRef.current = true;
    syncedBaselineRef.current = nextDraft;
    setDraft(nextDraft);
    // persistedDraft is intentionally omitted; remote draft sync is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the active schedule changes
  }, [defaultRange, defaultServiceIds, defaultTeamId, draftKey, selectedSchedule?.scheduleId]);

  useEffect(() => {
    const nextDraft = buildScheduleDraft({
      persistedDraft,
      selectedSchedule,
      defaultTeamId,
      defaultServiceIds,
      defaultRange,
    });
    if (scheduleDraftsMatch(draftRef.current, nextDraft)) {
      syncedBaselineRef.current = nextDraft;
      return;
    }
    // Live polling/SSE replaces the selectedSchedule object whenever another
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
  }, [
    defaultRange,
    defaultServiceIds,
    defaultTeamId,
    persistedDraft,
    selectedSchedule,
  ]);

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
      onDraftFlush(draftKey, draftRef.current);
    },
    [canEdit, draftKey, onDraftFlush],
  );

  // A copy is a create flow (no selectedSchedule) that arrives pre-populated with
  // assignments. Surface what carries over so the date change isn't a surprise.
  const isCopy =
    !selectedSchedule && Object.keys(draft.assignments || {}).length > 0;
  const hasPendingChanges = !scheduleDraftsMatch(draft, syncedBaselineRef.current);
  useTeamsUnsavedChanges(hasPendingChanges);

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

  const getScheduleSaveConflictWarning = (payload: TeamSchedulePayload) => {
    if (!payload.assignments || Object.keys(payload.assignments).length === 0) {
      return "";
    }
    const scheduleForConflict: TeamSchedule = {
      churchId,
      scheduleId: selectedSchedule?.scheduleId || "draft-schedule",
      name: payload.name,
      description: payload.description || "",
      teamId: payload.teamId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      serviceIds: payload.serviceIds,
      occurrences: payload.occurrences || [],
      assignments: payload.assignments,
      archivedAt: selectedSchedule?.archivedAt || null,
    };
    const conflicts = Object.entries(payload.assignments).flatMap(
      ([occurrenceId, row]) => {
        const memberIds = new Set(
          Object.values(row || {}).flatMap(getCellMemberIds),
        );
        return [...memberIds].flatMap((memberId) =>
          findCrossTeamScheduleOccurrenceConflicts({
            schedule: scheduleForConflict,
            occurrenceId,
            memberId,
            schedules,
            teams: activeTeams,
          }),
        );
      },
    );
    return formatCrossTeamScheduleConflictWarning(conflicts);
  };

  const saveSchedule = async (allowCrossTeamConflict = false) => {
    if (!canEdit) return;
    const currentDraft = draftRef.current;
    onDraftFlush(draftKey, currentDraft);
    try {
      const occurrences = generateScheduleOccurrences({
        services,
        serviceIds: currentDraft.serviceIds,
        startDate: currentDraft.startDate || "",
        endDate: currentDraft.endDate || "",
      });
      // Creating a schedule (including a copy): remap the draft's assignments
      // onto the freshly generated occurrences by service + chronological index,
      // so a copied schedule keeps its people even when the date range shifts.
      // For a blank new schedule this is a no-op (no source occurrences). Editing
      // an existing schedule re-keys by (service, date) so assignments survive the
      // occurrence-id change when services are combined/un-combined after the fact.
      const assignments = selectedSchedule
        ? rekeyAssignmentsByServiceDate({
          sourceOccurrences: currentDraft.occurrences || [],
          targetOccurrences: occurrences,
          assignments: currentDraft.assignments || {},
        })
        : remapAssignmentsToOccurrences({
          sourceOccurrences: currentDraft.occurrences || [],
          targetOccurrences: occurrences,
          assignments: currentDraft.assignments || {},
        });
      const payload = {
        ...currentDraft,
        occurrences,
        assignments,
        ...(selectedSchedule?.microphoneAssignments
          ? {
            microphoneAssignments: rekeyScheduleOccurrenceRowsByServiceDate({
              sourceOccurrences: selectedSchedule.occurrences || [],
              targetOccurrences: occurrences,
              rows: selectedSchedule.microphoneAssignments,
            }),
          }
          : {}),
        ...(selectedSchedule?.additionalPositionSlots
          ? {
            additionalPositionSlots: rekeyScheduleOccurrenceRowsByServiceDate({
              sourceOccurrences: selectedSchedule.occurrences || [],
              targetOccurrences: occurrences,
              rows: selectedSchedule.additionalPositionSlots,
            }),
          }
          : {}),
        ...(allowCrossTeamConflict ? { allowCrossTeamConflict: true } : {}),
      };
      const conflictWarning = getScheduleSaveConflictWarning(payload);
      if (conflictWarning && !allowCrossTeamConflict) {
        setScheduleConflictWarning(conflictWarning);
        return;
      }
      const saveToastMessage = formatScheduleSaveToast(selectedSchedule, payload, {
        teamNameById: new Map(
          activeTeams.map((team) => [team.teamId, team.name]),
        ),
        serviceNameById: new Map(
          services.map((service) => [service.serviceId, service.name]),
        ),
      });
      setSaving(true);
      const localScheduleId =
        selectedSchedule?.scheduleId || `local-schedule-${generateRandomId()}`;
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
        additionalPositionSlots: payload.additionalPositionSlots,
        archivedAt: selectedSchedule?.archivedAt || null,
      };
      onScheduleSaved(optimisticSchedule);
      const response = selectedSchedule
        ? await updateTeamSchedule(churchId, selectedSchedule.scheduleId, payload)
        : await createTeamSchedule(churchId, payload);
      if (!selectedSchedule) {
        onScheduleSaved(response.schedule, localScheduleId);
        // Reset the shared "new" draft so the next New/Copy starts clean instead
        // of re-opening with this schedule's (or a copy's) leftover values.
        onDraftFlush(
          draftKey,
          buildScheduleDraft({ defaultTeamId, defaultServiceIds, defaultRange }),
        );
      } else {
        onScheduleSaved(response.schedule);
      }
      setSelectedScheduleId(response.schedule.scheduleId);
      showToast(saveToastMessage, "success");
      setScheduleConflictWarning("");
      onCancel();
    } catch (error) {
      showApiErrorToast(showToast, error, "Could not save this schedule.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteSchedule = async () => {
    if (!canEdit) return;
    if (!selectedSchedule) return;
    const schedule = selectedSchedule;
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
            {selectedSchedule ? "Edit schedule" : "New schedule"}
          </h2>
          {canEdit && selectedSchedule ? (
            <EntityFormDangerActions
              archived={Boolean(selectedSchedule.archivedAt)}
              canEdit={canEdit}
              archiveLabel="Archive schedule"
              deleteLabel="Delete schedule"
              menuLabel="Schedule actions"
              onArchive={
                selectedSchedule.archivedAt
                  ? undefined
                  : async () => {
                    if (!canEdit) return;
                    const archivedSchedule = {
                      ...selectedSchedule,
                      archivedAt: new Date().toISOString(),
                    };
                    onScheduleSaved(archivedSchedule);
                    try {
                      await archiveTeamSchedule(churchId, selectedSchedule.scheduleId);
                    } catch (error) {
                      showApiErrorToast(showToast, error, "Could not archive this schedule.");
                      onScheduleSaved(selectedSchedule);
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
            <Input
              className={inputStackClassName}
              label="Name"
              value={draft.name}
              onChange={(name) => setDraft((current) => ({ ...current, name: String(name) }))}
            />
            <Select
              className={inputStackClassName}
              label="Team"
              value={draft.teamId}
              onChange={(teamId) => setDraft((current) => ({ ...current, teamId }))}
              options={activeTeams.map((team) => ({ label: team.name, value: team.teamId }))}
            />
            <TextArea
              className="lg:col-span-2"
              label="Description"
              value={draft.description || ""}
              textareaClassName="min-h-20"
              onChange={(description) => setDraft((current) => ({ ...current, description }))}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
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
            </div>
            <div className="lg:col-span-2">
              <MultiCheckboxGroup
                label="Services"
                options={serviceOptions}
                value={draft.serviceIds}
                onChange={(serviceIds) => setDraft((current) => ({ ...current, serviceIds }))}
              />
              <p className="mt-2 text-xs text-gray-400">
                {draftOccurrences.length} service occurrences will appear in the grid for this range.
              </p>
              {isCopy ? (
                <p className="mt-1 text-xs text-gray-400">
                  Set the new date range. Assignments stay with matching services and
                  move to replacement services when needed.
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <FormActionButtons
          pinFooter
          saveLabel="Save schedule"
          onSave={() => void saveSchedule()}
          onCancel={onCancel}
          hasPendingChanges={hasPendingChanges}
          disabled={
            !canEdit ||
            !draft.name.trim() ||
            !draft.teamId ||
            draft.serviceIds.length === 0 ||
            draftOccurrences.length === 0
          }
          isLoading={saving}
        />
      </section>
      <DeleteModal
        isOpen={deletingSchedule}
        onClose={() => setDeletingSchedule(false)}
        onConfirm={() => void confirmDeleteSchedule()}
        itemName={selectedSchedule?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the schedule"
        warningMessage="This cannot be undone, including all of its assignments. Archive instead to keep a record."
      />
      <Modal
        isOpen={Boolean(scheduleConflictWarning)}
        onClose={() => setScheduleConflictWarning("")}
        title="Schedule conflict"
        size="sm"
        description="Confirm whether to save this schedule despite a team conflict."
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-200">
            This schedule includes someone who is{" "}
            {scheduleConflictWarning
              ? scheduleConflictWarning.charAt(0).toLowerCase() +
              scheduleConflictWarning.slice(1)
              : "already scheduled on another team"}{" "}
            for the same service.
          </p>
          <p className="text-sm text-gray-400">
            Confirm if this is intentional.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              onClick={() => setScheduleConflictWarning("")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setScheduleConflictWarning("");
                void saveSchedule(true);
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
