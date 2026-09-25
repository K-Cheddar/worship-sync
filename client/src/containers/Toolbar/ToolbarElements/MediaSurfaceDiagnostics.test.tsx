import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import MediaSurfaceDiagnostics from "./MediaSurfaceDiagnostics";
import displayOutputsReducer from "../../../store/displayOutputsSlice";
import type { DisplayOutput } from "../../../utils/displayOutputs";

const renderDiagnostics = () => {
  const list: DisplayOutput[] = [
    { id: "projector", type: "projector", name: "Main Projector", order: 0, enabled: true },
    { id: "lobby", type: "projector", name: "Lobby", order: 1, enabled: true },
  ];
  const store = configureStore({
    reducer: {
      displayOutputs: displayOutputsReducer,
      undoable: (
        state = {
          present: {
            itemLists: {
              selectedList: null,
              scope: "presentation",
              currentLists: [],
              selectedIdByScope: {},
            },
          },
        },
      ) => state,
    },
    preloadedState: {
      displayOutputs: {
        isLoaded: true,
        list,
      },
    },
  });
  return render(
    <Provider store={store}>
      <MediaSurfaceDiagnostics />
    </Provider>,
  );
};

const publish = (outputId: string, readyCount: number, candidateCount: number) => {
  window.dispatchEvent(
    new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        outputId,
        windowRole: "projector",
        candidateCount,
        surfaceCount: candidateCount,
        readyCount,
        preparingCount: candidateCount - readyCount,
        playingCount: 0,
        resettingCount: 0,
        errorCount: 0,
        evictions: [],
        surfaces: [],
      },
    }),
  );
};

describe("MediaSurfaceDiagnostics", () => {
  it("renders readiness counts and keeps multiple displays separate", () => {
    renderDiagnostics();
    act(() => {
      publish("projector", 6, 8);
      publish("lobby", 2, 4);
    });

    expect(screen.getByTestId("media-surface-diagnostics-trigger")).toHaveTextContent(
      "Videos",
    );
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));

    expect(screen.getByText("Main Projector")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(screen.getAllByText("Distinct videos")).toHaveLength(2);
    expect(screen.getAllByText("Selected surfaces")).toHaveLength(2);
    expect(screen.getAllByText("Advanced diagnostics")).toHaveLength(2);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the operator view compact, exposes failures, and discloses detailed records only on demand", () => {
    Object.defineProperty(window, "electronAPI", { configurable: true, value: undefined });
    renderDiagnostics();
    act(() => window.dispatchEvent(new CustomEvent("worship-sync-media-surface-diagnostics", {
      detail: {
        diagnosticId: "device-session-projector",
        outputId: "projector",
        windowRole: "projector",
        preparationSource: "local-pouchdb",
        candidateCount: 1,
        discoveredCount: 2,
        surfaceCount: 1,
        readyCount: 0,
        preparingCount: 0,
        playingCount: 0,
        resettingCount: 0,
        errorCount: 1,
        evictions: [],
        candidateDetails: [{ mediaKey: "remote:secret", resolvedSource: "https://cdn.example.test/video.mp4?token=private" }],
        surfaces: [{ mediaKey: "remote:secret", source: "https://cdn.example.test/video.mp4?token=private", phase: "error", sourceKind: "remote", error: "decode failed" }],
        discovery: { renderer: "projector", itemCount: 2, items: [], uniqueVideoInventoryCount: 2, finitePlayableSourceCount: 1, pendingHlsCacheCount: 0, intentionallyExcludedVideoCount: 0, outlineLoadState: "error", outlineLoadError: "One item is missing" },
      },
    })));
    fireEvent.click(screen.getByTestId("media-surface-diagnostics-trigger"));

    expect(screen.getByLabelText("Computer health")).toHaveTextContent("Unavailable — Electron only");
    expect(screen.getByRole("alert")).toHaveTextContent("decode failed");
    expect(screen.getByRole("button", { name: "Retry preparation" })).toBeInTheDocument();
    expect(screen.getByText("Candidate details (1)")).not.toBeVisible();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });
});
