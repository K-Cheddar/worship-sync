import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ServicePlanningPreview } from "../types/servicePlanningImport";

export type ServicePlanningSyncStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export type ServicePlanningSyncMode = "outline" | "overlays" | "both";

export type ServicePlanningSyncPhase = "outline" | "overlays" | "done" | null;

export type ServicePlanningSyncItemStatus =
  | "pending"
  | "updated"
  | "created"
  | "added"
  | "already-present";

export type ServicePlanningSyncItem = {
  label: string;
  sublabel?: string;
  phase: Exclude<ServicePlanningSyncPhase, "done" | null>;
  status: ServicePlanningSyncItemStatus;
};

/** @deprecated Use ServicePlanningSyncItem */
export type ServicePlanningSyncCompletedItem = ServicePlanningSyncItem;

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
  preview: ServicePlanningPreview | null;
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
  preview: null,
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
    setServicePlanningImportPreview: (
      state,
      action: PayloadAction<ServicePlanningPreview | null>,
    ) => {
      state.preview = action.payload;
    },
    resetServicePlanningImportPreview: (state) => {
      state.preview = null;
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
      }>,
    ) => {
      state.sync.totalSteps = action.payload.totalSteps;
      state.sync.overlaysSkipped = action.payload.overlaysSkipped ?? 0;
      state.sync.reasons = action.payload.reasons ?? [];
      state.sync.syncItems = action.payload.syncItems ?? [];
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
      action: PayloadAction<{ resolvedStatus: Exclude<ServicePlanningSyncItemStatus, "pending" | "already-present"> }>,
    ) => {
      if (state.sync.activeLabel) {
        const idx = state.sync.syncItems.findIndex(
          (item) => item.status === "pending" && item.label === state.sync.activeLabel,
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
    clearServicePlanningSyncState: (state) => {
      state.sync = {
        ...initialServicePlanningSyncSummary,
        runId: state.sync.runId,
      };
    },
    resetServicePlanningImportState: () => initialServicePlanningImportState,
  },
});

export const {
  setServicePlanningImportUrl,
  setServicePlanningImportPreview,
  resetServicePlanningImportPreview,
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
  clearServicePlanningSyncState,
  resetServicePlanningImportState,
} = servicePlanningImportSlice.actions;

export default servicePlanningImportSlice.reducer;
