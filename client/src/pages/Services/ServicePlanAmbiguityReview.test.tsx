import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";
import { createServicePlanTextResource } from "./servicePlanResources";
import { applyReviewedServicePlanParts, servicePlanResourceFingerprint } from "./servicePlanImportOwnership";
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

    expect(screen.getByText("Psalms 97 Jasmine Williams")).toBeInTheDocument();
    expect(screen.getByText("Jeriyah Brown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm interpretation" }));

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
    await user.click(screen.getByRole("button", { name: "Confirm interpretation" }));

    const changes = onResolve.mock.calls[0][1] as Partial<ServicePlanElement>;
    expect(changes.songRefs).toEqual([
      { id: "incoming-id", kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" },
      { id: "library-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
    ]);
    expect(changes.importAmbiguity).toMatchObject({ status: "confirmed", reasons: [] });
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
      return (
        <ServicePlanAmbiguityReview
          sections={reviewSections}
          elementIds={elementIds}
          prompt={false}
          onLater={jest.fn()}
          onResolve={(elementId) => setElementIds((current) => current.filter((id) => id !== elementId))}
        />
      );
    };
    render(<ReviewQueue />);

    expect(screen.getByText("Psalms 97 Jasmine Williams")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm interpretation" }));

    expect(screen.getByText("Unknown second title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm interpretation" })).toBeInTheDocument();
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
