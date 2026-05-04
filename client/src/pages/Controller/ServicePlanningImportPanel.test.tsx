import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServicePlanningImportPanel from "./ServicePlanningImportPanel";
import servicePlanningImportReducer, {
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

    await user.click(screen.getByRole("button", { name: "Sync Both" }));

    expect(store.getState().servicePlanningImport.sync.status).toBe("running");
    expect(store.getState().servicePlanningImport.sync.mode).toBe("both");
    expect(screen.getByRole("button", { name: "Sync Both" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeDisabled();
    expect(screen.queryByText(/syncing outline/i)).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Sync Both" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Overlays" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Outline" })).toBeDisabled();
  });

  it("enables the open service plan button when a service outline is loaded", () => {
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

    expect(screen.getByRole("button", { name: "Open Service Plan" })).toBeDisabled();

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
});
