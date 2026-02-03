import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayType, SavedTemplate, TemplatesByType } from "../types";

export type OverlayTemplatesState = {
  templatesByType: TemplatesByType;
  isInitialized: boolean;
  isLoading: boolean;
  hasPendingUpdate: boolean;
};

const initialState: OverlayTemplatesState = {
  templatesByType: {
    participant: [],
    "stick-to-bottom": [],
    "qr-code": [],
    image: [],
  },
  isInitialized: false,
  isLoading: false,
  hasPendingUpdate: false,
};

const overlayTemplatesSlice = createSlice({
  name: "overlayTemplates",
  initialState,
  reducers: {
    setIsInitialized: (state, action: PayloadAction<boolean>) => {
      state.isInitialized = action.payload;
    },
    initiateTemplates: (
      state,
      action: PayloadAction<TemplatesByType | undefined>,
    ) => {
      state.templatesByType = action.payload || initialState.templatesByType;
      state.isInitialized = true;
      state.isLoading = false;
    },
    addTemplate: (
      state,
      action: PayloadAction<{ type: OverlayType; template: SavedTemplate }>,
    ) => {
      const { type, template } = action.payload;
      state.templatesByType[type].push(template);
      state.hasPendingUpdate = true;
    },
    updateTemplate: (
      state,
      action: PayloadAction<{
        type: OverlayType;
        templateId: string;
        updates: Partial<SavedTemplate>;
      }>,
    ) => {
      const { type, templateId, updates } = action.payload;
      const templateIndex = state.templatesByType[type].findIndex(
        (t) => t.id === templateId,
      );
      if (templateIndex !== -1) {
        state.templatesByType[type][templateIndex] = {
          ...state.templatesByType[type][templateIndex],
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        state.hasPendingUpdate = true;
      }
    },
    deleteTemplate: (
      state,
      action: PayloadAction<{ type: OverlayType; templateId: string }>,
    ) => {
      const { type, templateId } = action.payload;
      state.templatesByType[type] = state.templatesByType[type].filter(
        (t) => t.id !== templateId,
      );
      state.hasPendingUpdate = true;
    },
    updateTemplatesFromRemote: (
      state,
      action: PayloadAction<TemplatesByType>,
    ) => {
      state.templatesByType = action.payload;
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setHasPendingUpdate: (state, action: PayloadAction<boolean>) => {
      state.hasPendingUpdate = action.payload;
    },
    forceUpdate: (state) => {
      // Force update trigger
    },
  },
});

export const {
  initiateTemplates,
  setIsInitialized,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  updateTemplatesFromRemote,
  setIsLoading,
  setHasPendingUpdate,
  forceUpdate,
} = overlayTemplatesSlice.actions;

export default overlayTemplatesSlice.reducer;
export { overlayTemplatesSlice };
