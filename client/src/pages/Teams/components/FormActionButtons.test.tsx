import { render, screen } from "@testing-library/react";
import FormActionButtons from "./FormActionButtons";

describe("FormActionButtons", () => {
  it("shows Close when the form has no pending changes", () => {
    render(
      <FormActionButtons
        saveLabel="Save member"
        onSave={() => undefined}
        onCancel={() => undefined}
        hasPendingChanges={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows Cancel when closing would discard changes", () => {
    render(
      <FormActionButtons
        saveLabel="Save member"
        onSave={() => undefined}
        onCancel={() => undefined}
        hasPendingChanges
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
