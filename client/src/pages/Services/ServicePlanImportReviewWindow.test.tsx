import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatingWindowZIndexProvider } from "../../components/FloatingWindow/FloatingWindowZIndexContext";
import type { ServicePlanImportSummary } from "./servicePlanImportSummary";
import ServicePlanImportReviewWindow from "./ServicePlanImportReviewWindow";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";
import { applySelectedServicePlanImportChanges, summarizeServicePlanImport } from "./servicePlanImportSummary";
import { applyPlanAnchorStartTime } from "./servicePlanTimingUtils";

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

    expect(screen.getByText("Confirm match for Sermon")).toBeInTheDocument();
    expect(screen.getByText("Message → Response & Celebration")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Confirm match for Sermon" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Update Prayer" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select all updates" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Select all updates" }));
    expect(screen.getByRole("checkbox", { name: "Confirm match for Sermon" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Update Prayer" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Response & Celebration" }));
    expect(screen.getByRole("checkbox", { name: "Confirm match for Sermon" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Update Prayer" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Confirm match for Sermon" }));
    await user.click(screen.getByRole("button", { name: "Apply 2 changes" }));
    expect(onApply).toHaveBeenCalledWith(["updated:prayer", "legacy_match:legacy-sermon"]);
  });

  it("leaves ambiguous duplicate match suggestions unchecked until confirmed", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: ["short", "long"].map((id) => ({
        id: `local-${id}`,
        incomingElementId: `incoming-${id}`,
        sectionId: "worship",
        kind: "legacy_match" as const,
        itemName: "Prayer",
        sectionName: "Worship",
        fields: [{
          label: "Time or duration",
          before: id === "short" ? "09:00 · 2m" : "09:02 · 7m",
          after: id === "short" ? "09:00 · 3m" : "09:02 · 8m",
        }],
      })),
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

    const suggestions = screen.getAllByRole("checkbox", { name: "Confirm match for Prayer" });
    expect(suggestions).toHaveLength(2);
    suggestions.forEach((suggestion) => expect(suggestion).not.toBeChecked());
    expect(screen.getByText("09:00 · 2m")).toBeInTheDocument();
    expect(screen.getByText("09:00 · 3m")).toBeInTheDocument();
    await user.click(suggestions[0]);
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(["legacy_match:local-short"]);
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

  it("shows source removals as explicit selectable remove actions", async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    const summary: ServicePlanImportSummary = {
      changes: [{
        id: "old-prayer",
        sectionId: "worship",
        kind: "removed",
        itemName: "Prayer",
        sectionName: "Worship",
        fields: [],
      }],
      added: 0,
      removed: 1,
      updated: 0,
      moved: 0,
    };

    render(
      <FloatingWindowZIndexProvider>
        <ServicePlanImportReviewWindow summary={summary} onApply={onApply} onClose={jest.fn()} />
      </FloatingWindowZIndexProvider>,
    );

    expect(screen.getByText("Removed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remove Prayer" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Remove Prayer" }));
    expect(screen.getByRole("checkbox", { name: "Select all updates" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Remove Prayer" }));
    await user.click(screen.getByRole("button", { name: "Apply 1 change" }));
    expect(onApply).toHaveBeenCalledWith(["removed:old-prayer"]);
  });
  it("compares duplicate possible matches using the actual current and incoming items", () => {
    const item = (id: string, startTime: string, notes: string, candidate?: string): ServicePlanElement => ({
      id, type: "free", title: plainTextToRichText("Prayer"), startTime, durationMinutes: 2,
      notes: plainTextToRichText(notes), legacyImportMatchCandidateForId: candidate,
    });
    const current: ServicePlanSection[] = [{ id: "w", name: "Worship", elements: [item("a", "09:00", "Opening"), item("b", "09:10", "Closing")] }];
    const proposed: ServicePlanSection[] = [{ id: "w", name: "Worship", elements: [item("x", "09:01", "Opening updated", "a"), item("y", "09:11", "Closing updated", "b")] }];
    const summary = summarizeServicePlanImport(current, proposed);
    render(<FloatingWindowZIndexProvider><ServicePlanImportReviewWindow summary={summary} currentSections={current} proposedSections={proposed} onApply={jest.fn()} onClose={jest.fn()} /></FloatingWindowZIndexProvider>);
    expect(screen.getAllByText("Current plan")).toHaveLength(2);
    expect(screen.getByText("Opening updated")).toBeInTheDocument();
    expect(screen.getByText("Closing")).toBeInTheDocument();
    expect(screen.queryByText("Worship \u2192 Worship")).not.toBeInTheDocument();
    expect(screen.getByText("2 changes selected \u00b7 2 possible matches")).toBeInTheDocument();
  });

  it("updates schedule impact from the selected application result", async () => {
    const user = userEvent.setup();
    const item = (id: string, title: string, time: string, durationMinutes: number): ServicePlanElement => ({ id, type: "free", title: plainTextToRichText(title), startTime: time, durationMinutes });
    const current: ServicePlanSection[] = [{ id: "w", name: "Worship", elements: [item("song", "Song", "09:00", 5), item("prayer", "Prayer", "09:05", 2)] }];
    const proposed: ServicePlanSection[] = [{ id: "w", name: "Worship", elements: [item("song", "Song", "09:00", 8), item("prayer", "Prayer", "09:08", 2)] }];
    const summary = summarizeServicePlanImport(current, proposed, {}, { dependentTimingShifts: true });
    const getSelectedSections = (keys: string[]) => keys.length ? applyPlanAnchorStartTime(applySelectedServicePlanImportChanges(current, proposed, summary, new Set(keys)), "09:00") : current;
    render(<FloatingWindowZIndexProvider><ServicePlanImportReviewWindow summary={summary} currentSections={current} proposedSections={proposed} getSelectedSections={getSelectedSections} onApply={jest.fn()} onClose={jest.fn()} /></FloatingWindowZIndexProvider>);
    await user.click(screen.getByText("Schedule impact (1)"));
    expect(screen.getByText("Prayer \u00b7 09:05 \u2192 09:08")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Update Song" }));
    expect(screen.getByText("Schedule impact (0)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply no changes" })).toBeDisabled();
  });

});
