import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import servicePlanningImportReducer, {
  cancelServicePlanningSync,
  setServicePlanningPlanOutline,
  setServicePlanningServiceOutline,
  startServicePlanningSync,
} from "../../store/servicePlanningImportSlice";
import itemListsReducer, {
  initiateItemLists,
} from "../../store/itemListsSlice";
import controllerProfilesReducer, {
  setControllerProfilesFromRemote,
} from "../../store/controllerProfilesSlice";
import { useServicePlanningSyncRunner } from "./useServicePlanningSyncRunner";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  ActiveControllerProvider,
  useActiveControllerId,
} from "../../context/activeController";

const mockPersistItemListServicePlanBinding = jest.fn();

jest.mock("../../utils/itemListImports", () => ({
  ...jest.requireActual("../../utils/itemListImports"),
  persistItemListServicePlanBinding: (...args: unknown[]) =>
    mockPersistItemListServicePlanBinding(...args),
}));

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

const RunnerHarness = ({ allowOverlaySync = true }: { allowOverlaySync?: boolean } = {}) => {
  const activeControllerId = useActiveControllerId();
  useServicePlanningSyncRunner({ allowOverlaySync });
  return (
    <>
      <div data-testid="active-controller">{activeControllerId}</div>
      <LocationProbe />
    </>
  );
};

const AUX_CONTROLLER_ID = "ctrl_lobby";
const PRESENTATION_CONTROLLER_ID = "presentation";

type ControllerScopedUndoableState = {
  present: {
    itemLists: ReturnType<typeof itemListsReducer>;
  };
};

const controllerScopedUndoableReducer = (
  state: ControllerScopedUndoableState | undefined,
  action: Parameters<typeof itemListsReducer>[1],
): ControllerScopedUndoableState => ({
  present: {
    itemLists: itemListsReducer(state?.present.itemLists, action),
  },
});

const createControllerScopedStore = () => {
  const store = configureStore({
    reducer: {
      servicePlanningImport: servicePlanningImportReducer,
      controllerProfiles: controllerProfilesReducer,
      undoable: controllerScopedUndoableReducer,
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

const ControllerScopedRunner = ({
  profileId,
  allowOverlaySync = true,
}: {
  profileId: string;
  allowOverlaySync?: boolean;
}) => (
  <ActiveControllerProvider profileId={profileId}>
    <RunnerHarness allowOverlaySync={allowOverlaySync} />
  </ActiveControllerProvider>
);

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

const undoableState = {
  present: {
    itemLists: {
      selectedList: { _id: "outline-1", name: "Sunday AM" },
    },
  },
};

const undoableStateWithoutOutline = {
  present: {
    itemLists: {
      selectedList: null,
    },
  },
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
        undoable: () => undoableState,
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

  it("links the target outline after a plan-sourced outline sync completes", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: () => undoableState,
      },
    });
    mockPlanOutlineSyncSteps.mockReturnValue([]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([]);
    store.dispatch(
      setServicePlanningPlanOutline({
        outline: serviceOutlineFixture as any,
        planKey: "service-1@2026-08-09",
      }),
    );

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db: {} } as any}>
          <MemoryRouter initialEntries={["/controller/service-planning"]}>
            <RunnerHarness />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "outline" }));
    });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.sync.status).toBe(
        "completed",
      ),
    );
    expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
      {},
      "outline-1",
      expect.objectContaining({
        planKey: "service-1@2026-08-09",
        planName: "May 2, 2026 - 10 AM",
      }),
    );
    expect(
      store.getState().servicePlanningImport.outlinePlanBinding?.planKey,
    ).toBe("service-1@2026-08-09");
  });

  it("persists an aux-selected outline rather than the presentation outline", async () => {
    const store = createControllerScopedStore();
    mockPlanOutlineSyncSteps.mockReturnValue([]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([]);
    store.dispatch(
      setServicePlanningPlanOutline({
        outline: serviceOutlineFixture as any,
        planKey: "service-aux@2026-08-09",
      }),
    );

    render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db: {} } as any}>
          <MemoryRouter initialEntries={["/aux-controller/ctrl_lobby"]}>
            <ControllerScopedRunner
              profileId={AUX_CONTROLLER_ID}
              allowOverlaySync={false}
            />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active-controller")).toHaveTextContent(
        AUX_CONTROLLER_ID,
      ),
    );
    await waitFor(() =>
      expect(
        store.getState().undoable.present.itemLists.selectedList?._id,
      ).toBe("aux-outline"),
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "outline" }));
    });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.sync.status).toBe(
        "completed",
      ),
    );
    expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
      {},
      "aux-outline",
      expect.objectContaining({ planKey: "service-aux@2026-08-09" }),
    );
    expect(mockExecuteOverlaySyncStep).not.toHaveBeenCalled();
  });

  it("does not continue an aux run after the active controller changes", async () => {
    const store = createControllerScopedStore();
    let resolveBinding: (() => void) | undefined;
    mockPersistItemListServicePlanBinding.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveBinding = resolve;
      }),
    );
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
      { phase: "outline", label: "Welcome", status: "pending" },
    ]);
    mockExecuteOutlineSyncStep.mockResolvedValue({
      inserted: 1,
      activeLabel: "Welcome",
    });
    mockExecuteOverlaySyncStep.mockResolvedValue({
      overlaysUpdated: 0,
      overlaysCloned: 0,
      overlaysCreated: 1,
      overlaysSkipped: 0,
      reasons: [],
    });
    store.dispatch(
      setServicePlanningPlanOutline({
        outline: serviceOutlineFixture as any,
        planKey: "service-aux@2026-08-09",
      }),
    );

    const { rerender } = render(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db: {} } as any}>
          <MemoryRouter initialEntries={["/aux-controller/ctrl_lobby"]}>
            <ControllerScopedRunner
              profileId={AUX_CONTROLLER_ID}
              allowOverlaySync={false}
            />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );

    await waitFor(() =>
      expect(store.getState().undoable.present.itemLists.selectedList?._id).toBe(
        "aux-outline",
      ),
    );
    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "outline" }));
    });

    await waitFor(() =>
      expect(mockExecuteOutlineSyncStep).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() =>
      expect(mockPersistItemListServicePlanBinding).toHaveBeenCalledWith(
        {},
        "aux-outline",
        expect.objectContaining({ planKey: "service-aux@2026-08-09" }),
      ),
    );

    rerender(
      <Provider store={store}>
        <ControllerInfoContext.Provider value={{ db: {} } as any}>
          <MemoryRouter initialEntries={["/aux-controller/ctrl_lobby"]}>
            <ControllerScopedRunner
              profileId={PRESENTATION_CONTROLLER_ID}
              allowOverlaySync={false}
            />
          </MemoryRouter>
        </ControllerInfoContext.Provider>
      </Provider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active-controller")).toHaveTextContent(
        PRESENTATION_CONTROLLER_ID,
      ),
    );

    await act(async () => {
      resolveBinding?.();
    });

    expect(
      store.getState().servicePlanningImport.outlinePlanBinding,
    ).toBeNull();
    expect(mockExecuteOutlineSyncStep).toHaveBeenCalledTimes(1);
    expect(mockExecuteOverlaySyncStep).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).not.toHaveTextContent(
      "/controller/overlays",
    );
  });

  it("rejects a stale overlay-capable run on an outline-only controller", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: () => undoableState,
      },
    });
    mockPlanOutlineSyncSteps.mockReturnValue([]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [{ action: "create", elementType: "Welcome", patch: {} }],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([]);
    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture as any));

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/aux-controller/ctrl_lobby"]}>
          <RunnerHarness allowOverlaySync={false} />
        </MemoryRouter>
      </Provider>,
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "both" }));
    });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.sync.status).toBe("failed"),
    );
    expect(mockExecuteOverlaySyncStep).not.toHaveBeenCalled();
  });

  it("allows an overlays-only sync without a selected outline", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: () => undoableStateWithoutOutline,
      },
    });
    mockPlanOutlineSyncSteps.mockReturnValue([]);
    mockPlanOverlaySyncSteps.mockReturnValue({
      steps: [],
      skippedCount: 0,
      skipReasons: [],
    });
    mockPlanSyncItemsInOrder.mockReturnValue([]);
    store.dispatch(setServicePlanningServiceOutline(serviceOutlineFixture as any));

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/controller/overlays"]}>
          <RunnerHarness />
        </MemoryRouter>
      </Provider>,
    );

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "overlays" }));
    });

    await waitFor(() =>
      expect(store.getState().servicePlanningImport.sync.status).toBe(
        "completed",
      ),
    );
    expect(mockPersistItemListServicePlanBinding).not.toHaveBeenCalled();
  });

  it("finalizes a stop request after the active step records its result", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: () => undoableState,
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
