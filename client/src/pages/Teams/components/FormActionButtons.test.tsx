import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import FormActionButtons from "./FormActionButtons";

const EditorActionsHarness = () => {
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState("Persisted");
  const [lastSaved, setLastSaved] = useState("Persisted");

  return (
    <>
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        isSaving={isSaving}
        onSave={() => {
          setIsSaving(true);
          setLastSaved(draft);
          setDirty(false);
          setIsSaving(false);
        }}
        onCancel={() => {
          setDraft(lastSaved);
          setDirty(false);
        }}
        hasPendingChanges={dirty}
        disabled={isSaving}
      />
      <p>{draft}</p>
      <button onClick={() => { setDraft((current) => `${current}!`); setDirty(true); }}>Edit draft</button>
    </>
  );
};

describe("FormActionButtons", () => {
  it("shows Close and disabled Saved for a clean persisted editor", () => {
    const { rerender } = render(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        hasPendingChanges={false}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    rerender(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        hasPendingChanges
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save member" })).toBeEnabled();
  });

  it("uses create labels and communicates an active save", () => {
    const { rerender } = render(
      <FormActionButtons
        entityLabel="member"
        isCreate
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Create member" })).toBeInTheDocument();

    rerender(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        isSaving
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");

    rerender(
      <FormActionButtons
        entityLabel="member"
        isCreate
        isSaving
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Creating…" })).toHaveAttribute("aria-busy", "true");
  });

  it("shows Saved with a decorative check for persisted state", () => {
    render(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        hasPendingChanges={false}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const savedButton = screen.getByRole("button", { name: "Saved" });
    expect(savedButton).toBeInTheDocument();
    expect(savedButton).toBeDisabled();
    expect(screen.getByTestId("form-save-success-icon")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("form-save-success-icon")).toHaveClass("text-emerald-300");
  });

  it("follows clean → dirty → saved and clean → dirty → cancel transitions", () => {
    render(<EditorActionsHarness />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save member" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save member" }));
    expect(screen.getByText("Persisted!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Persisted!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  });
});
