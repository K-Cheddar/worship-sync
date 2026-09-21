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
    reducer: { displayOutputs: displayOutputsReducer },
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
    expect(screen.getAllByText("Last send path")).toHaveLength(2);
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });
});
