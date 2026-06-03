import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import servicePlanningImportReducer, {
  setServicePlanningFloatingWindowDismissed,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPlanInfo,
  setServicePlanningServiceOutline,
  startServicePlanningSync,
  completeServicePlanningSync,
  advanceServicePlanningSyncStep,
} from "../../store/servicePlanningImportSlice";
import ServicePlanningSyncFloatingWindow from "./ServicePlanningSyncFloatingWindow";
import { getServicePlanningLineItemKey } from "../../utils/servicePlanningSyncKeys";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import { useToast } from "../../context/toastContext";

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: jest.fn(),
  overlayPlanHasExecutableChange: (plan: Array<{ action: string }>) =>
    Array.isArray(plan) && plan.some((item) => item.action !== "skip"),
}));
jest.mock("../../context/toastContext", () => ({
  useToast: jest.fn(),
}));

const mockedUseServicePlanningImport =
  useServicePlanningImport as jest.MockedFunction<
    typeof useServicePlanningImport
  >;
const mockedUseToast = useToast as jest.MockedFunction<typeof useToast>;

const renderWindow = (store: ReturnType<typeof configureStore>) =>
  render(
    <MemoryRouter>
      <Provider store={store}>
        <ServicePlanningSyncFloatingWindow />
      </Provider>
    </MemoryRouter>,
  );

const wrapImport = (preview: any) => ({
  source: "servicePlanning" as const,
  loadedAt: "2026-05-03T12:00:00.000Z",
  sourceUrl: "https://example.com/plan",
  planLabel: "May 2, 2026 - 10 AM",
  preview,
});

describe("ServicePlanningSyncFloatingWindow", () => {
  beforeEach(() => {
    mockedUseServicePlanningImport.mockReturnValue({
      loadPreview: jest.fn(),
      runImport: jest.fn(),
      planOutlineSyncSteps: jest.fn(),
      planSyncItemsInOrder: jest.fn(),
      planOverlaySyncSteps: jest.fn(),
      executeOutlineSyncStep: jest.fn(),
      executeOverlaySyncStep: jest.fn(),
      isServicePlanningEnabled: true,
      servicePlanningAvailabilityMessage: null,
    });
    mockedUseToast.mockReturnValue({
      showToast: jest.fn(),
      hideToast: jest.fn(),
      toasts: [],
    } as any);
  });

  it("stays hidden on initial hydration until the user explicitly opens it", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 0,
            elementType: "Announcement",
            title: "Church Updates",
            ledBy: "Pastoral Team",
            selectedForOutline: false,
            outlineItemType: "none",
            matchedLibraryItem: null,
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        teamAssignments: [],
      }) as any),
    );

    const { rerender } = renderWindow(store);

    expect(screen.queryByText("May 2, 2026 - 10 AM")).not.toBeInTheDocument();

    act(() => {
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    });

    rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText("May 2, 2026 - 10 AM")).toBeInTheDocument();
  });

  it("shows every planning row in one list with selection badges", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 0,
            elementType: "Announcement",
            title: "Church Updates",
            ledBy: "Pastoral Team",
            selectedForOutline: false,
            outlineItemType: "none",
            matchedLibraryItem: null,
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 1,
            elementType: "Welcome Song",
            title: "Welcome Song",
            ledBy: "Praise Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: {
              _id: "song-1",
              name: "Welcome Song",
              type: "song",
            },
            parsedRef: null,
            overlayReady: true,
            outlineAlreadyPresent: false,
          },
        ],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    expect(screen.getByText("May 2, 2026 - 10 AM")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("May 2, 2026 - 10 AM")).toBeInTheDocument();
    expect(screen.getByText(/Imported .*2026/i)).toBeInTheDocument();
    expect(screen.getByText("Announcement")).toBeInTheDocument();
    expect(screen.getByText("Church Updates")).toBeInTheDocument();
    expect(screen.getByText("Pastoral Team")).toBeInTheDocument();
    expect(screen.getAllByText("Welcome Song")).toHaveLength(2);
    expect(screen.getByText("Overlay ready")).toBeInTheDocument();
    expect(screen.getByText("Song")).toBeInTheDocument();
  });

  it("renders safely when preview has no team assignments field", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 0,
            elementType: "Announcement",
            title: "Church Updates",
            ledBy: "Pastoral Team",
            selectedForOutline: false,
            outlineItemType: "none",
            matchedLibraryItem: null,
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    expect(screen.getByText("Announcement")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Assignments" }),
    ).not.toBeInTheDocument();
  });

  it("keeps all rows visible and folds sync status into the same list during and after sync", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    const songLineItem = {
      sectionName: "Welcome",
      headingName: "Welcome",
      sourceRowIndex: 0,
      elementType: "Welcome Song",
      title: "Welcome Song",
      ledBy: "Praise Team",
      selectedForOutline: true,
      outlineItemType: "song",
      matchedLibraryItem: {
        _id: "song-1",
        name: "Welcome Song",
        type: "song",
      },
      parsedRef: null,
      overlayReady: true,
      outlineAlreadyPresent: false,
    } as const;

    const songLineItemKey = getServicePlanningLineItemKey(songLineItem);

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          songLineItem,
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 1,
            elementType: "Announcement",
            title: "Church Updates",
            ledBy: "Pastoral Team",
            selectedForOutline: false,
            outlineItemType: "none",
            matchedLibraryItem: null,
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "both" }));
      store.dispatch(
        setServicePlanningSyncPlanInfo({
          totalSteps: 2,
          syncItems: [
            {
              label: "Welcome Song",
              sublabel: "Welcome",
              phase: "outline",
              status: "pending",
              sourceLineItemKey: songLineItemKey,
            },
            {
              label: "Welcome Song",
              phase: "overlays",
              status: "pending",
              sourceLineItemKey: songLineItemKey,
            },
          ],
        }),
      );
      store.dispatch(
        setServicePlanningSyncActiveStep({
          phase: "outline",
          activeLabel: "Welcome Song",
          activeSublabel: "Welcome",
        }),
      );
    });

    const { rerender } = renderWindow(store);

    expect(screen.getByText("Announcement")).toBeInTheDocument();
    expect(screen.getByText("Syncing outline")).toBeInTheDocument();
    expect(screen.getByText("Overlay pending")).toBeInTheDocument();

    act(() => {
      store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "added" }));
      store.dispatch(
        setServicePlanningSyncActiveStep({
          phase: "overlays",
          activeLabel: "Welcome Song",
        }),
      );
    });

    rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Outline added")).toBeInTheDocument();
    expect(screen.getByText("Syncing overlay")).toBeInTheDocument();

    act(() => {
      store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
      store.dispatch(completeServicePlanningSync());
    });

    rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Outline added")).toBeInTheDocument();
    expect(screen.getByText("Overlay updated")).toBeInTheDocument();
    expect(screen.getByText("Announcement")).toBeInTheDocument();
  });

  it("keeps duplicate rows isolated by their source row index", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    const firstSongLineItem = {
      sectionName: "Welcome",
      headingName: "Welcome",
      sourceRowIndex: 0,
      elementType: "Song",
      title: "Same Song",
      ledBy: "Praise Team",
      selectedForOutline: true,
      outlineItemType: "song",
      matchedLibraryItem: {
        _id: "song-1",
        name: "Same Song",
        type: "song",
      },
      parsedRef: null,
      overlayReady: false,
      outlineAlreadyPresent: false,
    } as const;
    const secondSongLineItem = {
      ...firstSongLineItem,
      sourceRowIndex: 1,
    } as const;

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [firstSongLineItem, secondSongLineItem],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "outline" }));
      store.dispatch(
        setServicePlanningSyncPlanInfo({
          totalSteps: 1,
          syncItems: [
            {
              label: "Same Song",
              sublabel: "Welcome",
              phase: "outline",
              status: "pending",
              sourceLineItemKey: getServicePlanningLineItemKey(firstSongLineItem),
            },
          ],
        }),
      );
      store.dispatch(
        setServicePlanningSyncActiveStep({
          phase: "outline",
          activeLabel: "Same Song",
          activeSublabel: "Welcome",
        }),
      );
    });

    renderWindow(store);

    expect(screen.getAllByText("Same Song")).toHaveLength(2);
    expect(screen.getByText("Syncing outline")).toBeInTheDocument();
    expect(screen.queryByText("Outline pending")).not.toBeInTheDocument();
    expect(screen.queryByText("Outline pending")).not.toBeInTheDocument();
  });

  it("normalizes Sync All to outline when overlays have no executable changes", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            elementType: "Welcome Song",
            title: "Welcome Song",
            outlineItemType: "song",
            cleanedTitle: "Welcome Song",
            matchedLibraryItem: {
              _id: "song-1",
              name: "Welcome Song",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 0,
            elementType: "Welcome Song",
            title: "Welcome Song",
            ledBy: "Praise Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: {
              _id: "song-1",
              name: "Welcome Song",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    fireEvent.click(screen.getByRole("button", { name: "Sync All" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("outline");
  });

  it("shows team assignments in a separate tab", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
            sourceRowIndex: 0,
            elementType: "Announcement",
            title: "Church Updates",
            ledBy: "Pastoral Team",
            selectedForOutline: false,
            outlineItemType: "none",
            matchedLibraryItem: null,
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        teamAssignments: [
          {
            teamName: "Praise Team",
            role: "Alto Singer",
            name: "Mykkah Binns",
          },
          {
            teamName: "Praise Team",
            role: "Worship Leader",
            name: "Kailyn Reid",
          },
        ],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Assignments" })).toBeInTheDocument();
    expect(screen.queryByText("Mykkah Binns")).not.toBeInTheDocument();

    const assignmentsTab = screen.getByRole("tab", { name: "Assignments" });
    fireEvent.mouseDown(assignmentsTab);
    fireEvent.click(assignmentsTab);

    await waitFor(() => {
      expect(screen.getByText("Praise Team")).toBeInTheDocument();
    });
    expect(screen.getByText("Alto Singer")).toBeInTheDocument();
    expect(screen.getByText("Mykkah Binns")).toBeInTheDocument();
    expect(screen.getByText("Worship Leader")).toBeInTheDocument();
    expect(screen.getByText("Kailyn Reid")).toBeInTheDocument();
  });
});
