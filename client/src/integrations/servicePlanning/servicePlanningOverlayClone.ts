import type { DBOverlay, OverlayInfo } from "../../types";
import type { ServicePlanningFieldPatch } from "./mapServicePlanningToOverlays";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { getDefaultFormatting } from "../../utils/overlayUtils";

/** Participant overlay with the same event label as the sync target. */
export const findParticipantTemplateForSync = (
  list: OverlayInfo[],
  targetEvent: string | undefined,
): OverlayInfo | null => {
  if (!targetEvent?.trim()) return null;
  const te = targetEvent.toLowerCase().replace(/\s+/g, " ").trim();
  const participants = list.filter((o) => o.type === "participant");
  const exact = participants.find(
    (o) => (o.event || "").toLowerCase().replace(/\s+/g, " ").trim() === te,
  );
  if (exact) return exact;
  return null;
};

export const buildClonedParticipantOverlay = (
  template: OverlayInfo,
  patch: ServicePlanningFieldPatch,
  newId: string,
): OverlayInfo => {
  const next: OverlayInfo = {
    ...template,
    id: newId,
    name: patch.name ?? "",
    event: patch.event ?? template.event,
  };
  if (patch.title !== undefined) {
    next.title = patch.title;
  } else {
    next.title = template.title;
  }
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
): OverlayInfo => ({
  id: newId,
  type: "participant",
  name: patch.name ?? "",
  title: patch.title ?? "",
  event: patch.event ?? "",
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  imageUrl: "",
  formatting: getDefaultFormatting("participant"),
});

type PouchLike = {
  get: (id: string) => Promise<unknown>;
  put: (doc: unknown) => Promise<unknown>;
};

/** Persist a new overlay doc cloned from the template row in Pouch (fallback: minimal doc from `fallback`). */
export const persistNewParticipantOverlayClone = async (
  db: PouchLike | undefined,
  templateId: string,
  newId: string,
  patch: ServicePlanningFieldPatch,
  fallback: OverlayInfo,
): Promise<void> => {
  if (!db) return;
  const now = new Date().toISOString();
  try {
    const raw = (await db.get(`overlay-${templateId}`)) as DBOverlay;
    const { _rev: _r, _id: _i, ...rest } = raw;
    const stamped = applyPouchAudit(
      null,
      {
        ...rest,
        _id: `overlay-${newId}`,
        id: newId,
        docType: "overlay",
        name: patch.name ?? "",
        title:
          patch.title !== undefined ? patch.title : (rest as OverlayInfo).title,
        event: patch.event ?? (rest as OverlayInfo).event,
        createdAt: now,
        updatedAt: now,
      } as DBOverlay,
      { isNew: true },
    );
    await db.put(stamped);
  } catch (e) {
    console.error("Service Planning: full clone from template doc failed", e);
    try {
      const minimal = applyPouchAudit(
        null,
        {
          ...fallback,
          _id: `overlay-${newId}`,
          id: newId,
          docType: "overlay",
          type: "participant",
          createdAt: now,
          updatedAt: now,
        } as DBOverlay,
        { isNew: true },
      );
      await db.put(minimal);
    } catch (e2) {
      console.error("Service Planning: fallback new overlay put failed", e2);
    }
  }
};

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
  }
};
