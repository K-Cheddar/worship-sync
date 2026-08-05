import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ServicePlanImportReviewWindow from "./ServicePlanImportReviewWindow";
import type { ServicePlanImportSummary } from "./servicePlanImportSummary";

const summary: ServicePlanImportSummary = {
  changes: [
    {
      id: "welcome",
      sectionId: "worship",
      kind: "updated",
      itemName: "Welcome",
      sectionName: "Worship",
      fields: [],
    },
    {
      id: "message",
      sectionId: "worship",
      kind: "updated",
      itemName: "Message",
      sectionName: "Worship",
      fields: [],
    },
    {
      id: "prayer",
      sectionId: "response",
      kind: "added",
      itemName: "Prayer",
      sectionName: "Response",
      fields: [],
    },
  ],
  added: 1,
  removed: 0,
  updated: 2,
};

describe("ServicePlanImportReviewWindow", () => {
  it("selects all changes by default and can omit an individual element", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    render(
      <ServicePlanImportReviewWindow
        summary={summary}
        onApply={onApply}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Select all updates" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Worship" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Update Welcome" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Update Welcome" }));

    expect(screen.getByRole("checkbox", { name: "Select all updates" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Worship" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Apply 2 changes" }));

    expect(onApply).toHaveBeenCalledWith(["updated:message", "added:prayer"]);
  });
});
