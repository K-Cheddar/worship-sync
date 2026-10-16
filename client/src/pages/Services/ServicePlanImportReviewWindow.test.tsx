import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatingWindowZIndexProvider } from "../../components/FloatingWindow/FloatingWindowZIndexContext";
import type { ServicePlanImportSummary } from "./servicePlanImportSummary";
import ServicePlanImportReviewWindow from "./ServicePlanImportReviewWindow";

describe("ServicePlanImportReviewWindow", () => {
  it("selects all changes by default and can omit an individual element", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: [
        { id: "welcome", sectionId: "worship", kind: "updated", itemName: "Welcome", sectionName: "Worship", fields: [] },
        { id: "message", sectionId: "worship", kind: "updated", itemName: "Message", sectionName: "Worship", fields: [] },
        { id: "prayer", sectionId: "response", kind: "added", itemName: "Prayer", sectionName: "Response", fields: [] },
      ],
      added: 1,
      removed: 0,
      updated: 2,
      moved: 0,
    };

    render(
      <FloatingWindowZIndexProvider>
        <ServicePlanImportReviewWindow summary={summary} onApply={onApply} onClose={jest.fn()} />
      </FloatingWindowZIndexProvider>,
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

  it("shows a section move as a selectable change with its original and destination sections", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: [{
        id: "sermon",
        sectionId: "response",
        fromSectionId: "message",
        fromSectionName: "Message",
        kind: "moved",
        itemName: "Sermon",
        sectionName: "Response & Celebration",
        fields: [],
      }],
      added: 0,
      removed: 0,
      updated: 0,
      moved: 1,
    };

    render(
      <FloatingWindowZIndexProvider>
        <ServicePlanImportReviewWindow summary={summary} onApply={onApply} onClose={jest.fn()} />
      </FloatingWindowZIndexProvider>,
    );

    expect(screen.getByText("Moved")).toBeInTheDocument();
    expect(screen.getByText("Message → Response & Celebration")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(["moved:sermon"]);
  });

  it("requires individual confirmation for a legacy match while allowing other changes", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: [
        {
          id: "legacy-sermon",
          incomingElementId: "incoming-sermon",
          sectionId: "response",
          fromSectionId: "message",
          fromSectionName: "Message",
          kind: "legacy_match",
          itemName: "Sermon",
          sectionName: "Response & Celebration",
          fields: [],
        },
        { id: "prayer", sectionId: "response", kind: "updated", itemName: "Prayer", sectionName: "Response & Celebration", fields: [] },
      ],
      added: 0,
      removed: 0,
      updated: 1,
      moved: 0,
    };

    render(
      <FloatingWindowZIndexProvider>
        <ServicePlanImportReviewWindow summary={summary} onApply={onApply} onClose={jest.fn()} />
      </FloatingWindowZIndexProvider>,
    );

    expect(screen.getByText("Moved")).toBeInTheDocument();
    expect(screen.getByText("Message → Response & Celebration")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Confirm match for Sermon" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Update Prayer" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(["updated:prayer"]);
  });

  it("offers source linking independently of item field updates", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: [{
        id: "sermon",
        sectionId: "message",
        kind: "linked",
        itemName: "Sermon",
        sectionName: "Message",
        fields: [],
      }],
      added: 0,
      removed: 0,
      updated: 0,
      moved: 0,
    };

    render(
      <FloatingWindowZIndexProvider>
        <ServicePlanImportReviewWindow summary={summary} onApply={onApply} onClose={jest.fn()} />
      </FloatingWindowZIndexProvider>,
    );

    expect(screen.getByRole("checkbox", { name: "Link Sermon to the import source" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(["linked:sermon"]);
  });
});
