import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { ServicePlanningPreview } from "../types/servicePlanningImport";

export type ServicePlanningImportState = {
  url: string;
  preview: ServicePlanningPreview | null;
  /** Service Planning Import page: overlay sync summary list expanded. */
  overlaySummaryExpanded: boolean;
  /** Service Planning Import page: outline preview list expanded. */
  outlinePreviewExpanded: boolean;
};

export const initialServicePlanningImportState: ServicePlanningImportState = {
  url: "",
  preview: null,
  overlaySummaryExpanded: false,
  outlinePreviewExpanded: false,
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
    resetServicePlanningImportState: () => initialServicePlanningImportState,
  },
});

export const {
  setServicePlanningImportUrl,
  setServicePlanningImportPreview,
  resetServicePlanningImportPreview,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportOutlinePreviewExpanded,
  resetServicePlanningImportState,
} = servicePlanningImportSlice.actions;

export default servicePlanningImportSlice.reducer;
