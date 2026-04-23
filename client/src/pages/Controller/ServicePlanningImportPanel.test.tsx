import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ServicePlanningImportPanel from "./ServicePlanningImportPanel";
import servicePlanningImportReducer, {
  setServicePlanningImportPreview,
} from "../../store/servicePlanningImportSlice";

const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockLoadPreview = jest.fn();

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
      setServicePlanningImportPreview({
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
          },
        ],
      } as any),
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
});
