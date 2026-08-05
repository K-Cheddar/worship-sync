import type { ServicePlanSection } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import {
  addElement,
  addSection,
  cloneSectionsForTemplate,
  createEmptyServicePlanSections,
  moveElementToSection,
  removeElement,
  removeSection,
  renameSection,
  reorderElementsInSection,
  reorderSections,
  updateElement,
} from "./servicePlanDraftUtils";

const section = (
  id: string,
  overrides: Partial<ServicePlanSection> = {},
): ServicePlanSection => ({
  id,
  name: id,
  elements: [],
  ...overrides,
});

describe("createEmptyServicePlanSections", () => {
  it("seeds one default section for a brand-new plan", () => {
    const sections = createEmptyServicePlanSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].elements).toEqual([]);
  });
});

describe("addSection / removeSection / renameSection", () => {
  it("appends a new empty section", () => {
    const sections = addSection([section("a")], "Welcome");
    expect(sections.map((s) => s.name)).toEqual(["a", "Welcome"]);
    expect(sections[1].elements).toEqual([]);
  });

  it("removes only the targeted section", () => {
    const sections = removeSection([section("a"), section("b")], "a");
    expect(sections.map((s) => s.id)).toEqual(["b"]);
  });

  it("renames only the targeted section, leaving others untouched", () => {
    const sections = renameSection(
      [section("a"), section("b")],
      "a",
      "Renamed",
    );
    expect(sections[0].name).toBe("Renamed");
    expect(sections[1].name).toBe("b");
  });
});

describe("reorderSections", () => {
  it("reorders sections to match the given id order", () => {
    const sections = reorderSections(
      [section("a"), section("b"), section("c")],
      ["c", "a", "b"],
    );
    expect(sections.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("drops ids that no longer match a section", () => {
    const sections = reorderSections([section("a"), section("b")], [
      "b",
      "missing",
      "a",
    ]);
    expect(sections.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("addElement / removeElement / updateElement", () => {
  it("adds an element of the given type to the targeted section only", () => {
    const sections = addElement([section("a"), section("b")], "a", "song");
    expect(sections[0].elements).toHaveLength(1);
    expect(sections[0].elements[0].type).toBe("song");
    expect(sections[1].elements).toHaveLength(0);
  });

  it("removes only the targeted element", () => {
    const withElements = addElement(
      addElement([section("a")], "a", "song"),
      "a",
      "announcement",
    );
    const [first, second] = withElements[0].elements;
    const sections = removeElement(withElements, "a", first.id);
    expect(sections[0].elements.map((e) => e.id)).toEqual([second.id]);
  });

  it("patches only the targeted element's fields", () => {
    const withElements = addElement([section("a")], "a");
    const elementId = withElements[0].elements[0].id;
    const title = plainTextToRichText("Great Are You Lord");
    const sections = updateElement(withElements, "a", elementId, {
      title,
      assignedName: "Jamie",
    });
    expect(sections[0].elements[0]).toMatchObject({
      title,
      assignedName: "Jamie",
      // A new element is a plain item until something is attached to it —
      // operators no longer pick a type.
      type: "free",
    });
  });

  it("derives the element kind from what gets attached to it", () => {
    const withElements = addElement([section("a")], "a");
    const elementId = withElements[0].elements[0].id;

    const withSong = updateElement(withElements, "a", elementId, {
      songRef: { kind: "library", songId: "song-1", songName: "Living Hope" },
    });
    expect(withSong[0].elements[0].type).toBe("song");

    const withScripture = updateElement(withElements, "a", elementId, {
      scriptureRef: {
        label: "John 3:16 NIV",
        book: "John",
        chapter: "3",
        verseRange: "16",
        version: "NIV",
      },
    });
    expect(withScripture[0].elements[0].type).toBe("bible");

    // Detaching returns it to a plain item.
    const detached = updateElement(withSong, "a", elementId, {
      songRef: undefined,
    });
    expect(detached[0].elements[0].type).toBe("free");
  });
});

describe("reorderElementsInSection", () => {
  it("reorders elements within one section without touching other sections", () => {
    let sections = addElement([section("a"), section("b")], "a", "song");
    sections = addElement(sections, "a", "announcement");
    sections = addElement(sections, "b", "free");
    const [first, second] = sections[0].elements;

    const reordered = reorderElementsInSection(sections, "a", [
      second.id,
      first.id,
    ]);
    expect(reordered[0].elements.map((e) => e.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(reordered[1].elements).toEqual(sections[1].elements);
  });
});

describe("moveElementToSection", () => {
  it("moves an element from one section to another, appended at the end", () => {
    let sections = addElement([section("a"), section("b", { elements: [] })], "a", "song");
    sections = addElement(sections, "b", "announcement");
    const movedElement = sections[0].elements[0];

    const result = moveElementToSection(sections, movedElement.id, "a", "b");
    expect(result[0].elements).toHaveLength(0);
    expect(result[1].elements.map((e) => e.id)).toEqual([
      sections[1].elements[0].id,
      movedElement.id,
    ]);
  });

  it("is a no-op when source and target sections are the same", () => {
    const sections = addElement([section("a")], "a", "song");
    const result = moveElementToSection(
      sections,
      sections[0].elements[0].id,
      "a",
      "a",
    );
    expect(result).toBe(sections);
  });

  it("is a no-op when the element can't be found", () => {
    const sections = [section("a"), section("b")];
    const result = moveElementToSection(sections, "missing", "a", "b");
    expect(result).toBe(sections);
  });
});

describe("cloneSectionsForTemplate", () => {
  it("gives sections and elements fresh ids while keeping structure/content", () => {
    let sections = addElement([section("a")], "a");
    sections = updateElement(sections, "a", sections[0].elements[0].id, {
      title: plainTextToRichText("Opening prayer"),
      durationMinutes: 5,
      notes: plainTextToRichText("Keep it short."),
    });

    const cloned = cloneSectionsForTemplate(sections);

    expect(cloned[0].id).not.toBe(sections[0].id);
    expect(cloned[0].name).toBe(sections[0].name);
    expect(cloned[0].elements[0].id).not.toBe(sections[0].elements[0].id);
    expect(cloned[0].elements[0]).toMatchObject({
      title: plainTextToRichText("Opening prayer"),
      durationMinutes: 5,
      notes: plainTextToRichText("Keep it short."),
    });
  });

  it("strips everything that belongs to a single week, not the pattern", () => {
    let sections = addElement([section("a")], "a");
    const elementId = sections[0].elements[0].id;
    sections = updateElement(sections, "a", elementId, {
      songRef: { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
      assignees: [{ id: "assignee-1", name: "Jamie", memberId: "member-1" }],
      sourceLedByRaw: "Jamie",
      pushedOutlineListId: "list-item-1",
    });

    const cloned = cloneSectionsForTemplate(sections);
    const [element] = cloned[0].elements;

    expect(element.songRef).toBeUndefined();
    expect(element.scriptureRef).toBeUndefined();
    // A template must not assert who is serving on some future date. The slot
    // carried nothing else, so it is dropped rather than kept empty.
    expect(element.assignees).toEqual([]);
    expect(element.sourceLedByRaw).toBeUndefined();
    expect(element.pushedOutlineListId).toBeUndefined();
    // Kind follows the now-cleared attachments.
    expect(element.type).toBe("free");
  });

  // Microphones are church-owned and addressed to roles by their own
  // configuration, so a mic plan repeats week to week and rides along with the
  // pattern — in both directions, since this clone runs on save and on apply.
  // Microphones hang off an assignee, so what survives is the microphone slot
  // with the person removed.
  it("keeps the microphone plan as a slot, minus the person", () => {
    let sections = addElement([section("a")], "a");
    const elementId = sections[0].elements[0].id;
    sections = updateElement(sections, "a", elementId, {
      assignees: [
        {
          id: "assignee-1",
          name: "Jamie",
          memberId: "member-1",
          microphoneIds: ["mic-orange"],
        },
      ],
    });

    const cloned = cloneSectionsForTemplate(sections);
    const [element] = cloned[0].elements;

    expect(element.assignees).toHaveLength(1);
    expect(element.assignees?.[0]).toMatchObject({
      microphoneIds: ["mic-orange"],
    });
    // Still no claim about who is holding it on any given week.
    expect(element.assignees?.[0].name).toBeUndefined();
    expect(element.assignees?.[0].memberId).toBeUndefined();
    // Re-keyed like every other cloned id, so two plans never collide.
    expect(element.assignees?.[0].id).not.toBe("assignee-1");
  });

  it("converts a legacy element's single assignee and element microphones", () => {
    let sections = addElement([section("a")], "a");
    const elementId = sections[0].elements[0].id;
    sections = updateElement(sections, "a", elementId, {
      assignedName: "Jamie",
      microphoneAssignments: [{ microphoneId: "mic-orange" }],
    });

    const cloned = cloneSectionsForTemplate(sections);
    const [element] = cloned[0].elements;

    // The person goes; the stand-mic slot the legacy assignment became stays.
    expect(element.assignees).toHaveLength(1);
    expect(element.assignees?.[0].microphoneIds).toEqual(["mic-orange"]);
    expect(element.microphoneAssignments).toBeUndefined();
  });
});
