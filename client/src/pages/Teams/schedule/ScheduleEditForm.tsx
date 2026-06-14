import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TextArea from "../../../components/TextArea/TextArea";
import DeleteModal from "../../../components/Modal/DeleteModal";
import DatePicker from "@/components/ui/DatePicker";
import FormActionButtons from "../components/FormActionButtons";
import { generateScheduleOccurrences } from "@/utils/teamScheduleOccurrences";
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
import { inputStackClassName } from "../teamsStyles";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  formatServiceTiming,
  scheduleDraftsMatch,
} from "../teamsUtils";
import {
  buildScheduleDraft,
  remapAssignmentsToOccurrences,
  SCHEDULE_DRAFT_PERSIST_DELAY_MS,
  type ScheduleEditFormProps,
} from "./scheduleDraftUtils";

const ScheduleEditForm = ({
  draftKey,
  persistedDraft,
  selectedSchedule,
  defaultTeamId,
  defaultServiceIds,
  defaultRange,
  services,
  activeTeams,
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
  const draftRef = useRef(draft);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    skipNextPersistRef.current = true;
    setDraft(
      buildScheduleDraft({
        persistedDraft,
        selectedSchedule,
        defaultTeamId,
        defaultServiceIds,
        defaultRange,
      }),
    );
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
      return;
    }
    skipNextPersistRef.current = true;
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

  const saveSchedule = async () => {
    if (!canEdit) return;
    const currentDraft = draftRef.current;
    onDraftFlush(draftKey, currentDraft);
    setSaving(true);
    try {
      const occurrences = generateScheduleOccurrences({
        services,
        serviceIds: currentDraft.serviceIds,
        startDate: currentDraft.startDate || "",
        endDate: currentDraft.endDate || "",
      });
      const occurrenceIds = new Set(occurrences.map((occurrence) => occurrence.occurrenceId));
      // Creating a schedule (including a copy): remap the draft's assignments
      // onto the freshly generated occurrences by service + chronological index,
      // so a copied schedule keeps its people even when the date range shifts.
      // For a blank new schedule this is a no-op (no source occurrences). Editing
      // an existing schedule keeps the original date-keyed filter below.
      const assignments = selectedSchedule
        ? Object.fromEntries(
          Object.entries(currentDraft.assignments || {}).filter(([occurrenceId]) =>
            occurrenceIds.has(occurrenceId),
          ),
        )
        : remapAssignmentsToOccurrences({
          sourceOccurrences: currentDraft.occurrences || [],
          targetOccurrences: occurrences,
          assignments: currentDraft.assignments || {},
        });
      const attendance = Object.fromEntries(
        Object.entries(currentDraft.attendance || {}).filter(([occurrenceId]) =>
          occurrenceIds.has(occurrenceId),
        ),
      );
      const payload = {
        ...currentDraft,
        occurrences,
        assignments,
        attendance,
      };
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
        attendance,
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
      }
      setSelectedScheduleId(response.schedule.scheduleId);
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
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
            onChange={(startDate) => setDraft((current) => ({ ...current, startDate }))}
          />
          <DatePicker
            label="End date"
            value={draft.endDate || ""}
            onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))}
          />
        </div>
        <div className="lg:col-span-2">
          <MultiCheckboxGroup
            label="Services"
            options={services.map((service) => ({
              id: service.serviceId,
              label: [service.name, formatServiceTiming(service)].filter(Boolean).join(" - "),
              archived: Boolean(service.archivedAt),
            }))}
            value={draft.serviceIds}
            onChange={(serviceIds) => setDraft((current) => ({ ...current, serviceIds }))}
          />
          <p className="mt-2 text-xs text-gray-400">
            {draftOccurrences.length} service occurrences will appear in the grid for this range.
          </p>
          {isCopy ? (
            <p className="mt-1 text-xs text-gray-400">
              Set the new date range and the assignments will move to the matching
              services. Attendance starts fresh.
            </p>
          ) : null}
        </div>
        <div className="space-y-2 lg:col-span-2">
          <FormActionButtons
            saveLabel="Save schedule"
            onSave={() => void saveSchedule()}
            onCancel={onCancel}
            disabled={
              !canEdit ||
              !draft.name.trim() ||
              !draft.teamId ||
              draft.serviceIds.length === 0 ||
              draftOccurrences.length === 0
            }
            isLoading={saving}
          />
          {canEdit && selectedSchedule ? (
            <div className="flex flex-wrap gap-2">
              {!selectedSchedule.archivedAt ? (
                <Button
                  variant="secondary"
                  svg={Archive}
                  iconSize="sm"
                  onClick={async () => {
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
                  }}
                >
                  Archive schedule
                </Button>
              ) : null}
              <Button
                variant="destructive"
                svg={Trash2}
                iconSize="sm"
                onClick={() => setDeletingSchedule(true)}
              >
                Delete schedule
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <DeleteModal
        isOpen={deletingSchedule}
        onClose={() => setDeletingSchedule(false)}
        onConfirm={() => void confirmDeleteSchedule()}
        itemName={selectedSchedule?.name}
        isConfirming={deleteBusy}
        message="Permanently delete the schedule"
        warningMessage="This cannot be undone, including all of its assignments. Archive instead to keep a record."
      />
    </>
  );
};

export default memo(ScheduleEditForm);
