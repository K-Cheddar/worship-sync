import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type GeneratedCreditItemStatus =
  | "pending"
  | "updating"
  | "updated"
  | "current"
  | "missed"
  | "error";

export type GeneratedCreditItem = {
  creditId: string;
  creditHeading: string;
  sourceLabel: string;
  previousText: string;
  nextText: string;
  status: GeneratedCreditItemStatus;
  error?: string;
};

export type GeneratedCreditsState = {
  dismissed: boolean;
  restoreId: number;
  status: "idle" | "running" | "completed" | "failed";
  generatedAt: string;
  currentStep: number;
  totalSteps: number;
  activeCreditId: string;
  items: GeneratedCreditItem[];
  warning: string | null;
  error: string | null;
};

export const initialGeneratedCreditsState: GeneratedCreditsState = {
  dismissed: true,
  restoreId: 0,
  status: "idle",
  generatedAt: "",
  currentStep: 0,
  totalSteps: 0,
  activeCreditId: "",
  items: [],
  warning: null,
  error: null,
};

export const generatedCreditsSlice = createSlice({
  name: "generatedCredits",
  initialState: initialGeneratedCreditsState,
  reducers: {
    startGeneratedCredits: (
      state,
      action: PayloadAction<{
        generatedAt: string;
        items: Array<Omit<GeneratedCreditItem, "status" | "error"> & {
          status?: Extract<GeneratedCreditItemStatus, "missed">;
        }>;
        warning?: string | null;
      }>,
    ) => {
      state.dismissed = false;
      state.restoreId += 1;
      state.status = "running";
      state.generatedAt = action.payload.generatedAt;
      state.currentStep = 0;
      state.totalSteps = action.payload.items.filter(
        (item) => item.status !== "missed",
      ).length;
      state.activeCreditId = "";
      state.items = action.payload.items.map((item) => ({
        ...item,
        status: item.status ?? "pending",
      }));
      state.warning = action.payload.warning ?? null;
      state.error = null;
    },
    setGeneratedCreditsDismissed: (state, action: PayloadAction<boolean>) => {
      state.dismissed = action.payload;
      if (!action.payload) state.restoreId += 1;
    },
    setGeneratedCreditActive: (state, action: PayloadAction<string>) => {
      state.activeCreditId = action.payload;
      const item = state.items.find((entry) => entry.creditId === action.payload);
      if (item && item.status === "pending") {
        item.status = "updating";
      }
    },
    completeGeneratedCreditItem: (
      state,
      action: PayloadAction<{
        creditId: string;
        status: Extract<GeneratedCreditItemStatus, "updated" | "current">;
      }>,
    ) => {
      const item = state.items.find((entry) => entry.creditId === action.payload.creditId);
      if (item) {
        item.status = action.payload.status;
      }
      state.currentStep = Math.min(state.currentStep + 1, state.totalSteps);
      state.activeCreditId = "";
    },
    failGeneratedCreditItem: (
      state,
      action: PayloadAction<{ creditId: string; error: string }>,
    ) => {
      const item = state.items.find((entry) => entry.creditId === action.payload.creditId);
      if (item) {
        item.status = "error";
        item.error = action.payload.error;
      }
      state.currentStep = Math.min(state.currentStep + 1, state.totalSteps);
      state.activeCreditId = "";
    },
    completeGeneratedCredits: (state) => {
      state.status = "completed";
      state.activeCreditId = "";
      state.error = null;
    },
    failGeneratedCredits: (state, action: PayloadAction<string>) => {
      state.status = "failed";
      state.activeCreditId = "";
      state.error = action.payload;
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
  clearGeneratedCredits,
} = generatedCreditsSlice.actions;

export default generatedCreditsSlice.reducer;
