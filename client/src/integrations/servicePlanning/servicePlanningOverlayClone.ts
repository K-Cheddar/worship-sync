import type { DBOverlay, OverlayFormatting, OverlayInfo } from "../../types";
import type { ServicePlanningFieldPatch } from "./mapServicePlanningToOverlays";
import { applyPouchAudit } from "../../utils/pouchAudit";
import { getDefaultFormatting } from "../../utils/overlayUtils";

export type ServicePlanOverlaySource = {
  planKey: string;
  elementId: string;
  candidateId: string;
};

type SyncedOverlayField = "name" | "title" | "event";

/** Merge source values independently so one edited field does not freeze the others. */
export const mergeServicePlanOverlayFields = (
  existing: OverlayInfo,
  patch: ServicePlanningFieldPatch,
  source?: ServicePlanOverlaySource,
): OverlayInfo => {
  const fields: SyncedOverlayField[] = ["name", "title", "event"];
  const baseline = { ...(existing.servicePlanBaseline || {}) };
  const overrides = { ...(existing.servicePlanOverrides || {}) };
  const next: OverlayInfo = { ...existing };

  fields.forEach((field) => {
    const importedValue = patch[field];
    if (importedValue === undefined) return;
    const currentValue = existing[field] || "";
    const hasPriorBaseline = existing.servicePlanBaseline?.[field] !== undefined;
    const isOverride = Boolean(overrides[field])
      || !hasPriorBaseline
      || currentValue !== (existing.servicePlanBaseline?.[field] || "");
    if (isOverride) {
      overrides[field] = true;
    } else {
      next[field] = importedValue;
      delete overrides[field];
    }
    baseline[field] = importedValue;
  });

  return {
    ...next,
    servicePlanSource: source || existing.servicePlanSource,
    servicePlanBaseline: baseline,
    servicePlanOverrides: overrides,
    // Existing overlays predate field provenance. Preserve their values and
    // make the association visible for deliberate review instead of guessing.
    servicePlanReviewRequired: existing.servicePlanReviewRequired || !existing.servicePlanBaseline,
  };
};

export const trackServicePlanOverlayEdit = (
  existing: OverlayInfo,
  incoming: Partial<OverlayInfo>,
): OverlayInfo => {
  if (!existing.servicePlanSource || !existing.servicePlanBaseline) {
    return { ...existing, ...incoming };
  }
  const next = { ...existing, ...incoming };
  const overrides = { ...(existing.servicePlanOverrides || {}) };
  (["name", "title", "event"] as const).forEach((field) => {
    if (!(field in incoming)) return;
    if ((next[field] || "") === (existing.servicePlanBaseline?.[field] || "")) {
      delete overrides[field];
    } else {
      overrides[field] = true;
    }
  });
  return {
    ...next,
    servicePlanOverrides: overrides,
    servicePlanReviewRequired: existing.servicePlanReviewRequired
      && Object.values(overrides).some(Boolean),
  };
};

export const DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION = 7;

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
  formatting: OverlayFormatting =
    template.formatting || getDefaultFormatting("participant"),
  source?: ServicePlanOverlaySource,
): OverlayInfo => {
  const next: OverlayInfo = {
    ...template,
    id: newId,
    name: patch.name ?? "",
    title: patch.title ?? "",
    event: patch.event ?? template.event,
    duration: template.duration ?? DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
    formatting,
    ...(source
      ? {
          servicePlanSource: source,
          servicePlanBaseline: {
            name: patch.name ?? "",
            title: patch.title ?? "",
            event: patch.event ?? template.event ?? "",
          },
          servicePlanOverrides: {},
          servicePlanReviewRequired: false,
        }
      : {}),
  };
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
  source?: ServicePlanOverlaySource,
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
  ...(source
    ? {
        servicePlanSource: source,
        servicePlanBaseline: {
          name: patch.name ?? "",
          title: patch.title ?? "",
          event: patch.event ?? "",
        },
        servicePlanOverrides: {},
        servicePlanReviewRequired: false,
      }
    : {}),
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
        title: patch.title ?? "",
        event: patch.event ?? (rest as OverlayInfo).event,
        servicePlanSource: fallback.servicePlanSource,
        servicePlanBaseline: fallback.servicePlanBaseline,
        servicePlanOverrides: fallback.servicePlanOverrides,
        servicePlanReviewRequired: fallback.servicePlanReviewRequired,
        duration:
          (rest as OverlayInfo).duration ??
          DEFAULT_SERVICE_PLANNING_OVERLAY_DURATION,
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
