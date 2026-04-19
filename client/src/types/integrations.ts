export type IntegrationCatalogStatus = "available" | "coming_soon";

export type NameColumnKey = "elementType" | "title" | "ledBy";

/** Default name columns for new rules and when persisted rules omit `nameSources`. */
export const DEFAULT_SERVICE_PLANNING_NAME_SOURCES: NameColumnKey[] = ["ledBy"];

export type ServicePlanningMatchMode = "exact" | "contains" | "normalize";

export type ServicePlanningMultiOverlayMode = "single" | "split";

export type ServicePlanningElementRule = {
  id: string;
  matchElementType: string;
  matchMode: ServicePlanningMatchMode;
  /** When false, this rule is ignored by overlay preview/sync but may still drive outline actions. */
  overlaySyncEnabled?: boolean;
  /**
   * Optional custom default event string for overlay `event` (and template `{{displayName}}` when not overridden).
   * When blank or whitespace-only, mapping uses `matchElementType` instead.
   */
  displayName: string;
  /** Which planning columns to merge (space-joined) and in this order: first in the list is first in the merged string. */
  nameSources: NameColumnKey[];
  multiOverlay: {
    mode: ServicePlanningMultiOverlayMode;
    /** When mode is `split`, split on these (default commas, ampersand). */
    splitSeparators?: string[];
    /**
     * Split mode only: suffix for each extracted person token by index (first person → index 0).
     * Event is effective default event label + `" " + suffix` when suffix is non-empty (effective label is custom display name, or match element type when blank).
     * If there are more people than entries, extras use that label only unless `repeatLastEventSuffix` is true (then the last suffix applies to all remaining names).
     */
    eventSuffixByPersonIndex?: string[];
    /** Split mode: when true and there are more tokens than `eventSuffixByPersonIndex`, reuse the last suffix for every remaining person. */
    repeatLastEventSuffix?: boolean;
  };
  fieldTemplates?: {
    name?: string;
    title?: string;
    heading?: string;
    subHeading?: string;
    event?: string;
  };
  outlineSync?: {
    enabled: boolean;
    itemType: "song" | "bible" | "none";
  };
};

export type ServicePlanningSectionRule = {
  id: string;
  matchSectionName: string;
  matchMode: ServicePlanningMatchMode;
  /** Name of the outline heading to find or create. */
  headingName: string;
};

export type ServicePlanningPerson = {
  id: string;
  names: string[];
  displayName: string;
  title?: string;
};

export type ServicePlanningConfig = {
  enabled: boolean;
  elementRules: ServicePlanningElementRule[];
  sectionRules: ServicePlanningSectionRule[];
  people: ServicePlanningPerson[];
};

export type ChurchIntegrationsCatalog = {
  servicePlanning: { status: IntegrationCatalogStatus; label: string };
  songSelect: { status: IntegrationCatalogStatus; label: string };
  planningCenter: { status: IntegrationCatalogStatus; label: string };
};

export type ChurchIntegrations = {
  version: number;
  catalog: ChurchIntegrationsCatalog;
  servicePlanning: ServicePlanningConfig;
};

export const createDefaultChurchIntegrations = (): ChurchIntegrations => ({
  version: 1,
  catalog: {
    servicePlanning: { status: "available", label: "Service Planning" },
    songSelect: { status: "coming_soon", label: "SongSelect" },
    planningCenter: { status: "coming_soon", label: "Planning Center" },
  },
  servicePlanning: {
    enabled: false,
    elementRules: [],
    sectionRules: [],
    people: [],
  },
});
