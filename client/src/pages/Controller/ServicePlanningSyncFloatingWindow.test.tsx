import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import servicePlanningImportReducer, {
  beginServicePlanningPlanSelection,
  setServicePlanningFloatingWindowDismissed,
  setServicePlanningSyncActiveStep,
  setServicePlanningSyncPlanInfo,
  recordServicePlanningSyncResult,
  setServicePlanningServiceOutline,
  startServicePlanningSync,
  completeServicePlanningSync,
  advanceServicePlanningSyncStep,
} from "../../store/servicePlanningImportSlice";
import allDocsReducer from "../../store/allDocsSlice";
import { setActiveItemInList } from "../../store/itemListSlice";
import ServicePlanningSyncFloatingWindow from "./ServicePlanningSyncFloatingWindow";
import {
  formatControllerServicePlanDateTime,
  formatControllerServicePlanLabel,
} from "./controllerServicePlanSelection";
import { getServicePlanningLineItemKey } from "../../utils/servicePlanningSyncKeys";
import { useServicePlanningImport } from "../../hooks/useServicePlanningImport";
import { useToast } from "../../context/toastContext";
import { buildServicePlanningPreview } from "../../integrations/servicePlanning/buildServicePlanningPreview";
import { mapNativeServicePlanParticipants } from "../../integrations/servicePlanning/mapNativeServicePlanParticipants";
import { servicePlanToImportData } from "../../integrations/servicePlanning/servicePlanToImportData";
import type { ServicePlan } from "../../types/servicePlan";

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: jest.fn(),
  overlayPlanHasExecutableChange: (plan: Array<{ action: string }>) =>
    Array.isArray(plan) && plan.some((item) => item.action !== "skip"),
}));
jest.mock("../Services/useServicePlanSongLibrary", () => ({
  useServicePlanSongLibrary: () => ({ songs: [], isLoading: false }),
}));
const mockPushPlanToOutline = jest.fn();
const mockLoadPreview = jest.fn();
jest.mock("../../context/toastContext", () => ({
  useToast: jest.fn(),
}));
jest.mock("../../context/churchServiceTimeZone", () => ({
  useChurchServiceTimeZone: () => ({
    status: "ready",
    timeZone: "America/New_York",
    isConfigured: true,
    legacyTimeZoneSuggestion: null,
    refresh: jest.fn(),
  }),
}));
jest.mock("../../utils/generalUtils", () => ({
  ...jest.requireActual("../../utils/generalUtils"),
  ensureElementInView: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../Services/useServicePlanOutlinePush", () => ({
  useServicePlanOutlinePush: () => ({ pushPlanToOutline: mockPushPlanToOutline }),
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
    startsAt?: string;
  },
  selectedPlanDetails: null as any,
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
  isRefreshing: false,
  isRefreshingParticipants: false,
  isParticipantOverlayUnsafe: false,
  isLoadingPlans: false,
  plansError: null as string | null,
  isPlanSourced: false,
  isPlanPreviewStale: false,
  isNativeOverlayMappingReady: true,
  nativeOverlayMappingKey: "test-mapping",
  nativeOverlayMappingFresh: true,
  isNativeOverlayPreviewFresh: () => mockPlanSource.nativeOverlayMappingFresh,
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
  it("never offers import controls or displays a historical URL preview without a selected saved plan", async () => {
    mockPlanSource.selectedPlanKey = null;
    mockPlanSource.isPlanSourced = false;
    const store = configureStore({ reducer: {
      servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer,
    } });
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [], overlayPlan: [], outlineCandidates: [], teamAssignments: [],
      lineItems: [{
        sectionName: "Other service", headingName: "Other service", sourceRowIndex: 0,
        elementType: "Announcement", title: "Historical URL content", ledBy: "",
        selectedForOutline: false, outlineItemType: "none", matchedLibraryItem: null,
        parsedRef: null, overlayReady: false, outlineAlreadyPresent: false,
      }],
    })));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Planning URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Historical URL content")).not.toBeInTheDocument();
    expect(screen.queryByText(/Updated .*2026/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    expect(screen.getByText("Choose a saved plan to review it in the controller.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(mockPlanSource.refreshPlans).toHaveBeenCalled();
    expect(mockLoadPreview).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    mockPushPlanToOutline.mockReset();
    mockLoadPreview.mockReset();
    mockedUseServicePlanningImport.mockReturnValue({
      loadPlanPreview: jest.fn(),
      runImport: jest.fn(),
      planOutlineSyncSteps: jest.fn(),
      planSyncItemsInOrder: jest.fn(),
      planOverlaySyncSteps: jest.fn(),
      executeOutlineSyncStep: jest.fn(),
      executeOverlaySyncStep: jest.fn(),
      isNativeOverlayMappingReady: true,
      nativeOverlayMappingKey: "test-mapping",
      isNativeOverlayPreviewFresh: jest.fn(() => true),
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
    mockPlanSource.selectedPlanDetails = null;
    mockPlanSource.selectedPlanKey = "saved-plan";
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.isPlanPreviewStale = false;
    mockPlanSource.isNativeOverlayMappingReady = true;
    mockPlanSource.nativeOverlayMappingFresh = true;
    mockPlanSource.refresh.mockReset();
    mockPlanSource.isLoading = false;
    mockPlanSource.isRefreshing = false;
    mockPlanSource.isRefreshingParticipants = false;
    mockPlanSource.isParticipantOverlayUnsafe = false;
    mockPlanSource.occurrences = [];
    mockPlanSource.occurrence = null;
    mockPlanSource.selectedOccurrenceId = null;
    mockPlanSource.isManualSelection = false;
  });

  it("stays hidden on initial hydration until the user explicitly opens it", () => {
    mockPlanSource.selectedPlan = { planKey: "saved-plan", serviceId: "service", name: "May 2, 2026 - 10 AM", date: "2026-05-02" };
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
        name: /^Select service plan: May 2, 2026 - 10 AM/,
      }),
    ).toBeInTheDocument();
  });

  it("shows saved plan timing, content, notes, and microphones in the plan preview", () => {
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
            sectionName: "Pathfinder Presentation",
            headingName: null,
            sourceRowIndex: 0,
            elementType: "video",
            title: "Pathfinder Welcome Video",
            cleanedTitle: "Pathfinder Welcome Video",
            ledBy: "Mikaela Cox",
            assigneeNames: ["Mikaela Cox"],
            startTime: "10:59",
            durationMinutes: 1.5,
            contentResources: [
              {
                id: "resource-1",
                type: "url",
                title: "Dropbox video",
                url: "https://example.com/video",
                detail: "Play the intro before the welcome.",
              },
            ],
            note: "Keep the lights low.",
            teamNotes: [{ teamName: "Media Team", note: "Check playback." }],
            microphoneAssignments: [
              { assigneeName: "Mikaela Cox", microphoneIds: ["mic-orange"] },
            ],
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

    renderWindow(store);

    expect(screen.getByText("10:59 AM")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dropbox video/ })).toHaveAttribute(
      "href",
      "https://example.com/video",
    );
    expect(screen.getByText("Play the intro before the welcome.")).toBeInTheDocument();
    expect(screen.getByText("Keep the lights low.")).toBeInTheDocument();
    expect(screen.getByText("Media Team:")).toBeInTheDocument();
    expect(screen.getByText("mic-orange")).toBeInTheDocument();
  });

  it("renders a native saved plan when no legacy import preview exists", async () => {
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "element-1",
          type: "free",
          title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
        }],
      }],
    };

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderWindow(store);

      expect(await screen.findByText("Welcome")).toBeInTheDocument();
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps a same-plan view mounted and updates its content during refresh", async () => {
    const user = userEvent.setup();
    const planKey = "service-1@2026-07-30";
    const makeElement = (
      id: string,
      title: string,
      options: { notes?: string; assignedName?: string } = {},
    ) => ({
      id,
      type: "free",
      title: { blocks: [{ type: "paragraph", spans: [{ text: title }] }] },
      ...(options.notes
        ? {
            notes: {
              blocks: [{
                type: "paragraph",
                spans: [{ text: options.notes }],
              }],
            },
          }
        : {}),
      ...(options.assignedName ? { assignedName: options.assignedName } : {}),
    });
    const initialPlan = {
      planId: "plan-1",
      planKey,
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [
          makeElement("item-1", "First item", {
            notes: "Original note",
            assignedName: "Original lead",
          }),
          makeElement("item-2", "Second item"),
        ],
      }],
    };
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlan = {
      planKey,
      serviceId: "service-1",
      name: initialPlan.name,
      date: initialPlan.date,
    };
    mockPlanSource.selectedPlanKey = planKey;
    mockPlanSource.selectedPlanDetails = initialPlan;
    mockPlanSource.isRefreshing = true;

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    const { rerender } = renderWindow(store);

    expect(screen.getByRole("status")).toHaveTextContent("Updating…");
    const notesSummary = screen.getByText("View notes");
    await user.click(notesSummary);
    expect(screen.getByText("Original note")).toBeVisible();

    const refreshedPlan = {
      ...initialPlan,
      revision: 2,
      sections: [{
        ...initialPlan.sections[0],
        elements: [
          makeElement("item-2", "Second item revised"),
          makeElement("item-1", "First item revised", {
            notes: "Updated note",
            assignedName: "Updated lead",
          }),
        ],
      }],
    };
    mockPlanSource.selectedPlanDetails = refreshedPlan;
    rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Updating…");
    expect(screen.getByRole("heading", { name: "First item revised" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Second item revised" })).toBeVisible();
    expect(screen.getByText("Updated note")).toBeVisible();
    expect(screen.getByText("Updated lead")).toBeVisible();
    expect(screen.queryByText("Original note")).not.toBeInTheDocument();
    const planView = screen.getByLabelText("Selected service plan running order");
    expect(
      within(planView).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent),
    ).toEqual(["Second item revised", "First item revised"]);
  });

  it("starts overlay preview collapsed and shows native participant details when expanded", async () => {
    const user = userEvent.setup();
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "element-1",
          type: "free",
          title: { blocks: [{ type: "paragraph", spans: [{ text: "Sabbath School" }] }] },
        }],
      }],
    };

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [],
      overlayPlan: [{
        sectionName: "Worship",
        sourceRowIndex: 0,
        elementType: "free",
        title: "Sabbath School",
        ledBy: "Greg Baldeo",
        personIndex: 0,
        rawNameToken: "Greg Baldeo",
        action: "update",
        targetOverlayId: "weekly-host",
        targetOverlayName: "Weekly Host",
        patch: { name: "Dr. Greg Baldeo", title: "Lead Pastor", event: "Sabbath School" },
        duplicateExactMatchesAreAmbiguous: true,
      }],
      nativeOverlaySummary: {
        status: "ready",
        selectedItemCount: 1,
        assignedParticipantCount: 1,
      },
      outlineCandidates: [],
      lineItems: [],
      teamAssignments: [],
    }) as any));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    const overlayPreview = screen.getByRole("region", { name: "Overlay preview" });
    expect(within(overlayPreview).queryByText("Dr. Greg Baldeo")).not.toBeInTheDocument();
    expect(within(overlayPreview).getByText("1 update")).toBeInTheDocument();
    await user.click(within(overlayPreview).getByRole("button", { name: "Expand overlay preview" }));
    expect(within(overlayPreview).getByText("Dr. Greg Baldeo")).toBeInTheDocument();
    expect(within(overlayPreview).getByText("Lead Pastor")).toBeInTheDocument();
    expect(within(overlayPreview).getByText("Sabbath School")).toBeInTheDocument();
    expect(within(overlayPreview).getByText("Update existing")).toBeInTheDocument();
    await user.click(within(overlayPreview).getByRole("button", { name: "Collapse overlay preview" }));
    expect(within(overlayPreview).queryByText("Dr. Greg Baldeo")).not.toBeInTheDocument();
    expect(within(overlayPreview).getByText("1 update")).toBeInTheDocument();
  });

  it("keeps the scheduled LIVE row when the outline selection changes", () => {
    const startsAt = new Date(Date.now() - 100_000).toISOString();
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      startsAt,
      timezone: "UTC",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [
          {
            id: "welcome",
            type: "free",
            title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome" }] }] },
            durationSeconds: 90,
            pushedOutlineListId: "outline-welcome",
          },
          {
            id: "song",
            type: "free",
            title: { blocks: [{ type: "paragraph", spans: [{ text: "Song" }] }] },
            durationSeconds: 120,
            pushedOutlineListId: "outline-song",
          },
        ],
      }],
    };

    type TestUndoableState = {
      present: {
        itemLists: { selectedList: { _id: string; name: string } };
        itemList: { list: unknown[]; selectedItemListId: string };
      };
    };
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: (
          state: TestUndoableState = {
            present: {
              itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
              itemList: { list: [], selectedItemListId: "" },
            },
          },
          action: { type: string; payload?: unknown },
        ): TestUndoableState => action.type === setActiveItemInList.type && typeof action.payload === "string"
          ? {
              ...state,
              present: {
                ...state.present,
                itemList: {
                  ...state.present.itemList,
                  selectedItemListId: action.payload,
                },
              },
            }
          : state,
      },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    const liveRow = screen.getByRole("listitem", { current: true });
    expect(within(liveRow).getByRole("heading", { name: "Song" })).toBeInTheDocument();

    act(() => store.dispatch(setActiveItemInList("outline-welcome")));

    expect(store.getState().undoable.present.itemList.selectedItemListId).toBe("outline-welcome");
    expect(within(screen.getByRole("listitem", { current: true })).getByRole("heading", { name: "Song" }))
      .toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { current: true })).queryByRole("heading", { name: "Welcome" }))
      .not.toBeInTheDocument();
  });

  it("starts the native-plan summary collapsed and expands as one card", async () => {
    const item = { _id: "song-1", name: "What A Beautiful Name", type: "song", listId: "song-link" };
    const fallback = { sectionName: "Announcements", headingName: "Welcome & Notices", reason: "mapped-heading-missing", listId: item.listId, title: item.name };
    mockPushPlanToOutline.mockImplementation(async (_plan, _isCurrent, onItemAdded) => {
      await onItemAdded?.(item, fallback);
      return {
        items: [item],
        insertedCount: 1,
        skippedTitles: ["Example Song"],
        unresolvedAttachments: [{ listId: "missing", title: "Example Song", reason: 'Linked song "Example Song" was not found in the library (ID: missing).' }],
        alreadyPresent: [{ listId: "existing", title: "Existing song" }],
        placementFallbacks: [fallback],
      };
    });
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "element-1",
          type: "song",
          title: { blocks: [{ type: "paragraph", spans: [{ text: "What A Beautiful Name" }] }] },
          songRef: { kind: "library", songId: "song-1", songName: "What A Beautiful Name" },
        }],
      }],
    };

    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: (state = { present: { itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } }, itemList: { list: [], selectedItemListId: "" } } }) => state,
      },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Sync outline" }));
    const summaryButton = await screen.findByRole("button", { name: /1 added · 1 already in outline · 0 updated · 0 created · 1 skipped/i });
    const summaryCard = screen.getByLabelText("Most recent sync");
    const summary = within(summaryCard);
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    expect(summary.queryByText("What A Beautiful Name")).not.toBeInTheDocument();
    await userEvent.setup().click(summaryButton);
    expect(summaryButton).toHaveAttribute("aria-expanded", "true");
    expect(summary.getByText("Outline added · 1")).toBeInTheDocument();
    expect(summary.getByText("What A Beautiful Name")).toBeInTheDocument();
    expect(summary.getByText("Skipped · 1")).toBeInTheDocument();
    expect(summary.getByText("Example Song")).toBeInTheDocument();
    expect(summary.getByText(/Linked song "Example Song" was not found.*missing/)).toBeInTheDocument();
    expect(summary.getByText(/Added at end — mapped heading "Welcome & Notices" wasn't found\./)).toBeInTheDocument();
    expect(summary.getByRole("heading", { name: "Outline added · 1" })).toHaveClass("text-cyan-300");
    expect(summary.getByRole("heading", { name: "Skipped · 1" })).toHaveClass("text-amber-300");

    await userEvent.setup().click(summaryButton);
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    expect(summary.queryByText("What A Beautiful Name")).not.toBeInTheDocument();
    expect(summary.queryByText("Example Song")).not.toBeInTheDocument();
    expect(summaryButton).toHaveTextContent("1 added · 1 already in outline · 0 updated · 0 created · 1 skipped");
    expect(summary.queryByText(/Outline added ·/)).not.toBeInTheDocument();

    await userEvent.setup().click(summaryButton);
    expect(summaryButton).toHaveAttribute("aria-expanded", "true");
    expect(summary.getByText("What A Beautiful Name")).toBeInTheDocument();
    expect(summary.getByText("Example Song")).toBeInTheDocument();
  });

  it.each([false, true])("reports only committed fallbacks when a later step fails (committed: %s)", async (committed) => {
    const item = { _id: "song", name: "Prayer song", type: "song", listId: "prayer-link" };
    mockPushPlanToOutline.mockImplementation(async (_plan, _isCurrent, onItemAdded) => {
      if (committed) await onItemAdded(item, {
        sectionName: "Prayer", headingName: "Call to Prayer", reason: "heading-removed", listId: item.listId, title: item.name,
      });
      throw new Error("Could not load Bible passage");
    });
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service@2026-10-18";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service@2026-10-18", name: "Sunday", date: "2026-10-18",
      sections: [{ id: "prayer", name: "Prayer", elements: [{
        id: "song", type: "song", title: { blocks: [] },
        songRef: { kind: "library", songId: item._id, songName: item.name },
      }] }],
    };
    const store = configureStore({ reducer: {
      servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer,
      undoable: (state = { present: { itemLists: { selectedList: { _id: "outline", name: "Sunday" } }, itemList: { list: [], selectedItemListId: "" } } }) => state,
    } });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sync outline" }));
    const summary = within(await screen.findByLabelText("Most recent sync"));
    expect(await summary.findByText("Sync incomplete")).toBeInTheDocument();
    await userEvent.setup().click(summary.getByRole("button"));
    expect(summary.getByText("Could not load Bible passage")).toBeInTheDocument();
    expect(summary.queryAllByText("Outline added · 1")).toHaveLength(Number(committed));
    expect(summary.queryAllByText(/Added at end — heading "Call to Prayer" was removed before insertion\./)).toHaveLength(Number(committed));
  });

  it("summarizes updated and created overlays separately", async () => {
    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    store.dispatch(startServicePlanningSync({ mode: "overlays" }));
    store.dispatch(setServicePlanningSyncPlanInfo({
      totalSteps: 2,
      syncItems: [
        { label: "Clarence Jones", sublabel: "Sabbath School Host", phase: "overlays", status: "pending" },
        { label: "Media Team", sublabel: "Mission Story", phase: "overlays", status: "pending" },
      ],
    }));
    store.dispatch(setServicePlanningSyncActiveStep({ phase: "overlays", activeLabel: "Clarence Jones", activeSublabel: "Sabbath School Host" }));
    store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
    store.dispatch(setServicePlanningSyncActiveStep({ phase: "overlays", activeLabel: "Media Team", activeSublabel: "Mission Story" }));
    store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "created" }));
    store.dispatch(recordServicePlanningSyncResult({ overlaysSkipped: 1, reasons: ["No overlay target was available."] }));
    store.dispatch(completeServicePlanningSync());

    renderWindow(store);
    const summaryButton = await screen.findByRole("button", { name: /0 added · 1 updated · 1 created · 1 skipped/i });
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    expect(within(summaryButton).getByText("0 added")).toHaveClass("text-cyan-300");
    expect(within(summaryButton).getByText("1 updated")).toHaveClass("text-green-300");
    expect(within(summaryButton).getByText("1 created")).toHaveClass("text-sky-300");
    expect(within(summaryButton).getByText("1 skipped")).toHaveClass("text-amber-300");
    await userEvent.setup().click(summaryButton);
    expect(screen.getByText("Overlays updated · 1")).toBeInTheDocument();
    expect(screen.getByText("Overlays created · 1")).toBeInTheDocument();
    expect(screen.queryByText("Outline added · 0")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overlays updated · 1" })).toHaveClass("text-green-300");
    expect(screen.getByRole("heading", { name: "Overlays created · 1" })).toHaveClass("text-sky-300");
    expect(screen.getByText("Clarence Jones — Sabbath School Host")).toBeInTheDocument();
    expect(screen.getByText("Media Team — Mission Story")).toBeInTheDocument();
    expect(screen.getByText(/No overlay target was available/)).toBeInTheDocument();

    act(() => {
      store.dispatch(startServicePlanningSync({ mode: "overlays" }));
      store.dispatch(setServicePlanningSyncPlanInfo({
        totalSteps: 1,
        syncItems: [{ label: "New Person", sublabel: "Host", phase: "overlays", status: "pending" }],
      }));
      store.dispatch(setServicePlanningSyncActiveStep({ phase: "overlays", activeLabel: "New Person", activeSublabel: "Host" }));
      store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
      store.dispatch(completeServicePlanningSync());
    });

    const nextSummaryButton = await screen.findByRole("button", { name: /0 added · 1 updated · 0 created · 0 skipped/i });
    expect(nextSummaryButton).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(nextSummaryButton);
    expect(screen.getByText("New Person — Host")).toBeInTheDocument();
    expect(screen.queryByText("Clarence Jones — Sabbath School Host")).not.toBeInTheDocument();
  });

  it("combines native outline additions and automatically eligible overlays after Sync All", async () => {
    const song = { _id: "song-1", name: "What A Beautiful Name", type: "song", listId: "song-link" };
    const fallback = { sectionName: "Worship", headingName: "Praise and Worship", reason: "mapped-heading-missing", listId: song.listId, title: song.name };
    mockPushPlanToOutline.mockImplementation(async (_plan, _isCurrent, onItemAdded) => {
      await onItemAdded?.(song, fallback);
      return { items: [song], insertedCount: 1, skippedTitles: [], unresolvedAttachments: [], alreadyPresent: [], placementFallbacks: [fallback] };
    });
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{ id: "section-1", name: "Worship", elements: [{
        id: "element-1",
        type: "song",
        title: { blocks: [{ type: "paragraph", spans: [{ text: song.name }] }] },
        songRef: { kind: "library", songId: song._id, songName: song.name },
        assignees: [{ id: "assignee-1", name: "Clarence Jones" }],
      }] }],
    };
    const existingOverlay = { id: "overlay-1", type: "participant" as const, name: "Dobney Keen", event: song.name };
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: (state = { present: {
          itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
          itemList: { list: [], selectedItemListId: "" },
          overlays: { list: [existingOverlay] },
        } }) => state,
      },
    });
    const sourcePlan = mockPlanSource.selectedPlanDetails as ServicePlan;
    const importData = servicePlanToImportData(sourcePlan);
    const mapping = mapNativeServicePlanParticipants({
      sections: sourcePlan.sections,
      importData,
      participantOverlay: { status: "ready", elements: [{
        elementId: "element-1",
        assignees: [{ name: "Clarence Jones", memberStatus: "guest", roleStatus: "not-applicable" }],
      }] },
    });
    const preview = buildServicePlanningPreview({
      importData,
      servicePlanning: { enabled: false, people: [], sectionRules: [], elementRules: [] },
      overlays: [existingOverlay],
      songLibrary: [],
      activeOutlineList: [],
      nativeOverlayCandidates: mapping.overlayCandidates,
      nativeOverlaySummary: mapping.summary,
    });
    expect(preview.overlayPlan[0]).toMatchObject({ action: "update", patch: { name: "Clarence Jones", event: song.name } });
    store.dispatch(setServicePlanningServiceOutline(wrapImport(preview)));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sync All" }));
    await waitFor(() => expect(store.getState().servicePlanningImport.sync.status).toBe("running"));
    expect(mockPushPlanToOutline).toHaveBeenCalledWith(sourcePlan, expect.any(Function), expect.any(Function), expect.any(Function));
    expect(store.getState().servicePlanningImport.sync.mode).toBe("overlays");
    act(() => {
      store.dispatch(setServicePlanningSyncPlanInfo({
        totalSteps: 1,
        syncItems: [{ label: "Clarence Jones", sublabel: song.name, phase: "overlays", status: "pending" }],
      }));
      store.dispatch(setServicePlanningSyncActiveStep({ phase: "overlays", activeLabel: "Clarence Jones", activeSublabel: song.name }));
      store.dispatch(advanceServicePlanningSyncStep({ resolvedStatus: "updated" }));
      store.dispatch(recordServicePlanningSyncResult({ overlaysUpdated: 1 }));
      store.dispatch(completeServicePlanningSync());
    });

    const summaryButton = await screen.findByRole("button", { name: /1 added · 0 already in outline · 1 updated · 0 created · 0 skipped/i });
    expect(summaryButton).toHaveAttribute("aria-expanded", "false");
    await userEvent.setup().click(summaryButton);
    const summary = within(screen.getByLabelText("Most recent sync"));
    expect(summary.getByText("What A Beautiful Name")).toBeInTheDocument();
    expect(summary.getByText(/Added at end — mapped heading "Praise and Worship" wasn't found\./)).toBeInTheDocument();
    expect(summary.getByText(`Clarence Jones — ${song.name}`)).toBeInTheDocument();
  });

  it("does not start overlay sync if the plan becomes stale while Sync All pushes the outline", async () => {
    const song = { _id: "song-1", name: "What A Beautiful Name", type: "song", listId: "song-link" };
    let isSourcePlanCurrent: (() => boolean) | undefined;
    let resolveOutlinePush!: (result: {
      items: typeof song[];
      insertedCount: number;
      skippedTitles: string[];
      unresolvedAttachments: [];
      alreadyPresent: [];
      placementIssues: [];
    }) => void;
    mockPushPlanToOutline.mockImplementation(
      (_plan, isCurrent) => {
        isSourcePlanCurrent = isCurrent;
        return new Promise((resolve) => {
          resolveOutlinePush = resolve;
        });
      },
    );
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-07-30";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-07-30",
      name: "Native service plan",
      date: "2026-07-30",
      sections: [{ id: "section-1", name: "Worship", elements: [{
        id: "element-1",
        type: "song",
        title: { blocks: [{ type: "paragraph", spans: [{ text: song.name }] }] },
        songRef: { kind: "library", songId: song._id, songName: song.name },
      }] }],
    };
    const existingOverlay = { id: "overlay-1", type: "participant", name: "Dobney Keen", event: "Sabbath School Host" };
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: (state = { present: {
          itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
          itemList: { list: [], selectedItemListId: "" },
          overlays: { list: [existingOverlay] },
        } }) => state,
      },
    });
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [],
      overlayPlan: [{ action: "update", elementType: "Sabbath School Host", targetOverlayId: existingOverlay.id, patch: { name: "Clarence Jones", event: "Sabbath School Host" } }],
      outlineCandidates: [],
      lineItems: [],
      teamAssignments: [],
    }) as any));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    const { rerender } = renderWindow(store);

    await userEvent.setup().click(screen.getByRole("button", { name: "Sync All" }));
    await waitFor(() => expect(mockPushPlanToOutline).toHaveBeenCalled());
    expect(isSourcePlanCurrent?.()).toBe(true);

    mockPlanSource.isPlanPreviewStale = true;
    rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );
    expect(isSourcePlanCurrent?.()).toBe(false);

    await act(async () => {
      resolveOutlinePush({
        items: [song],
        insertedCount: 1,
        skippedTitles: [],
        unresolvedAttachments: [],
        alreadyPresent: [],
        placementIssues: [],
      });
      await Promise.resolve();
    });

    expect(store.getState().servicePlanningImport.sync.status).toBe("idle");
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
    // The overlay must live in this floating window's owner host. jsdom does
    // not model stacking contexts, so host ownership is the useful contract.
    const overlayHost = within(
      screen.getByTestId("floating-window-overlay-host"),
    );
    expect(
      await overlayHost.findByRole("option", { name: /Test 2/ }),
    ).toBeInTheDocument();

    await user.click(overlayHost.getByRole("option", { name: /Test 2/ }));
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

  it("shows plan names and dates separately while keeping full accessible labels", async () => {
    const user = userEvent.setup();
    const longName = "Sabbath School & Worship Experience with a Very Long Service Name";
    const selectedPlan = {
      planKey: "service-1@2026-09-26",
      serviceId: "service-1",
      name: longName,
      date: "2026-09-26",
      startsAt: "2026-09-26T10:00:00.000Z",
    };
    mockPlanSource.savedPlans = [selectedPlan];
    mockPlanSource.selectedPlan = selectedPlan;
    mockPlanSource.selectedPlanKey = selectedPlan.planKey;

    const store = configureStore({
      reducer: { servicePlanningImport: servicePlanningImportReducer, allDocs: allDocsReducer },
    });
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    renderWindow(store);

    const trigger = screen.getByRole("button", {
      name: `Select service plan: ${formatControllerServicePlanLabel(selectedPlan, "America/New_York")}`,
    });
    expect(trigger).toHaveClass("min-h-9");
    expect(screen.getByText(longName)).toHaveClass("min-w-0", "truncate");

    await user.click(trigger);
    const picker = screen.getByTestId("service-plan-picker-content");
    expect(picker).toHaveClass("scrollbar-portal");
    const option = screen.getByRole("option", { name: new RegExp(`^${longName} ·`) });
    expect(option).toHaveAttribute("aria-label");
    expect(within(option).getByText(longName)).toHaveClass("truncate");
    expect(within(option).getByText(
      formatControllerServicePlanDateTime(selectedPlan, "America/New_York"),
    )).toHaveClass("shrink-0");
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
        "scrollbar-portal",
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
    const overlayHost = within(
      screen.getByTestId("floating-window-overlay-host"),
    );
    expect(overlayHost.getByText("Upcoming")).toBeInTheDocument();
    expect(overlayHost.getByText("Recent", { selector: "p" })).toBeInTheDocument();
    expect(
      overlayHost.getByRole("option", { name: /^Upcoming 1 ·/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      overlayHost.queryByRole("option", { name: /^Recent 1 ·/ }),
    ).not.toBeInTheDocument();

    await user.type(
      overlayHost.getByRole("combobox", { name: "Search all saved plans" }),
      "Recent 1",
    );
    const extraPlan = await overlayHost.findByRole("option", {
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
    mockPlanSource.selectedPlan = { planKey: "saved-plan", serviceId: "service", name: "May 2, 2026 - 10 AM", date: "2026-05-02" };
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
        name: /^Select service plan: May 2, 2026 - 10 AM/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Updated .*2026/i)).toBeInTheDocument();
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

  it("uses native Sync Outline for Sync All when overlays have no executable changes", async () => {
    mockPlanSource.selectedPlanDetails = {
      planKey: "saved-plan", name: "Saved service", date: "2026-10-27", sections: [{ id: "worship", name: "Worship", elements: [{
        id: "song", type: "song", title: { blocks: [] },
        songRef: { kind: "library", songId: "song-1", songName: "Welcome Song" },
      }] }],
    };
    mockPushPlanToOutline.mockResolvedValue({ items: [], insertedCount: 0, skippedTitles: [], unresolvedAttachments: [], alreadyPresent: [], placementFallbacks: [] });
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

    await waitFor(() => expect(mockPushPlanToOutline).toHaveBeenCalled());
    expect(store.getState().servicePlanningImport.sync.status).toBe("idle");
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

  it("disables overlay sync only while participant data is refreshing or unsafe", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
      },
    });
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [],
      overlayPlan: [{ action: "create", elementType: "Welcome" }],
      outlineCandidates: [],
      lineItems: [],
      teamAssignments: [],
    }) as any));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    const { rerender } = renderWindow(store);
    const renderAgain = () => rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    const syncButton = screen.getByRole("button", { name: "Sync overlays" });
    expect(syncButton).toBeEnabled();

    mockPlanSource.isRefreshingParticipants = true;
    renderAgain();
    expect(syncButton).toBeDisabled();

    mockPlanSource.isRefreshingParticipants = false;
    mockPlanSource.isParticipantOverlayUnsafe = true;
    renderAgain();
    expect(syncButton).toBeDisabled();

    mockPlanSource.isParticipantOverlayUnsafe = false;
    renderAgain();
    expect(syncButton).toBeEnabled();
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

  it("disables overlay sync while the saved plan preview is stale", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: () => ({
          present: {
            itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
            itemList: { isLoading: false, list: [] },
          },
        }),
      },
    });
    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [{ action: "create" }],
        outlineCandidates: [{
          outlineItemType: "song",
          outlineAlreadyPresent: false,
          matchedLibraryItem: { _id: "song-1", type: "song" },
        }],
        lineItems: [],
        teamAssignments: [],
      }) as any),
    );
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-05-02";
    mockPlanSource.isPlanPreviewStale = false;

    mockPlanSource.selectedPlanDetails = {
      planKey: mockPlanSource.selectedPlanKey, name: "Saved service", date: "2026-05-02",
      sections: [{ id: "worship", name: "Worship", elements: [{
        id: "song", type: "song", title: { blocks: [] },
        songRef: { kind: "library", songId: "song-1", songName: "Song" },
      }] }],
    };
    const view = renderWindow(store);
    expect(screen.getByRole("button", { name: "Sync overlays" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync outline" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeEnabled();

    mockPlanSource.isPlanPreviewStale = true;
    view.rerender(
      <MemoryRouter>
        <Provider store={store}>
          <ServicePlanningSyncFloatingWindow />
        </Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Sync overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync outline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    expect(
      screen.getByText(/refresh before syncing/i),
    ).toBeInTheDocument();
  });

  it("keeps outline sync available while native overlay mappings are unverified", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: () => ({
          present: {
            itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
            itemList: { isLoading: false, list: [] },
          },
        }),
      },
    });
    mockPlanSource.selectedPlanKey = "service-1@2026-05-02";
    mockPlanSource.selectedPlanDetails = {
      planKey: mockPlanSource.selectedPlanKey,
      name: "Saved service",
      date: "2026-05-02",
      sections: [{ id: "worship", name: "Worship", elements: [{
        id: "song",
        type: "song",
        title: { blocks: [] },
        songRef: { kind: "library", songId: "song-1", songName: "Song" },
      }] }],
    };
    mockPlanSource.isNativeOverlayMappingReady = false;
    mockPlanSource.nativeOverlayMappingFresh = false;
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      nativeOverlayMappingKey: "unverified",
      nativeOverlaySummary: { selectedItemCount: 1 },
      overlayCandidates: [],
      overlayPlan: [{ action: "create", elementType: "Sermon" }],
      outlineCandidates: [],
      lineItems: [],
      teamAssignments: [],
    }) as any));
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));

    renderWindow(store);

    expect(screen.getByRole("button", { name: "Sync overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync outline" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeEnabled();
    expect(screen.getByText(/settings are loading/i)).toBeInTheDocument();
  });

  it("keeps saved-plan sync disabled and retries the selected plan when no preview could be built", async () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        allDocs: allDocsReducer,
        undoable: () => ({
          present: {
            itemLists: { selectedList: { _id: "outline-1", name: "Sunday" } },
            itemList: { isLoading: false, list: [] },
          },
        }),
      },
    });
    store.dispatch(
      beginServicePlanningPlanSelection({
        planKey: "service-1@2026-05-02",
        preservePreview: false,
      }),
    );
    expect(store.getState().servicePlanningImport.servicePlanKey).toBe(
      "service-1@2026-05-02",
    );
    expect(store.getState().servicePlanningImport.isPlanPreviewStale).toBe(true);
    store.dispatch(setServicePlanningFloatingWindowDismissed(false));
    mockPlanSource.isPlanSourced = true;
    mockPlanSource.selectedPlanKey = "service-1@2026-05-02";
    mockPlanSource.selectedPlanDetails = {
      planKey: "service-1@2026-05-02",
      name: "Sabbath Service",
      date: "2026-05-02",
      sections: [{
        id: "section-1",
        name: "Worship",
        elements: [{
          id: "element-1",
          type: "song",
          title: { blocks: [{ type: "paragraph", spans: [{ text: "Opening Song" }] }] },
          songRef: { kind: "library", songId: "song-1", songName: "Opening Song" },
        }],
      }],
    };
    mockPlanSource.isPlanPreviewStale =
      store.getState().servicePlanningImport.isPlanPreviewStale;
    mockPlanSource.refresh.mockResolvedValue("failed");

    renderWindow(store);

    expect(store.getState().servicePlanningImport.preview).toBeNull();
    expect(screen.getByRole("button", { name: "Sync overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync outline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(screen.getByText(/plan and its assignments could not be fully loaded/i)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));

    expect(mockPlanSource.refresh).toHaveBeenCalledTimes(1);
    expect(mockLoadPreview).not.toHaveBeenCalled();
  });

  it.each([
    ["updated", "Plan refreshed", "success"],
    ["unchanged", "Plan is up to date", "success"],
    [
      "failed",
      "Plan refresh failed. Check your connection and try again.",
      "error",
    ],
  ] as const)(
    "shows the %s result from a saved-plan refresh",
    async (status, message, kind) => {
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
          lineItems: [],
          teamAssignments: [],
        }) as any),
      );
      store.dispatch(setServicePlanningFloatingWindowDismissed(false));
      mockPlanSource.isPlanSourced = true;
      mockPlanSource.selectedPlanKey = "service-1@2026-05-02";
      mockPlanSource.refresh.mockResolvedValue(status);
      const showToast = jest.fn();
      mockedUseToast.mockReturnValue({
        showToast,
        hideToast: jest.fn(),
        toasts: [],
      } as any);

      renderWindow(store);

      await userEvent.setup().click(
        screen.getByRole("button", { name: "Refresh" }),
      );

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(message, kind));
    },
  );
});
