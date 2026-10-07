import {
  isUnassignedServicePlanAssignee,
  type ServicePlanAssignee,
} from "../../types/servicePlan";

/** Whether an assignee carries any operator-owned equipment. */
export const hasServicePlanAssigneeEquipment = (
  assignee: Pick<ServicePlanAssignee, "microphoneIds" | "iemIds">,
): boolean =>
  Boolean(assignee.microphoneIds?.length || assignee.iemIds?.length);

/** Copies only equipment from a prior assignment onto a newly imported identity. */
export const copyServicePlanAssigneeEquipment = <T extends ServicePlanAssignee>(
  target: T,
  source: Pick<ServicePlanAssignee, "microphoneIds" | "iemIds"> | undefined,
): T => {
  const next = { ...target };
  if (source?.microphoneIds?.length)
    next.microphoneIds = [...source.microphoneIds];
  else delete next.microphoneIds;
  if (source?.iemIds?.length) next.iemIds = [...source.iemIds];
  else delete next.iemIds;
  return next;
};

export type ServicePlanAssigneeSlotClaim = {
  assignees: ServicePlanAssignee[];
  assignee: ServicePlanAssignee;
  claimedSlot: boolean;
  reusedExisting: boolean;
};

/**
 * Reuses a same-name person or places a new person into the first eligible
 * equipment slot, keeping that slot's identity and equipment. Callers resolve
 * stable identity matches and verify provenance before replacing source rows.
 */
export const claimServicePlanAssigneeSlot = (
  assignees: ServicePlanAssignee[],
  person: ServicePlanAssignee,
  options: { preferredSlotId?: string; replaceAssigneeId?: string; reuseSameName?: boolean } = {},
): ServicePlanAssigneeSlotClaim => {
  const normalizedName = person.name?.trim().toLocaleLowerCase();
  const sameName = normalizedName
    ? assignees.find((assignee) => assignee.name?.trim().toLocaleLowerCase() === normalizedName)
    : undefined;
  if (options.reuseSameName !== false && sameName)
    return { assignees, assignee: sameName, claimedSlot: false, reusedExisting: true };

  const eligible = (assignee: ServicePlanAssignee) =>
    isUnassignedServicePlanAssignee(assignee) && hasServicePlanAssigneeEquipment(assignee);
  const preferredIndex = options.preferredSlotId
    ? assignees.findIndex((assignee) => assignee.id === options.preferredSlotId && eligible(assignee))
    : -1;
  const slotIndex = preferredIndex >= 0
    ? preferredIndex
    : assignees.findIndex(eligible);

  if (slotIndex < 0) {
    return { assignees: [...assignees, person], assignee: person, claimedSlot: false, reusedExisting: false };
  }

  const slot = assignees[slotIndex];
  const claimed = {
    ...slot,
    ...person,
    id: slot.id,
    ...(slot.microphoneIds?.length ? { microphoneIds: [...slot.microphoneIds] } : {}),
    ...(slot.iemIds?.length ? { iemIds: [...slot.iemIds] } : {}),
  };
  const next = assignees.flatMap((assignee, index) => {
    if (index === slotIndex) return [claimed];
    if (options.replaceAssigneeId && assignee.id === options.replaceAssigneeId) return [];
    return [assignee];
  });
  return { assignees: next, assignee: claimed, claimedSlot: true, reusedExisting: false };
};

/** Removes imported/operator identity while retaining equipment as a local slot. */
export const stripServicePlanAssigneeIdentityPreservingEquipment = (
  assignee: ServicePlanAssignee,
): ServicePlanAssignee | undefined =>
  hasServicePlanAssigneeEquipment(assignee)
    ? {
        id: assignee.id,
        ...(assignee.microphoneIds?.length
          ? { microphoneIds: [...assignee.microphoneIds] }
          : {}),
        ...(assignee.iemIds?.length ? { iemIds: [...assignee.iemIds] } : {}),
      }
    : undefined;
