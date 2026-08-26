import { Plus, TriangleAlert, Trash2, UserPlus, UserRound, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import Button from "../../components/Button/Button";
import HistorySuggestField from "../../components/HistorySuggestField/HistorySuggestField";
import { ServicePlanMicrophoneChip } from "../../components/ServicePlanMicrophoneChip";
import { ServicePlanMicrophoneIcon } from "../../components/ServicePlanMicrophoneIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/utils/cnHelper";
import generateRandomId from "../../utils/generateRandomId";
import useDebouncedStringCommit from "../../hooks/useDebouncedStringCommit";
import { SERVICE_PLAN_INLINE_INPUT_CLASS } from "./ServicePlanElementRow";
import {
  isUnassignedServicePlanAssignee,
  type ServicePlanAssignee,
  type ServicePlanMicrophone,
} from "../../types/servicePlan";

export const createServicePlanAssignee = (
  overrides: Partial<ServicePlanAssignee> = {},
): ServicePlanAssignee => ({ id: generateRandomId(), ...overrides });

/** Microphones already spoken for elsewhere on this item. */
const takenMicrophoneIds = (
  assignees: ServicePlanAssignee[],
  exceptAssigneeId?: string,
): Set<string> => {
  const taken = new Set<string>();
  for (const assignee of assignees) {
    if (assignee.id === exceptAssigneeId) continue;
    for (const microphoneId of assignee.microphoneIds || []) {
      taken.add(microphoneId);
    }
  }
  return taken;
};

/** Names already on other assignee rows — case-insensitive. */
const takenAssigneeNames = (
  assignees: ServicePlanAssignee[],
  exceptAssigneeId?: string,
): Set<string> => {
  const taken = new Set<string>();
  for (const assignee of assignees) {
    if (assignee.id === exceptAssigneeId) continue;
    const name = assignee.name?.trim().toLowerCase();
    if (name) taken.add(name);
  }
  return taken;
};

/**
 * Suggestion list for one assignee field: church history minus people already
 * named on this item (this row keeps its own value so renaming still works).
 */
export const filterAssigneeSuggestions = (
  historyValues: string[],
  assignees: ServicePlanAssignee[],
  exceptAssigneeId: string,
): string[] => {
  const taken = takenAssigneeNames(assignees, exceptAssigneeId);
  if (!taken.size) return historyValues;
  return historyValues.filter(
    (value) => !taken.has(value.trim().toLowerCase()),
  );
};

/**
 * Drops slots that carry neither a person nor a microphone, so removing the
 * last mic from the unassigned slot clears the empty row rather than leaving
 * it behind.
 */
const pruneEmptyAssignees = (
  assignees: ServicePlanAssignee[],
): ServicePlanAssignee[] =>
  assignees.filter(
    (assignee) =>
      assignee.name?.trim() || assignee.memberId || assignee.microphoneIds?.length,
  );

/**
 * Applies an in-place assignee edit. Empty rows are pruned only when
 * microphones change — clearing a name mid-keystroke must keep the row
 * mounted so the input stays focused.
 */
export const applyAssigneeChanges = (
  assignees: ServicePlanAssignee[],
  assigneeId: string,
  changes: Partial<ServicePlanAssignee>,
): ServicePlanAssignee[] => {
  const next = assignees.map((assignee) =>
    assignee.id === assigneeId ? { ...assignee, ...changes } : assignee,
  );
  if (!("microphoneIds" in changes)) return next;
  return pruneEmptyAssignees(next);
};

export const addServicePlanAssignee = (
  assignees: ServicePlanAssignee[],
  overrides: Partial<ServicePlanAssignee> = {},
): ServicePlanAssignee[] => [...assignees, createServicePlanAssignee(overrides)];

/**
 * A microphone slot still waiting for whoever will carry it — the shape a
 * template's microphone plan arrives in. An empty row the operator just added
 * is not one of these: it holds nothing, so it blocks nothing.
 */
export const hasUnclaimedMicrophoneSlot = (
  assignees: ServicePlanAssignee[],
): boolean =>
  assignees.some(
    (assignee) =>
      isUnassignedServicePlanAssignee(assignee)
      && (assignee.microphoneIds || []).length > 0,
  );

/**
 * Removing a person hands their microphones back to the item rather than
 * deleting them: the mic is still in the service, it just has nobody on it
 * yet. Removing a slot that already has nobody does delete it — that is the
 * second press, and the only way to drop a microphone from the item wholesale.
 */
export const releaseServicePlanAssignee = (
  assignees: ServicePlanAssignee[],
  assigneeId: string,
): ServicePlanAssignee[] =>
  assignees.flatMap((assignee) => {
    if (assignee.id !== assigneeId) return [assignee];
    if (
      isUnassignedServicePlanAssignee(assignee)
      || !(assignee.microphoneIds || []).length
    ) {
      return [];
    }
    return [{ id: assignee.id, microphoneIds: assignee.microphoneIds }];
  });

/**
 * Add a microphone to the item as a slot of its own, at the end of the order.
 *
 * A slot is one holder, so each microphone added from the item's "Add →
 * Microphone" menu needs its own — piling them into a single slot would hand
 * every one of them to whoever claims that slot. Microphones that genuinely
 * travel together (a choir's three) are grouped afterwards with the slot's own
 * "+ Mic" control.
 */
export const addMicrophoneSlot = (
  assignees: ServicePlanAssignee[],
  microphoneId: string,
): ServicePlanAssignee[] =>
  addServicePlanAssignee(assignees, { microphoneIds: [microphoneId] });

type ServicePlanAssigneeListProps = {
  assignees: ServicePlanAssignee[];
  /** True when the operator may edit (canEdit && isEditing on the row). */
  allowEdit: boolean;
  microphones: ServicePlanMicrophone[];
  assignedToHistoryValues: string[];
  onRemoveAssignedToHistoryValue?: (value: string) => void;
  isAssignedToHistoryValueRemovable?: (value: string) => boolean;
  itemLabel: string;
  /**
   * Templates carry a microphone plan but never a person, so the name field is
   * hidden there and each row reads as "this role carries this mic".
   */
  structureOnly?: boolean;
  /** Scheduled holders for the plan date, keyed by church microphone id. */
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  onEdit?: () => void;
  onChange: (next: ServicePlanAssignee[], coalesceKey?: string) => void;
};

type DebouncedAssigneeNameFieldProps = {
  value: string;
  onCommit: (value: string) => void;
  historyValues: string[];
  onRemoveHistoryValue?: (value: string) => void;
  isHistoryValueRemovable?: (value: string) => boolean;
  label: string;
  placeholder: string;
};

/** Keeps assignee typing inside its chip until the plan-wide update settles. */
const DebouncedAssigneeNameField = ({
  value,
  onCommit,
  historyValues,
  onRemoveHistoryValue,
  isHistoryValueRemovable,
  label,
  placeholder,
}: DebouncedAssigneeNameFieldProps) => {
  const draft = useDebouncedStringCommit(value, onCommit);

  return (
    <HistorySuggestField
      label={label}
      hideLabel
      placeholder={placeholder}
      multiline={false}
      // Give names room to remain readable before microphone chips wrap.
      className="min-w-[16rem] flex-1 sm:w-48 sm:min-w-0 sm:flex-none"
      inputClassName={cn(
        SERVICE_PLAN_INLINE_INPUT_CLASS,
        "max-md:min-h-8 max-md:text-sm",
      )}
      value={draft.draftValue}
      onChange={draft.setDraftValue}
      onFieldBlur={draft.flush}
      historyValues={historyValues}
      onRemoveHistoryValue={onRemoveHistoryValue}
      isHistoryValueRemovable={isHistoryValueRemovable}
    />
  );
};

/**
 * Who is doing this item, and what each of them is holding.
 *
 * Microphones live on the person rather than on the item, so "who has the
 * orange handheld" is answerable by looking at one row. A row with no name is
 * the unassigned slot — a stand or spare mic that nobody has picked up yet.
 *
 * People pack left and wrap as compact chips under an "Assignees" label so the
 * group reads like Notes and three people do not burn three full-width rows.
 */
const ServicePlanAssigneeList = ({
  assignees,
  allowEdit,
  microphones,
  assignedToHistoryValues,
  onRemoveAssignedToHistoryValue,
  isAssignedToHistoryValueRemovable,
  itemLabel,
  structureOnly = false,
  scheduledMicrophoneHolders,
  onEdit,
  onChange,
}: ServicePlanAssigneeListProps) => {
  // Adding a person is the most common edit on a row, so the affordance stays
  // in place rather than living only behind the Add menu. Nothing renders for
  // a viewer looking at an item nobody is assigned to.
  const canAddPerson = allowEdit && !structureOnly;
  if (!assignees.length && !canAddPerson) return null;

  const microphonesById = new Map(
    microphones.map((microphone) => [microphone.id, microphone]),
  );
  const itemHasMicrophones = assignees.some(
    (assignee) => (assignee.microphoneIds || []).length > 0,
  );

  const updateAssignee = (
    assigneeId: string,
    changes: Partial<ServicePlanAssignee>,
    coalesceKey?: string,
  ) => {
    onChange(applyAssigneeChanges(assignees, assigneeId, changes), coalesceKey);
  };

  return (
    <div
      className={cn(
        "service-plan-assignee-list space-y-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit && "pl-9",
        onEdit && "cursor-pointer rounded-md hover:bg-gray-800/60",
      )}
      role={onEdit ? "button" : "group"}
      tabIndex={onEdit ? 0 : undefined}
      onClick={onEdit}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!onEdit || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onEdit();
      }}
      aria-label={
        structureOnly
          ? `Microphone plan for ${itemLabel}`
          : `Assignees for ${itemLabel}`
      }
    >
      {/* Same chrome as Notes: icon + title so chips read as a named group. */}
      <div className="flex min-w-0 items-center gap-1.5 px-0.5 py-0.5">
        <UserRound className="size-3.5 shrink-0 text-gray-300" aria-hidden />
        <span className="shrink-0 text-xs font-medium text-white">
          {structureOnly ? "Microphone plan" : "Assignees"}
        </span>
      </div>
      <div className="flex flex-col items-start gap-2">
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {assignees.map((assignee, assigneeIndex) => {
          const isUnassigned = isUnassignedServicePlanAssignee(assignee);
          const assigneeMicrophones = (assignee.microphoneIds || [])
            .map((microphoneId) => microphonesById.get(microphoneId))
            .filter((microphone): microphone is ServicePlanMicrophone =>
              Boolean(microphone),
            );
          const taken = takenMicrophoneIds(assignees, assignee.id);
          const availableMicrophones = microphones.filter(
            (microphone) =>
              !taken.has(microphone.id)
              && !(assignee.microphoneIds || []).includes(microphone.id),
          );
          // In a template an unnamed row is a position in the order the dated
          // plan hands microphones out in; a named one is a standing group.
          const label =
            assignee.name?.trim()
            || (structureOnly ? `Slot ${assigneeIndex + 1}` : "Unassigned");
          // Quiet, not an alarm: plenty of people never need a microphone. It
          // only says anything on an item that has a microphone plan at all.
          const showMissingMicrophoneHint =
            !structureOnly
            && !isUnassigned
            && itemHasMicrophones
            && !(assignee.microphoneIds || []).length;

            return (
              <div
                key={assignee.id}
                className={cn(
                  "inline-flex w-full max-w-full flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 md:w-auto md:gap-1 md:px-1.5 md:py-1",
                  isUnassigned
                    ? "border-gray-700/50 bg-gray-900/40"
                    : "border-gray-700/60 bg-gray-950/50",
                )}
              >
              <UserRound
                className="size-3.5 shrink-0 text-gray-400"
                aria-hidden
              />

              {allowEdit ? (
                <DebouncedAssigneeNameField
                  label={
                    structureOnly
                      ? `Group for ${itemLabel}`
                      : `Assigned to for ${itemLabel}`
                  }
                  // A template names standing groups, never this week's people
                  // — "Audience", "Chorale", whoever always carries the mic.
                  placeholder={structureOnly ? "Group (optional)" : "Assigned to"}
                  value={assignee.name || ""}
                  onCommit={(value) =>
                    updateAssignee(
                      assignee.id,
                      { name: value },
                      `assignee:${assignee.id}:name`,
                    )
                  }
                  historyValues={
                    structureOnly
                      ? []
                      : filterAssigneeSuggestions(
                        assignedToHistoryValues,
                        assignees,
                        assignee.id,
                      )
                  }
                  onRemoveHistoryValue={onRemoveAssignedToHistoryValue}
                  isHistoryValueRemovable={isAssignedToHistoryValueRemovable}
                />
              ) : (
                <span
                  className={cn(
                    "max-w-36 truncate text-xs font-medium",
                    isUnassigned ? "text-gray-400" : "text-gray-100",
                  )}
                >
                  {label}
                </span>
              )}

              {showMissingMicrophoneHint ? (
                <span className="shrink-0 text-[10px] text-gray-400">
                  No mic
                </span>
              ) : null}

              {assigneeMicrophones.map((microphone) => {
                const scheduledHolders =
                  scheduledMicrophoneHolders?.get(microphone.id) || [];
                const scheduledTitle = scheduledHolders.length
                  ? `Scheduled to ${scheduledHolders.join(", ")}`
                  : undefined;
                return (
                  <span
                    key={microphone.id}
                    className="inline-flex shrink-0 items-center gap-0.5"
                    title={scheduledTitle}
                  >
                    <ServicePlanMicrophoneChip microphone={microphone}>
                      {allowEdit ? (
                        <Button
                          type="button"
                          variant="tertiary"
                          iconSize="xs"
                          padding="p-0"
                          className="h-6 w-6 max-md:min-h-8 max-md:min-w-8"
                          svg={X}
                          aria-label={`Remove ${microphone.name} from ${label}`}
                          onClick={() =>
                            updateAssignee(assignee.id, {
                              microphoneIds: (assignee.microphoneIds || []).filter(
                                (id) => id !== microphone.id,
                              ),
                            })
                          }
                        />
                      ) : null}
                    </ServicePlanMicrophoneChip>
                    {scheduledHolders.length ? (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10px] text-amber-300"
                        aria-label={scheduledTitle}
                      >
                        <TriangleAlert className="size-3 shrink-0" aria-hidden />
                        <span className="max-w-28 truncate">
                          {scheduledHolders.join(", ")}
                        </span>
                      </span>
                    ) : null}
                  </span>
                );
              })}

              {allowEdit && availableMicrophones.length > 0 ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="tertiary"
                      svg={Plus}
                      iconSize="xs"
                      padding="px-1 py-0.5"
                      className="h-7 max-md:min-h-8 max-md:px-2 border border-dashed border-violet-500/40 text-xs text-violet-200"
                      aria-haspopup="menu"
                      aria-label={`Add microphone for ${label}`}
                    >
                      Mic
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-52">
                    {availableMicrophones.map((microphone) => {
                      const scheduledHolders =
                        scheduledMicrophoneHolders?.get(microphone.id) || [];
                      const scheduledLabel = scheduledHolders.length
                        ? `Assigned: ${scheduledHolders.join(", ")}`
                        : null;
                      return (
                        <DropdownMenuItem
                          key={microphone.id}
                          onSelect={() =>
                            updateAssignee(assignee.id, {
                              microphoneIds: [
                                ...(assignee.microphoneIds || []),
                                microphone.id,
                              ],
                            })
                          }
                        >
                          <ServicePlanMicrophoneIcon
                            microphone={microphone}
                            color={microphone.color}
                            className="size-4 shrink-0"
                          />
                          <span className="truncate">{microphone.name}</span>
                          {scheduledLabel ? (
                            <span className="ml-auto shrink-0 text-[10px] text-amber-300">
                              {scheduledLabel}
                            </span>
                          ) : (
                            <span className="ml-auto shrink-0 text-xs text-gray-400">
                              {microphone.type}
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}

              {allowEdit ? (
                <Button
                  type="button"
                  variant="tertiary"
                  iconSize="xs"
                  padding="p-0.5"
                  className="h-7 w-7 shrink-0 max-md:min-h-8 max-md:min-w-8"
                  svg={Trash2}
                  aria-label={
                    isUnassigned
                      ? `Remove ${label} from ${itemLabel}`
                      : `Remove ${label} from ${itemLabel}, keeping their microphones`
                  }
                  onClick={() =>
                    onChange(releaseServicePlanAssignee(assignees, assignee.id))
                  }
                />
              ) : null}
              </div>
            );
          })}
        </div>

        {canAddPerson ? (
          <Button
            type="button"
            variant="tertiary"
            svg={UserPlus}
            iconSize="xs"
            padding="px-2 py-1"
            className="h-7 max-md:min-h-0 border border-dashed border-gray-600/80 text-xs text-gray-300"
            onClick={() => onChange(addServicePlanAssignee(assignees))}
          >
            Add person
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default ServicePlanAssigneeList;
