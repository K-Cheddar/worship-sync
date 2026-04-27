import { configureStore } from "@reduxjs/toolkit";
import servicePlanningImportReducer, {
  advanceServicePlanningSyncStep,
  clearServicePlanningSyncState,
  completeServicePlanningSync,
  failServicePlanningSync,
  recordServicePlanningSyncResult,
  resetServicePlanningImportPreview,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPlanInfo,
  setServicePlanningSyncPhase,
  setServicePlanningImportOutlinePreviewExpanded,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportPreview,
  setServicePlanningImportUrl,
  startServicePlanningSync,
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

  it("tracks a staged sync run from start through completion", () => {
    const store = createStore();

    store.dispatch(startServicePlanningSync({ mode: "both" }));
    store.dispatch(
      setServicePlanningSyncPlanInfo({
        totalSteps: 4,
        overlaysSkipped: 1,
        reasons: ['Create overlay for "Song of Praise"'],
      }),
    );
    store.dispatch(
      setServicePlanningSyncActiveStep({
        phase: "outline",
        activeLabel: "Welcome Song",
      }),
    );
    store.dispatch(recordServicePlanningSyncResult({ outlineInserted: 1 }));
    store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
    store.dispatch(setServicePlanningSyncPhase("overlays"));
    store.dispatch(
      setServicePlanningSyncActiveStep({
        phase: "overlays",
        activeLabel: "Welcome & Announcements",
      }),
    );
    store.dispatch(
      recordServicePlanningSyncResult({
        overlaysUpdated: 1,
        overlaysCreated: 1,
      }),
    );
    store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
    store.dispatch(completeServicePlanningSync());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.sync.status).toBe("completed");
    expect(state.sync.phase).toBe("done");
    expect(state.sync.totalSteps).toBe(4);
    expect(state.sync.currentStep).toBe(2);
    expect(state.sync.outlineInserted).toBe(1);
    expect(state.sync.overlaysUpdated).toBe(1);
    expect(state.sync.overlaysCreated).toBe(1);
    expect(state.sync.overlaysSkipped).toBe(1);
    expect(state.sync.reasons).toEqual(['Create overlay for "Song of Praise"']);
  });

  it("can fail and then clear staged sync state without losing the preview", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportPreview(previewFixture));
    store.dispatch(startServicePlanningSync({ mode: "outline" }));
    store.dispatch(failServicePlanningSync("Sync failed. Try again."));
    store.dispatch(clearServicePlanningSyncState());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.preview).toEqual(previewFixture);
    expect(state.sync.status).toBe("idle");
    expect(state.sync.mode).toBeNull();
    expect(state.sync.error).toBeNull();
  });
});
