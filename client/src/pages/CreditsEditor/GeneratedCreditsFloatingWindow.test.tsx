import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import GeneratedCreditsFloatingWindow from "./GeneratedCreditsFloatingWindow";
import {
  completeGeneratedCreditItem,
  detachGeneratedCreditsOperation,
  failGeneratedCreditItem,
  failGeneratedCredits,
  generatedCreditsSlice,
  startGeneratedCredits,
} from "../../store/generatedCreditsSlice";
import { FloatingWindowZIndexProvider } from "../../components/FloatingWindow/FloatingWindowZIndexContext";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";

const operationId = "generation-1";
const owner = {
  churchId: "church-1",
  databaseKey: "",
  databaseScopeId: "",
  databaseInstanceId: 1,
  outlineId: "outline-1",
};

describe("GeneratedCreditsFloatingWindow", () => {
  it("shows updated, unchanged, unmatched, skipped, and failed results", () => {
    const store = configureStore({
      reducer: {
        generatedCredits: generatedCreditsSlice.reducer,
        undoable: (state = { present: { itemLists: { selectedList: { _id: "outline-1" } } } }) => state,
      },
    });
    store.dispatch(startGeneratedCredits({
      operationId,
      owner,
      generatedAt: "2026-10-11T12:00:00.000Z",
      items: [
        { creditId: "updated", creditHeading: "Welcome", sourceLabel: "Overlays", previousText: "Old", nextText: "New" },
        { creditId: "unchanged", creditHeading: "Reading", sourceLabel: "Overlays", previousText: "Reader", nextText: "Reader" },
        { creditId: "created", creditHeading: "Stage Manager", sourceLabel: "Media schedule", previousText: "", nextText: "Jesse Green", status: "creating" },
        { creditId: "unmatched", creditHeading: "Stream Audio", sourceLabel: "Media schedule", previousText: "", nextText: "Sam", status: "unmatched" },
        { creditId: "missing-overlay", creditHeading: "Welcome", sourceLabel: "Participant overlays", previousText: "Existing host", nextText: "", status: "unmatched" },
        { creditId: "skipped", creditHeading: "Band", sourceLabel: "Media schedule", previousText: "Manual edit", nextText: "Manual edit", status: "skipped", reason: "The media schedule couldn't be loaded. Credits based on that schedule were left unchanged. Check it in Teams, then generate again." },
        { creditId: "failed", creditHeading: "Invocation", sourceLabel: "Overlays", previousText: "Old", nextText: "New" },
      ],
    }));
    store.dispatch(completeGeneratedCreditItem({ operationId, creditId: "updated", status: "updated" }));
    store.dispatch(completeGeneratedCreditItem({ operationId, creditId: "unchanged", status: "unchanged" }));
    store.dispatch(completeGeneratedCreditItem({ operationId, creditId: "created", status: "created" }));
    store.dispatch(failGeneratedCreditItem({ operationId, creditId: "failed", error: "Could not save this credit. Generate again to retry." }));
    store.dispatch(failGeneratedCredits({ operationId, error: "Some credits could not be saved." }));

    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <ControllerInfoContext.Provider value={{ db: {} } as any}>
            <FloatingWindowZIndexProvider>
              <GeneratedCreditsFloatingWindow />
            </FloatingWindowZIndexProvider>
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Stage Manager")).toBeInTheDocument();
    expect(screen.getByText("Jesse Green")).toBeInTheDocument();
    expect(screen.getAllByText("Media schedule")).toHaveLength(3);
    expect(screen.getByText("Unchanged")).toBeInTheDocument();
    expect(screen.getAllByText("Unmatched")).toHaveLength(2);
    expect(screen.getByText("Skipped")).toBeInTheDocument();
    expect(screen.getByText("The media schedule couldn't be loaded. Credits based on that schedule were left unchanged. Check it in Teams, then generate again.")).toBeInTheDocument();
    expect(screen.getByText("No participant name was available. Existing credit text was left unchanged.")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Could not save this credit. Generate again to retry.")).toBeInTheDocument();
    expect(screen.getByText("No change. This credit already matches the generated text.")).toBeInTheDocument();
  });

  it("labels a report paused after its owning service changes", () => {
    const store = configureStore({
      reducer: {
        generatedCredits: generatedCreditsSlice.reducer,
        undoable: (state = { present: { itemLists: { selectedList: { _id: "outline-1" } } } }) => state,
      },
    });
    store.dispatch(startGeneratedCredits({
      operationId,
      owner,
      generatedAt: "2026-10-11T12:00:00.000Z",
      items: [],
    }));
    store.dispatch(detachGeneratedCreditsOperation({ operationId }));

    render(
      <Provider store={store}>
        <GlobalInfoContext.Provider value={{ churchId: "church-1" } as any}>
          <ControllerInfoContext.Provider value={{ db: {} } as any}>
            <FloatingWindowZIndexProvider>
              <GeneratedCreditsFloatingWindow />
            </FloatingWindowZIndexProvider>
          </ControllerInfoContext.Provider>
        </GlobalInfoContext.Provider>
      </Provider>,
    );

    expect(screen.getByText(/\(Paused\)/)).toBeInTheDocument();
    expect(screen.getByText(/Progress paused after leaving this service/)).toBeInTheDocument();
  });
});
