import { Plus, TriangleAlert, Trash2, UserRound, X } from "lucide-react";
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
 * Put a microphone on the item's unassigned slot, creating that slot if this
 * is the first stand mic. Used by the item's "Add → Microphone" action, which
 * is for mics nobody is holding yet.
 */
export const addUnassignedMicrophone = (
  assignees: ServicePlanAssignee[],
  microphoneId: string,
): ServicePlanAssignee[] => {
  const slotIndex = assignees.findIndex(isUnassignedServicePlanAssignee);
  if (slotIndex === -1) {
    return addServicePlanAssignee(assignees, { microphoneIds: [microphoneId] });
  }
  return assignees.map((assignee, index) =>
    index === slotIndex
      ? {
        ...assignee,
        microphoneIds: [...(assignee.microphoneIds || []), microphoneId],
      }
      : assignee,
  );
};

type ServicePlanAssigneeListProps = {
  assignees: ServicePlanAssignee[];
  /** True when the operator may edit (canEdit && isEditing on the row). */
  allowEdit: boolean;
  microphones: ServicePlanMicrophone[];
  assignedToHistoryValues: string[];
  itemLabel: string;
  /**
   * Templates carry a microphone plan but never a person, so the name field is
   * hidden there and each row reads as "this role carries this mic".
   */
  structureOnly?: boolean;
  /** Scheduled holders for the plan date, keyed by church microphone id. */
  scheduledMicrophoneHolders?: ReadonlyMap<string, string[]>;
  onChange: (next: ServicePlanAssignee[], coalesceKey?: string) => void;
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
  itemLabel,
  structureOnly = false,
  scheduledMicrophoneHolders,
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
        "space-y-1 px-1.5 pb-1.5 md:pb-1",
        allowEdit && "pl-9",
      )}
      role="group"
      aria-label={`Assignees for ${itemLabel}`}
    >
      {/* Same chrome as Notes: icon + title so chips read as a named group. */}
      <div className="flex min-w-0 items-center gap-1.5 px-0.5 py-0.5">
        <UserRound className="size-3.5 shrink-0 text-gray-300" aria-hidden />
        <span className="shrink-0 text-xs font-medium text-white">Assignees</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {assignees.map((assignee) => {
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
          const label = assignee.name?.trim() || "Unassigned";

          return (
            <div
              key={assignee.id}
              className={cn(
                "inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border px-1.5 py-1",
                isUnassigned
                  ? "border-gray-700/50 bg-gray-900/40"
                  : "border-gray-700/60 bg-gray-950/50",
              )}
            >
              <UserRound
                className="size-3.5 shrink-0 text-gray-400"
                aria-hidden
              />

              {allowEdit && !structureOnly ? (
                <HistorySuggestField
                  label={`Assigned to for ${itemLabel}`}
                  hideLabel
                  placeholder="Assigned to"
                  multiline={false}
                  className="w-32 sm:w-40"
                  inputClassName={SERVICE_PLAN_INLINE_INPUT_CLASS}
                  value={assignee.name || ""}
                  onChange={(value) =>
                    updateAssignee(
                      assignee.id,
                      { name: value },
                      `assignee:${assignee.id}:name`,
                    )
                  }
                  historyValues={filterAssigneeSuggestions(
                    assignedToHistoryValues,
                    assignees,
                    assignee.id,
                  )}
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

              {assigneeMicrophones.map((microphone) => {
                const scheduledHolders =
                  scheduledMicrophoneHolders?.get(microphone.id) || [];
                const scheduledTitle = scheduledHolders.length
                  ? `Scheduled to ${scheduledHolders.join(", ")}`
                  : undefined;
                return (
                  <span
                    key={microphone.id}
                    className="inline-flex min-w-0 items-center gap-0.5"
                    title={scheduledTitle}
                  >
                    <ServicePlanMicrophoneChip microphone={microphone}>
                      {allowEdit ? (
                        <Button
                          type="button"
                          variant="tertiary"
                          iconSize="xs"
                          padding="p-0"
                          className="h-4 w-4 max-md:min-h-0"
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
                      className="h-6 max-md:min-h-0 border border-dashed border-violet-500/40 text-[11px] text-violet-200"
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
                  className="h-6 w-6 shrink-0 max-md:min-h-0"
                  svg={Trash2}
                  aria-label={`Remove ${label} from ${itemLabel}`}
                  onClick={() =>
                    onChange(
                      assignees.filter((existing) => existing.id !== assignee.id),
                    )
                  }
                />
              ) : null}
            </div>
          );
        })}

        {canAddPerson ? (
          <Button
            type="button"
            variant="tertiary"
            svg={Plus}
            iconSize="xs"
            padding="px-1.5 py-0.5"
            className="h-7 max-md:min-h-0 border border-dashed border-gray-600/80 text-[11px] text-gray-300"
            onClick={() => onChange(addServicePlanAssignee(assignees))}
          >
            {assignees.length ? "Add another person" : "Add a person"}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

export default ServicePlanAssigneeList;
