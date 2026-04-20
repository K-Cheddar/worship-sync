import { configureStore } from "@reduxjs/toolkit";
import servicePlanningImportReducer, {
  resetServicePlanningImportPreview,
  setServicePlanningImportOutlinePreviewExpanded,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportPreview,
  setServicePlanningImportUrl,
} from "./servicePlanningImportSlice";
import type { ServicePlanningPreview } from "../types/servicePlanningImport";

type ServicePlanningImportState = ReturnType<
  typeof servicePlanningImportReducer
>;

const createStore = () =>
  configureStore({
    reducer: { servicePlanningImport: servicePlanningImportReducer },
  });

const previewFixture: ServicePlanningPreview = {
  overlayCandidates: [],
  overlayPlan: [],
  outlineCandidates: [],
};

describe("servicePlanningImportSlice", () => {
  it("keeps the loaded url and preview until they are cleared", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportUrl("https://example.com/plan"));
    store.dispatch(setServicePlanningImportPreview(previewFixture));

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.url).toBe("https://example.com/plan");
    expect(state.preview).toEqual(previewFixture);
  });

  it("clears only the preview after sync so the last url stays available", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportUrl("https://example.com/plan"));
    store.dispatch(setServicePlanningImportPreview(previewFixture));
    store.dispatch(resetServicePlanningImportPreview());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.url).toBe("https://example.com/plan");
    expect(state.preview).toBeNull();
  });

  it("preserves expand/collapse flags when preview is cleared", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportOverlaySummaryExpanded(true));
    store.dispatch(setServicePlanningImportOutlinePreviewExpanded(true));
    store.dispatch(setServicePlanningImportPreview(previewFixture));
    store.dispatch(resetServicePlanningImportPreview());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.overlaySummaryExpanded).toBe(true);
    expect(state.outlinePreviewExpanded).toBe(true);
  });
});
