import type {
  ServicePlanSection,
  ServicePlanSongReference,
} from "../../types/servicePlan";
import { getServicePlanElementLead } from "../../types/servicePlan";
import { promoteServicePlanAssignee } from "./ServicePlanAssigneeList";
import { plainTextToRichText } from "../../types/richText";
import {
  addElement,
  addSection,
  cloneSectionsForTemplate,
  cloneSectionsFromTemplate,
  createEmptyServicePlanSections,
  moveElementToSection,
  moveElementToPosition,
  removeElement,
  removeSection,
  replaceMatchingPendingSongReferences,
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

describe("service-plan lead ordering", () => {
  it("derives the first named person and keeps microphone slots in place", () => {
    const assignees = [
      { id: "mic", microphoneIds: ["orange"] },
      { id: "one", name: "Alex" },
      { id: "two", name: "Jordan" },
    ];
    expect(getServicePlanElementLead({ assignees })?.name).toBe("Alex");
    const promoted = promoteServicePlanAssignee(assignees, "two");
    expect(promoted.map((assignee) => assignee.id)).toEqual(["mic", "two", "one"]);
  });
});

describe("addSection / removeSection / renameSection", () => {
  it("appends a new empty section", () => {
    const sections = addSection([section("a")], "Welcome");
    expect(sections.map((s) => s.name)).toEqual(["a", "Welcome"]);
    expect(sections[1].elements).toEqual([]);
  });

  it("inserts a new section after the selected section", () => {
    const sections = addSection(
      [section("a"), section("b"), section("c")],
      "New section",
      "b",
    );
    expect(sections.map((s) => s.name)).toEqual(["a", "b", "New section", "c"]);
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

describe("replaceMatchingPendingSongReferences", () => {
  it("links every exact repeated occurrence without changing a same-title variant", () => {
    const pending: ServicePlanSongReference = {
      kind: "pending",
      title: "Appeal Song",
      lyricsText: "Come as you are",
    };
    const replacement: ServicePlanSongReference = {
      kind: "library",
      songId: "song-created",
      songName: "Appeal Song",
    };
    const sections = [
      section("response", {
        elements: [
          {
            id: "first",
            type: "song",
            title: plainTextToRichText("Appeal Song"),
            songRef: pending,
          },
          {
            id: "second",
            type: "song",
            title: plainTextToRichText("Appeal Song continued"),
            songRefs: [pending],
          },
          {
            id: "variant",
            type: "song",
            title: plainTextToRichText("Appeal Song alternate"),
            songRef: {
              kind: "pending",
              title: "Appeal Song",
              lyricsText: "Different lyrics",
            },
          },
        ],
      }),
    ];

    const result = replaceMatchingPendingSongReferences(
      sections,
      pending,
      replacement,
    );

    expect(result[0].elements[0].songRefs).toEqual([replacement]);
    expect(result[0].elements[0].songRef).toBeUndefined();
    expect(result[0].elements[1].songRefs).toEqual([replacement]);
    expect(result[0].elements[2].songRef).toEqual({
      kind: "pending",
      title: "Appeal Song",
      lyricsText: "Different lyrics",
    });
  });

  it("does not restore a source-classified song an operator dismissed", () => {
    const target: ServicePlanSongReference = {
      kind: "pending",
      title: "Welcome",
      lyricsText: "",
    };
    const replacement: ServicePlanSongReference = {
      kind: "library",
      songId: "song-created",
      songName: "Welcome",
    };
    const sections = [
      section("service", {
        elements: [{
          id: "welcome",
          type: "free",
          title: plainTextToRichText("Welcome"),
          sourceElementTypeRaw: "Song",
          sourceSongReferenceDismissed: true,
        }],
      }),
    ];

    const result = replaceMatchingPendingSongReferences(sections, target, replacement);

    expect(result[0].elements[0].songRefs).toBeUndefined();
    expect(result[0].elements[0].sourceSongReferenceDismissed).toBe(true);
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

describe("moveElementToPosition", () => {
  it("moves an item into an indexed position across sections", () => {
    let sections = addElement([section("a"), section("b")], "a", "song");
    const moved = sections[0].elements[0];
    sections = addElement(sections, "a", "free");
    sections = addElement(sections, "b", "announcement");
    const result = moveElementToPosition(sections, moved.id, "a", "b", 0);
    expect(result[0].elements.map((element) => element.type)).toEqual(["free"]);
    expect(result[1].elements[0].id).toBe(moved.id);
  });

  it("supports empty section targets and clamps the index", () => {
    const sections = addElement([section("a"), section("empty")], "a", "song");
    const moved = sections[0].elements[0];
    const result = moveElementToPosition(sections, moved.id, "a", "empty", 99);
    expect(result[0].elements).toHaveLength(0);
    expect(result[1].elements).toEqual([moved]);
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

describe("cloneSectionsFromTemplate", () => {
  const templateSections = (): ServicePlanSection[] => [
    {
      id: "section-1",
      name: "Panel",
      elements: [
        {
          id: "element-1",
          type: "free",
          title: plainTextToRichText("Group discussion"),
          assignees: [
            { id: "slot-1", microphoneIds: ["mic-lead"] },
            { id: "slot-2", name: "Audience", microphoneIds: ["mic-roving"] },
          ],
        },
      ],
    },
  ];

  it("keeps a standing group label on the way out to a plan", () => {
    const [section] = cloneSectionsFromTemplate(templateSections());
    const [element] = section.elements;

    // The save-direction clone strips every name; running it here too would
    // erase "Audience" and leave the mic looking unassigned every week.
    expect(element.assignees?.[0].name).toBeUndefined();
    expect(element.assignees?.[1]).toMatchObject({
      name: "Audience",
      microphoneIds: ["mic-roving"],
    });
  });

  it("re-keys everything so two plans from one template never collide", () => {
    const [section] = cloneSectionsFromTemplate(templateSections());

    expect(section.id).not.toBe("section-1");
    expect(section.elements[0].id).not.toBe("element-1");
    expect(section.elements[0].assignees?.[0].id).not.toBe("slot-1");
    expect(section.elements[0].assignees?.[1].id).not.toBe("slot-2");
  });

  it("does not mutate the template it was given", () => {
    const original = templateSections();
    cloneSectionsFromTemplate(original);

    expect(original[0].id).toBe("section-1");
    expect(original[0].elements[0].assignees?.[1].id).toBe("slot-2");
  });
});
