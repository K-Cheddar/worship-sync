import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import Input from "../../../components/Input/Input";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import TimePicker from "../../../components/TimePicker/TimePicker";
import DatePicker from "@/components/ui/DatePicker";
import DateTimePicker from "@/components/ui/DateTimePicker";
import {
  ordinals,
  weekdays,
} from "../../../containers/ServiceTimes/utils";
import { useToast } from "../../../context/toastContext";
import { GlobalInfoContext } from "../../../context/globalInfo";
import { useDispatch, useSelector } from "../../../hooks";
import { AUTOSAVE_DEBOUNCE_KEYS } from "../../../store/autosaveIndicatorSlice";
import {
  addService,
  removeService,
  updateService,
} from "../../../store/serviceTimesSlice";
import type {
  MonthWeekOrdinal,
  MultiWeeklyDay,
  RecurrenceType,
  PositionRequirement,
  ServiceTime,
  Weekday,
} from "../../../types";
import type { TeamRecord, TeamPosition, TeamService } from "../../../api/authTypes";
import type { ServicePlanTemplate } from "../../../types/servicePlan";
import PositionIconBadge from "../../../components/icons/PositionIconBadge";
import { sanitizePositionRequirements } from "../schedule/scheduleRequirements";
import CreatePanel from "../CreatePanel";
import PortableDataActions from "../../../components/PortableDataTransfer/PortableDataActions";
import MultiCheckboxGroup from "../components/MultiCheckboxGroup";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import {
  EntityListFilterFooter,
  EntityListFilterPanel,
  EntityListFilterToolbar,
  type EntityListFilterState,
} from "../components/EntityListFilters";
import Checkbox from "../../../components/Checkbox/Checkbox";
import {
  buildServiceTimeUpdate,
  canServicesShareDay,
  createEmptyServiceDraft,
  formatServiceTiming,
  isActive,
  isServicePastEnd,
  planServiceGroupCleanupOnDelete,
  planServiceGroupUpdates,
} from "../teamsUtils";
import { useTeamsUnsavedChanges } from "../hooks/useTeamsUnsavedChanges";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

const applyPositionCountDrafts = (
  requirements: PositionRequirement[] | undefined,
  drafts: Record<string, string>,
): PositionRequirement[] => {
  const byPositionId = new Map(
    (requirements || []).map((requirement) => [requirement.positionId, requirement.count]),
  );
  Object.entries(drafts).forEach(([positionId, rawCount]) => {
    const parsedCount = Number(rawCount);
    const count = Number.isFinite(parsedCount)
      ? Math.max(0, Math.floor(parsedCount))
      : 0;
    if (count === 0) byPositionId.delete(positionId);
    else byPositionId.set(positionId, count);
  });
  return [...byPositionId].map(([positionId, count]) => ({ positionId, count }));
};

type ServiceManagerProps = {
  services: TeamService[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  planTemplates?: ServicePlanTemplate[];
  canEdit: boolean;
  onImported?: () => void;
};

const ServiceManager = ({
  services,
  positions,
  teams,
  planTemplates = [],
  canEdit,
  onImported,
}: ServiceManagerProps) => {
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const churchId = useContext(GlobalInfoContext)?.churchId || "";
  const { requestDiscardAction } = useTeamsNavigationGuard();
  const [editing, setEditing] = useState<TeamService | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [listFilters, setListFilters] = useState<EntityListFilterState>({
    teamIds: [],
    includeArchived: false,
  });
  const [draft, setDraft] = useState<Partial<ServiceTime>>(createEmptyServiceDraft);
  // Other services this one is combined with (shares one set of schedule cells).
  const [combineWith, setCombineWith] = useState<string[]>([]);
  // Keep number inputs editable while the operator is typing. Values are
  // normalized and committed when the field loses focus.
  const [positionCountDrafts, setPositionCountDrafts] = useState<Record<string, string>>({});
  const [savingEditorKeys, setSavingEditorKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedEditorKeys, setFailedEditorKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const savingEditorKeysRef = useRef(new Set<string>());
  const pendingSavesRef = useRef(new Map<string, {
    expectedService: ServiceTime;
    partnerUpdates: { id: string; serviceGroupId?: string | null }[];
    pendingObserved: boolean;
  }>());
  const serviceTimesSavePending = useSelector((state) =>
    state.autosaveIndicator
      ? Boolean(
        state.autosaveIndicator.debouncedSaveDepth[
          AUTOSAVE_DEBOUNCE_KEYS.serviceTimes
        ],
      )
      : null,
  );

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft(createEmptyServiceDraft());
    setCombineWith([]);
    setPositionCountDrafts({});
  };

  const startEdit = (service: TeamService) => {
    setEditing(service);
    setShowCreate(true);
    setDraft({ ...service });
    setPositionCountDrafts({});
    setCombineWith(
      service.serviceGroupId
        ? services
          .filter(
            (item) =>
              item.serviceGroupId === service.serviceGroupId &&
              item.serviceId !== service.serviceId,
          )
          .map((item) => item.serviceId)
        : [],
    );
  };

  const updateRecurrence = (recurrence: RecurrenceType) => {
    setDraft((current) => ({
      ...createEmptyServiceDraft(),
      id: current.id,
      name: current.name || "",
      defaultPlanTemplateId: current.defaultPlanTemplateId,
      reccurence: recurrence,
    }));
  };

  const initialCombineWith = editing?.serviceGroupId
    ? services
      .filter(
        (service) =>
          service.serviceGroupId === editing.serviceGroupId &&
          service.serviceId !== editing.serviceId,
      )
      .map((service) => service.serviceId)
      .sort()
    : [];

  const submit = () => {
    if (!canEdit) return;
    const name = String(draft.name || "").trim();
    if (!name) {
      showToast("Service name is required.", "neutral");
      return;
    }
    const { groupId, partnerUpdates } = planServiceGroupUpdates({
      services,
      serviceId: editing?.serviceId,
      currentGroupId: editing?.serviceGroupId,
      partnerIds: combineWith,
    });
    const saved = buildServiceTimeUpdate(
      {
        ...draft,
        name,
        positionRequirements: sanitizePositionRequirements(
          applyPositionCountDrafts(draft.positionRequirements, positionCountDrafts),
        ),
        serviceGroupId: groupId,
      },
      editing,
    );
    const editorKey = editing?.serviceId || saved.id;
    if (
      savingEditorKeysRef.current.has(editorKey) ||
      pendingSavesRef.current.has(editorKey)
    ) return;
    const retryingFailedCreate = Boolean(
      editing &&
      failedEditorKeys.has(editorKey) &&
      !services.some((service) => service.serviceId === editorKey),
    );
    setFailedEditorKeys((current) => {
      if (!current.has(editorKey)) return current;
      const next = new Set(current);
      next.delete(editorKey);
      return next;
    });
    if (editing && !retryingFailedCreate) {
      dispatch(updateService({ id: editing.id, changes: saved }));
    } else {
      dispatch(addService(saved));
    }
    // Stamp the shared group id on partners (and clear it on services that left).
    partnerUpdates.forEach(({ id, serviceGroupId }) => {
      dispatch(updateService({ id, changes: { serviceGroupId } }));
    });
    // Redux dispatch is optimistic; the store listener commits to Firebase and
    // can roll this change back. Without a per-action acknowledgment, a success
    // toast here would claim persistence before it is confirmed.
    // Saving commits data; keep the same service open on every screen size.
    // A new service uses its generated id immediately so later saves update it.
    const nextEditing: TeamService = {
      ...(editing ?? {}),
      ...saved,
      serviceId: editing?.serviceId || saved.id,
      churchId: editing?.churchId || churchId,
    };
    if (serviceTimesSavePending === null) {
      // The selector is unavailable in isolated editor contexts; dispatch stays
      // optimistic there, matching the existing local save behavior.
    } else {
      savingEditorKeysRef.current.add(nextEditing.serviceId);
      pendingSavesRef.current.set(nextEditing.serviceId, {
        expectedService: saved,
        partnerUpdates,
        pendingObserved: serviceTimesSavePending === true,
      });
      setSavingEditorKeys((current) => new Set(current).add(nextEditing.serviceId));
    }
    setEditing(nextEditing);
    setDraft({ ...nextEditing });
  };

  const editorKey = editing?.serviceId || "__create__";
  const hasIncompletePositionCountDraft = Object.values(positionCountDrafts).some(
    (value) => !value.trim() || !Number.isFinite(Number(value)),
  );
  const hasPositionCountDraftChanges = Object.entries(positionCountDrafts).some(
    ([positionId, value]) => {
      const parsedCount = Number(value);
      const normalizedCount = Number.isFinite(parsedCount)
        ? Math.max(0, Math.floor(parsedCount))
        : 0;
      const savedCount = draft.positionRequirements?.find(
        (requirement) => requirement.positionId === positionId,
      )?.count ?? 0;
      return !value.trim() || normalizedCount !== savedCount;
    },
  );
  const normalizeServiceDraft = (value: typeof draft) => ({
    ...value,
    daysOfWeek: [...(value.daysOfWeek || [])].sort((a, b) => a.day - b.day),
  });
  const hasPendingChanges =
    failedEditorKeys.has(editorKey) ||
    JSON.stringify(normalizeServiceDraft(draft)) !==
      JSON.stringify(normalizeServiceDraft(editing || createEmptyServiceDraft())) ||
    JSON.stringify([...combineWith].sort()) !== JSON.stringify(initialCombineWith) ||
    hasPositionCountDraftChanges;

  useEffect(() => {
    const pendingSaves = pendingSavesRef.current;
    if (pendingSaves.size === 0) return;
    if (serviceTimesSavePending === true) {
      pendingSaves.forEach((pending) => {
        pending.pendingObserved = true;
      });
      return;
    }
    if (serviceTimesSavePending === null) {
      pendingSaves.forEach((pending) => {
        if (!pending.pendingObserved) pending.pendingObserved = true;
      });
    }
    if (serviceTimesSavePending !== false && serviceTimesSavePending !== null) return;

    // The Firebase writer converts undefined optional fields to null before persisting.
    const comparableValue = (value: unknown) =>
      JSON.stringify(value, (_key, nestedValue: unknown) =>
        nestedValue === undefined ? null : nestedValue,
      );
    const matchesExpectedService = (actual: ServiceTime | undefined, expected: ServiceTime) =>
      Boolean(actual) && Object.entries(expected).every(([key, value]) =>
        key === "updatedAt" || comparableValue(actual?.[key as keyof ServiceTime]) === comparableValue(value),
      );
    const completedKeys: string[] = [];
    pendingSaves.forEach((pending, key) => {
      const actual = services.find((service) => service.serviceId === key);
      const partnersCommitted = pending.partnerUpdates.every((update) => {
        const partner = services.find((service) => service.id === update.id);
        return partner && comparableValue(partner.serviceGroupId ?? null) === comparableValue(update.serviceGroupId ?? null);
      });
      const saveCommitted = serviceTimesSavePending === null ||
        (matchesExpectedService(actual, pending.expectedService) && partnersCommitted);
      if (!pending.pendingObserved && serviceTimesSavePending === false && saveCommitted) {
        pending.pendingObserved = true;
      }
      if (!pending.pendingObserved && serviceTimesSavePending === false && !saveCommitted) {
        setFailedEditorKeys((current) => new Set(current).add(key));
        completedKeys.push(key);
        return;
      }
      if (!pending.pendingObserved) return;
      if (saveCommitted) {
        setFailedEditorKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      } else {
        setFailedEditorKeys((current) => new Set(current).add(key));
      }
      completedKeys.push(key);
    });
    completedKeys.forEach((key) => pendingSaves.delete(key));
    completedKeys.forEach((key) => savingEditorKeysRef.current.delete(key));
    setSavingEditorKeys((current) => {
      if (!completedKeys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      completedKeys.forEach((key) => next.delete(key));
      return next;
    });
  }, [serviceTimesSavePending, services]);

  // Services that can be combined with the one being edited: anything that could
  // fall on the same day (combining only merges same-day occurrences). Already
  // combined partners stay listed even if the day changed, so they can be removed.
  const editedServiceDayShape = {
    reccurence: draft.reccurence || "weekly",
    dayOfWeek: draft.dayOfWeek,
    daysOfWeek: draft.daysOfWeek,
    weekday: draft.weekday,
    dateTimeISO: draft.dateTimeISO,
  };
  const combinableServices = services.filter(
    (service) =>
      service.serviceId !== editing?.serviceId &&
      (canServicesShareDay(editedServiceDayShape, service) ||
        combineWith.includes(service.serviceId)),
  );

  const activePositions = positions.filter(isActive);
  const filteredServices = useMemo(
    () =>
      services.filter(
        (service) =>
          (listFilters.includeArchived || !service.archivedAt) &&
          (!listQuery.trim() ||
            service.name.toLowerCase().includes(listQuery.trim().toLowerCase())),
      ),
    [listFilters.includeArchived, listQuery, services],
  );
  const emptyFilterMessage =
    !listQuery.trim() && !listFilters.includeArchived
      ? "Archived services are hidden. Open Filter to show them."
      : "No matches.";
  const eligiblePlanTemplates = planTemplates.filter(
    (template) =>
      !template.serviceId || template.serviceId === editing?.serviceId,
  );
  const selectedDefaultTemplateId = draft.defaultPlanTemplateId || "";
  const selectedDefaultTemplateIsMissing = Boolean(
    selectedDefaultTemplateId &&
    !eligiblePlanTemplates.some(
      (template) => template.templateId === selectedDefaultTemplateId,
    ),
  );
  const defaultPlanTemplateOptions = [
    { label: "No default template", value: "" },
    ...eligiblePlanTemplates.map((template) => ({
      label: template.name,
      value: template.templateId,
    })),
    ...(selectedDefaultTemplateIsMissing
      ? [{ label: "Unavailable template", value: selectedDefaultTemplateId }]
      : []),
  ];
  // Positions are owned by teams, so group the requirement checklist by team. A
  // service can be run by more than one team, so several groups may show.
  const positionsByTeam = teams
    .filter(isActive)
    .map((team) => ({
      team,
      teamPositions: activePositions.filter((position) => position.teamId === team.teamId),
    }))
    .filter((group) => group.teamPositions.length > 0);
  const requirements = draft.positionRequirements || [];
  const requirementCount = (positionId: string) =>
    requirements.find((req) => req.positionId === positionId)?.count ?? 0;
  const setPositionNeeded = (positionId: string, needed: boolean) => {
    setPositionCountDrafts((current) => {
      if (current[positionId] === undefined) return current;
      const next = { ...current };
      delete next[positionId];
      return next;
    });
    setDraft((current) => {
      const rest = (current.positionRequirements || []).filter((req) => req.positionId !== positionId);
      const next: PositionRequirement[] = needed
        ? [
          ...rest,
          { positionId, count: Math.max(1, requirementCount(positionId)) },
        ]
        : rest;
      return { ...current, positionRequirements: next };
    });
  };
  const setPositionCount = (positionId: string, count: number) => {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    setDraft((current) => {
      const list = current.positionRequirements || [];
      if (safeCount === 0) {
        return {
          ...current,
          positionRequirements: list.filter((req) => req.positionId !== positionId),
        };
      }
      const next = list.some((req) => req.positionId === positionId)
        ? list.map((req) => (req.positionId === positionId ? { ...req, count: safeCount } : req))
        : [...list, { positionId, count: safeCount }];
      return { ...current, positionRequirements: next };
    });
  };
  const setPositionCountDraft = (positionId: string, value: string | number) => {
    setPositionCountDrafts((current) => ({ ...current, [positionId]: String(value) }));
  };
  const commitPositionCount = (positionId: string) => {
    const rawValue = positionCountDrafts[positionId]?.trim() ?? "";
    const parsedValue = Number(rawValue);
    setPositionCount(positionId, Number.isFinite(parsedValue) ? parsedValue : 0);
    setPositionCountDrafts((current) => {
      const next = { ...current };
      delete next[positionId];
      return next;
    });
  };
  const adjustPositionCount = (positionId: string, delta: number) => {
    const currentCount = Number(positionCountDrafts[positionId] ?? requirementCount(positionId));
    setPositionCount(positionId, currentCount + delta);
    setPositionCountDrafts((current) => {
      const next = { ...current };
      delete next[positionId];
      return next;
    });
  };

  const recurrence = draft.reccurence || "weekly";
  const canSave =
    Boolean(String(draft.name || "").trim()) &&
    !hasIncompletePositionCountDraft &&
    (recurrence === "one_time"
      ? Boolean(draft.dateTimeISO)
      : recurrence === "multi_weekly"
        ? Boolean(draft.daysOfWeek?.length) &&
        (draft.daysOfWeek || []).every((day) => Boolean(day.time))
        : Boolean(draft.time));
  useTeamsUnsavedChanges(hasPendingChanges);

  return (
    <CreatePanel
      open={showCreate}
      onOpenCreate={() => {
        requestDiscardAction(() => {
          setShowFilters(false);
          reset();
          setShowCreate(true);
        });
      }}
      canEdit={canEdit}
      title={editing ? "Edit service" : "Create service"}
      sectionTitle="Service settings"
      description="Manage service times used for scheduling."
      createLabel="Create service"
        listHeaderActions={<PortableDataActions type="services" onImported={onImported} />}
      listToolbar={
        <EntityListFilterToolbar
          entityLabel="Services"
          query={listQuery}
          onQueryChange={setListQuery}
          filters={listFilters}
          onFiltersChange={setListFilters}
          filtersOpen={showFilters}
          onFiltersOpenChange={setShowFilters}
        />
      }
      asideOpen={showFilters}
      asideTitle="Filter services"
      asideHeaderActions={
        <Button variant="tertiary" onClick={() => setShowFilters(false)}>
          Close
        </Button>
      }
      aside={
        <EntityListFilterPanel
          entityLabel="services"
          filters={listFilters}
          onFiltersChange={setListFilters}
        />
      }
      asideFooter={
        <EntityListFilterFooter
          filters={listFilters}
          onClear={() => setListFilters({ teamIds: [], includeArchived: false })}
          onClose={() => setShowFilters(false)}
        />
      }
      list={
        <>
          {services.length === 0 ? <p className="text-sm text-gray-300">No services yet.</p> : null}
          {services.length > 0 && filteredServices.length === 0 ? (
            <p className="text-sm text-gray-300">{emptyFilterMessage}</p>
          ) : null}
          {filteredServices.map((service) => (
            <EntityRow
              key={service.serviceId}
              title={service.name}
              subtitle={formatServiceTiming(service)}
              archived={Boolean(service.archivedAt)}
              inactive={!service.archivedAt && isServicePastEnd(service)}
              canEdit={canEdit}
              onTitleClick={() => {
                if (editing?.serviceId === service.serviceId) return;
                requestDiscardAction(() => startEdit(service));
              }}
            />
          ))}
        </>
      }
      formHeaderActions={
        editing ? (
          <EntityFormDangerActions
            canEdit={canEdit}
            archived={Boolean(editing.archivedAt)}
            archiveLabel="Archive service"
            restoreLabel="Restore service"
            deleteLabel="Remove service"
            menuLabel="Service actions"
            onArchive={() => {
              if (!canEdit) return;
              dispatch(
                updateService({
                  id: editing.id,
                  changes: { archivedAt: new Date().toISOString() },
                }),
              );
              showToast("Service archived.", "success");
              reset();
            }}
            onRestore={() => {
              if (!canEdit) return;
              const restoredService = { ...editing, archivedAt: null };
              dispatch(updateService({ id: editing.id, changes: { archivedAt: null } }));
              setEditing(restoredService);
              setDraft((current) => ({ ...current, archivedAt: null }));
              showToast("Service restored.", "success");
            }}
            onDelete={() => {
              if (!canEdit) return;
              const { partnerUpdates } = planServiceGroupCleanupOnDelete({
                services,
                serviceId: editing.serviceId,
              });
              dispatch(removeService(editing.id));
              // Dissolve a now-orphaned combined group so no service is left
              // pointing at a one-member group.
              partnerUpdates.forEach(({ id, serviceGroupId }) => {
                dispatch(updateService({ id, changes: { serviceGroupId } }));
              });
              reset();
            }}
          />
        ) : null
      }
      formFooter={
        <FormActionButtons
          pinFooter
          entityLabel="service"
          isCreate={!editing}
          isSaving={savingEditorKeys.has(editorKey)}
          onSave={submit}
          onCancel={() => requestDiscardAction(reset)}
          hasPendingChanges={hasPendingChanges}
          disabled={!canEdit || !canSave || !hasPendingChanges || savingEditorKeys.has(editorKey)}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name" value={draft.name || ""} onChange={(name) => setDraft((d) => ({ ...d, name: String(name) }))} />
        <Select
          label="Type"
          value={recurrence}
          onChange={(value) => updateRecurrence(value as RecurrenceType)}
          options={[
            { label: "One-time date", value: "one_time" },
            { label: "Weekly", value: "weekly" },
            { label: "Multi-day weekly", value: "multi_weekly" },
            { label: "Monthly", value: "monthly" },
          ]}
        />
      </div>

      {recurrence === "one_time" ? (
        <DateTimePicker
          label="Date & Time"
          value={draft.dateTimeISO || ""}
          onChange={(dateTimeISO) => setDraft((d) => ({ ...d, dateTimeISO }))}
        />
      ) : null}

      {recurrence === "weekly" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Day"
            value={String(draft.dayOfWeek ?? 0)}
            onChange={(dayOfWeek) => setDraft((d) => ({ ...d, dayOfWeek: Number(dayOfWeek) as Weekday }))}
            options={weekdays.map((day) => ({ label: day.label, value: String(day.value) }))}
          />
          <TimePicker
            variant="countdown"
            labelLayout="stacked"
            label="Time"
            inputClassName="w-full"
            value={draft.time || "10:00"}
            onChange={(time) => setDraft((d) => ({ ...d, time: String(time) }))}
          />
        </div>
      ) : null}

      {recurrence === "multi_weekly" ? (
        <div className="space-y-3">
          <fieldset>
            <legend className="p-1 text-sm font-semibold">Days &amp; times:</legend>
            <div className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2">
              {weekdays.map((day) => {
                const days = draft.daysOfWeek || [];
                const entry = days.find((item) => item.day === day.value);
                return (
                  <div key={day.value} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr]">
                    <Checkbox
                      label={day.label}
                      checked={Boolean(entry)}
                      onCheckedChange={() => {
                        setDraft((current) => {
                          const currentDays = current.daysOfWeek || [];
                          const existing = currentDays.find((item) => item.day === day.value);
                          const nextDays: MultiWeeklyDay[] = existing
                            ? currentDays.filter((item) => item.day !== day.value)
                            : [...currentDays, { day: day.value, time: "10:00" }];
                          return { ...current, daysOfWeek: nextDays };
                        });
                      }}
                    />
                    {entry ? (
                      <TimePicker
                        variant="countdown"
                        value={entry.time}
                        onChange={(time) =>
                          setDraft((current) => ({
                            ...current,
                            daysOfWeek: (current.daysOfWeek || []).map((item) =>
                              item.day === day.value ? { ...item, time: String(time) } : item,
                            ),
                          }))
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
      ) : null}

      {recurrence === "monthly" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Ordinal"
            value={String(draft.ordinal ?? 1)}
            onChange={(ordinal) => setDraft((d) => ({ ...d, ordinal: Number(ordinal) as MonthWeekOrdinal }))}
            options={ordinals.map((ordinal) => ({ label: ordinal.label, value: String(ordinal.value) }))}
          />
          <Select
            label="Weekday"
            value={String(draft.weekday ?? 3)}
            onChange={(weekday) => setDraft((d) => ({ ...d, weekday: Number(weekday) as Weekday }))}
            options={weekdays.map((day) => ({ label: day.label, value: String(day.value) }))}
          />
          <TimePicker
            variant="countdown"
            labelLayout="stacked"
            label="Time"
            inputClassName="w-full"
            value={draft.time || "10:00"}
            onChange={(time) => setDraft((d) => ({ ...d, time: String(time) }))}
          />
        </div>
      ) : null}

      {recurrence === "weekly" ||
        recurrence === "multi_weekly" ||
        recurrence === "monthly" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker
            label="Start date (optional)"
            value={draft.startDateISO || ""}
            onChange={(startDateISO) => setDraft((d) => ({ ...d, startDateISO }))}
          />
          <DatePicker
            label="End date (optional)"
            value={draft.endDateISO || ""}
            onChange={(endDateISO) => setDraft((d) => ({ ...d, endDateISO }))}
          />
        </div>
      ) : null}

      <div className="space-y-1">
        <Select
          label="Default plan template"
          value={selectedDefaultTemplateId}
          onChange={(defaultPlanTemplateId) =>
            setDraft((current) => ({
              ...current,
              defaultPlanTemplateId:
                String(defaultPlanTemplateId || "") || undefined,
            }))
          }
          options={defaultPlanTemplateOptions}
        />
        <p className="text-xs text-gray-400">
          Empty plans offer this as the one-click Apply action. Scheduled role
          links in the template fill from that date&apos;s team schedules.
        </p>
      </div>

      {combinableServices.length > 0 ? (
        <MultiCheckboxGroup
          label="Combined services"
          description="Combine back-to-back services on the same day so the schedule shows one set of positions for them together — assign someone once and it covers every combined service that day."
          optionGridClassName="grid gap-2"
          options={combinableServices.map((service) => ({
            id: service.serviceId,
            label: [service.name, formatServiceTiming(service)]
              .filter(Boolean)
              .join(" - "),
            archived: Boolean(service.archivedAt),
          }))}
          value={combineWith}
          onChange={setCombineWith}
        />
      ) : null}

      <fieldset className="space-y-2">
        <legend className="p-1 text-sm font-semibold">Positions needed</legend>
        <p className="px-1 text-xs text-gray-400">
          Set how many people each position needs for every occurrence. Use 0 for positions
          this service does not need. You can add extra team positions to a specific date later
          without changing the fill requirement.
        </p>
        {positionsByTeam.length === 0 ? (
          <p className="px-1 text-xs text-gray-500">
            No positions yet. Add positions to a team on the Positions tab first.
          </p>
        ) : (
          <div className="space-y-3">
            {positionsByTeam.map(({ team, teamPositions }) => (
              <div
                key={team.teamId}
                className="space-y-2 rounded-md border border-gray-700 bg-gray-950/60 p-2"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {team.name}
                </p>
                <div className="grid grid-cols-[1fr_7rem] items-center gap-3 px-1 text-xs font-semibold text-gray-300">
                  <span />
                  <span className="text-center">People needed</span>
                </div>
                {teamPositions.map((position) => {
                  const needed = requirements.some((req) => req.positionId === position.positionId);
                  const count = requirementCount(position.positionId);
                  return (
                    <div
                      key={position.positionId}
                      className="grid min-h-11 grid-cols-[1fr_7rem] items-center gap-3 rounded-md px-1 py-1 transition-colors hover:bg-white/[0.04]"
                    >
                      <Checkbox
                        checked={needed}
                        onCheckedChange={(checked) =>
                          setPositionNeeded(position.positionId, checked)
                        }
                        label={
                          <span className="inline-flex min-w-0 items-center gap-2">
                            {position.icon ? (
                              <PositionIconBadge
                                icon={position.icon}
                                className="size-5 rounded"
                                iconClassName="size-3.5"
                              />
                            ) : null}
                            {position.name}
                          </span>
                        }
                        className="min-w-0"
                        labelClassName="flex-1 gap-2 text-sm"
                      />
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="tertiary"
                          svg={Minus}
                          padding="p-1"
                          className="min-h-0!"
                          aria-label={`Decrease people needed for ${position.name}`}
                          onClick={() => adjustPositionCount(position.positionId, -1)}
                          disabled={count <= 0}
                        />
                        <Input
                          type="number"
                          min={0}
                          hideLabel
                          aria-label={`People needed for ${position.name}`}
                          value={positionCountDrafts[position.positionId] ?? count}
                          inputWidth="w-14"
                          inputTextSize="text-xs"
                          onChange={(value) => setPositionCountDraft(position.positionId, value)}
                          onBlur={() => commitPositionCount(position.positionId)}
                        />
                        <Button
                          variant="tertiary"
                          svg={Plus}
                          padding="p-1"
                          className="min-h-0!"
                          aria-label={`Increase people needed for ${position.name}`}
                          onClick={() => adjustPositionCount(position.positionId, 1)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </CreatePanel>
  );
};

export default ServiceManager;
