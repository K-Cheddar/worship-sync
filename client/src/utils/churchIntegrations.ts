import type {
  ChurchIntegrations,
  ServicePlanningElementRule,
  ServicePlanningPerson,
  ServicePlanningSectionRule,
} from "../types/integrations";
import {
  createDefaultChurchIntegrations,
  DEFAULT_SERVICE_PLANNING_NAME_SOURCES,
} from "../types/integrations";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Merges partial RTDB data with defaults for client use.
 */
export const normalizeChurchIntegrations = (
  value: unknown,
): ChurchIntegrations => {
  const base = createDefaultChurchIntegrations();
  if (!isRecord(value)) return base;

  const version = Number(value.version);
  const catalog = isRecord(value.catalog) ? value.catalog : {};
  const sp = isRecord(value.servicePlanning) ? value.servicePlanning : {};
  const restream = isRecord(value.restream) ? value.restream : {};

  return {
    version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 1,
    catalog: {
      servicePlanning: isRecord(catalog.servicePlanning)
        ? {
            status:
              catalog.servicePlanning.status === "coming_soon"
                ? "coming_soon"
                : "available",
            label:
              String(catalog.servicePlanning.label || "").trim() ||
              base.catalog.servicePlanning.label,
          }
        : base.catalog.servicePlanning,
      songSelect: isRecord(catalog.songSelect)
        ? {
            status: "coming_soon",
            label:
              String(catalog.songSelect.label || "").trim() ||
              base.catalog.songSelect.label,
          }
        : base.catalog.songSelect,
      planningCenter: isRecord(catalog.planningCenter)
        ? {
            status: "coming_soon",
            label:
              String(catalog.planningCenter.label || "").trim() ||
              base.catalog.planningCenter.label,
          }
        : base.catalog.planningCenter,
    },
    servicePlanning: {
      enabled: Boolean(sp.enabled),
      elementRules: Array.isArray(sp.elementRules)
        ? sp.elementRules.filter(isRecord).map(
            (r): ServicePlanningElementRule => ({
              id: String(r.id ?? ""),
              matchElementType: String(r.matchElementType ?? ""),
              matchMode: ["exact", "contains", "normalize"].includes(
                String(r.matchMode),
              )
                ? (r.matchMode as ServicePlanningElementRule["matchMode"])
                : "contains",
              overlaySyncEnabled:
                r.overlaySyncEnabled === false ? false : true,
              dedupeRepeatedOverlays:
                r.dedupeRepeatedOverlays === true ? true : false,
              displayName: String(r.displayName ?? ""),
              nameSources:
                Array.isArray(r.nameSources) && r.nameSources.length > 0
                  ? (r.nameSources as ServicePlanningElementRule["nameSources"])
                  : [...DEFAULT_SERVICE_PLANNING_NAME_SOURCES],
              multiOverlay: isRecord(r.multiOverlay)
                ? (r.multiOverlay as ServicePlanningElementRule["multiOverlay"])
                : { mode: "single" },
              ...(isRecord(r.fieldTemplates)
                ? {
                    fieldTemplates:
                      r.fieldTemplates as ServicePlanningElementRule["fieldTemplates"],
                  }
                : {}),
              ...(isRecord(r.outlineSync)
                ? {
                    outlineSync: {
                      enabled: Boolean(r.outlineSync.enabled),
                      itemType: (["song", "bible", "none"].includes(
                        String(r.outlineSync.itemType),
                      )
                        ? String(r.outlineSync.itemType)
                        : "none") as "song" | "bible" | "none",
                    },
                  }
                : {}),
            }),
          )
        : [],
      sectionRules: Array.isArray(sp.sectionRules)
        ? sp.sectionRules.filter(isRecord).map(
            (r): ServicePlanningSectionRule => ({
              id: String(r.id ?? ""),
              matchSectionName: String(r.matchSectionName ?? ""),
              matchMode: ["exact", "contains", "normalize"].includes(
                String(r.matchMode),
              )
                ? (r.matchMode as ServicePlanningSectionRule["matchMode"])
                : "contains",
              headingName: String(r.headingName ?? ""),
            }),
          )
        : [],
      people: Array.isArray(sp.people)
        ? sp.people.filter(isRecord).map(
            (p): ServicePlanningPerson => ({
              id: String(p.id ?? ""),
              names: Array.isArray(p.names) ? p.names.map(String) : [],
              displayName: String(p.displayName ?? ""),
              ...(p.title != null && String(p.title).trim()
                ? { title: String(p.title) }
                : {}),
            }),
          )
        : [],
    },
    restream: {
      enabled: Boolean(restream.enabled),
      connected: Boolean(restream.connected),
      accountLabel: String(restream.accountLabel ?? "").trim(),
      lastError: String(restream.lastError ?? "").trim(),
      ...(Number.isFinite(Number(restream.lastEventAt))
        ? { lastEventAt: Number(restream.lastEventAt) }
        : {}),
      ...(Number.isFinite(Number(restream.sessionStartedAt))
        ? { sessionStartedAt: Number(restream.sessionStartedAt) }
        : {}),
      platformSummary: Array.isArray(restream.platformSummary)
        ? restream.platformSummary.map(String).map((item) => item.trim()).filter(Boolean)
        : [],
    },
  };
};
