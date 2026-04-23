import React from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import servicePlanningImportReducer, {
  setServicePlanningImportPreview,
  startServicePlanningSync,
} from "../../store/servicePlanningImportSlice";
import { useServicePlanningSyncRunner } from "./useServicePlanningSyncRunner";

const mockShowToast = jest.fn();
const mockRemoveToast = jest.fn();
const mockPlanOutlineSyncSteps = jest.fn();
const mockPlanOverlaySyncSteps = jest.fn();
const mockExecuteOutlineSyncStep = jest.fn();
const mockExecuteOverlaySyncStep = jest.fn();

jest.mock("../../context/toastContext", () => ({
  useToast: () => ({
    showToast: mockShowToast,
    removeToast: mockRemoveToast,
  }),
}));

jest.mock("../../hooks/useServicePlanningImport", () => ({
  useServicePlanningImport: () => ({
    planOutlineSyncSteps: mockPlanOutlineSyncSteps,
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

    store.dispatch(setServicePlanningImportPreview(previewFixture as any));

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

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "info",
        position: "top-center",
        persist: true,
        showCloseButton: false,
      }),
    );

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
    expect(state.preview).toBeNull();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
