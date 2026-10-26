import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServicePlanningImportPanel from "./ServicePlanningImportPanel";
import overlaysReducer, { initiateOverlayList, updateOverlayInList } from "../../store/overlaysSlice";
import servicePlanningImportReducer, {
  beginServicePlanningPlanSelection,
  setServicePlanningPlanOutline,
  setServicePlanningServiceOutline,
} from "../../store/servicePlanningImportSlice";

const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockLoadPreview = jest.fn();

const wrapImport = (preview: any) => ({
  source: "servicePlanning" as const,
  loadedAt: "2026-05-03T12:00:00.000Z",
  sourceUrl: "https://example.com/plan",
  planLabel: "May 2, 2026 - 10 AM",
  preview,
});

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: () => ({
    loadPreview: mockLoadPreview,
    isServicePlanningEnabled: true,
    servicePlanningAvailabilityMessage: null,
  }),
  overlayPlanHasExecutableChange: (plan: Array<{ action: string }>) =>
    Array.isArray(plan) && plan.some((item) => item.action !== "skip"),
}));

describe("ServicePlanningImportPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts a staged sync and disables sync buttons while it is running", async () => {
    const user = userEvent.setup();
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [
          {
            sectionName: "Welcome",
            elementType: "Welcome",
            title: "Welcome Song",
            ledBy: "Praise Team",
            personIndex: 0,
            rawNameToken: "Praise Team",
            action: "update",
            targetOverlayId: "overlay-1",
            patch: { event: "Welcome Song" },
          },
        ],
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
            overlayReady: true,
            outlineAlreadyPresent: false,
          },
        ],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
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
      }) as any),
    );

    render(
      <Provider store={store}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Sync All" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("both");
    // The pressed "Sync All" button becomes a "Stop syncing" button; the others
    // stay disabled while the run is in progress.
    expect(
      screen.queryByRole("button", { name: "Sync All" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop syncing" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync Overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeDisabled();
    expect(screen.queryByText(/syncing outline/i)).not.toBeInTheDocument();
  });

  it("blocks every sync action when a saved-plan preview is stale", async () => {
    const user = userEvent.setup();
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });
    const planKey = "service-1@2026-05-02";
    store.dispatch(setServicePlanningPlanOutline({
      outline: wrapImport({
        overlayCandidates: [],
        overlayPlan: [
          {
            sectionName: "Welcome",
            elementType: "Welcome",
            title: "Welcome Song",
            action: "update",
            patch: { event: "Welcome Song" },
          },
        ],
        outlineCandidates: [
          {
            outlineItemType: "song",
            outlineAlreadyPresent: false,
            matchedLibraryItem: { _id: "song-1", name: "Welcome Song", type: "song" },
            title: "Welcome Song",
            cleanedTitle: "Welcome Song",
          },
        ],
      }) as any,
      planKey,
    }));
    store.dispatch(
      beginServicePlanningPlanSelection({
        planKey,
        preservePreview: true,
      }),
    );

    render(
      <Provider store={store}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /open service plan and refresh before syncing/i,
    );
    expect(screen.getByRole("button", { name: "Sync Overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sync Outline" }));
    expect(store.getState().servicePlanningImport.sync.status).toBe("idle");
  });

  it("shows already-present outline items and disables sync when nothing would change", () => {
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    store.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [
          {
            sectionName: "Welcome",
            elementType: "Welcome",
            title: "Welcome Song",
            ledBy: "Praise Team",
            personIndex: 0,
            rawNameToken: "Praise Team",
            action: "skip",
            targetOverlayId: "overlay-1",
            patch: { event: "Welcome Song" },
            reason: "Overlay is already up to date.",
          },
        ],
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
            overlayReady: true,
            outlineAlreadyPresent: true,
          },
        ],
        lineItems: [
          {
            sectionName: "Welcome",
            headingName: "Welcome",
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
            outlineAlreadyPresent: true,
          },
          {
            sectionName: "Welcome",
            headingName: "Welcome",
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

    render(
      <Provider store={store}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText("1 already present")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeDisabled();
  });

  it("shows plan metadata and allows outline sync for matched songs without a section heading", async () => {
    const user = userEvent.setup();
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
            sectionName: "Special Music",
            headingName: null,
            elementType: "Special Music",
            title: "Goodness of God",
            outlineItemType: "song",
            cleanedTitle: "Goodness of God",
            matchedLibraryItem: {
              _id: "song-2",
              name: "Goodness of God",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        lineItems: [
          {
            sectionName: "Special Music",
            headingName: null,
            elementType: "Special Music",
            title: "Goodness of God",
            ledBy: "Worship Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: {
              _id: "song-2",
              name: "Goodness of God",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
      }) as any),
    );

    render(
      <Provider store={store}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText("May 2, 2026 - 10 AM")).toBeInTheDocument();
    expect(screen.getByText(/Imported .*2026/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Sync Outline" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("outline");
  });

  it("normalizes Sync All to outline when overlays have no executable changes", async () => {
    const user = userEvent.setup();
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
            sectionName: "Special Music",
            headingName: null,
            elementType: "Special Music",
            title: "Goodness of God",
            outlineItemType: "song",
            cleanedTitle: "Goodness of God",
            matchedLibraryItem: {
              _id: "song-2",
              name: "Goodness of God",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
        lineItems: [
          {
            sectionName: "Special Music",
            headingName: null,
            elementType: "Special Music",
            title: "Goodness of God",
            ledBy: "Worship Team",
            selectedForOutline: true,
            outlineItemType: "song",
            matchedLibraryItem: {
              _id: "song-2",
              name: "Goodness of God",
              type: "song",
            },
            parsedRef: null,
            overlayReady: false,
            outlineAlreadyPresent: false,
          },
        ],
      }) as any),
    );

    render(
      <Provider store={store}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    await user.click(screen.getByRole("button", { name: "Sync All" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("outline");
  });

  it("renders the open service plan button when a service outline preview is loaded", () => {
    const emptyStore = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    const { rerender } = render(
      <Provider store={emptyStore}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    expect(
      screen.queryByRole("button", { name: "Open Service Plan" }),
    ).not.toBeInTheDocument();

    const loadedStore = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
      },
    });

    loadedStore.dispatch(
      setServicePlanningServiceOutline(wrapImport({
        overlayCandidates: [],
        overlayPlan: [],
        outlineCandidates: [],
        lineItems: [],
      }) as any),
    );

    rerender(
      <Provider store={loadedStore}>
        <MemoryRouter>
          <ServicePlanningImportPanel />
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByRole("button", { name: "Open Service Plan" })).toBeEnabled();
  });

  it("updates the expanded native overlay preview against current slots after synchronization", async () => {
    const user = userEvent.setup();
    const store = configureStore({
      reducer: {
        servicePlanningImport: servicePlanningImportReducer,
        undoable: (state: { present: { overlays: ReturnType<typeof overlaysReducer> } } | undefined, action: Parameters<typeof overlaysReducer>[1]) => ({
          present: { overlays: overlaysReducer(state?.present.overlays, action) },
        }),
      },
    });
    store.dispatch(initiateOverlayList([{ id: "slot", name: "Previous", event: "Offertory" }]));
    store.dispatch(setServicePlanningServiceOutline(wrapImport({
      overlayCandidates: [], outlineCandidates: [], lineItems: [],
      nativeOverlaySummary: { status: "ready", selectedItemCount: 1, assignedParticipantCount: 1 },
      overlayPlan: [{ sourceKind: "native", action: "update", sectionName: "Service", sourceRowIndex: 0, elementType: "Offertory", title: "Offertory", ledBy: "", personIndex: 0, rawNameToken: "Gorphine Tomlinson", targetOverlayId: "slot", patch: { name: "Gorphine Tomlinson", title: "", event: "Offertory" } }],
    })));
    render(<Provider store={store}><MemoryRouter><ServicePlanningImportPanel /></MemoryRouter></Provider>);
    await user.click(screen.getByRole("button", { name: "Expand overlay sync summary" }));
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("1 update")).toBeInTheDocument();
    act(() => { store.dispatch(updateOverlayInList({ id: "slot", name: "Gorphine Tomlinson", title: "" })); });
    expect(screen.getByText("1 found")).toBeInTheDocument();
    expect(screen.getByText("Found existing")).toBeInTheDocument();
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
  });

});
