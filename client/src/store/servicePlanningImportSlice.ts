import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ServiceItem } from "../types";
import type { ServiceOutline } from "../types/importedPlan";
import type { ServicePlanningPreview } from "../types/servicePlanningImport";
import { findBestServicePlanningSongMatch } from "../integrations/servicePlanning/findServicePlanningSongMatch";
import { cleanPlanningTitle } from "../integrations/servicePlanning/cleanPlanningTitle";

export type ServicePlanningSyncStatus =
  | "idle"
  | "running"
  // User requested a stop; the runner finalizes to "cancelled" once the active
  // step settles so the summary counts include any change already in flight.
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type ServicePlanningSyncMode = "outline" | "overlays" | "both";

export type ServicePlanningSyncPhase = "outline" | "overlays" | "done" | null;

export type ServicePlanningSyncItemStatus =
  | "pending"
  | "updated"
  | "created"
  | "added"
  // Overlay already existed and matched the plan — nothing was changed.
  | "found"
  | "already-present";

export type ServicePlanningSyncItem = {
  label: string;
  sublabel?: string;
  phase: Exclude<ServicePlanningSyncPhase, "done" | null>;
  status: ServicePlanningSyncItemStatus;
  sourceLineItemKey?: string;
};

/** @deprecated Use ServicePlanningSyncItem */
export type ServicePlanningSyncCompletedItem = ServicePlanningSyncItem;

export type ServicePlanningSyncFollowUpItem = {
  label: string;
  sublabel?: string;
  reason: string;
};

export type ServicePlanningSyncSummary = {
  runId: number;
  status: ServicePlanningSyncStatus;
  mode: ServicePlanningSyncMode | null;
  phase: ServicePlanningSyncPhase;
  currentStep: number;
  totalSteps: number;
  activeLabel: string;
  activeSublabel: string;
  syncItems: ServicePlanningSyncItem[];
  followUpItems: ServicePlanningSyncFollowUpItem[];
  overlaysUpdated: number;
  overlaysCloned: number;
  overlaysCreated: number;
  overlaysSkipped: number;
  outlineInserted: number;
  reasons: string[];
  error: string | null;
};

export type ServicePlanningImportState = {
  url: string;
  serviceOutline: ServiceOutline | null;
  preview: ServicePlanningPreview | null;
  /**
   * planKey when the current preview was built from the Teams ServicePlan
   * rather than a pasted URL; null for a URL-sourced preview. A plan-sourced
   * preview follows the plan live, so Refresh must re-read the plan instead of
   * re-scraping `url` (which may be stale or belong to a different service).
   */
  servicePlanKey: string | null;
  floatingWindowDismissed: boolean;
  floatingWindowRestoreId: number;
  /** Service Planning Import page: overlay sync summary list expanded. */
  overlaySummaryExpanded: boolean;
  /** Service Planning Import page: outline preview list expanded. */
  outlinePreviewExpanded: boolean;
  sync: ServicePlanningSyncSummary;
};

const initialServicePlanningSyncSummary: ServicePlanningSyncSummary = {
  runId: 0,
  status: "idle",
  mode: null,
  phase: null,
  currentStep: 0,
  totalSteps: 0,
  activeLabel: "",
  activeSublabel: "",
  syncItems: [],
  followUpItems: [],
  overlaysUpdated: 0,
  overlaysCloned: 0,
  overlaysCreated: 0,
  overlaysSkipped: 0,
  outlineInserted: 0,
  reasons: [],
  error: null,
};

export const initialServicePlanningImportState: ServicePlanningImportState = {
  url: "",
  serviceOutline: null,
  preview: null,
  servicePlanKey: null,
  floatingWindowDismissed: true,
  floatingWindowRestoreId: 0,
  overlaySummaryExpanded: false,
  outlinePreviewExpanded: false,
  sync: initialServicePlanningSyncSummary,
};

export const servicePlanningImportSlice = createSlice({
  name: "servicePlanningImport",
  initialState: initialServicePlanningImportState,
  reducers: {
    setServicePlanningImportUrl: (state, action: PayloadAction<string>) => {
      state.url = action.payload;
    },
    setServicePlanningServiceOutline: (
      state,
      action: PayloadAction<ServiceOutline | null>,
    ) => {
      state.serviceOutline = action.payload;
      state.preview = action.payload?.preview ?? null;
      // Pasting a URL is an explicit operator choice, so it takes over from a
      // plan-sourced preview until the next plan load.
      state.servicePlanKey = null;
      if (action.payload?.sourceUrl) {
        state.url = action.payload.sourceUrl;
      }
    },
    /**
     * Same as above but for a preview built from the Teams ServicePlan. Leaves
     * `url` alone: the plan's original import URL is provenance, not something
     * the operator pasted, and overwriting the box would make Import look like
     * it had already been used for this service.
     */
    setServicePlanningPlanOutline: (
      state,
      action: PayloadAction<{ outline: ServiceOutline; planKey: string }>,
    ) => {
      state.serviceOutline = action.payload.outline;
      state.preview = action.payload.outline.preview;
      state.servicePlanKey = action.payload.planKey;
    },
    /**
     * Drops a plan-sourced preview when its service no longer has a saved plan
     * (typically after switching services in the picker). Deliberately a no-op
     * for a URL-sourced preview, which the operator pasted by hand and owns.
     * Showing the previous service's plan under the new service's name would
     * invite an operator to sync overlays or the outline for the wrong service.
     */
    clearServicePlanningPlanOutline: (state) => {
      if (!state.servicePlanKey) return;
      state.serviceOutline = null;
      state.preview = null;
      state.servicePlanKey = null;
    },
    resetServicePlanningImportPreview: (state) => {
      state.serviceOutline = null;
      state.preview = null;
      state.servicePlanKey = null;
      state.floatingWindowDismissed = true;
    },
    setServicePlanningFloatingWindowDismissed: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.floatingWindowDismissed = action.payload;
      if (!action.payload) {
        state.floatingWindowRestoreId += 1;
      }
    },
    setServicePlanningImportOverlaySummaryExpanded: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.overlaySummaryExpanded = action.payload;
    },
    setServicePlanningImportOutlinePreviewExpanded: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.outlinePreviewExpanded = action.payload;
    },
    startServicePlanningSync: (
      state,
      action: PayloadAction<{ mode: ServicePlanningSyncMode }>,
    ) => {
      state.sync = {
        ...initialServicePlanningSyncSummary,
        runId: state.sync.runId + 1,
        status: "running",
        mode: action.payload.mode,
        phase: action.payload.mode === "overlays" ? "overlays" : "outline",
      };
    },
    setServicePlanningSyncPlanInfo: (
      state,
      action: PayloadAction<{
        totalSteps: number;
        overlaysSkipped?: number;
        reasons?: string[];
        syncItems?: ServicePlanningSyncItem[];
        followUpItems?: ServicePlanningSyncFollowUpItem[];
      }>,
    ) => {
      state.sync.totalSteps = action.payload.totalSteps;
      state.sync.overlaysSkipped = action.payload.overlaysSkipped ?? 0;
      state.sync.reasons = action.payload.reasons ?? [];
      state.sync.syncItems = action.payload.syncItems ?? [];
      state.sync.followUpItems = action.payload.followUpItems ?? [];
    },
    setServicePlanningSyncActiveStep: (
      state,
      action: PayloadAction<{
        phase: Exclude<ServicePlanningSyncPhase, "done" | null>;
        activeLabel: string;
        activeSublabel?: string;
      }>,
    ) => {
      state.sync.phase = action.payload.phase;
      state.sync.activeLabel = action.payload.activeLabel;
      state.sync.activeSublabel = action.payload.activeSublabel ?? "";
    },
    advanceServicePlanningSyncStep: (
      state,
      action: PayloadAction<{
        resolvedStatus: Exclude<
          ServicePlanningSyncItemStatus,
          "pending" | "already-present"
        >;
      }>,
    ) => {
      if (state.sync.activeLabel) {
        const idx = state.sync.syncItems.findIndex(
          (item) =>
            item.status === "pending" &&
            item.phase === state.sync.phase &&
            item.label === state.sync.activeLabel &&
            (item.sublabel || "") === (state.sync.activeSublabel || ""),
        );
        if (idx !== -1) {
          state.sync.syncItems[idx].status = action.payload.resolvedStatus;
        }
      }
      state.sync.currentStep += 1;
      state.sync.activeLabel = "";
      state.sync.activeSublabel = "";
    },
    setServicePlanningSyncPhase: (
      state,
      action: PayloadAction<Exclude<ServicePlanningSyncPhase, "done" | null>>,
    ) => {
      state.sync.phase = action.payload;
      state.sync.activeLabel = "";
      state.sync.activeSublabel = "";
    },
    recordServicePlanningSyncResult: (
      state,
      action: PayloadAction<{
        overlaysUpdated?: number;
        overlaysCloned?: number;
        overlaysCreated?: number;
        overlaysSkipped?: number;
        outlineInserted?: number;
        reasons?: string[];
      }>,
    ) => {
      state.sync.overlaysUpdated += action.payload.overlaysUpdated ?? 0;
      state.sync.overlaysCloned += action.payload.overlaysCloned ?? 0;
      state.sync.overlaysCreated += action.payload.overlaysCreated ?? 0;
      state.sync.overlaysSkipped += action.payload.overlaysSkipped ?? 0;
      state.sync.outlineInserted += action.payload.outlineInserted ?? 0;
      if (action.payload.reasons?.length) {
        state.sync.reasons.push(...action.payload.reasons);
      }
    },
    completeServicePlanningSync: (state) => {
      state.sync.status = "completed";
      state.sync.phase = "done";
      state.sync.activeLabel = "";
      state.sync.activeSublabel = "";
      state.sync.error = null;
    },
    failServicePlanningSync: (state, action: PayloadAction<string>) => {
      state.sync.status = "failed";
      state.sync.error = action.payload;
      state.sync.activeLabel = "";
      state.sync.activeSublabel = "";
    },
    /** User requested a stop. The runner finalizes once any active step settles. */
    cancelServicePlanningSync: (state) => {
      if (state.sync.status !== "running") return;
      state.sync.status = "cancelling";
      state.sync.error = null;
    },
    finishServicePlanningSyncCancellation: (state) => {
      if (state.sync.status !== "cancelling") return;
      state.sync.status = "cancelled";
      state.sync.phase = "done";
      state.sync.activeLabel = "";
      state.sync.activeSublabel = "";
      state.sync.error = null;
    },
    clearServicePlanningSyncState: (state) => {
      state.sync = {
        ...initialServicePlanningSyncSummary,
        runId: state.sync.runId,
      };
    },
    resetServicePlanningImportState: () => initialServicePlanningImportState,
    refreshPreviewSongMatches: (
      state,
      action: PayloadAction<ServiceItem[]>,
    ) => {
      if (!state.preview) return;
      const songs = action.payload.filter((item) => item.type === "song");
      for (const lineItem of state.preview.lineItems) {
        if (
          lineItem.outlineItemType === "song" &&
          !lineItem.matchedLibraryItem
        ) {
          const match = findBestServicePlanningSongMatch(
            lineItem.cleanedTitle || cleanPlanningTitle(lineItem.title),
            songs,
          );
          if (match) lineItem.matchedLibraryItem = match;
        }
      }
      for (const candidate of state.preview.outlineCandidates) {
        if (
          candidate.outlineItemType === "song" &&
          !candidate.matchedLibraryItem
        ) {
          const match = findBestServicePlanningSongMatch(
            candidate.cleanedTitle,
            songs,
          );
          if (match) candidate.matchedLibraryItem = match;
        }
      }
    },
  },
});

export const {
  setServicePlanningImportUrl,
  setServicePlanningServiceOutline,
  setServicePlanningPlanOutline,
  clearServicePlanningPlanOutline,
  resetServicePlanningImportPreview,
  setServicePlanningFloatingWindowDismissed,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportOutlinePreviewExpanded,
  startServicePlanningSync,
  setServicePlanningSyncPlanInfo,
  setServicePlanningSyncActiveStep,
  advanceServicePlanningSyncStep,
  setServicePlanningSyncPhase,
  recordServicePlanningSyncResult,
  completeServicePlanningSync,
  failServicePlanningSync,
  cancelServicePlanningSync,
  finishServicePlanningSyncCancellation,
  clearServicePlanningSyncState,
  resetServicePlanningImportState,
  refreshPreviewSongMatches,
} = servicePlanningImportSlice.actions;

export default servicePlanningImportSlice.reducer;
