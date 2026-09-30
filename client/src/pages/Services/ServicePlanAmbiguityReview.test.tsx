import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";
import type { ServicePlanningImportData } from "../../containers/Overlays/eventParser";
import { createServicePlanTextResource, getServicePlanResourceText } from "./servicePlanResources";
import { applyReviewedServicePlanParts, reconcileReviewedServicePlanParts, servicePlanResourceFingerprint } from "./servicePlanImportOwnership";
import { buildServicePlanSectionsFromImport } from "./servicePlanFromImport";
import { DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, refreshServicePlanFromImport } from "./servicePlanImportSync";
import { applySelectedServicePlanImportChanges, servicePlanImportChangeKey, summarizeServicePlanImport } from "./servicePlanImportSummary";
import ServicePlanAmbiguityReview from "./ServicePlanAmbiguityReview";

const sections: ServicePlanSection[] = [{
  id: "section-1",
  name: "Reading",
  elements: [{
    id: "element-1",
    type: "free",
    title: plainTextToRichText("Reading the Word"),
    importAmbiguity: {
      source: "servicePlanning",
      sourceKey: "Reading:0",
      sourceElementType: "Reading",
      sourceTitle: "Psalms 97 Jasmine Williams",
      sourceLedBy: "Jeriyah Brown",
      parts: [{ kind: "description", value: "Jasmine Williams", destination: "content" }],
      reasons: ["The remaining title text is uncertain."],
      status: "unresolved",
      sourceFingerprint: "source",
    },
  }],
}];

describe("ServicePlanAmbiguityReview", () => {
  it("offers a compact defer prompt and lets the operator open the per-item review", async () => {
    const user = userEvent.setup();
    const onLater = jest.fn();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={onLater} onResolve={onResolve} />);

    expect(screen.getByText(/1 imported item needs a quick interpretation review/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
  });

  it("shows original source fields and confirms a selected interpretation", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));

    expect(screen.getByText("Item 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Review imported items")).toBeInTheDocument();
    expect(screen.getByText("Psalms 97 Jasmine Williams")).toBeInTheDocument();
    expect(screen.getByText("Jeriyah Brown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm & finish" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", expect.objectContaining({
      importAmbiguity: expect.objectContaining({ status: "confirmed", reasons: [] }),
    }));
    const changes = onResolve.mock.calls[0][1];
    expect(changes.resources).toHaveLength(1);
    expect(changes.resources?.[0]).toMatchObject({
      type: "text",
      title: "Imported description",
    });
  });

  it("lets an ambiguous description title become an assignee and removes its source content", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const managed = createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Samar"),
    });
    const element: ServicePlanElement = {
      ...sections[0].elements[0],
      title: plainTextToRichText("Call to Praise"),
      resources: [managed],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        sourceTitle: "Samar",
        parts: [{
          kind: "description",
          value: "Samar",
          destination: "content",
          sourceField: "title",
          managed: {
            kind: "resource",
            id: managed.id,
            fingerprint: servicePlanResourceFingerprint(managed),
          },
        }],
        reasons: ["The title could be descriptive content or an assignee."],
      },
    };
    render(<ServicePlanAmbiguityReview sections={[{ ...sections[0], elements: [element] }]} elementIds={[element.id]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    expect(screen.getByText("Ambiguous title")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: /Destination for ambiguous title 1/ }));
    expect(screen.getByRole("option", { name: "Assignee" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Assignee" }));
    await user.click(screen.getByRole("button", { name: "Confirm & finish" }));

    const changes = onResolve.mock.calls[0][1] as Partial<ServicePlanElement>;
    expect(changes.assignees).toEqual([expect.objectContaining({ name: "Samar" })]);
    expect(changes.resources).toBeUndefined();
    expect(changes.importAmbiguity).toMatchObject({ status: "confirmed", reasons: [] });
  });

  it("keeps no-parts items simple and acknowledges the imported content as-is", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const element = {
      ...sections[0].elements[0],
      title: plainTextToRichText("Untitled"),
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        sourceTitle: "",
        parts: [],
        reasons: ["The source title is empty."],
      },
    };
    render(<ServicePlanAmbiguityReview sections={[{ ...sections[0], elements: [element] }]} elementIds={[element.id]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    expect(screen.getByText("The source title is empty.")).toBeInTheDocument();
    expect(screen.getByText("No mapping is needed for this item.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep as imported" }));

    expect(onResolve).toHaveBeenCalledWith(element.id, {
      importAmbiguity: expect.objectContaining({ status: "acknowledged" }),
    });
  });

  it("keeps review dropdown options inside the floating window", async () => {
    const user = userEvent.setup();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt={false} onLater={jest.fn()} onResolve={jest.fn()} />);

    await user.click(screen.getByRole("combobox", { name: /Destination for description 1/ }));

    const overlayHost = within(screen.getByTestId("floating-window-overlay-host"));
    expect(overlayHost.getByRole("option", { name: "Content attachment" })).toBeInTheDocument();
  });

  it("acknowledges without applying any suggested field changes", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));
    await user.click(screen.getByRole("button", { name: "Acknowledge as-is" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", {
      importAmbiguity: expect.objectContaining({ status: "acknowledged" }),
    });
    expect(onResolve.mock.calls[0][1]).not.toHaveProperty("assignees");
    expect(onResolve.mock.calls[0][1]).not.toHaveProperty("resources");
  });

  it("can defer one item and leave it available for a later review", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    render(<ServicePlanAmbiguityReview sections={sections} elementIds={["element-1"]} prompt onLater={jest.fn()} onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Review items" }));
    await user.click(screen.getByRole("button", { name: "Leave for later" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", {
      importAmbiguity: expect.objectContaining({ status: "deferred" }),
    });
  });

  it("keeps all existing links when a song mapping is deferred", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const linkedSongs: ServicePlanElement = {
      ...sections[0].elements[0],
      songRefs: [
        { id: "library-one", kind: "library", songId: "song-one", songName: "Same Song", key: "C" },
        { id: "library-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
      ],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        songMappings: [{
          incoming: { kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" },
          candidateOccurrenceIds: ["library-one", "library-two"],
          sourceFingerprint: "incoming-song",
        }],
      },
    };
    const reviewSections = [{ ...sections[0], elements: [linkedSongs] }];
    render(<ServicePlanAmbiguityReview sections={reviewSections} elementIds={[linkedSongs.id]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    expect(screen.getByRole("combobox", { name: /Song mapping for Same Song/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Leave for later" }));

    expect(onResolve).toHaveBeenCalledWith("element-1", {
      importAmbiguity: expect.objectContaining({ status: "deferred" }),
    });
    expect(linkedSongs.songRefs).toHaveLength(2);
  });

  it("replaces only the occurrence explicitly selected for an ambiguous song mapping", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const linkedSongs: ServicePlanElement = {
      ...sections[0].elements[0],
      songRefs: [
        { id: "library-one", kind: "library", songId: "song-one", songName: "Same Song", key: "C" },
        { id: "library-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
      ],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        songMappings: [{
          incoming: { id: "incoming-id", kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" },
          candidateOccurrenceIds: ["library-one", "library-two"],
          sourceFingerprint: "incoming-song",
        }],
      },
    };
    render(<ServicePlanAmbiguityReview sections={[{ ...sections[0], elements: [linkedSongs] }]} elementIds={[linkedSongs.id]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    await user.click(screen.getByRole("combobox", { name: /Song mapping for Same Song/ }));
    await user.click(screen.getByRole("option", { name: "Same Song · C" }));
    await user.click(screen.getByRole("button", { name: "Confirm & finish" }));

    const changes = onResolve.mock.calls[0][1] as Partial<ServicePlanElement>;
    expect(changes.songRefs).toEqual([
      { id: "library-one", kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" },
      { id: "library-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
    ]);
    expect(changes.importAmbiguity).toMatchObject({ status: "confirmed", reasons: [] });
  });

  it("keeps identical song mappings on separate controls and applies each selection", async () => {
    const user = userEvent.setup();
    const onResolve = jest.fn();
    const linkedSongs: ServicePlanElement = {
      ...sections[0].elements[0],
      songRefs: [
        { id: "library-one", kind: "library", songId: "song-one", songName: "Same Song", key: "C" },
        { id: "library-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
      ],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        songMappings: [0, 1].map((occurrence) => ({
          incoming: { kind: "pending" as const, title: "Same Song", lyricsText: `Lyrics ${occurrence}` },
          candidateOccurrenceIds: ["library-one", "library-two"],
          mappingId: `mapping-${occurrence}`,
          sourceFingerprint: `song-${occurrence}`,
        })),
      },
    };
    render(<ServicePlanAmbiguityReview sections={[{ ...sections[0], elements: [linkedSongs] }]} elementIds={[linkedSongs.id]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    const [first, second] = screen.getAllByRole("combobox", { name: /Song mapping for Same Song/ });
    await user.click(first);
    await user.click(screen.getByRole("option", { name: "Same Song · C" }));
    expect(first).toHaveTextContent("Same Song · C");
    expect(second).toHaveTextContent("Keep existing linked songs");
    await user.click(second);
    await user.click(screen.getByRole("option", { name: "Same Song · G" }));
    await user.click(screen.getByRole("button", { name: "Confirm & finish" }));

    const changes = onResolve.mock.calls[0][1] as Partial<ServicePlanElement>;
    expect(changes.songRefs).toEqual([
      { id: "library-one", kind: "pending", title: "Same Song", lyricsText: "Lyrics 0" },
      { id: "library-two", kind: "pending", title: "Same Song", lyricsText: "Lyrics 1" },
    ]);
    expect(changes.importAmbiguity?.songMappings?.map(({ resolution }) => resolution)).toEqual([
      { kind: "replace", occurrenceId: "library-one" },
      { kind: "replace", occurrenceId: "library-two" },
    ]);
  });

  it("parses, selectively applies, confirms, saves, and repeats a manual song replacement without reopening", async () => {
    const user = userEvent.setup();
    const source: ServicePlanningImportData = {
      planLabel: "Sunday worship",
      sections: [{ sectionName: "Praise", rows: [{ elementType: "Song", title: "Same Song", songTitle: "Same Song", ledBy: "" }] }],
      teamAssignments: [],
    };
    const parsed = buildServicePlanSectionsFromImport(source, []);
    const current: ServicePlanSection[] = [{
      id: "saved-section",
      name: "Praise",
      sourcePlanningManaged: true,
      elements: [{
        id: "saved-set",
        type: "song",
        title: plainTextToRichText("Worship Set"),
        sourcePlanningManaged: true,
        songRefs: [
          { id: "selected-occurrence", kind: "library", songId: "song-one", songName: "Same Song", key: "C" },
          { id: "other-occurrence", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
        ],
      }],
    }];
    const reconciled = refreshServicePlanFromImport(current, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, reconciled);
    const applied = applySelectedServicePlanImportChanges(
      current,
      reconciled,
      summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );
    let savedSections = JSON.parse(JSON.stringify(applied)) as ServicePlanSection[];
    const onResolve = jest.fn((elementId: string, changes: Partial<ServicePlanElement>) => {
      const nextSections = savedSections.map((section) => ({
        ...section,
        elements: section.elements.map((element) => element.id === elementId ? { ...element, ...changes } : element),
      }));
      savedSections = JSON.parse(JSON.stringify(nextSections));
    });
    const elementId = applied[0].elements[0].id;
    render(<ServicePlanAmbiguityReview sections={applied} elementIds={[elementId]} prompt={false} onLater={jest.fn()} onResolve={onResolve} />);

    await user.click(screen.getByRole("combobox", { name: /Song mapping for Same Song/ }));
    await user.click(screen.getByRole("option", { name: "Same Song · C" }));
    await user.click(screen.getByRole("button", { name: "Confirm & finish" }));

    expect(savedSections[0].elements[0].songRefs).toEqual([
      { id: "selected-occurrence", kind: "pending", title: "Same Song", lyricsText: "" },
      { id: "other-occurrence", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
    ]);
    const repeated = refreshServicePlanFromImport(savedSections, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(repeated[0].elements[0]).toEqual(savedSections[0].elements[0]);
    expect(summarizeServicePlanImport(savedSections, repeated).changes).toEqual([]);
  });

  it("advances through queued items without closing the review", async () => {
    const user = userEvent.setup();
    const secondElement: ServicePlanElement = {
      ...sections[0].elements[0],
      id: "element-2",
      title: plainTextToRichText("Second item"),
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        sourceTitle: "Unknown second title",
      },
    };
    const reviewSections: ServicePlanSection[] = [{
      ...sections[0],
      elements: [...sections[0].elements, secondElement],
    }];
    const ReviewQueue = () => {
      const [elementIds, setElementIds] = useState(["element-1", "element-2"]);
      const [completedCount, setCompletedCount] = useState(0);
      return (
        <ServicePlanAmbiguityReview
          sections={reviewSections}
          elementIds={elementIds}
          batchTotal={2}
          completedCount={completedCount}
          prompt={false}
          onLater={jest.fn()}
          onResolve={(elementId) => {
            setElementIds((current) => current.filter((id) => id !== elementId));
            setCompletedCount((current) => current + 1);
          }}
        />
      );
    };
    render(<ReviewQueue />);

    expect(screen.getByText("Psalms 97 Jasmine Williams")).toBeInTheDocument();
    expect(screen.getByText("Item 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("1 remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm & next" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm & next" }));

    expect(screen.getByText("Unknown second title")).toBeInTheDocument();
    expect(screen.getByText("Item 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("button", { name: "Confirm & finish" })).toBeInTheDocument();
  });

  it("moves a source-managed description from content to notes and keeps unrelated resources", () => {
    const managed = createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Behind the pulpit"),
    });
    const manual = createServicePlanTextResource({ title: "Operator note", text: plainTextToRichText("Keep this") });
    const element: ServicePlanElement = {
      id: "element-1",
      type: "free",
      title: plainTextToRichText("Reading"),
      resources: [managed, manual],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        parts: [{
          kind: "description",
          value: "Behind the pulpit",
          destination: "content",
          sourceField: "title",
          managed: {
            kind: "resource",
            id: managed.id,
            fingerprint: servicePlanResourceFingerprint(managed),
          },
        }],
      },
    };
    const reconciled = applyReviewedServicePlanParts(element, [
      { ...element.importAmbiguity!.parts[0], destination: "notes" },
    ]);
    expect(reconciled.element.resources).toEqual([manual]);
    expect(richTextToPlainText(reconciled.element.notes)).toContain("Behind the pulpit");
    expect(reconciled.parts[0].managed?.kind).toBe("note");
  });

  it("switches a source-managed ambiguous title between content and assignee without duplicates", () => {
    const managed = createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Samar"),
    });
    const contentPart = {
      kind: "description" as const,
      value: "Samar",
      destination: "content" as const,
      sourceField: "title" as const,
      managed: {
        kind: "resource" as const,
        id: managed.id,
        fingerprint: servicePlanResourceFingerprint(managed),
      },
    };
    const contentElement: ServicePlanElement = {
      ...sections[0].elements[0],
      resources: [managed],
      importAmbiguity: { ...sections[0].elements[0].importAmbiguity!, parts: [contentPart] },
    };

    const asAssignee = applyReviewedServicePlanParts(contentElement, [{ ...contentPart, destination: "assignee" }]);
    expect(asAssignee.element.resources).toBeUndefined();
    expect(asAssignee.element.assignees).toEqual([expect.objectContaining({ name: "Samar" })]);
    expect(asAssignee.parts[0].managed?.kind).toBe("assignee");

    const assigneeElement = {
      ...asAssignee.element,
      importAmbiguity: { ...contentElement.importAmbiguity!, parts: asAssignee.parts },
    };
    const backToContent = applyReviewedServicePlanParts(assigneeElement, [{ ...asAssignee.parts[0], destination: "content" }]);
    expect(backToContent.element.assignees).toBeUndefined();
    expect(backToContent.element.resources).toHaveLength(1);
    expect(richTextToPlainText(getServicePlanResourceText(backToContent.element.resources![0]))).toBe("Samar");
  });

  it("does not promote an ordinary description to a person without an explicit assignee destination", () => {
    const element: ServicePlanElement = {
      ...sections[0].elements[0],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        parts: [{
          kind: "description",
          value: "Behind the pulpit",
          destination: "content",
          sourceField: "title",
        }],
      },
    };
    const reviewed = applyReviewedServicePlanParts(element, element.importAmbiguity!.parts);

    expect(reviewed.element.assignees).toBeUndefined();
    expect(reviewed.element.resources).toEqual([expect.objectContaining({ title: "Imported description" })]);
  });

  it("installs an explicitly reviewed description assignee during a source refresh", () => {
    const managed = createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Samar"),
    });
    const oldPart = {
      kind: "description" as const,
      value: "Samar",
      destination: "content" as const,
      sourceField: "title" as const,
      managed: {
        kind: "resource" as const,
        id: managed.id,
        fingerprint: servicePlanResourceFingerprint(managed),
      },
    };
    const current: ServicePlanElement = {
      ...sections[0].elements[0],
      resources: [managed],
      importAmbiguity: { ...sections[0].elements[0].importAmbiguity!, parts: [oldPart] },
    };
    const incoming: ServicePlanElement = {
      ...current,
      resources: undefined,
      importAmbiguity: {
        ...current.importAmbiguity!,
        parts: [{ ...oldPart, destination: "assignee" }],
      },
    };

    const refreshed = reconcileReviewedServicePlanParts(current, incoming, new Set(["title"]));

    expect(refreshed.element.resources).toBeUndefined();
    expect(refreshed.element.assignees).toEqual([expect.objectContaining({ name: "Samar" })]);
    expect(refreshed.ambiguity?.parts[0]).toMatchObject({
      destination: "assignee",
      managed: expect.objectContaining({ kind: "assignee" }),
    });
  });

  it("removes only the source-derived name and retains Led By and its microphone", () => {
    const element: ServicePlanElement = {
      id: "element-1",
      type: "free",
      title: plainTextToRichText("Reading"),
      assignees: [
        { id: "led-by", name: "Jeriyah Brown", microphoneIds: ["mic-a"] },
        { id: "title-person", name: "Jasmine Williams", microphoneIds: ["mic-b"] },
      ],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        parts: [{
          kind: "person",
          value: "Jasmine Williams",
          destination: "assignee",
          sourceField: "title",
          managed: { kind: "assignee", id: "title-person", fingerprint: JSON.stringify({ name: "Jasmine Williams" }) },
        }],
      },
    };
    const reconciled = applyReviewedServicePlanParts(element, [
      { ...element.importAmbiguity!.parts[0], destination: "content" },
    ]);
    expect(reconciled.element.assignees).toEqual([
      { id: "led-by", name: "Jeriyah Brown", microphoneIds: ["mic-a"] },
      { id: "title-person", microphoneIds: ["mic-b"] },
    ]);
  });

  it("preserves an operator-edited source attachment when its ownership snapshot no longer matches", () => {
    const imported = createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Behind the pulpit"),
    });
    const edited = { ...imported, title: "Operator-edited description" };
    const part = {
      kind: "description" as const,
      value: "Behind the pulpit",
      destination: "content" as const,
      sourceField: "title" as const,
      managed: {
        kind: "resource" as const,
        id: imported.id,
        fingerprint: servicePlanResourceFingerprint(imported),
      },
    };
    const element: ServicePlanElement = {
      id: "element-1",
      type: "free",
      title: plainTextToRichText("Reading"),
      resources: [edited],
      importAmbiguity: { ...sections[0].elements[0].importAmbiguity!, parts: [part] },
    };

    const reconciled = applyReviewedServicePlanParts(element, [{ ...part, destination: "notes" }]);

    expect(reconciled.element.resources).toEqual([edited]);
    expect(richTextToPlainText(reconciled.element.notes)).toBe("Behind the pulpit");
  });

  it("moves only its source-created scripture reference to notes and is idempotent", () => {
    const element: ServicePlanElement = {
      id: "element-1",
      type: "bible",
      title: plainTextToRichText("Reading"),
      scriptureRefs: [
        { id: "source-ref", label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" },
        { id: "manual-ref", label: "Psalm 23 (NIV)", book: "Psalms", chapter: "23", verseRange: "", version: "NIV" },
      ],
      importAmbiguity: {
        ...sections[0].elements[0].importAmbiguity!,
        parts: [{
          kind: "scripture",
          value: "John 3:16 NIV",
          destination: "scripture",
          sourceField: "title",
          managed: { kind: "scripture", id: "source-ref", fingerprint: JSON.stringify({ label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" }) },
        }],
      },
    };
    const moved = applyReviewedServicePlanParts(element, [{ ...element.importAmbiguity!.parts[0], destination: "notes" }]);
    const nextElement = { ...moved.element, importAmbiguity: { ...element.importAmbiguity!, parts: moved.parts } };
    const repeated = applyReviewedServicePlanParts(nextElement, moved.parts);

    expect(moved.element.scriptureRefs?.map(({ id }) => id)).toEqual(["manual-ref"]);
    expect(repeated.element.scriptureRefs?.map(({ id }) => id)).toEqual(["manual-ref"]);
    expect(richTextToPlainText(repeated.element.notes)).toBe("John 3:16 NIV");
    expect(repeated.parts).toEqual(moved.parts);
  });
});
