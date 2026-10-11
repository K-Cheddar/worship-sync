import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import GeneratedCreditsFloatingWindow from "./GeneratedCreditsFloatingWindow";
import {
  completeGeneratedCreditItem,
  failGeneratedCreditItem,
  failGeneratedCredits,
  generatedCreditsSlice,
  startGeneratedCredits,
} from "../../store/generatedCreditsSlice";
import { FloatingWindowZIndexProvider } from "../../components/FloatingWindow/FloatingWindowZIndexContext";

describe("GeneratedCreditsFloatingWindow", () => {
  it("shows updated, unchanged, unmatched, and failed results", () => {
    const store = configureStore({
      reducer: { generatedCredits: generatedCreditsSlice.reducer },
    });
    store.dispatch(startGeneratedCredits({
      generatedAt: "2026-10-11T12:00:00.000Z",
      items: [
        { creditId: "updated", creditHeading: "Welcome", sourceLabel: "Overlays", previousText: "Old", nextText: "New" },
        { creditId: "unchanged", creditHeading: "Reading", sourceLabel: "Overlays", previousText: "Reader", nextText: "Reader" },
        { creditId: "unmatched", creditHeading: "Stream Audio", sourceLabel: "Media schedule", previousText: "", nextText: "Sam", status: "unmatched" },
        { creditId: "failed", creditHeading: "Invocation", sourceLabel: "Overlays", previousText: "Old", nextText: "New" },
      ],
    }));
    store.dispatch(completeGeneratedCreditItem({ creditId: "updated", status: "updated" }));
    store.dispatch(completeGeneratedCreditItem({ creditId: "unchanged", status: "unchanged" }));
    store.dispatch(failGeneratedCreditItem({ creditId: "failed", error: "Could not save this credit." }));
    store.dispatch(failGeneratedCredits("Some credits could not be saved."));

    render(
      <Provider store={store}>
        <FloatingWindowZIndexProvider>
          <GeneratedCreditsFloatingWindow />
        </FloatingWindowZIndexProvider>
      </Provider>,
    );

    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByText("Unchanged")).toBeInTheDocument();
    expect(screen.getByText("Unmatched")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Could not save this credit.")).toBeInTheDocument();
    expect(screen.getByText("No change. This credit already matches the generated text.")).toBeInTheDocument();
  });
});
