import { configureStore } from "@reduxjs/toolkit";
import servicePlanningImportReducer, {
  advanceServicePlanningSyncStep,
  cancelServicePlanningSync,
  clearServicePlanningSyncState,
  completeServicePlanningSync,
  failServicePlanningSync,
  finishServicePlanningSyncCancellation,
  recordServicePlanningSyncResult,
  resetServicePlanningImportPreview,
  setServicePlanningServiceOutline,
  setServicePlanningImportOutlinePreviewExpanded,
  setServicePlanningImportOverlaySummaryExpanded,
  setServicePlanningImportUrl,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPlanInfo,
  setServicePlanningSyncPhase,
  startServicePlanningSync,
} from "./servicePlanningImportSlice";
import type { ServiceOutline } from "../types/importedPlan";
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
  lineItems: [],
};

const serviceOutlineFixture: ServiceOutline = {
  source: "servicePlanning",
  loadedAt: "2026-05-03T12:00:00.000Z",
  sourceUrl: "https://example.com/plan",
  planLabel: "May 2, 2026 - 10 AM",
  preview: previewFixture,
};

describe("servicePlanningImportSlice", () => {
  it("keeps the loaded url and preview until they are cleared", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportUrl("https://example.com/plan"));
    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture));

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.url).toBe("https://example.com/plan");
    expect(state.preview).toEqual(previewFixture);
    expect(state.serviceOutline).toEqual(serviceOutlineFixture);
  });

  it("clears only the preview after sync so the last url stays available", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportUrl("https://example.com/plan"));
    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture));
    store.dispatch(resetServicePlanningImportPreview());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.url).toBe("https://example.com/plan");
    expect(state.preview).toBeNull();
    expect(state.serviceOutline).toBeNull();
  });

  it("preserves expand/collapse flags when preview is cleared", () => {
    const store = createStore();

    store.dispatch(setServicePlanningImportOverlaySummaryExpanded(true));
    store.dispatch(setServicePlanningImportOutlinePreviewExpanded(true));
    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture));
    store.dispatch(resetServicePlanningImportPreview());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.overlaySummaryExpanded).toBe(true);
    expect(state.outlinePreviewExpanded).toBe(true);
  });

  it("resolves the pending sync item for the active phase and sublabel", () => {
    const store = createStore();

    store.dispatch(startServicePlanningSync({ mode: "both" }));
    store.dispatch(
      setServicePlanningSyncPlanInfo({
        totalSteps: 2,
        syncItems: [
          {
            phase: "outline",
            label: "Welcome Song",
            sublabel: "Welcome",
            status: "pending",
          },
          {
            phase: "overlays",
            label: "Welcome Song",
            status: "pending",
          },
        ],
      }),
    );
    store.dispatch(
      setServicePlanningSyncActiveStep({
        phase: "overlays",
        activeLabel: "Welcome Song",
      }),
    );
    store.dispatch(
      advanceServicePlanningSyncStep({ resolvedStatus: "updated" }),
    );

    const items = store.getState().servicePlanningImport.sync.syncItems;
    expect(items[0]?.status).toBe("pending");
    expect(items[1]?.status).toBe("updated");
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
    store.dispatch(
      advanceServicePlanningSyncStep({ resolvedStatus: "updated" }),
    );
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
    store.dispatch(
      advanceServicePlanningSyncStep({ resolvedStatus: "updated" }),
    );
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

    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture));
    store.dispatch(startServicePlanningSync({ mode: "outline" }));
    store.dispatch(failServicePlanningSync("Sync failed. Try again."));
    store.dispatch(clearServicePlanningSyncState());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.preview).toEqual(previewFixture);
    expect(state.serviceOutline).toEqual(serviceOutlineFixture);
    expect(state.sync.status).toBe("idle");
    expect(state.sync.mode).toBeNull();
    expect(state.sync.error).toBeNull();
  });

  it("keeps stop requests pending until the runner finalizes cancellation", () => {
    const store = createStore();

    store.dispatch(startServicePlanningSync({ mode: "outline" }));
    store.dispatch(
      setServicePlanningSyncActiveStep({
        phase: "outline",
        activeLabel: "Welcome Song",
      }),
    );
    store.dispatch(cancelServicePlanningSync());

    expect(store.getState().servicePlanningImport.sync.status).toBe(
      "cancelling",
    );
    expect(store.getState().servicePlanningImport.sync.activeLabel).toBe(
      "Welcome Song",
    );

    store.dispatch(recordServicePlanningSyncResult({ outlineInserted: 1 }));
    store.dispatch(finishServicePlanningSyncCancellation());

    const state = store.getState()
      .servicePlanningImport as ServicePlanningImportState;
    expect(state.sync.status).toBe("cancelled");
    expect(state.sync.phase).toBe("done");
    expect(state.sync.activeLabel).toBe("");
    expect(state.sync.outlineInserted).toBe(1);
  });
});
