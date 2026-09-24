import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import allDocsReducer from "../../store/allDocsSlice";
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
// Covered by useCurrentServicePlanSource.test.tsx. Stubbed here so these tests
// stay about the window itself and don't need Teams state in the store.
const mockPlanSource = {
  savedPlans: [] as Array<{
    planKey: string;
    serviceId: string;
    name: string;
    date: string;
    startsAt?: string;
  }>,
  selectedPlan: null as null | {
    planKey: string;
    serviceId: string;
    name: string;
    date: string;
  },
  selectedPlanKey: null as string | null,
  selectPlan: jest.fn(),
  occurrences: [] as Array<{
    occurrenceId: string;
    name: string;
    startsAt: string;
  }>,
  occurrence: null as {
    occurrenceId: string;
    name: string;
    startsAt: string;
  } | null,
  selectedOccurrenceId: null as string | null,
  selectOccurrence: jest.fn(),
  returnToCurrentService: jest.fn(),
  isManualSelection: false,
  isEnabled: true,
  isLoading: false,
  isLoadingPlans: false,
  plansError: null as string | null,
  isPlanSourced: false,
  refresh: jest.fn(),
  refreshPlans: jest.fn(),
};

jest.mock("./useCurrentServicePlanSource", () => ({
  useCurrentServicePlanSource: () => mockPlanSource,
}));

const mockedUseServicePlanningImport =
  useServicePlanningImport as jest.MockedFunction<
    typeof useServicePlanningImport
  >;
const mockedUseToast = useToast as jest.MockedFunction<typeof useToast>;

const renderWindow = (
  store: ReturnType<typeof configureStore>,
  props: { allowOverlaySync?: boolean } = {},
) =>
  render(
    <MemoryRouter>
      <Provider store={store}>
        <ServicePlanningSyncFloatingWindow {...props} />
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
      loadPlanPreview: jest.fn(),
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
    mockPlanSource.savedPlans = [];
    mockPlanSource.selectedPlan = null;
    mockPlanSource.selectedPlanKey = null;
    mockPlanSource.isPlanSourced = false;
    mockPlanSource.isLoading = false;
    mockPlanSource.occurrences = [];
    mockPlanSource.occurrence = null;
    mockPlanSource.selectedOccurrenceId = null;
    mockPlanSource.isManualSelection = false;
  });

  it("stays hidden on initial hydration until the user explicitly opens it", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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
            elementType: "free",
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

    expect(
      screen.getByRole("button", {
        name: "Select service plan: May 2, 2026 - 10 AM",
      }),
    ).toBeInTheDocument();
  });

  // Regression: the menu was portaled, which escapes the floating window's
  // stacking context — the picker rendered but clicking it did nothing.
  it("opens the service picker inside the floating window", async () => {
    const user = userEvent.setup();
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.savedPlans = [
      {
        planKey: "service-1@2026-07-30",
        serviceId: "service-1",
        name: "Test 1",
        date: "2026-07-30",
        startsAt: "2026-07-30T19:00:00.000Z",
      },
      {
        planKey: "service-2@2026-08-06",
        serviceId: "service-2",
        name: "Test 2",
        date: "2026-08-06",
        startsAt: "2026-08-06T19:00:00.000Z",
      },
    ];

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(
      setServicePlanningServiceOutline(
        wrapImport({
          overlayCandidates: [],
          overlayPlan: [],
          outlineCandidates: [],
          lineItems: [],
          teamAssignments: [],
        }) as any,
      ),
    );
    act(() => {
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    });

    renderWindow(store);

    await user.click(
      screen.getByRole("button", { name: /Select service plan:/i }),
    );
    expect(
      await screen.findByRole("option", { name: /Test 2/ }),
    ).toBeInTheDocument();

    // The assertion that matters: the menu must live *inside* the floating
    // window. jsdom doesn't model stacking contexts, so a portaled menu still
    // renders (into document.body) and a plain screen query passes either way —
    // containment is what actually distinguishes the broken version.
    const floatingWindow = within(screen.getByTestId("floating-window"));
    expect(
      floatingWindow.getByRole("option", { name: /Test 2/ }),
    ).toBeInTheDocument();

    await user.click(floatingWindow.getByRole("option", { name: /Test 2/ }));
    expect(mockPlanSource.selectPlan).toHaveBeenCalledWith(
      "service-2@2026-08-06",
    );
  });

  it("uses combobox keyboard navigation to select a plan", async () => {
    const user = userEvent.setup();
    mockPlanSource.savedPlans = [
      {
        planKey: "service-1@2026-07-30",
        serviceId: "service-1",
        name: "Test 1",
        date: "2026-07-30",
        startsAt: "2026-07-30T19:00:00.000Z",
      },
      {
        planKey: "service-2@2026-08-06",
        serviceId: "service-2",
        name: "Test 2",
        date: "2026-08-06",
        startsAt: "2026-08-06T19:00:00.000Z",
      },
    ];
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [],
      overlayPlan: [],
      outlineCandidates: [],
      lineItems: [],
      teamAssignments: [],
    }) as any));
    act(() => {
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    });

    renderWindow(store);
    await user.click(screen.getByRole("button", { name: /Select service plan:/i }));

    const search = await screen.findByRole("combobox", {
      name: "Search all saved plans",
    });
    expect(search).toHaveFocus();

    await user.keyboard("{Escape}");
    const trigger = screen.getByRole("button", { name: /Select service plan:/i });
    expect(screen.queryByRole("combobox", { name: "Search all saved plans" }))
      .not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const reopenedSearch = await screen.findByRole("combobox", {
      name: "Search all saved plans",
    });
    expect(reopenedSearch).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    const nextOption = screen.getByRole("option", { name: /Test 2/ });
    expect(reopenedSearch).toHaveAttribute(
      "aria-activedescendant",
      nextOption.id,
    );
    await user.keyboard("{Enter}");

    expect(mockPlanSource.selectPlan).toHaveBeenCalledWith(
      "service-2@2026-08-06",
    );
    expect(screen.queryByRole("combobox", { name: "Search all saved plans" }))
      .not.toBeInTheDocument();
  });

  it.each([
    ["minimum supported viewport", 320, 240],
    ["iPad portrait viewport", 768, 1024],
    ["iPad landscape viewport", 1024, 768],
  ])("keeps plan results scrollable at the %s", async (_label, width, height) => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: height,
    });

    try {
      const user = userEvent.setup();
      mockPlanSource.savedPlans = Array.from({ length: 30 }, (_, index) => ({
        planKey: `service-${index + 1}`,
        serviceId: `service-${index + 1}`,
        name: `Plan ${index + 1}`,
        date: "2099-08-01",
        startsAt: `2099-08-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
      }));

      const store = configureStore({
        reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
      });
      store.dispatch(setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [],
        teamAssignments: [],
      }) as any));
      act(() => {
        store.dispatch(setServicePlanningFloatingWindowDismissed(false));
      });

      const { unmount } = renderWindow(store);
      await user.click(screen.getByRole("button", { name: /Select service plan:/i }));

      const picker = await screen.findByRole("listbox", {
        name: "Saved service plans",
      });
      expect(picker).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
      expect(screen.getByTestId("service-plan-picker-content")).toHaveClass(
        "max-h-[min(var(--radix-popper-available-height),65vh,24rem)]",
      );
      expect(screen.getByTestId("floating-window")).toHaveStyle({
        maxHeight: `min(${Math.max(height - 32, 240)}px, 100vh)`,
      });
      unmount();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });

  it("marks the selected plan and searches plans beyond the initial groups", async () => {
    const user = userEvent.setup();
    const upcomingPlans = Array.from({ length: 11 }, (_, index) => ({
      planKey: `upcoming-${index + 1}`,
      serviceId: `upcoming-${index + 1}`,
      name: `Upcoming ${index + 1}`,
      date: "2099-08-01",
      startsAt: `2099-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const recentPlans = Array.from({ length: 11 }, (_, index) => ({
      planKey: `recent-${index + 1}`,
      serviceId: `recent-${index + 1}`,
      name: `Recent ${index + 1}`,
      date: "2000-08-01",
      startsAt: `2000-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
    mockPlanSource.savedPlans = [...upcomingPlans, ...recentPlans];
    mockPlanSource.selectedPlan = upcomingPlans[0];
    mockPlanSource.selectedPlanKey = upcomingPlans[0].planKey;

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);

    await user.click(
      screen.getByRole("button", { name: /Select service plan:/i }),
    );
    const floatingWindow = within(screen.getByTestId("floating-window"));
    expect(floatingWindow.getByText("Upcoming")).toBeInTheDocument();
    expect(floatingWindow.getByText("Recent", { selector: "p" })).toBeInTheDocument();
    expect(
      floatingWindow.getByRole("option", { name: /^Upcoming 1 ·/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      floatingWindow.queryByRole("option", { name: /^Recent 1 ·/ }),
    ).not.toBeInTheDocument();

    await user.type(
      floatingWindow.getByRole("combobox", { name: "Search all saved plans" }),
      "Recent 1",
    );
    const extraPlan = await floatingWindow.findByRole("option", {
      name: /^Recent 1 ·/,
    });
    await user.click(extraPlan);
    expect(mockPlanSource.selectPlan).toHaveBeenCalledWith("recent-1");
  });

  it("keeps the current service empty when no matching saved plan exists", async () => {
    const user = userEvent.setup();
    mockPlanSource.selectPlan.mockClear();
    mockPlanSource.occurrence = {
      occurrenceId: "occurrence-1",
      name: "Sunday Service",
      startsAt: "2026-08-02T10:00:00.000Z",
    };

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);

    expect(
      screen.getByRole("button", {
        name: "Select service plan: No plan for current service",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No saved plan exists for the current service/i))
      .toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Select service plan:/i }),
    );
    expect(screen.getByText("No saved plans yet.")).toBeInTheDocument();
    expect(mockPlanSource.selectPlan).not.toHaveBeenCalled();
  });

  it("shows the selected service plan without an occurrence selector and offers return", async () => {
    mockPlanSource.occurrences = [
      {
        occurrenceId: "occurrence-1",
        name: "Sunday Service",
        startsAt: "2026-08-02T10:00:00.000Z",
      },
      {
        occurrenceId: "occurrence-2",
        name: "Evening Service",
        startsAt: "2026-08-02T18:00:00.000Z",
      },
    ];
    mockPlanSource.occurrence = mockPlanSource.occurrences[1];
    mockPlanSource.selectedOccurrenceId = "occurrence-2";
    mockPlanSource.isManualSelection = true;

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    act(() => {
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    });

    renderWindow(store);

    expect(
      screen.queryByRole("combobox", { name: /Service occurrence/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Select service plan:/i }),
    ).toBeInTheDocument();

    await userEvent.setup().click(
      screen.getByRole("button", { name: "Return to current service" }),
    );
    expect(mockPlanSource.returnToCurrentService).toHaveBeenCalled();
  });

  it("shows a manual plan without claiming an unrelated occurrence", async () => {
    mockPlanSource.savedPlans = [
      {
        planKey: "service-3@2026-08-02",
        serviceId: "service-3",
        date: "2026-08-02",
        name: "Outside Window Service",
      },
    ];
    mockPlanSource.selectedPlan = mockPlanSource.savedPlans[0];
    mockPlanSource.selectedPlanKey = "service-3@2026-08-02";
    mockPlanSource.occurrences = [
      {
        occurrenceId: "occurrence-1",
        name: "Sunday Service",
        startsAt: "2026-08-02T10:00:00.000Z",
      },
    ];
    mockPlanSource.isManualSelection = true;

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    act(() => {
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    });

    renderWindow(store);

    expect(
      screen.getByRole("button", {
        name: /Select service plan: Outside Window Service/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /Service occurrence/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Return to current service" }),
    ).toBeInTheDocument();
  });

  it("shows a loading status instead of the previous plan while selection changes", () => {
    mockPlanSource.isLoading = true;
    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(
      setServicePlanningServiceOutline(
        wrapImport({
          overlayCandidates: [],
          overlayPlan: [],
          outlineCandidates: [],
          lineItems: [
            {
              sectionName: "Welcome",
              headingName: "Welcome",
              sourceRowIndex: 0,
              elementType: "Old imported item",
              title: "Do not show",
              ledBy: "",
              selectedForOutline: false,
              outlineItemType: "none",
              matchedLibraryItem: null,
              parsedRef: null,
              overlayReady: false,
              outlineAlreadyPresent: false,
            },
          ],
          teamAssignments: [],
        }) as any,
      ),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading the selected plan",
    );
    expect(screen.queryByText("Old imported item")).not.toBeInTheDocument();
  });

  it("shows every planning row in one list with selection badges", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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
            // A saved WorshipSync plan can have current people that differ
            // from the original imported led-by text.
            ledBy: "Pastoral Team",
            assigneeNames: ["Avery Brown", "Blair Clark", "Casey Davis"],
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

    expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Select service plan: May 2, 2026 - 10 AM",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Imported .*2026/i)).toBeInTheDocument();
    expect(screen.getByText("Church Updates")).toBeInTheDocument();
    expect(screen.queryByText("free")).not.toBeInTheDocument();
    expect(screen.getByText("Assigned:")).toBeInTheDocument();
    expect(screen.getByText("Avery Brown, Blair Clark, Casey Davis")).toBeInTheDocument();
    expect(screen.queryByText("Pastoral Team")).not.toBeInTheDocument();
    expect(screen.getByText("Welcome Song")).toBeInTheDocument();
    expect(screen.getByLabelText("Overlay ready")).toBeInTheDocument();
    expect(screen.getByText("Song")).toBeInTheDocument();
  });

  it("renders safely when preview has no team assignments field", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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

    expect(screen.getByText("Church Updates")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Assignments" }),
    ).not.toBeInTheDocument();
  });

  it("keeps all rows visible and folds sync status into the same list during and after sync", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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

    expect(screen.getByText("Church Updates")).toBeInTheDocument();
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
    expect(screen.getByText("Church Updates")).toBeInTheDocument();
  });

  it("shows only overlay change badges when an overlay was updated on the row", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
      },
    });

    const lineItem = {
      sectionName: "Welcome",
      headingName: "Welcome",
      sourceRowIndex: 0,
      elementType: "Co-Host",
      title: "John Smith",
      ledBy: "",
      selectedForOutline: false,
      outlineItemType: "none",
      matchedLibraryItem: null,
      parsedRef: null,
      overlayReady: true,
      outlineAlreadyPresent: false,
    } as const;
    const lineItemKey = getServicePlanningLineItemKey(lineItem);

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [lineItem],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    store.dispatch(startServicePlanningSync({ mode: "overlays" }));
    store.dispatch(
      setServicePlanningSyncPlanInfo({
        totalSteps: 1,
        syncItems: [
          {
            label: "John Smith",
            sublabel: "Co-Host",
            phase: "overlays",
            status: "already-present",
            sourceLineItemKey: lineItemKey,
          },
          {
            label: "John Smith",
            sublabel: "Co-Host",
            phase: "overlays",
            status: "updated",
            sourceLineItemKey: lineItemKey,
          },
        ],
      }),
    );
    store.dispatch(completeServicePlanningSync());

    renderWindow(store);

    expect(screen.getByText("Overlay updated")).toBeInTheDocument();
    expect(screen.queryByText("Overlay current")).not.toBeInTheDocument();
    expect(screen.queryByText("Overlay created")).not.toBeInTheDocument();
  });

  it("keeps duplicate rows isolated by their source row index", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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
        allDocs: allDocsReducer,
        undoable: () => ({
          present: {
            itemLists: {
              currentLists: [{ _id: "outline-1", name: "Sunday AM" }],
              selectedList: { _id: "outline-1", name: "Sunday AM" },
            },
            itemList: { isLoading: false },
          },
        }),
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

  it("hides overlay sync actions when the controller is outline-only", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: () => ({
          present: {
            itemLists: {
              selectedList: { _id: "aux-outline", name: "Lobby" },
            },
            itemList: { isLoading: false },
          },
        }),
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [{ action: "create", elementType: "Welcome" }],
        outlineCandidates: [],
        lineItems: [],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store, { allowOverlaySync: false });

    expect(screen.getByRole("button", { name: "Sync outline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync overlays" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync All" })).not.toBeInTheDocument();
  });

  it("normalizes Sync All to overlays when no target outline is selected", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [{ action: "create", elementType: "Welcome" }],
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
        lineItems: [],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    fireEvent.click(screen.getByRole("button", { name: "Sync All" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("overlays");
  });

  it("shows Create song for unmatched outline songs instead of Add to list", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [
          {
            sectionName: "Worship",
            headingName: "Worship",
            sourceRowIndex: 0,
            elementType: "Song",
            title: "New Song Title",
            cleanedTitle: "New Song Title",
            ledBy: "Praise Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: null,
            attachedSongs: [{ title: "New Song Title", inLibrary: false }],
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
          {
            sectionName: "Worship",
            headingName: "Worship",
            sourceRowIndex: 1,
            elementType: "Song",
            title: "Existing Song",
            cleanedTitle: "Existing Song",
            ledBy: "Praise Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: {
              _id: "song-1",
              name: "Existing Song",
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

    expect(
      screen.getByRole("button", { name: "Create song New Song Title" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not in library")).toBeInTheDocument();
    expect(screen.queryByText("Song not found")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add .* to list/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Create song Existing Song/i }),
    ).not.toBeInTheDocument();
  });

  it("shows team assignments in a separate tab", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
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
            profileImageUrl: "https://example.com/mykkah.jpg",
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
    expect(
      screen.getByRole("button", { name: "View profile image of Mykkah Binns" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Worship Leader")).toBeInTheDocument();
    expect(screen.getByText("Kailyn Reid")).toBeInTheDocument();
  });
});
