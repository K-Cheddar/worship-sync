import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import FormActionButtons from "./FormActionButtons";
import useFormSaveFeedback, { SAVE_SUCCESS_DISPLAY_MS } from "./useFormSaveFeedback";

const SaveFeedbackHarness = () => {
  const [editorKey, setEditorKey] = useState("member-a");
  const [isCreate, setIsCreate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const feedback = useFormSaveFeedback(editorKey, dirty);

  return (
    <>
      <FormActionButtons
        entityLabel="member"
        isCreate={isCreate}
        isSaving={isSaving}
        successMode={feedback.successMode}
        onSave={() => {
          setIsSaving(false);
          feedback.recordSuccess(isCreate ? "member-new" : editorKey, isCreate ? "create" : "update");
          if (isCreate) {
            setEditorKey("member-new");
            setIsCreate(false);
          }
        }}
        onCancel={() => undefined}
        hasPendingChanges={dirty}
        disabled={isSaving}
      />
      <button onClick={() => setIsCreate((value) => !value)}>Toggle mode</button>
      <button onClick={() => setIsSaving(true)}>Start saving</button>
      <button onClick={() => setIsSaving(false)}>Stop saving</button>
      <button onClick={() => setDirty((value) => !value)}>Toggle dirty</button>
      <button onClick={() => { setEditorKey("member-b"); setIsCreate(false); }}>Switch editor</button>
    </>
  );
};

describe("FormActionButtons save feedback", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses create and update labels, and replaces them while saving", () => {
    const { rerender } = render(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Save member" })).toBeInTheDocument();

    rerender(
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

  it("shows the correct success label and decorative check", () => {
    const { rerender } = render(
      <FormActionButtons
        entityLabel="member"
        isCreate={false}
        successMode="update"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const savedButton = screen.getByRole("button", { name: "Saved" });
    expect(savedButton).toBeInTheDocument();
    expect(screen.getByTestId("form-save-success-icon")).toHaveAttribute("aria-hidden", "true");

    rerender(
      <FormActionButtons
        entityLabel="member"
        isCreate
        successMode="create"
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Created" })).toBeInTheDocument();
  });

  it("clears success as soon as the draft changes and expires it after the shared timeout", () => {
    jest.useFakeTimers();
    render(<SaveFeedbackHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Save member" }));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle dirty" }));
    expect(screen.getByRole("button", { name: "Save member" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle dirty" }));
    expect(screen.getByRole("button", { name: "Save member" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save member" }));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(SAVE_SUCCESS_DISPLAY_MS));
    expect(screen.getByRole("button", { name: "Save member" })).toBeInTheDocument();
  });

  it("keeps a create confirmation through the persisted editor transition and isolates other editors", () => {
    render(<SaveFeedbackHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle mode" }));
    expect(screen.getByRole("button", { name: "Create member" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create member" }));
    expect(screen.getByRole("button", { name: "Created" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch editor" }));
    expect(screen.getByRole("button", { name: "Save member" })).toBeInTheDocument();
  });

  it("prefers pending feedback over a previous success state", () => {
    render(<SaveFeedbackHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Save member" }));
    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start saving" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
  });
});
