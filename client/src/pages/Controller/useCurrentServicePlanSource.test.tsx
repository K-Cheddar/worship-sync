import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, waitFor, act } from "@testing-library/react";
import servicePlanningImportReducer, {
  markServicePlanningUrlSelection,
  setServicePlanningOutlinePlanBinding,
  setServicePlanningServiceOutline,
  setStoredServicePlanningOutlineIfIdle,
} from "../../store/servicePlanningImportSlice";
import itemListsReducer, { initiateItemLists } from "../../store/itemListsSlice";
import controllerProfilesReducer, {
  setControllerProfilesFromRemote,
} from "../../store/controllerProfilesSlice";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ControllerInfoContext } from "../../context/controllerInfo";
import ActiveControllerContext from "../../context/activeController";
import { ActiveControllerProvider } from "../../context/activeController";
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
const mockGetServicePlanAssignments = jest.fn();
const mockGetServicePlanViewer = jest.fn();
const mockListServicePlans = jest.fn();
const mockLoadPlanPreview = jest.fn();
const mockPersistItemListServicePlanBinding = jest.fn();
let mockLiveHandler: ((event: unknown) => void) | null = null;
let mockServicePlanningEnabled = true;

jest.mock("../../api/auth", () => ({
  getServicePlan: (...args: unknown[]) => mockGetServicePlan(...args),
  getServicePlanAssignments: (...args: unknown[]) =>
    mockGetServicePlanAssignments(...args),
  getServicePlanViewer: (...args: unknown[]) => mockGetServicePlanViewer(...args),
  listServicePlans: (...args: unknown[]) => mockListServicePlans(...args),
}));

jest.mock("../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({
    status: "ready",
    timeZone: "UTC",
    isConfigured: true,
    legacyTimeZoneSuggestion: null,
    refresh: jest.fn(),
  }),
}));

jest.mock("../../utils/itemListImports", () => ({
  persistItemListServicePlanBinding: (...args: unknown[]) =>
    mockPersistItemListServicePlanBinding(...args),
}));

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: () => ({
    loadPlanPreview: mockLoadPlanPreview,
    isServicePlanningEnabled: mockServicePlanningEnabled,
  }),
}));

jest.mock("../Teams/hooks/useTeamsLiveSync", () => ({
  ...jest.requireActual("../Teams/hooks/useTeamsLiveSync"),
  useTeamsLiveSync: (churchId: string | null, onMessage: (e: unknown) => void, enabled: boolean) => {
    mockLiveHandler = churchId && enabled ? onMessage : null;
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
  revision: 1,
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

const AUX_CONTROLLER_ID = "ctrl_lobby";
const PRESENTATION_CONTROLLER_ID = "presentation";

type ControllerAwareUndoableState = {
  present: Omit<typeof undoableState.present, "itemLists"> & {
    itemLists: ReturnType<typeof itemListsReducer>;
  };
};

const makeControllerAwareStore = () => {
  const store = configureStore({
    reducer: {
      servicePlanningImport: servicePlanningImportReducer,
      controllerProfiles: controllerProfilesReducer,
      undoable: (
        state: ControllerAwareUndoableState = {
          present: {
            ...undoableState.present,
            itemLists: itemListsReducer(undefined, { type: "@@init" }),
          },
        },
        action: Parameters<typeof itemListsReducer>[1],
      ): ControllerAwareUndoableState => ({
        present: {
          ...state.present,
          itemLists: itemListsReducer(state.present.itemLists, action),
        },
      }),
    },
  });
  store.dispatch(
    setControllerProfilesFromRemote([
      {
        id: AUX_CONTROLLER_ID,
        type: "aux-presentation",
        name: "Lobby",
        description: "",
        order: 2,
        enabled: true,
        outputIds: [],
        outputsConfigured: true,
        defaultSendOutputIds: [],
        outlineScope: AUX_CONTROLLER_ID,
      },
    ]),
  );
  store.dispatch(
    initiateItemLists([
      { _id: "presentation-outline", name: "Sunday AM" },
      {
        _id: "aux-outline",
        name: "Lobby",
        controllerScope: AUX_CONTROLLER_ID,
      },
    ]),
  );
  return store;
};

type Result = ReturnType<typeof useCurrentServicePlanSource>;

const Harness = ({ onResult }: { onResult: (result: Result) => void }) => {
  onResult(useCurrentServicePlanSource());
  return null;
};

const ControllerScopedHook = ({
  profileId,
  globalInfo,
  controllerInfo,
  onResult,
}: {
  profileId: string;
  globalInfo: Record<string, unknown>;
  controllerInfo: Record<string, unknown>;
  onResult: (result: Result) => void;
}) => (
  <ActiveControllerProvider profileId={profileId}>
    <GlobalInfoContext.Provider value={globalInfo as never}>
      <ControllerInfoContext.Provider value={controllerInfo as never}>
        <Harness onResult={onResult} />
      </ControllerInfoContext.Provider>
    </GlobalInfoContext.Provider>
  </ActiveControllerProvider>
);

/** Latest hook result, refreshed on every render of the harness. */
let latestResult: Result | null = null;

const renderHookWith = (
  store: ReturnType<typeof makeStore>,
  globalInfo: Record<string, unknown>,
  controllerInfo: Record<string, unknown> = {},
  activeControllerId = "presentation",
) => {
  return render(
    <Provider store={store}>
      <ActiveControllerContext.Provider value={activeControllerId}>
        <GlobalInfoContext.Provider value={globalInfo as never}>
          <ControllerInfoContext.Provider value={controllerInfo as never}>
            <Harness
              onResult={(result) => {
                latestResult = result;
              }}
            />
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </ActiveControllerContext.Provider>
    </Provider>,
  );
};

const enabledGlobalInfo = {
  churchId: "church-1",
  canViewServices: true,
  canViewTeams: true,
  canUseTeamsLiveSync: true,
  loginState: "success",
};

const setVisibility = (visibility: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("useCurrentServicePlanSource", () => {
  beforeEach(() => {
    mockServicePlanningEnabled = true;
    jest.clearAllMocks();
    dispatchedTypes.length = 0;
    latestResult = null;
    mockLiveHandler = null;
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: planFixture });
    mockListServicePlans.mockResolvedValue({
      success: true,
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
    mockGetServicePlanAssignments.mockResolvedValue({
      success: true,
      assignments: [{ teamName: "Band", role: "Keys", name: "Dana Robinson" }],
      participantOverlay: { status: "ready", elements: [] },
    });
    mockGetServicePlanViewer.mockResolvedValue({
      success: true,
      plan: planFixture,
      snapshot: null,
    });
    mockLoadPlanPreview.mockResolvedValue(outlineFixture);
  });

  it("loads native saved plans when the external Service Planning integration is disabled", async () => {
    mockServicePlanningEnabled = false;
    mockListServicePlans.mockResolvedValue({ success: true, servicePlans: [planFixture] });
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: planFixture });
    mockGetServicePlanAssignments.mockResolvedValue({ success: true, assignments: [] });
    mockLoadPlanPreview.mockResolvedValue({ source: "servicePlanning", sections: [] });

    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(latestResult?.selectedPlanDetails?.planKey).toBe(planFixture.planKey));
    expect(mockListServicePlans).toHaveBeenCalledWith("church-1");
  });

  it("does not publish a plan preview after the hook unmounts", async () => {
    let resolvePreview!: (outline: typeof outlineFixture) => void;
    const pendingPreview = new Promise<typeof outlineFixture>((resolve) => {
      resolvePreview = resolve;
    });
    mockLoadPlanPreview.mockReturnValue(pendingPreview);

    const store = makeStore();
    const view = renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      resolvePreview(outlineFixture);
      await pendingPreview;
    });

    expect(store.getState().servicePlanningImport.serviceOutline).toBeNull();
    expect(
      dispatchedTypes.some((type) => type.endsWith("/setServicePlanningPlanOutline")),
    ).toBe(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it("prefers the current occurrence over an old outline binding", async () => {
    mockGetServicePlan.mockResolvedValue({
      success: true,
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
        "service-1@2026-08-01",
      ),
    );
    expect(latestResult?.selectedPlanKey).toBe("service-1@2026-08-01");
  });

  it("leaves the selection empty when the current occurrence has no plan", async () => {
    mockListServicePlans.mockResolvedValueOnce({
      success: true,
      servicePlans: [
        {
          planKey: "service-2@2026-08-01",
          serviceId: "service-2",
          date: "2026-08-01",
          name: "Evening Service",
        },
      ],
    });
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(mockGetServicePlan).not.toHaveBeenCalled();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
  });

  it("persists a manually selected plan before its detail request finishes", async () => {
    const store = makeStore();
    const db = {};
    renderHookWith(store, enabledGlobalInfo, { db });

    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe("service-1@2026-08-01"),
    );
    mockGetServicePlan.mockImplementation(
      () => new Promise(() => undefined),
    );

    act(() => {
      latestResult?.selectPlan("service-2@2026-08-01");
    });

    await waitFor(() => expect(latestResult?.isLoading).toBe(true));
    expect(store.getState().servicePlanningImport.preview).toBeNull();

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
  });

  it("does not publish a late binding after the selected outline changes", async () => {
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        Promise.resolve({
          success: true,
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
    const resolveBindings: Array<() => void> = [];
    mockPersistItemListServicePlanBinding.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveBindings.push(resolve);
      }),
    );
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: (
          state: typeof undoableState = undoableState,
          action: { type?: string },
        ): typeof undoableState =>
          action.type === "SWITCH_OUTLINE"
            ? {
              ...state,
              present: {
                ...state.present,
                itemLists: {
                  ...state.present.itemLists,
                  selectedList: { _id: "outline-2", name: "Evening" },
                },
              },
            }
            : state,
      },
    });
    renderHookWith(store, enabledGlobalInfo, { db: {} });

    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );
    act(() => {
      latestResult?.selectPlan("service-2@2026-08-01");
    });
    await waitFor(() =>
      expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
        {},
        "outline-1",
        expect.objectContaining({ planKey: "service-2@2026-08-01" }),
      ),
    );

    act(() => {
      store.dispatch({ type: "SWITCH_OUTLINE" });
    });
    await waitFor(() =>
      expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
        "outline-2",
      ),
    );
    await act(async () => {
      resolveBindings.forEach((resolve) => resolve());
    });

    expect(store.getState().servicePlanningImport.outlinePlanBinding).toBeNull();
  });

  it("does not carry late plan detail or binding results across controllers", async () => {
    const store = makeControllerAwareStore();
    let resolveOldPlan:
      | ((value: { success: true, servicePlan: typeof planFixture }) => void)
      | undefined;
    let resolveOldBinding: (() => void) | undefined;
    const oldControllerPlan = {
      ...planFixture,
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      name: "Evening Service",
    };
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) => {
        if (planKey === oldControllerPlan.planKey) {
          return new Promise<{ success: true, servicePlan: typeof oldControllerPlan }>((resolve) => {
            resolveOldPlan = resolve;
          });
        }
        return Promise.resolve({ success: true, servicePlan: planFixture });
      },
    );
    mockPersistItemListServicePlanBinding.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOldBinding = resolve;
      }),
    );

    const view = render(
      <Provider store={store}>
        <ControllerScopedHook
          profileId={AUX_CONTROLLER_ID}
          globalInfo={enabledGlobalInfo}
          controllerInfo={{ db: {} }}
          onResult={(result) => {
            latestResult = result;
          }}
        />
      </Provider>,
    );

    await waitFor(() =>
      expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
        "aux-outline",
      ),
    );
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );

    act(() => {
      latestResult?.selectPlan(oldControllerPlan.planKey);
    });
    await waitFor(() =>
      expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
        {},
        "aux-outline",
        expect.objectContaining({ planKey: oldControllerPlan.planKey }),
      ),
    );

    view.rerender(
      <Provider store={store}>
        <ControllerScopedHook
          profileId={PRESENTATION_CONTROLLER_ID}
          globalInfo={enabledGlobalInfo}
          controllerInfo={{ db: {} }}
          onResult={(result) => {
            latestResult = result;
          }}
        />
      </Provider>,
    );

    await waitFor(() =>
      expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
        "presentation-outline",
      ),
    );
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );
    await waitFor(() =>
      expect(mockLoadPlanPreview).toHaveBeenCalledWith(
        planFixture,
        expect.anything(),
        expect.objectContaining({ status: "ready" }),
      ),
    );

    await act(async () => {
      resolveOldPlan?.({ success: true, servicePlan: oldControllerPlan });
      resolveOldBinding?.();
    });

    const loadedPlanKeys = mockLoadPlanPreview.mock.calls.map(
      ([plan]) => (plan as { planKey: string }).planKey,
    );
    expect(loadedPlanKeys).not.toContain(oldControllerPlan.planKey);
    expect(
      store.getState().servicePlanningImport.outlinePlanBinding,
    ).toBeNull();
    expect(dispatchedTypes).not.toContain(
      setServicePlanningOutlinePlanBinding.type,
    );
  });

  it("loads the selected plan's scoped assignments", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(mockLoadPlanPreview).toHaveBeenCalledWith(planFixture, [
      { teamName: "Band", role: "Keys", name: "Dana Robinson" },
    ], { status: "ready", elements: [] });
  });

  it("blocks a participant projection read from a different saved-plan revision", async () => {
    const newerPlan = { ...planFixture, revision: 2 };
    const staleProjection = {
      status: "ready" as const,
      planRevision: 1,
      elements: [{
        elementId: "element-1",
        assignees: [{
          name: "Stale Person",
          memberStatus: "resolved" as const,
          roleStatus: "resolved" as const,
          roleTitle: "Stale Role",
        }],
      }],
    };
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: newerPlan });
    mockGetServicePlanAssignments.mockResolvedValue({
      success: true,
      assignments: [],
      participantOverlay: staleProjection,
    });

    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(mockLoadPlanPreview).toHaveBeenCalledWith(
      newerPlan,
      [],
      { status: "failed", elements: [] },
    );
  });

  it("reloads the selected plan when schedule data carries a newer plan revision", async () => {
    const newerPlan = { ...planFixture, revision: 2, name: "Revised service" };
    const currentProjection = {
      status: "ready" as const,
      planRevision: 2,
      elements: [{
        elementId: "element-1",
        assignees: [{
          name: "Current Person",
          memberStatus: "resolved" as const,
          roleStatus: "resolved" as const,
          roleTitle: "Current Role",
        }],
      }],
    };
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: newerPlan });
    mockGetServicePlanAssignments
      .mockResolvedValueOnce({ success: true, assignments: [], participantOverlay: currentProjection })
      .mockResolvedValueOnce({ success: true, assignments: [], participantOverlay: currentProjection });

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      newerPlan,
      [],
      currentProjection,
    );
  });

  it("keeps a mismatched preview non-syncable when the follow-up plan read fails", async () => {
    const staleOutline = {
      ...outlineFixture,
      preview: {
        ...outlineFixture.preview,
        overlayPlan: [{
          sectionName: "Worship",
          sourceRowIndex: 0,
          elementType: "free",
          title: "Sermon",
          ledBy: "Stale Person",
          personIndex: 0,
          rawNameToken: "Stale Person",
          action: "update" as const,
          targetOverlayId: "weekly-host",
          patch: { name: "Stale Person", title: "Stale Role", event: "Sermon" },
        }],
        nativeOverlaySummary: {
          status: "ready" as const,
          selectedItemCount: 1,
          assignedParticipantCount: 1,
        },
      },
    };
    mockLoadPlanPreview.mockResolvedValue(staleOutline);

    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    mockGetServicePlanAssignments.mockResolvedValueOnce({
      success: true,
      assignments: [],
      participantOverlay: {
        status: "ready",
        planRevision: 2,
        elements: [],
      },
    });
    mockGetServicePlan.mockRejectedValueOnce(new Error("plan refresh failed"));
    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });

    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latestResult?.isLoading).toBe(false));
    const preview = store.getState().servicePlanningImport.preview;
    expect(preview?.nativeOverlaySummary).toMatchObject({
      status: "failed",
      assignedParticipantCount: null,
    });
    expect(preview?.overlayPlan[0]).toMatchObject({
      action: "skip",
      patch: { name: "", title: "", event: "Sermon" },
      reason: expect.stringMatching(/refresh the plan before syncing/i),
    });
  });

  it("does not publish a late participant projection after switching plans", async () => {
    const secondPlan = {
      ...planFixture,
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      name: "Evening Service",
    };
    const staleProjection = {
      status: "ready" as const,
      elements: [{
        elementId: "element-1",
        assignees: [{
          name: "Stale Person",
          memberStatus: "resolved" as const,
          roleStatus: "resolved" as const,
          roleTitle: "Stale Role",
        }],
      }],
    };
    const freshProjection = {
      status: "ready" as const,
      elements: [{
        elementId: "element-1",
        assignees: [{
          name: "Fresh Person",
          memberStatus: "resolved" as const,
          roleStatus: "resolved" as const,
          roleTitle: "Fresh Role",
        }],
      }],
    };
    let resolveStaleAssignments!: (value: {
      success: true,
      assignments: [];
      participantOverlay: typeof staleProjection;
    }) => void;
    const staleAssignments = new Promise<{
      success: true,
      assignments: [];
      participantOverlay: typeof staleProjection;
    }>((resolve) => {
      resolveStaleAssignments = resolve;
    });
    mockGetServicePlan.mockImplementation((_churchId: string, planKey: string) =>
      Promise.resolve({ success: true, servicePlan: planKey === secondPlan.planKey ? secondPlan : planFixture }),
    );
    mockGetServicePlanAssignments
      .mockResolvedValueOnce({
        success: true,
        assignments: [],
        participantOverlay: { status: "ready", elements: [] },
      })
      .mockReturnValueOnce(staleAssignments)
      .mockResolvedValue({ success: true, assignments: [], participantOverlay: freshProjection });
    mockLoadPlanPreview.mockImplementation(async (plan, assignments, participantOverlay) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${participantOverlay.elements[0]?.assignees[0]?.name || "empty"}`,
    }));

    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2));

    act(() => {
      latestResult?.selectPlan(secondPlan.planKey);
    });
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(secondPlan.planKey),
    );
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Evening Service:Fresh Person",
      ),
    );

    await act(async () => {
      resolveStaleAssignments({ success: true, assignments: [], participantOverlay: staleProjection });
      await staleAssignments;
    });
    expect(mockLoadPlanPreview).not.toHaveBeenCalledWith(planFixture, [], staleProjection);

    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(secondPlan.planKey);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Evening Service:Fresh Person",
    );
  });

  it("does not publish participant data from the previous church when a plan key repeats", async () => {
    const oldProjection = {
      status: "ready" as const,
      elements: [{ elementId: "element-1", assignees: [{
        name: "Church One Person",
        memberStatus: "resolved" as const,
        roleStatus: "resolved" as const,
        roleTitle: "Church One Role",
      }] }],
    };
    const newProjection = {
      status: "ready" as const,
      elements: [{ elementId: "element-1", assignees: [{
        name: "Church Two Person",
        memberStatus: "resolved" as const,
        roleStatus: "resolved" as const,
        roleTitle: "Church Two Role",
      }] }],
    };
    let resolveOldAssignments!: (value: {
      success: true,
      assignments: [];
      participantOverlay: typeof oldProjection;
    }) => void;
    const oldAssignments = new Promise<{
      success: true,
      assignments: [];
      participantOverlay: typeof oldProjection;
    }>((resolve) => {
      resolveOldAssignments = resolve;
    });
    mockGetServicePlan.mockImplementation((churchId: string) =>
      Promise.resolve({
        success: true,
        servicePlan: {
          ...planFixture,
          churchId,
          name: churchId === "church-2" ? "Church Two Service" : "Church One Service",
        },
      }),
    );
    mockGetServicePlanAssignments
      .mockResolvedValueOnce({ success: true, assignments: [], participantOverlay: { status: "ready", elements: [] } })
      .mockReturnValueOnce(oldAssignments)
      .mockResolvedValue({ success: true, assignments: [], participantOverlay: newProjection });
    mockLoadPlanPreview.mockImplementation(async (plan, _assignments, projection) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${projection.elements[0]?.assignees[0]?.name || "empty"}`,
    }));

    const store = makeStore();
    const view = renderHookWith(store, enabledGlobalInfo);
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Church One Service:empty",
      ),
    );
    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2));

    view.rerender(
      <Provider store={store}>
        <ActiveControllerContext.Provider value="presentation">
          <GlobalInfoContext.Provider value={{ ...enabledGlobalInfo, churchId: "church-2" } as never}>
            <ControllerInfoContext.Provider value={{} as never}>
              <Harness onResult={(result) => { latestResult = result; }} />
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </ActiveControllerContext.Provider>
      </Provider>,
    );
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Church Two Service:Church Two Person",
      ),
    );
    expect(mockGetServicePlanAssignments).toHaveBeenLastCalledWith(
      "church-2",
      planFixture.planKey,
    );

    await act(async () => {
      resolveOldAssignments({ success: true, assignments: [], participantOverlay: oldProjection });
      await oldAssignments;
    });
    expect(mockLoadPlanPreview).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "Church One Service" }),
      [],
      oldProjection,
    );
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Church Two Service:Church Two Person",
    );
  });

  it("does not publish participant data from the previous outline", async () => {
    const staleProjection = {
      status: "ready" as const,
      elements: [{ elementId: "element-1", assignees: [{
        name: "Old outline person",
        memberStatus: "resolved" as const,
        roleStatus: "resolved" as const,
        roleTitle: "Old outline role",
      }] }],
    };
    const freshProjection = {
      status: "ready" as const,
      elements: [{ elementId: "element-1", assignees: [{
        name: "New outline person",
        memberStatus: "resolved" as const,
        roleStatus: "resolved" as const,
        roleTitle: "New outline role",
      }] }],
    };
    let resolveStaleAssignments!: (value: {
      success: true,
      assignments: [];
      participantOverlay: typeof staleProjection;
    }) => void;
    const staleAssignments = new Promise<{
      success: true,
      assignments: [];
      participantOverlay: typeof staleProjection;
    }>((resolve) => {
      resolveStaleAssignments = resolve;
    });
    mockGetServicePlanAssignments
      .mockResolvedValueOnce({ success: true, assignments: [], participantOverlay: { status: "ready", elements: [] } })
      .mockReturnValueOnce(staleAssignments)
      .mockResolvedValue({ success: true, assignments: [], participantOverlay: freshProjection });
    mockLoadPlanPreview.mockImplementation(async (plan, _assignments, projection) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${projection.elements[0]?.assignees[0]?.name || "empty"}`,
    }));
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: (
          state: typeof undoableState = undoableState,
          action: { type?: string },
        ): typeof undoableState =>
          action.type === "SWITCH_OUTLINE"
            ? {
                ...state,
                present: {
                  ...state.present,
                  itemLists: {
                    ...state.present.itemLists,
                    selectedList: { _id: "outline-2", name: "Evening" },
                  },
                },
              }
            : state,
      },
    });
    renderHookWith(store, enabledGlobalInfo, { db: {} });
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2));
    act(() => {
      store.dispatch({ type: "SWITCH_OUTLINE" });
    });
    await waitFor(() =>
      expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe("outline-2"),
    );
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Sabbath Service:New outline person",
      ),
    );

    await act(async () => {
      resolveStaleAssignments({ success: true, assignments: [], participantOverlay: staleProjection });
      await staleAssignments;
    });
    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2);
    expect(mockLoadPlanPreview).not.toHaveBeenCalledWith(planFixture, [], staleProjection);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Sabbath Service:New outline person",
    );
  });

  it("leaves the pasted URL untouched so Import still looks unused", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalled());
    expect(store.getState().servicePlanningImport.url).toBe("");
  });

  it("refetches a plan after its ID-only live change notification", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const editedPlan = { ...planFixture, name: "Sabbath Service (revised)" };
    let resolveRefresh!: (value: { success: true, servicePlan: typeof planFixture }) => void;
    const pendingRefresh = new Promise<{ success: true, servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    mockGetServicePlan.mockReturnValue(pendingRefresh);
    act(() => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: editedPlan.planKey,
      });
    });

    await waitFor(() => expect(latestResult?.isRefreshing).toBe(true));
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.selectedPlanDetails).toEqual(planFixture);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      planFixture.planKey,
    );

    await act(async () => {
      resolveRefresh({ success: true, servicePlan: editedPlan });
      await pendingRefresh;
    });
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latestResult?.isRefreshing).toBe(false));
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      editedPlan,
      expect.anything(),
      expect.objectContaining({ status: "ready" }),
    );
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
  });

  it("keeps the initial detail load current when a schedule update arrives before the plan is loaded", async () => {
    const latestPlan = {
      ...planFixture,
      revision: 2,
      name: "Latest initial plan",
    };
    const initialPlanRequest = createDeferred<{
      success: true,
      servicePlan: typeof planFixture;
    }>();
    const initialAssignmentsRequest = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const latestAssignmentsRequest = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    mockGetServicePlan.mockReturnValueOnce(initialPlanRequest.promise);
    mockGetServicePlanAssignments
      .mockReturnValueOnce(initialAssignmentsRequest.promise)
      .mockReturnValueOnce(latestAssignmentsRequest.promise);
    mockLoadPlanPreview.mockImplementation(async (
      plan: { name: string },
      assignments: Array<{ name: string }>,
    ) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${assignments.map((assignment) => assignment.name).join(",")}`,
    }));

    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalledTimes(1));
    expect(latestResult?.isLoading).toBe(true);

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(latestResult?.isLoading).toBe(true);
    expect(latestResult?.isRefreshingParticipants).toBe(true);

    await act(async () => {
      initialPlanRequest.resolve({ success: true, servicePlan: latestPlan });
      initialAssignmentsRequest.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Pre-event musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await Promise.all([
        initialPlanRequest.promise,
        initialAssignmentsRequest.promise,
      ]);
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2));
    expect(latestResult?.isRefreshing).toBe(false);
    expect(latestResult?.isRefreshingParticipants).toBe(true);

    await act(async () => {
      latestAssignmentsRequest.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Latest musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await latestAssignmentsRequest.promise;
    });

    expect(latestResult?.selectedPlanDetails).toEqual(latestPlan);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Latest initial plan:Latest musician",
    );
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.isRefreshing).toBe(false);
    expect(latestResult?.isRefreshingParticipants).toBe(false);
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
  });

  it("refreshes participants without duplicating plan-detail requests when schedule changes during a plan refresh", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const latestPlan = {
      ...planFixture,
      revision: 3,
      name: "Latest plan response",
    };
    const planRefreshRequest = createDeferred<{
      success: true,
      servicePlan: typeof planFixture;
    }>();
    const planRefreshAssignmentsRequest = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const latestAssignmentsRequest = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    mockGetServicePlan.mockReturnValueOnce(planRefreshRequest.promise);
    mockGetServicePlanAssignments
      .mockReturnValueOnce(planRefreshAssignmentsRequest.promise)
      .mockReturnValueOnce(latestAssignmentsRequest.promise);
    mockListServicePlans.mockResolvedValueOnce({
      success: true,
      servicePlans: [{
        planKey: planFixture.planKey,
        serviceId: planFixture.serviceId,
        date: planFixture.date,
        name: latestPlan.name,
      }],
    });
    mockLoadPlanPreview.mockImplementation(async (
      plan: { name: string },
      assignments: Array<{ name: string }>,
    ) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${assignments.map((assignment) => assignment.name).join(",")}`,
    }));

    act(() => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: planFixture.planKey,
      });
    });
    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latestResult?.isRefreshing).toBe(true));

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(latestResult?.isRefreshingParticipants).toBe(true);
    expect(latestResult?.selectedPlanDetails).toEqual(planFixture);

    await act(async () => {
      planRefreshRequest.resolve({ success: true, servicePlan: latestPlan });
      planRefreshAssignmentsRequest.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Pre-event musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await Promise.all([
        planRefreshRequest.promise,
        planRefreshAssignmentsRequest.promise,
      ]);
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(3));
    expect(latestResult?.selectedPlanDetails).toEqual(latestPlan);
    expect(latestResult?.isRefreshing).toBe(false);
    expect(latestResult?.isRefreshingParticipants).toBe(true);

    await act(async () => {
      latestAssignmentsRequest.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Latest musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await latestAssignmentsRequest.promise;
    });
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Latest plan response:Latest musician",
      ),
    );

    expect(latestResult?.selectedPlanDetails).toEqual(latestPlan);
    expect(latestResult?.selectedPlan?.name).toBe(latestPlan.name);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Latest plan response:Latest musician",
    );
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.isRefreshing).toBe(false);
    expect(latestResult?.isRefreshingParticipants).toBe(false);
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
  });

  it("coalesces rapid schedule events and applies only the final participant snapshot", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const firstAssignments = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const latestAssignments = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    mockGetServicePlanAssignments
      .mockReturnValueOnce(firstAssignments.promise)
      .mockReturnValueOnce(latestAssignments.promise);
    mockLoadPlanPreview.mockImplementation(async (
      plan: { name: string },
      assignments: Array<{ name: string }>,
    ) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${assignments.map((assignment) => assignment.name).join(",")}`,
    }));

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(latestResult?.isRefreshingParticipants).toBe(true);

    await act(async () => {
      firstAssignments.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Superseded musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await firstAssignments.promise;
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(3));
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).not.toContain("Superseded musician");

    await act(async () => {
      latestAssignments.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Latest musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await latestAssignments.promise;
    });
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Sabbath Service:Latest musician",
      ),
    );
    expect(latestResult?.isRefreshingParticipants).toBe(false);
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
  });

  it("keeps participant data unsafe after a failed schedule refresh and allows a later recovery", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    const visiblePreview = store.getState().servicePlanningImport.preview;
    const reportError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLoadPlanPreview.mockImplementation(async (
      _plan,
      assignments: Array<{ name: string }>,
    ) => ({
      ...outlineFixture,
      planLabel: assignments.map((assignment) => assignment.name).join(","),
    }));
    mockGetServicePlanAssignments
      .mockRejectedValueOnce(new Error("participants unavailable"))
      .mockResolvedValueOnce({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Recovered musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });

    act(() => mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" }));
    await waitFor(() => expect(latestResult?.isRefreshingParticipants).toBe(false));
    expect(latestResult?.isParticipantOverlayUnsafe).toBe(true);
    expect(latestResult?.selectedPlanDetails).toEqual(planFixture);
    expect(store.getState().servicePlanningImport.preview).toBe(visiblePreview);

    act(() => mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" }));
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
        "Recovered musician",
      ),
    );
    expect(latestResult?.isParticipantOverlayUnsafe).toBe(false);
    expect(latestResult?.isRefreshingParticipants).toBe(false);
    reportError.mockRestore();
  });

  it("ignores an in-flight participant response after switching plans", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    const staleAssignments = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const nextPlan = {
      ...planFixture,
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      date: "2026-08-01",
      name: "Evening plan",
    };
    mockGetServicePlanAssignments.mockReturnValueOnce(staleAssignments.promise);
    mockGetServicePlan.mockResolvedValueOnce({ success: true, servicePlan: nextPlan });

    act(() => mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" }));
    await waitFor(() => expect(latestResult?.isRefreshingParticipants).toBe(true));
    act(() => latestResult?.selectPlan(nextPlan.planKey));
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(nextPlan.planKey));
    await waitFor(() => expect(latestResult?.selectedPlanDetails).toEqual(nextPlan));
    expect(latestResult?.isRefreshingParticipants).toBe(false);

    await act(async () => {
      staleAssignments.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Wrong old-plan musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await staleAssignments.promise;
    });
    expect(latestResult?.selectedPlanKey).toBe(nextPlan.planKey);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).not.toContain(
      "Wrong old-plan musician",
    );
  });

  it("does not publish a participant refresh after the hook unmounts", async () => {
    const pendingAssignments = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const store = makeStore();
    const view = renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    mockGetServicePlanAssignments.mockReturnValueOnce(pendingAssignments.promise);
    act(() => mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" }));
    await waitFor(() => expect(latestResult?.isRefreshingParticipants).toBe(true));
    const outlineActionCount = dispatchedTypes.filter((type) => type.endsWith("/setServicePlanningPlanOutline")).length;

    view.unmount();
    await act(async () => {
      pendingAssignments.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Unmounted musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await pendingAssignments.promise;
    });

    expect(dispatchedTypes.filter((type) => type.endsWith("/setServicePlanningPlanOutline"))).toHaveLength(outlineActionCount);
  });

  it("ignores an older schedule response when a plan update fails, then recovers on refresh", async () => {
    const reportError = jest.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const originalPreview = store.getState().servicePlanningImport.preview;
    const recoveredPlan = {
      ...planFixture,
      revision: 3,
      name: "Recovered plan",
    };
    const delayedScheduleAssignments = createDeferred<{
      success: true;
      assignments: Array<{ teamName: string; role: string; name: string }>;
      participantOverlay: { status: "ready"; elements: [] };
    }>();
    const failedPlanRequest = createDeferred<{
      success: true,
      servicePlan: typeof planFixture;
    }>();
    mockGetServicePlanAssignments
      .mockReturnValueOnce(delayedScheduleAssignments.promise)
      .mockResolvedValueOnce({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Failed refresh data" }],
        participantOverlay: { status: "ready", elements: [] },
      })
      .mockResolvedValueOnce({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Recovered musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
    mockGetServicePlan
      .mockReturnValueOnce(failedPlanRequest.promise)
      .mockResolvedValueOnce({ success: true, servicePlan: recoveredPlan });
    mockLoadPlanPreview.mockImplementation(async (
      plan: { name: string },
      assignments: Array<{ name: string }>,
    ) => ({
      ...outlineFixture,
      planLabel: `${plan.name}:${assignments.map((assignment) => assignment.name).join(",")}`,
    }));

    act(() => {
      mockLiveHandler?.({ type: "schedule-updated", scheduleId: "schedule-1" });
    });
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2));

    act(() => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: planFixture.planKey,
      });
    });
    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latestResult?.isRefreshing).toBe(true));

    await act(async () => {
      failedPlanRequest.reject(new Error("plan refresh failed"));
      await failedPlanRequest.promise.catch(() => undefined);
    });
    await waitFor(() => expect(latestResult?.isRefreshing).toBe(false));
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.selectedPlanDetails).toEqual(planFixture);
    expect(store.getState().servicePlanningImport.preview).toBe(originalPreview);

    await act(async () => {
      delayedScheduleAssignments.resolve({
        success: true,
        assignments: [{ teamName: "Band", role: "Keys", name: "Stale schedule musician" }],
        participantOverlay: { status: "ready", elements: [] },
      });
      await delayedScheduleAssignments.promise;
    });
    expect(store.getState().servicePlanningImport.preview).toBe(originalPreview);

    await act(async () => {
      await latestResult?.refresh();
    });
    expect(latestResult?.selectedPlanDetails).toEqual(recoveredPlan);
    expect(store.getState().servicePlanningImport.serviceOutline?.planLabel).toBe(
      "Recovered plan:Recovered musician",
    );
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.isRefreshing).toBe(false);
    reportError.mockRestore();
  });

  it("keeps the loaded plan usable when a manual refresh request fails", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    const originalPreview = store.getState().servicePlanningImport.preview;
    const reportError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockGetServicePlan.mockRejectedValueOnce(new Error("network unavailable"));

    await act(async () => {
      await latestResult?.refresh();
    });

    expect(latestResult?.selectedPlanDetails).toEqual(planFixture);
    expect(latestResult?.isLoading).toBe(false);
    expect(latestResult?.isRefreshing).toBe(false);
    expect(store.getState().servicePlanningImport.preview).toBe(originalPreview);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      planFixture.planKey,
    );
    reportError.mockRestore();
  });

  it("loads newly created plans into the saved plans list from an unrelated update", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const newPlan = {
      planKey: "service-3@2026-08-08",
      serviceId: "service-3",
      date: "2026-08-08",
      name: "New Evening Service",
    };
    mockListServicePlans.mockResolvedValue({
      success: true,
      servicePlans: [newPlan],
    });
    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: newPlan.planKey,
      });
    });

    await waitFor(() => expect(latestResult?.savedPlans).toContainEqual(newPlan));
    expect(latestResult?.savedPlans).toContainEqual({
      planKey: planFixture.planKey,
      serviceId: planFixture.serviceId,
      date: planFixture.date,
      name: planFixture.name,
    });
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      planFixture.planKey,
    );
  });

  it("refreshes an unselected plan summary without interrupting the selected preview", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const updatedPlan = {
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      date: "2026-08-01",
      name: "Evening Service (revised)",
    };
    mockListServicePlans.mockResolvedValue({
      success: true,
      servicePlans: [updatedPlan],
    });
    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: updatedPlan.planKey,
      });
    });

    await waitFor(() => expect(latestResult?.savedPlans).toContainEqual(updatedPlan));
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      planFixture.planKey,
    );
  });

  it("refreshes saved summaries for a plan change outside the selected service", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const planListCalls = mockListServicePlans.mock.calls.length;
    await act(async () => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        planKey: "service-9@2026-08-01",
      });
    });

    await waitFor(() =>
      expect(mockListServicePlans).toHaveBeenCalledTimes(planListCalls + 1),
    );
    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
  });

  it("replaces a URL preview carried into the Controller with the current saved plan", async () => {
    const store = makeStore();
    const urlOutline = {
      ...outlineFixture,
      sourceUrl: "https://example.com/plan",
      planLabel: "Pasted plan",
    };
    store.dispatch(setServicePlanningServiceOutline(urlOutline));

    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(store.getState().servicePlanningImport.serviceOutline).toEqual(
      outlineFixture,
    );
  });

  it("replaces a stored imported outline restored while the Controller is loading", async () => {
    let resolvePlans!: (value: {
      success: true,
      servicePlans: Array<{
        planKey: string;
        serviceId: string;
        date: string;
        name: string;
      }>;
    }) => void;
    mockListServicePlans.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePlans = resolve;
        }),
    );
    const store = makeStore();
    const storedOutline = {
      ...outlineFixture,
      sourceUrl: "https://example.com/stored-plan",
      planLabel: "Stored imported plan",
    };

    renderHookWith(store, enabledGlobalInfo);
    await act(async () => {
      store.dispatch(setStoredServicePlanningOutlineIfIdle(storedOutline));
      resolvePlans({
        success: true,
        servicePlans: [
          {
            planKey: planFixture.planKey,
            serviceId: planFixture.serviceId,
            date: planFixture.date,
            name: planFixture.name,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        planFixture.planKey,
      ),
    );
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(store.getState().servicePlanningImport.serviceOutline).toEqual(
      outlineFixture,
    );
  });

  it("keeps a URL preview imported during this Controller visit when the target binding changes", async () => {
    const store = makeStore();
    const urlOutline = {
      ...outlineFixture,
      sourceUrl: "https://example.com/plan",
      planLabel: "Pasted plan",
    };

    renderHookWith(store, enabledGlobalInfo);

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    await act(async () => {
      store.dispatch(setServicePlanningServiceOutline(urlOutline));
      store.dispatch(markServicePlanningUrlSelection());
    });
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());

    await act(async () => {
      store.dispatch(
        setServicePlanningOutlinePlanBinding({
          planKey: "service-2@2026-08-01",
          planName: "Evening Service",
          linkedAt: "2026-07-30T12:00:00.000Z",
        }),
      );
    });

    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().servicePlanningImport.serviceOutline).toEqual(
      urlOutline,
    );
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
  });

  it("keeps an explicit manual plan selected when its binding is cleared", async () => {
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        Promise.resolve({
          success: true,
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
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );

    act(() => {
      latestResult?.selectPlan("service-2@2026-08-01");
      store.dispatch(setServicePlanningOutlinePlanBinding(null));
    });

    expect(latestResult?.selectedPlanKey).toBe("service-2@2026-08-01");
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
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

    expect(mockGetServicePlanAssignments).toHaveBeenCalledWith(
      "church-1",
      "service-1@2026-08-01",
    );
    expect(mockLiveHandler).toBeNull();
  });

  it("loads existing Services data without full Teams live sync for scoped access", async () => {
    const store = makeStore();
    renderHookWith(store, { ...enabledGlobalInfo, canUseTeamsLiveSync: false });
    await waitFor(() => expect(mockGetServicePlan).toHaveBeenCalled());
    expect(mockLiveHandler).toBeNull();
  });

  it("does nothing for a guest session", async () => {
    const store = makeStore();
    renderHookWith(store, { ...enabledGlobalInfo, loginState: "guest" });

    await waitFor(() => expect(mockLiveHandler).toBeNull());
    expect(mockGetServicePlan).not.toHaveBeenCalled();
  });

  it("blocks sync when the initial required assignment read fails", async () => {
    mockGetServicePlanAssignments.mockRejectedValue(new Error("assignments unavailable"));
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockGetServicePlanAssignments).toHaveBeenCalled());
    await waitFor(() => expect(latestResult?.isLoading).toBe(false));
    expect(mockLoadPlanPreview).not.toHaveBeenCalled();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(store.getState().servicePlanningImport.isPlanPreviewStale).toBe(true);
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
        planKey: planFixture.planKey,
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
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: null });
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
      success: true,
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

  it("keeps the latest manually selected binding when earlier persistence settles last", async () => {
    const store = makeStore();
    const database = {};
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    mockPersistItemListServicePlanBinding
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    renderHookWith(store, enabledGlobalInfo, { db: database });
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey));

    act(() => {
      latestResult?.selectPlan("service-2@2026-08-01");
      latestResult?.selectPlan(planFixture.planKey);
    });
    await waitFor(() => expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledTimes(2));
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);

    await act(async () => { secondWrite.resolve(undefined); });
    await waitFor(() => expect(store.getState().servicePlanningImport.outlinePlanBinding?.planKey).toBe(planFixture.planKey));
    await act(async () => { firstWrite.resolve(undefined); });

    expect(store.getState().servicePlanningImport.outlinePlanBinding?.planKey).toBe(planFixture.planKey);
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
  });

  it("persists reselecting the current binding after an earlier selection is queued", async () => {
    const store = makeStore();
    store.dispatch(setServicePlanningOutlinePlanBinding({
      planKey: planFixture.planKey,
      planName: planFixture.name,
      linkedAt: "2026-08-01T08:00:00.000Z",
    }));
    const database = {};
    const firstWrite = createDeferred<void>();
    const secondWrite = createDeferred<void>();
    mockPersistItemListServicePlanBinding
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    renderHookWith(store, enabledGlobalInfo, { db: database });
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey));

    act(() => latestResult?.selectPlan("service-2@2026-08-01"));
    await waitFor(() => expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledTimes(1));
    act(() => latestResult?.selectPlan(planFixture.planKey));
    await waitFor(() => expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledTimes(2));

    await act(async () => { secondWrite.resolve(undefined); });
    await waitFor(() => expect(store.getState().servicePlanningImport.outlinePlanBinding?.planKey).toBe(planFixture.planKey));
    await act(async () => { firstWrite.resolve(undefined); });

    expect(store.getState().servicePlanningImport.outlinePlanBinding?.planKey).toBe(planFixture.planKey);
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
      success: true,
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
    mockGetServicePlan.mockResolvedValueOnce({ success: true, servicePlan: null });

    await act(async () => {
      await latestResult?.refresh();
    });

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(latestResult?.savedPlans).toEqual([]);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBeNull();
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    // Refresh is an authoritative reconciliation: it reloads the summary list
    // as well as the selected plan and its assignments.
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
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
      success: true,
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
          success: true,
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
      success: true,
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

    let resolveRefresh!: (value: { success: true, servicePlan: typeof planFixture }) => void;
    const slowRefresh = new Promise<{ success: true, servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    let resolveSelectedPlan!: (value: { success: true, servicePlan: typeof planFixture }) => void;
    const selectedPlanRequest = new Promise<{ success: true, servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveSelectedPlan = resolve;
      },
    );
    mockGetServicePlan.mockImplementation(
      (_churchId: string, planKey: string) =>
        planKey === secondPlan.planKey
          ? selectedPlanRequest
          : slowRefresh,
    );
    let refreshPromise: Promise<unknown> | undefined;
    act(() => {
      refreshPromise = latestResult?.refresh();
    });
    act(() => latestResult?.selectPlan(secondPlan.planKey));
    await waitFor(() => expect(latestResult?.isLoading).toBe(true));
    expect(latestResult?.selectedPlanDetails).toBeNull();
    expect(latestResult?.isRefreshing).toBe(false);
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(secondPlan.planKey);
    expect(store.getState().servicePlanningImport.isPlanPreviewStale).toBe(true);

    await act(async () => {
      resolveSelectedPlan({ success: true, servicePlan: secondPlan });
      await selectedPlanRequest;
    });
    await waitFor(() =>
      expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
        secondPlan.planKey,
      ),
    );

    await act(async () => {
      resolveRefresh({
        success: true,
        servicePlan: { ...planFixture, name: "Stale refreshed plan" },
      });
      await refreshPromise;
    });

    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      secondPlan.planKey,
    );
    expect(latestResult?.selectedPlanKey).toBe(secondPlan.planKey);
  });

  it("keeps selected-plan reconciliation alive for an unrelated plan event", async () => {
    const secondPlan = {
      ...planFixture,
      planId: "plan-2",
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      name: "Evening Service",
    };
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    let resolveRefresh!: (value: { success: true, servicePlan: typeof planFixture }) => void;
    const slowRefresh = new Promise<{ success: true, servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    mockGetServicePlan.mockReturnValue(slowRefresh);
    let refreshPromise: Promise<unknown> | undefined;
    act(() => {
      refreshPromise = latestResult?.refresh();
    });

    act(() => {
      mockLiveHandler?.({
        type: "service-plan-updated",
        success: true,
        servicePlan: secondPlan,
      });
    });

    await act(async () => {
      resolveRefresh({
        success: true,
        servicePlan: { ...planFixture, name: "Selected plan refreshed" },
      });
      await refreshPromise;
    });

    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      { ...planFixture, name: "Selected plan refreshed" },
      expect.any(Array),
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("keeps selected-plan reconciliation alive for an unrelated plan removal", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    let resolveRefresh!: (value: { success: true, servicePlan: typeof planFixture }) => void;
    const slowRefresh = new Promise<{ success: true, servicePlan: typeof planFixture }>(
      (resolve) => {
        resolveRefresh = resolve;
      },
    );
    mockGetServicePlan.mockReturnValue(slowRefresh);
    let refreshPromise: Promise<unknown> | undefined;
    act(() => {
      refreshPromise = latestResult?.refresh();
    });

    act(() => {
      mockLiveHandler?.({
        type: "service-plan-removed",
        planKey: "unrelated-plan@2026-08-02",
      });
    });

    await act(async () => {
      resolveRefresh({
        success: true,
        servicePlan: { ...planFixture, name: "Selected plan refreshed" },
      });
      await refreshPromise;
    });

    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      { ...planFixture, name: "Selected plan refreshed" },
      expect.any(Array),
      expect.objectContaining({ status: "ready" }),
    );
  });

  it("recovers changed plan details and assignments after a long hidden period", async () => {
    let nowMs = Date.parse("2026-08-01T09:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const refreshedPlan = { ...planFixture, name: "Sabbath Service (revised)" };
    const refreshedAssignments = [
      { teamName: "Band", role: "Keys", name: "Alex Morgan" },
    ];
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: refreshedPlan });
    mockGetServicePlanAssignments.mockResolvedValue({
      success: true,
      assignments: refreshedAssignments,
      participantOverlay: { status: "ready", elements: [] },
    });

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs += 10_001;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      refreshedPlan,
      refreshedAssignments,
      { status: "ready", elements: [] },
    );
  });

  it("does not reconcile when a hidden period is shorter than the threshold", async () => {
    let nowMs = Date.parse("2026-08-01T09:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      nowMs += 9_999;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(1);
    expect(mockListServicePlans).toHaveBeenCalledTimes(1);
  });

  it("reconciles the selected plan and assignments after network recovery", async () => {
    let nowMs = Date.parse("2026-08-01T09:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    const refreshedAssignments = [
      { teamName: "Band", role: "Keys", name: "Offline recovery" },
    ];
    mockGetServicePlanAssignments.mockResolvedValue({
      success: true,
      assignments: refreshedAssignments,
      participantOverlay: { status: "ready", elements: [] },
    });
    act(() => {
      window.dispatchEvent(new Event("offline"));
      nowMs += 10_001;
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
    expect(mockLoadPlanPreview).toHaveBeenLastCalledWith(
      planFixture,
      refreshedAssignments,
      { status: "ready", elements: [] },
    );
  });

  it("ignores the initial SSE connection but reconciles a later connection", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);

    await act(async () => {
      mockLiveHandler?.({ type: "connected" });
    });
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(1);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(1);
    expect(mockListServicePlans).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockLiveHandler?.({ type: "connected" });
    });
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
  });

  it("collapses visibility, online, and SSE reconnect signals into one refresh", async () => {
    let nowMs = Date.parse("2026-08-01T09:00:00.000Z");
    jest.spyOn(Date, "now").mockImplementation(() => nowMs);
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    // Mark the first connected message as the initial connection.
    act(() => mockLiveHandler?.({ type: "connected" }));

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("offline"));
      nowMs += 10_001;
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      mockLiveHandler?.({ type: "connected" });
    });

    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(2));
    expect(mockGetServicePlan).toHaveBeenCalledTimes(2);
    expect(mockGetServicePlanAssignments).toHaveBeenCalledTimes(2);
    expect(mockListServicePlans).toHaveBeenCalledTimes(2);
  });

  it("uses the refreshed list to clear a plan removed while asleep", async () => {
    const remainingPlan = {
      planKey: "service-2@2026-08-01",
      serviceId: "service-2",
      date: "2026-08-01",
      name: "Evening Service",
    };
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));

    mockListServicePlans.mockResolvedValue({ success: true, servicePlans: [remainingPlan] });
    mockGetServicePlan.mockResolvedValue({ success: true, servicePlan: null });
    await act(async () => {
      await latestResult?.refresh();
    });

    await waitFor(() => expect(latestResult?.selectedPlanKey).toBeNull());
    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(latestResult?.savedPlans).toEqual([remainingPlan]);
  });

  it("keeps the displayed plan and assignments when background reconciliation fails", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    const displayedPreview = store.getState().servicePlanningImport.preview;
    mockGetServicePlan.mockRejectedValue(new Error("temporarily unavailable"));

    await act(async () => {
      await latestResult?.refresh();
    });

    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().servicePlanningImport.preview).toEqual(
      displayedPreview,
    );
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
  });

  it("keeps the displayed assignments when background assignment reconciliation fails", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1));
    const displayedPreview = store.getState().servicePlanningImport.preview;
    mockListServicePlans.mockResolvedValue({
      success: true,
      servicePlans: [
        {
          planKey: "service-2@2026-08-01",
          serviceId: "service-2",
          date: "2026-08-01",
          name: "Evening Service",
        },
      ],
    });
    mockGetServicePlanAssignments.mockRejectedValue(
      new Error("assignments temporarily unavailable"),
    );

    await act(async () => {
      await latestResult?.refresh();
    });

    expect(mockLoadPlanPreview).toHaveBeenCalledTimes(1);
    expect(store.getState().servicePlanningImport.preview).toEqual(
      displayedPreview,
    );
    expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey);
    expect(latestResult?.savedPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ planKey: planFixture.planKey }),
      ]),
    );
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
    expect(latestResult?.selectedOccurrenceId).toBe(
      mockOtherOccurrence.occurrenceId,
    );
    expect(latestResult?.occurrence?.serviceId).toBe("service-2");
    expect(latestResult?.isManualSelection).toBe(true);
  });

  it("keeps an unmatched manual plan separate from the automatic occurrence", async () => {
    const outsidePlanKey = "service-3@2026-08-01";
    mockListServicePlans.mockResolvedValueOnce({
      success: true,
      servicePlans: [
        {
          planKey: planFixture.planKey,
          serviceId: planFixture.serviceId,
          date: planFixture.date,
          name: planFixture.name,
        },
        {
          planKey: outsidePlanKey,
          serviceId: "service-3",
          date: "2026-08-01",
          name: "Outside Window Service",
        },
      ],
    });
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey));

    act(() => latestResult?.selectPlan(outsidePlanKey));

    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(outsidePlanKey),
    );
    expect(latestResult?.selectedOccurrenceId).toBeNull();
    expect(latestResult?.occurrence).toBeNull();
    expect(latestResult?.isManualSelection).toBe(true);
  });

  it("resets manual context when the active Controller changes", async () => {
    const store = makeStore();
    const view = renderHookWith(store, enabledGlobalInfo, {}, "controller-a");
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey));

    act(() => latestResult?.selectPlan("service-2@2026-08-01"));
    await waitFor(() =>
      expect(latestResult?.selectedOccurrenceId).toBe(
        mockOtherOccurrence.occurrenceId,
      ),
    );
    await waitFor(() =>
      expect(latestResult?.isManualSelection).toBe(true),
    );

    view.rerender(
      <Provider store={store}>
        <ActiveControllerContext.Provider value="controller-b">
          <GlobalInfoContext.Provider value={enabledGlobalInfo as never}>
            <ControllerInfoContext.Provider value={{} as never}>
              <Harness
                onResult={(result) => {
                  latestResult = result;
                }}
              />
            </ControllerInfoContext.Provider>
          </GlobalInfoContext.Provider>
        </ActiveControllerContext.Provider>
      </Provider>,
    );

    await waitFor(() =>
      expect(latestResult?.selectedOccurrenceId).toBeNull(),
    );
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );
    await waitFor(() =>
      expect(latestResult?.isManualSelection).toBe(false),
    );
    expect(latestResult?.occurrence?.serviceId).toBe("service-1");
  });

  it("returns a manually selected occurrence to the current service", async () => {
    const store = makeStore();
    renderHookWith(store, enabledGlobalInfo);
    await waitFor(() => expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey));

    const otherOccurrence = latestResult?.occurrences.find(
      (candidate) => candidate.occurrenceId === mockOtherOccurrence.occurrenceId,
    );
    act(() => latestResult?.selectOccurrence(otherOccurrence?.occurrenceId ?? ""));

    await waitFor(() =>
      expect(latestResult?.selectedOccurrenceId).toBe(mockOtherOccurrence.occurrenceId),
    );
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe("service-2@2026-08-01"),
    );
    expect(latestResult?.isManualSelection).toBe(true);

    act(() => latestResult?.returnToCurrentService());

    await waitFor(() => expect(latestResult?.selectedOccurrenceId).toBeNull());
    await waitFor(() =>
      expect(latestResult?.selectedPlanKey).toBe(planFixture.planKey),
    );
    expect(latestResult?.occurrence?.serviceId).toBe("service-1");
    expect(latestResult?.isManualSelection).toBe(false);
  });
});
