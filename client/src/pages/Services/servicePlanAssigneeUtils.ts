import type { ServicePlanAssignee } from "../../types/servicePlan";

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
