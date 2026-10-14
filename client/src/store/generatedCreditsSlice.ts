import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type GeneratedCreditItemStatus =
  | "pending"
  | "updating"
  | "creating"
  | "created"
  | "updated"
  | "unchanged"
  | "unmatched"
  | "skipped"
  | "failed";

export type GeneratedCreditItem = {
  creditId: string;
  creditHeading: string;
  sourceLabel: string;
  previousText: string;
  nextText: string;
  status: GeneratedCreditItemStatus;
  reason?: string;
  error?: string;
};

export type GeneratedCreditsOwner = {
  churchId: string;
  databaseKey: string;
  databaseScopeId: string;
  databaseInstanceId: number;
  outlineId: string;
};

export type GeneratedCreditsState = {
  dismissed: boolean;
  restoreId: number;
  operationId: string;
  owner: GeneratedCreditsOwner | null;
  status: "idle" | "running" | "completed" | "failed" | "detached";
  generatedAt: string;
  currentStep: number;
  totalSteps: number;
  activeCreditId: string;
  items: GeneratedCreditItem[];
  warning: string | null;
  error: string | null;
  detachedReason: string | null;
};

export const initialGeneratedCreditsState: GeneratedCreditsState = {
  dismissed: true,
  restoreId: 0,
  operationId: "",
  owner: null,
  status: "idle",
  generatedAt: "",
  currentStep: 0,
  totalSteps: 0,
  activeCreditId: "",
  items: [],
  warning: null,
  error: null,
  detachedReason: null,
};

export const generatedCreditsSlice = createSlice({
  name: "generatedCredits",
  initialState: initialGeneratedCreditsState,
  reducers: {
    startGeneratedCredits: (
      state,
      action: PayloadAction<{
        operationId: string;
        owner: GeneratedCreditsOwner;
        generatedAt: string;
        items: Array<Omit<GeneratedCreditItem, "status" | "error"> & {
          status?: Extract<GeneratedCreditItemStatus, "unmatched" | "skipped" | "creating">;
        }>;
        warning?: string | null;
      }>,
    ) => {
      state.dismissed = false;
      state.restoreId += 1;
      state.operationId = action.payload.operationId;
      state.owner = action.payload.owner;
      state.status = "running";
      state.generatedAt = action.payload.generatedAt;
      state.currentStep = 0;
      state.totalSteps = action.payload.items.filter(
        (item) => item.status !== "unmatched" && item.status !== "skipped",
      ).length;
      state.activeCreditId = "";
      state.items = action.payload.items.map((item) => ({
        ...item,
        status: item.status ?? "pending",
      }));
      state.warning = action.payload.warning ?? null;
      state.error = null;
      state.detachedReason = null;
    },
    setGeneratedCreditsDismissed: (state, action: PayloadAction<boolean>) => {
      state.dismissed = action.payload;
      if (!action.payload) state.restoreId += 1;
    },
    setGeneratedCreditActive: (
      state,
      action: PayloadAction<{ operationId: string; creditId: string }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      state.activeCreditId = action.payload.creditId;
      const item = state.items.find((entry) => entry.creditId === action.payload.creditId);
      if (item && item.status === "pending") {
        item.status = "updating";
      }
    },
    completeGeneratedCreditItem: (
      state,
      action: PayloadAction<{
        operationId: string;
        creditId: string;
        status: Extract<GeneratedCreditItemStatus, "created" | "updated" | "unchanged">;
      }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      const item = state.items.find((entry) => entry.creditId === action.payload.creditId);
      if (item) {
        item.status = action.payload.status;
      }
      state.currentStep = Math.min(state.currentStep + 1, state.totalSteps);
      state.activeCreditId = "";
    },
    failGeneratedCreditItem: (
      state,
      action: PayloadAction<{ operationId: string; creditId: string; error: string }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      const item = state.items.find((entry) => entry.creditId === action.payload.creditId);
      if (item) {
        item.status = "failed";
        item.error = action.payload.error;
      }
      state.currentStep = Math.min(state.currentStep + 1, state.totalSteps);
      state.activeCreditId = "";
    },
    completeGeneratedCredits: (
      state,
      action: PayloadAction<{ operationId: string }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      state.status = "completed";
      state.activeCreditId = "";
      state.error = null;
    },
    failGeneratedCredits: (
      state,
      action: PayloadAction<{ operationId: string; error: string }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      state.status = "failed";
      state.activeCreditId = "";
      state.error = action.payload.error;
    },
    detachGeneratedCreditsOperation: (
      state,
      action: PayloadAction<{ operationId: string }>,
    ) => {
      if (state.operationId !== action.payload.operationId || state.status !== "running") return;
      state.status = "detached";
      state.activeCreditId = "";
      state.detachedReason = "Progress paused after leaving this service. Some credits may already be saved. Review the outline before generating again.";
    },
    clearGeneratedCredits: () => initialGeneratedCreditsState,
  },
});

export const {
  startGeneratedCredits,
  setGeneratedCreditsDismissed,
  setGeneratedCreditActive,
  completeGeneratedCreditItem,
  failGeneratedCreditItem,
  completeGeneratedCredits,
  failGeneratedCredits,
  detachGeneratedCreditsOperation,
  clearGeneratedCredits,
} = generatedCreditsSlice.actions;

export default generatedCreditsSlice.reducer;
