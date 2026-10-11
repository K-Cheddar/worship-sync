import type { DBOverlay, OverlayFormatting, OverlayInfo } from "../../types";
import type { ServicePlanningFieldPatch } from "./mapServicePlanningToOverlays";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { getDefaultFormatting } from "../../utils/overlayUtils";
import { normalizeOverlayEvent } from "./findBestOverlayMatch";

/** Apply only mapped service-plan fields; explicit sync replaces earlier edits. */
export const applyServicePlanningOverlayPatch = (
  existing: OverlayInfo,
  patch: ServicePlanningFieldPatch,
): OverlayInfo => {
  const next: OverlayInfo = { ...existing };

  (["name", "title", "event"] as const).forEach((field) => {
    if (field in patch) next[field] = patch[field];
  });
  return next;
};

export const DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION = 7;

/** Participant overlay with the same event label as the sync target. */
export const findParticipantTemplateForSync = (
  list: OverlayInfo[],
  targetEvent: string | undefined,
): OverlayInfo | null => {
  if (!targetEvent?.trim()) return null;
  const te = normalizeOverlayEvent(targetEvent);
  const participants = list.filter((o) => (o.type ?? "participant") === "participant");
  const exact = participants.find(
    (o) => normalizeOverlayEvent(o.event) === te,
  );
  if (exact) return exact;
  return null;
};

export const buildClonedParticipantOverlay = (
  template: OverlayInfo,
  patch: ServicePlanningFieldPatch,
  newId: string,
  formatting: OverlayFormatting =
    template.formatting || getDefaultFormatting("participant"),
): OverlayInfo => {
  const next: OverlayInfo = {
    ...template,
    id: newId,
    name: patch.name ?? "",
    title: patch.title ?? "",
    event: patch.event ?? template.event,
    duration: template.duration ?? DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
    formatting,
  };
  delete next.servicePlanSource;
  delete next.servicePlanBaseline;
  delete next.servicePlanOverrides;
  delete (next as Record<string, unknown>).servicePlanReviewRequired;
  next.heading = "";
  next.subHeading = "";
  next.url = "";
  next.description = "";
  next.imageUrl = "";
  return next;
};

export const buildNewParticipantOverlay = (
  patch: ServicePlanningFieldPatch,
  newId: string,
  formatting: OverlayFormatting = getDefaultFormatting("participant"),
): OverlayInfo => ({
  id: newId,
  type: "participant",
  name: patch.name ?? "",
  title: patch.title ?? "",
  event: patch.event ?? "",
  duration: DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  imageUrl: "",
  formatting,
});

type PouchLike = {
  put: (doc: unknown) => Promise<unknown>;
};

/** Persist the finalized overlay with new-document identity and audit metadata. */
export const persistNewParticipantOverlay = async (
  db: PouchLike | undefined,
  newOverlay: OverlayInfo,
): Promise<void> => {
  if (!db) return;
  const now = new Date().toISOString();
  try {
    const stamped = applyPouchAudit(
      null,
      {
        ...newOverlay,
        _id: `overlay-${newOverlay.id}`,
        docType: "overlay",
        type: "participant",
        createdAt: now,
        updatedAt: now,
      } as DBOverlay,
      { isNew: true },
    );
    await db.put(stamped);
  } catch (e) {
    console.error("Service Planning: new participant overlay put failed", e);
    throw e;
  }
};
