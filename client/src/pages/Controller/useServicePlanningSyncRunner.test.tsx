import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import servicePlanningImportReducer, {
  cancelServicePlanningSync,
  setServicePlanningServiceOutline,
  startServicePlanningSync,
} from "../../store/servicePlanningImportSlice";
import { useServicePlanningSyncRunner } from "./useServicePlanningSyncRunner";

const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockPlanOutlineSyncSteps = jest.fn();
const mockPlanSyncItemsInOrder = jest.fn();
const mockPlanOverlaySyncSteps = jest.fn();
const mockExecuteOutlineSyncStep = jest.fn();
const mockExecuteOverlaySyncStep = jest.fn();

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

jest.mock("../../utils/generalUtils", () => ({
  ...jest.requireActual("../../utils/generalUtils"),
  ensureElementInView: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: () => ({
    planOutlineSyncSteps: mockPlanOutlineSyncSteps,
    planSyncItemsInOrder: mockPlanSyncItemsInOrder,
    planOverlaySyncSteps: mockPlanOverlaySyncSteps,
    executeOutlineSyncStep: mockExecuteOutlineSyncStep,
    executeOverlaySyncStep: mockExecuteOverlaySyncStep,
  }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const RunnerHarness = () => {
  useServicePlanningSyncRunner();
  return <LocationProbe />;
};

const previewFixture = {
  overlayCandidates: [],
  overlayPlan: [],
  outlineCandidates: [],
  lineItems: [],
};

const serviceOutlineFixture = {
  source: "servicePlanning" as const,
  loadedAt: "2026-05-03T12:00:00.000Z",
  sourceUrl: "https://example.com/plan",
  planLabel: "May 2, 2026 - 10 AM",
  preview: previewFixture,
};

describe("useServicePlanningSyncRunner", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockShowToast.mockReturnValue("toast-1");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("runs outline steps before overlay steps and ends on overlays", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    mockPlanOutlineSyncSteps.mockReturnValue([
      {
        kind: "insertSong",
        headingName: "Welcome",
        candidate: {
          title: "Welcome Song",
          cleanedTitle: "Welcome Song",
        },
      },
    ]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [
        {
          action: "update",
          elementType: "Welcome",
          patch: { event: "Welcome Song" },
          targetOverlayId: "overlay-1",
        },
      ],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([
      {
        phase: "outline",
        label: "Welcome Song",
        status: "pending",
      },
      {
        phase: "overlays",
        label: "Welcome Song",
        status: "pending",
      },
    ]);
    mockExecuteOutlineSyncStep.mockResolvedValue({
      inserted: 1,
      activeLabel: "Welcome Song",
    });
    mockExecuteOverlaySyncStep.mockResolvedValue({
      overlaysUpdated: 1,
      overlaysCloned: 0,
      overlaysCreated: 0,
      overlaysSkipped: 0,
      reasons: [],
    });

    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture as any));

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/controller/service-planning"]}>
          <RunnerHarness />
        </MemoryRouter>
      </Provider>,
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "both" }));
    });

    await waitFor(() => {
      const sync = store.getState().servicePlanningImport.sync;
      expect(sync.totalSteps).toBe(2);
    });
    expect(store.getState().servicePlanningImport.sync.syncItems).toHaveLength(2);

    await waitFor(() => {
      expect(mockExecuteOutlineSyncStep).toHaveBeenCalledTimes(1);
    });
    expect(mockExecuteOverlaySyncStep).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/controller/overlays",
      );
    });

    await waitFor(() => {
      expect(mockExecuteOverlaySyncStep).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(store.getState().servicePlanningImport.sync.status).toBe("completed");
    });

    const state = store.getState().servicePlanningImport;
    expect(state.preview).toEqual(previewFixture);
  });

  it("finalizes a stop request after the active step records its result", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });
    let resolveOutlineStep:
      | ((value: { inserted: number; activeLabel: string }) => void)
      | null = null;

    mockPlanOutlineSyncSteps.mockReturnValue([
      {
        kind: "insertSong",
        headingName: "Welcome",
        candidate: {
          title: "Welcome Song",
          cleanedTitle: "Welcome Song",
        },
      },
    ]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([
      {
        phase: "outline",
        label: "Welcome Song",
        status: "pending",
      },
    ]);
    mockExecuteOutlineSyncStep.mockReturnValue(
      new Promise((resolve) => {
        resolveOutlineStep = resolve;
      }),
    );

    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture as any));

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/controller/service-planning"]}>
          <RunnerHarness />
        </MemoryRouter>
      </Provider>,
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "outline" }));
    });

    await waitFor(() => {
      expect(mockExecuteOutlineSyncStep).toHaveBeenCalledTimes(1);
    });

    act(() => {
      store.dispatch(cancelServicePlanningSync());
    });

    expect(store.getState().servicePlanningImport.sync.status).toBe(
      "cancelling",
    );
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.stringContaining("Sync stopped"),
      "info",
    );

    await act(async () => {
      resolveOutlineStep?.({
        inserted: 1,
        activeLabel: "Welcome Song",
      });
    });

    await waitFor(() => {
      expect(store.getState().servicePlanningImport.sync.status).toBe(
        "cancelled",
      );
    });

    const sync = store.getState().servicePlanningImport.sync;
    expect(sync.outlineInserted).toBe(1);
    expect(sync.currentStep).toBe(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.stringContaining("1 outline item added"),
      "info",
    );
  });
});
