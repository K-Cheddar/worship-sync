import { fireEvent, render, screen } from "@testing-library/react";
import {
  PresentationControllerModeProvider,
  usePresentationControllerMode,
} from "./presentationControllerMode";

const Harness = () => {
  const { mode, setMode } = usePresentationControllerMode();
  return (
    <>
      <span>{mode}</span>
      <button type="button" onClick={() => setMode("edit")}>Edit</button>
    </>
  );
};

describe("presentation controller workspace mode", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to Present and stores a local Edit preference", () => {
    render(
      <PresentationControllerModeProvider>
        <Harness />
      </PresentationControllerModeProvider>,
    );

    expect(screen.getByText("present")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("edit")).toBeInTheDocument();
    expect(localStorage.getItem("worshipsync_presentation_controller_mode")).toBe("edit");
  });

  it("rehydrates the saved mode on the same device", () => {
    localStorage.setItem("worshipsync_presentation_controller_mode", "edit");
    render(
      <PresentationControllerModeProvider>
        <Harness />
      </PresentationControllerModeProvider>,
    );

    expect(screen.getByText("edit")).toBeInTheDocument();
  });
});
