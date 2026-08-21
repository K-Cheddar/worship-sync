import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, waitFor, act } from "@testing-library/react";
import servicePlanningImportReducer, {
  setServicePlanningOutlinePlanBinding,
  setServicePlanningServiceOutline,
} from "../../store/servicePlanningImportSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { useCurrentServicePlanSource } from "./useCurrentServicePlanSource";

const mockOccurrence = {
  occurrenceId: "occurrence-1",
  serviceId: "service-1",
  name: "Sabbath Service",
  startsAt: "2026-08-01T10:00:00.000Z",
};
const mockOtherOccurrence = {
  occurrenceId: "occurrence-2",
  serviceId: "service-2",
  name: "Evening Service",
  startsAt: "2026-08-01T18:00:00.000Z",
};

const mockGetServicePlan = jest.fn();
const mockGetTeamsBootstrap = jest.fn();
const mockListServicePlans = jest.fn();
const mockLoadPlanPreview = jest.fn();
const mockPersistItemListServicePlanBinding = jest.fn();
let mockLiveHandler: ((event: unknown) => void) | null = null;

jest.mock("../../api/auth", () => ({
  getServicePlan: (...args: unknown[]) => mockGetServicePlan(...args),
  getTeamsBootstrap: (...args: unknown[]) => mockGetTeamsBootstrap(...args),
  listServicePlans: (...args: unknown[]) => mockListServicePlans(...args),
}));

jest.mock("../../utils/itemListImports", () => ({
  persistItemListServicePlanBinding: (...args: unknown[]) =>
    mockPersistItemListServicePlanBinding(...args),
}));

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: () => ({
    loadPlanPreview: mockLoadPlanPreview,
    isServicePlanningEnabled: true,
  }),
}));

jest.mock("../Teams/hooks/useTeamsLiveSync", () => ({
  ...jest.requireActual("../Teams/hooks/useTeamsLiveSync"),
  useTeamsLiveSync: (churchId: string | null, onMessage: (e: unknown) => void) => {
    mockLiveHandler = churchId ? onMessage : null;
  },
}));

// Occurrence selection has its own coverage in currentServiceWorkspaceUtils.test.ts
// and useCurrentServiceOccurrence.test.tsx.
jest.mock("./currentServiceWorkspaceUtils", () => ({
  listCurrentServiceOccurrences: () => [mockOccurrence, mockOtherOccurrence],
  pickCurrentServiceOccurrence: () => mockOccurrence,
}));

jest.mock("../Teams/pages/teamsAssignmentsSummary", () => ({
  // The bootstrap fixture below ships fully-hydrated schedules, so on-demand
  // hydration has nothing to fetch — see hydrateOccurrenceSchedules.test.ts.
  getUnhydratedOccurrenceScheduleIds: () => [],
  getOccurrenceAssignmentSummary: () => [
    {
      teamId: "team-1",
      teamName: "Band",
      scheduleId: "schedule-1",
      occurrenceId: "occurrence-1",
      positionId: "position-1",
      positionName: "Keys",
      columnKey: "position-1::0",
      slotLabel: "Keys",
      memberName: "Dana Robinson",
    },
  ],
}));

const planFixture = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-08-01",
  serviceId: "service-1",
  date: "2026-08-01",
  name: "Sabbath Service",
  sections: [],
};

const outlineFixture = {
  source: "servicePlanning" as const,
  loadedAt: "2026-08-01T09:00:00.000Z",
  sourceUrl: "",
  planLabel: "Sabbath Service",
  preview: {
    overlayCandidates: [],
    overlayPlan: [],
    outlineCandidates: [],
    lineItems: [],
    teamAssignments: [],
  },
};

// Stable reference: a fresh object per dispatch would churn every derived memo
// downstream, which is not how the real serviceTimes slice behaves.
const undoableState = {
  present: {
    serviceTimes: { list: [] },
    itemLists: {
      currentLists: [{ _id: "outline-1", name: "Sunday AM" }],
      selectedList: { _id: "outline-1", name: "Sunday AM" },
      activeList: { _id: "outline-1", name: "Sunday AM" },
      isInitialized: true,
    },
    itemList: { isLoading: false, list: [] },
  },
};

const dispatchedTypes: string[] = [];

const makeStore = () =>
  configureStore({
    reducer: {
      servicePlanningImport: servicePlanningImportReducer,
      undoable: () => undoableState,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(
        () => (next: (action: unknown) => unknown) => (action: unknown) => {
          dispatchedTypes.push((action as { type: string }).type);
          return next(action);
        },
      ),
  });

type Result = ReturnType<typeof useCurrentServicePlanSource>;

const Harness = ({ onResult }: { onResult: (result: Result) => void }) => {
  onResult(useCurrentServicePlanSource());
  return null;
};

/** Latest hook result, refreshed on every render of the harness. */
let latestResult: Result | null = null;

const renderHookWith = (
  store: ReturnType<typeof makeStore>,
  globalInfo: Record<string, unknown>,
  controllerInfo: Record<string, unknown> = {},
) => {
  render(
    <Provider store={store}>
      <GlobalInfoContext.Provider value={globalInfo as never}>
        <ControllerInfoContext.Provider value={controllerInfo as never}>
          <Harness
            onResult={(result) => {
              latestResult = result;
            }}
          />
        </ControllerInfoContext.Provider>
      </GlobalInfoContext.Provider>
    </Provider>,
  );
};

const enabledGlobalInfo = {
  churchId: "church-1",
  canViewServices: true,
  canViewTeams: true,
  loginState: "success",
};

describe("useCurrentServicePlanSource", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dispatchedTypes.length = 0;
    latestResult = null;
    mockLiveHandler = null;
    mockGetServicePlan.mockResolvedValue({ servicePlan: planFixture });
    mockListServicePlans.mockResolvedValue({
      servicePlans: [
        {
          planKey: planFixture.planKey,
          serviceId: planFixture.serviceId,
          date: planFixture.date,
          name: planFixture.name,
        },
        {
          planKey: "service-2@2026-08-01",
          serviceId: "service-2",
          date: "2026-08-01",
          name: "Evening Service",
        },
      ],
    });
    mockGetTeamsBootstrap.mockResolvedValue({
      schedules: [],
      positions: [],
      members: [],
      teams: [],
    });
    mockLoadPlanPreview.mockResolvedValue(outlineFixture);
  });

  it("loads the current service's plan and marks the preview plan-sourced", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        "service-1@2026-08-01",
      ),
    );
    expect(mockGetServicePlan).toHaveBeenCalledWith(
      "church-1",
      "service-1@2026-08-01",
    );
    expect(store.getState().servicePlanningImport.preview).toEqual(
      outlineFixture.preview,
    );
  });

  it("prefers the plan linked to the selected outline", async () => {
    mockGetServicePlan.mockResolvedValue({
      servicePlan: {
        ...planFixture,
        planKey: "service-2@2026-08-01",
        serviceId: "service-2",
        name: "Evening Service",
      },
    });
    const store = makeStore();
    store.dispatch(
      setServicePlanningOutlinePlanBinding({
        planKey: "service-2@2026-08-01",
        planName: "Evening Service",
        linkedAt: "2026-07-30T12:00:00.000Z",
      }),
    );

    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() =>
      expect(mockGetServicePlan).toHaveBeenCalledWith(
        "church-1",
        "service-2@2026-08-01",
      ),
    );
    expect(latestResult?.selectedPlanKey).toBe("service-2@2026-08-01");
  });

  it("sources assignments from the Teams schedule rather than the plan", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(mockLoadPlanPreview).toHaveBeenCalledWith(planFixture, [
      { teamName: "Band", role: "Keys", name: "Dana Robinson" },
    ]);
  });

  it("leaves the pasted URL untouched so Import still looks unused", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(store.getState().servicePlanningImport.url).toBe("");
  });

  it("rebuilds when the plan is updated elsewhere, without refetching it", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const editedPlan = { ...planFixture, name: "Sabbath Service (revised)" };
    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        servicePlan: editedPlan,
      });
    });

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      editedPlan,
      expect.anything(),
    );
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
  });

  it("ignores plan updates for a different service", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        servicePlan: { ...planFixture, planKey: "service-9@2026-08-01" },
      });
    });

    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
  });

  it("keeps a pasted URL preview when the target outline binding changes", async () => {
    const store = makeStore();
    const urlOutline = {
      ...outlineFixture,
      sourceUrl: "https://example.com/plan",
      planLabel: "Pasted plan",
    };
    store.dispatch(setServicePlanningServiceOutline(urlOutline));

    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockListServicePlans).toHaveBeenCalled());
    await act(async () => {
      store.dispatch(
        setServicePlanningOutlinePlanBinding({
          planKey: "service-2@2026-08-01",
          planName: "Evening Service",
          linkedAt: "2026-07-30T12:00:00.000Z",
        }),
      );
    });

    expect(mockGetServicePlan).not.toHaveBeenCalled();
    expect(mockLoadPlanPreview).not.toHaveBeenCalled();
    expect(store.getState().servicePlanningImport.serviceOutline).toEqual(
      urlOutline,
    );
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
  });

  it("keeps a pinned plan selected when a new unbound outline loads", async () => {
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        Promise.resolve({
          servicePlan:
            planKey === "service-2@2026-08-01"
              ? {
                  ...planFixture,
                  planKey,
                  serviceId: "service-2",
                  name: "Evening Service",
                }
              : planFixture,
        }),
    );
    const store = makeStore();
    store.dispatch(
      setServicePlanningOutlinePlanBinding({
        planKey: "service-2@2026-08-01",
        planName: "Evening Service",
        linkedAt: "2026-07-30T12:00:00.000Z",
      }),
    );
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe("service-2@2026-08-01"),
    );

    act(() => {
      latestResult?.pinSelectedPlan();
      store.dispatch(setServicePlanningOutlinePlanBinding(null));
    });

    expect(latestResult?.selectedPlanKey).toBe("service-2@2026-08-01");
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
  });

  it("does nothing without Services view access", async () => {
    const store = makeStore();
    renderHookWith(store, { ...enabledGlobalInfo, canViewServices: false });

    await waitFor(() => expect(mockLiveHandler).toBeNull());
    expect(mockGetServicePlan).not.toHaveBeenCalled();
  });

  it("loads Service Plans without Teams-only bootstrap or live sync for a workstation", async () => {
    const store = makeStore();
    renderHookWith(store, { ...enabledGlobalInfo, canViewTeams: false });

    await waitFor(() =>
      expect(mockGetServicePlan).toHaveBeenCalledWith(
        "church-1",
        "service-1@2026-08-01",
      ),
    );

    expect(mockGetTeamsBootstrap).not.toHaveBeenCalled();
    expect(mockLiveHandler).toBeNull();
  });

  it("does nothing for a guest session", async () => {
    const store = makeStore();
    renderHookWith(store, { ...enabledGlobalInfo, loginState: "guest" });

    await waitFor(() => expect(mockLiveHandler).toBeNull());
    expect(mockGetServicePlan).not.toHaveBeenCalled();
  });

  it("stays usable when the Teams bootstrap fails, just without assignments", async () => {
    mockGetTeamsBootstrap.mockRejectedValue(new Error("teams unavailable"));
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(mockLoadPlanPreview).toHaveBeenCalledWith(planFixture, []);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      "service-1@2026-08-01",
    );
  });

  // The whole point of this feature: the plan follows Services automatically,
  // but nothing reaches the live outline or overlays without an operator press.
  it("never writes to the live item list or overlays", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());

    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        servicePlan: { ...planFixture, name: "Revised" },
      });
    });
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));

    const nonPreviewDispatches = dispatchedTypes.filter(
      (type) => !type.startsWith("servicePlanningImport/"),
    );
    expect(nonPreviewDispatches).toEqual([]);
  });

  it("clears the plan preview when switching to a service with no plan", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        "service-1@2026-08-01",
      ),
    );

    // The next service has no plan saved yet.
    mockGetServicePlan.mockResolvedValue({ servicePlan: null });
    await act(async () => {
      latestResult?.selectPlan("service-2@2026-08-01");
    });
    await waitFor(() =>
      expect(mockGetServicePlan).toHaveBeenLastCalledWith(
        "church-1",
        "service-2@2026-08-01",
      ),
    );

    // Showing service 1 plan while the picker says service 2 would let an
    // operator sync overlays/outline for the wrong service.
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull(),
    );
    expect(store.getState().servicePlanningImport.preview).toBeNull();
  });

  it("persists the outline binding immediately when the operator picks a plan, without a Sync", async () => {
    const store = makeStore();
    const db = {};
    renderHookWith(store, enabledGlobalInfo, { db });
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        "service-1@2026-08-01",
      ),
    );
    mockPersistItemListServicePlanBinding.mockResolvedValue(undefined);
    mockGetServicePlan.mockResolvedValue({
      servicePlan: {
        ...planFixture,
        planKey: "service-2@2026-08-01",
        serviceId: "service-2",
        name: "Evening Service",
      },
    });

    await act(async () => {
      latestResult?.selectPlan("service-2@2026-08-01");
    });

    await waitFor(() =>
      expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
        db,
        "outline-1",
        expect.objectContaining({
          planKey: "service-2@2026-08-01",
          planName: "Evening Service",
        }),
      ),
    );
    expect(store.getState().servicePlanningImport.outlinePlanBinding).toEqual(
      expect.objectContaining({ planKey: "service-2@2026-08-01" }),
    );
  });

  it("does not persist a binding for the automatic default selection on load", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo, { db: {} });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        "service-1@2026-08-01",
      ),
    );

    expect(mockPersistItemListServicePlanBinding).not.toHaveBeenCalled();
    expect(
      store.getState().servicePlanningImport.outlinePlanBinding,
    ).toBeNull();
  });

  it("clears a selected plan and preview when Refresh finds it was deleted", async () => {
    mockListServicePlans.mockResolvedValue({
      servicePlans: [
        {
          planKey: planFixture.planKey,
          serviceId: planFixture.serviceId,
          date: planFixture.date,
          name: planFixture.name,
        },
      ],
    });
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );
    mockGetServicePlan.mockResolvedValueOnce({ servicePlan: null });

    await act(async () => {
      await latestResult?.refresh();
    });

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(latestResult?.savedPlans).toEqual([]);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(mockListServicePlans).toHaveBeenCalledTimes(1);
  });

  it("does not silently switch services when a list refresh drops the automatic selection", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );
    mockListServicePlans.mockResolvedValue({
      servicePlans: [
        {
          planKey: "service-2@2026-08-01",
          serviceId: "service-2",
          date: "2026-08-01",
          name: "Evening Service",
        },
      ],
    });

    await act(async () => {
      await latestResult?.refreshPlans();
    });

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
  });

  it("reconciles a pinned selection when a plan-list refresh no longer contains it", async () => {
    const secondPlan = {
      ...planFixture,
      planId: "plan-2",
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      name: "Evening Service",
    };
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        Promise.resolve({
          servicePlan:
            planKey === secondPlan.planKey ? secondPlan : planFixture,
        }),
    );
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );
    act(() => latestResult?.selectPlan(secondPlan.planKey));
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        secondPlan.planKey,
      ),
    );
    mockListServicePlans.mockResolvedValue({
      servicePlans: [
        {
          planKey: planFixture.planKey,
          serviceId: planFixture.serviceId,
          date: planFixture.date,
          name: planFixture.name,
        },
      ],
    });

    await act(async () => {
      await latestResult?.refreshPlans();
    });

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
  });

  it("ignores a slow refresh after the operator selects another plan", async () => {
    const secondPlan = {
      ...planFixture,
      planId: "plan-2",
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      name: "Evening Service",
    };
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );

    let resolveRefresh!: (value: { servicePlan: typeof planFixture }) => void;
    const slowRefresh = new Promise<{ servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        planKey === secondPlan.planKey
          ? Promise.resolve({ servicePlan: secondPlan })
          : slowRefresh,
    );
    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = latestResult?.refresh();
    });
    act(() => latestResult?.selectPlan(secondPlan.planKey));
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        secondPlan.planKey,
      ),
    );

    await act(async () => {
      resolveRefresh({
        servicePlan: { ...planFixture, name: "Stale refreshed plan" },
      });
      await refreshPromise;
    });

    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      secondPlan.planKey,
    );
    expect(latestResult?.selectedPlanKey).toBe(secondPlan.planKey);
  });

  it("switches to another occurrence when the operator overrides it", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalledTimes(1));

    await act(async () => {
      latestResult?.selectPlan("service-2@2026-08-01");
    });

    await waitFor(() =>
      expect(mockGetServicePlan).toHaveBeenLastCalledWith(
        "church-1",
        "service-2@2026-08-01",
      ),
    );
  });
});
