import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import TimePicker from "../../../components/TimePicker/TimePicker";
import DatePicker from "@/components/ui/DatePicker";
import DateTimePicker from "@/components/ui/DateTimePicker";
import {
  ordinals,
  weekdays,
} from "../../../containers/ServiceTimes/utils";
import { useToast } from "../../../context/toastContext";
import { useDispatch } from "../../../hooks";
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
import Icon from "../../../components/Icon/Icon";
import { resolvePositionLucideIcon } from "../lucidePositionIcons";
import { sanitizePositionRequirements } from "../schedule/scheduleRequirements";
import CreatePanel from "../CreatePanel";
import MultiCheckboxGroup from "../components/MultiCheckboxGroup";
import EntityRow from "../components/EntityRow";
import FormActionButtons from "../components/FormActionButtons";
import EntityFormDangerActions from "../components/EntityFormDangerActions";
import Checkbox from "../../../components/Checkbox/Checkbox";
import { cn } from "@/utils/cnHelper";
import {
  buildServiceTimeUpdate,
  canServicesShareDay,
  createEmptyServiceDraft,
  formatServiceTiming,
  isActive,
  planServiceGroupCleanupOnDelete,
  planServiceGroupUpdates,
} from "../teamsUtils";

type ServiceManagerProps = {
  services: TeamService[];
  positions: TeamPosition[];
  teams: TeamRecord[];
  canEdit: boolean;
};

const ServiceManager = ({ services, positions, teams, canEdit }: ServiceManagerProps) => {
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const [editing, setEditing] = useState<TeamService | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Partial<ServiceTime>>(createEmptyServiceDraft);
  // Other services this one is combined with (shares one set of schedule cells).
  const [combineWith, setCombineWith] = useState<string[]>([]);

  const reset = () => {
    setEditing(null);
    setShowCreate(false);
    setDraft(createEmptyServiceDraft());
    setCombineWith([]);
  };

  const startEdit = (service: TeamService) => {
    setEditing(service);
    setShowCreate(true);
    setDraft({ ...service });
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
      reccurence: recurrence,
    }));
  };

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
        positionRequirements: sanitizePositionRequirements(draft.positionRequirements),
        serviceGroupId: groupId,
      },
      editing,
    );
    if (editing) {
      dispatch(updateService({ id: editing.id, changes: saved }));
    } else {
      dispatch(addService(saved));
    }
    // Stamp the shared group id on partners (and clear it on services that left).
    partnerUpdates.forEach(({ id, serviceGroupId }) => {
      dispatch(updateService({ id, changes: { serviceGroupId } }));
    });
    reset();
  };

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
    setDraft((current) => {
      const rest = (current.positionRequirements || []).filter((req) => req.positionId !== positionId);
      const next: PositionRequirement[] = needed
        ? [...rest, { positionId, count: Math.max(1, requirementCount(positionId)) }]
        : rest;
      return { ...current, positionRequirements: next };
    });
  };
  const setPositionCount = (positionId: string, count: number) => {
    const safeCount = Math.max(1, Math.floor(Number(count) || 1));
    setDraft((current) => {
      const list = current.positionRequirements || [];
      const next = list.some((req) => req.positionId === positionId)
        ? list.map((req) => (req.positionId === positionId ? { ...req, count: safeCount } : req))
        : [...list, { positionId, count: safeCount }];
      return { ...current, positionRequirements: next };
    });
  };

  const recurrence = draft.reccurence || "weekly";
  const canSave =
    Boolean(String(draft.name || "").trim()) &&
    (recurrence === "one_time"
      ? Boolean(draft.dateTimeISO)
      : recurrence === "multi_weekly"
        ? Boolean(draft.daysOfWeek?.length) &&
        (draft.daysOfWeek || []).every((day) => Boolean(day.time))
        : Boolean(draft.time));

  return (
    <CreatePanel
      open={showCreate}
      onOpenCreate={() => {
        reset();
        setShowCreate(true);
      }}
      canEdit={canEdit}
      title={editing ? "Edit service" : "Create service"}
      sectionTitle="Services"
      description="Manage service times used for scheduling."
      createLabel="Create service"
      list={
        <>
          {services.length === 0 ? <p className="text-sm text-gray-300">No services yet.</p> : null}
          {services.map((service) => (
            <EntityRow
              key={service.serviceId}
              title={service.name}
              subtitle={formatServiceTiming(service)}
              archived={Boolean(service.archivedAt)}
              canEdit={canEdit}
              onTitleClick={() => startEdit(service)}
            />
          ))}
        </>
      }
      formHeaderActions={
        editing ? (
          <EntityFormDangerActions
            canEdit={canEdit}
            deleteLabel="Remove service"
            menuLabel="Service actions"
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
          saveLabel="Save service"
          onSave={submit}
          onCancel={reset}
          disabled={!canEdit || !canSave}
        />
      }
    >
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
          <DatePicker
            label="End Date (optional)"
            value={draft.endDateISO || ""}
            onChange={(endDateISO) => setDraft((d) => ({ ...d, endDateISO }))}
          />
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

      {combinableServices.length > 0 ? (
        <MultiCheckboxGroup
          label="Combined services"
          description="Combine back-to-back services on the same day so the schedule shows one set of positions for them together — assign someone once and it covers every combined service that day."
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
          Choose which positions this service needs and how many of each. Schedules show
          a column per slot. Leave all unchecked to use the team&apos;s positions.
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
                {teamPositions.map((position) => {
                  const PositionIcon = resolvePositionLucideIcon(position.icon);
                  const needed = requirements.some((req) => req.positionId === position.positionId);
                  const count = requirementCount(position.positionId);
                  return (
                    <div
                      key={position.positionId}
                      className="grid min-h-9 grid-cols-[1fr_auto] items-center gap-2"
                    >
                      <Checkbox
                        checked={needed}
                        onCheckedChange={(checked) =>
                          setPositionNeeded(position.positionId, checked)
                        }
                        label={
                          <>
                            {PositionIcon ? (
                              <Icon svg={PositionIcon} size="sm" className="text-orange-300" alt="" />
                            ) : null}
                            {position.name}
                          </>
                        }
                        labelClassName="gap-2 text-sm"
                      />
                      <div
                        className={cn(
                          "flex items-center gap-1",
                          !needed && "pointer-events-none invisible",
                        )}
                        aria-hidden={!needed}
                      >
                        <Button
                          svg={Minus}
                          variant="tertiary"
                          iconSize="sm"
                          aria-label={`Decrease ${position.name} count`}
                          disabled={!needed || count <= 1}
                          onClick={() => setPositionCount(position.positionId, count - 1)}
                        />
                        <Input
                          type="number"
                          min={1}
                          label="How many"
                          hideLabel
                          disabled={!needed}
                          value={needed ? count : 1}
                          inputWidth="w-14"
                          inputTextSize="text-xs"
                          onChange={(value) => setPositionCount(position.positionId, Number(value))}
                        />
                        <Button
                          svg={Plus}
                          variant="tertiary"
                          iconSize="sm"
                          aria-label={`Increase ${position.name} count`}
                          disabled={!needed}
                          onClick={() => setPositionCount(position.positionId, count + 1)}
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
