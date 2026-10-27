import { plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  applySelectedServicePlanImportChanges,
  servicePlanImportChangeKey,
  summarizeServicePlanImport,
} from "./servicePlanImportSummary";
import {
  DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
  refreshServicePlanFromImport,
} from "./servicePlanImportSync";
import { applyPlanAnchorStartTime } from "./servicePlanTimingUtils";

const element = (
  id: string,
  title: string,
  overrides: Partial<ServicePlanElement> = {},
): ServicePlanElement => ({
  id,
  type: "free",
  title: plainTextToRichText(title),
  ...overrides,
});

const section = (elements: ServicePlanElement[]): ServicePlanSection => ({
  id: "section-1",
  name: "Worship",
  elements,
});

const namedSection = (
  id: string,
  name: string,
  elements: ServicePlanElement[],
): ServicePlanSection => ({ id, name, elements });

describe("summarizeServicePlanImport", () => {
  it("reports cascade-only start-time shifts as read-only schedule information", () => {
    const current = [section([
      element("song", "Song", { startTime: "09:00", durationSeconds: 300 }),
      element("prayer", "Prayer", { startTime: "09:05", durationSeconds: 600 }),
      element("message", "Message", { startTime: "09:15", durationSeconds: 900 }),
    ])];
    const changedDuration = [section([
      element("song", "Song", { startTime: "09:00", durationSeconds: 480 }),
      current[0].elements[1],
      current[0].elements[2],
    ])];
    const proposed = applyPlanAnchorStartTime(changedDuration, "09:00");
    const summary = summarizeServicePlanImport(current, proposed, {}, {
      dependentTimingShifts: true,
    });

    expect(summary.changes.map(({ kind, id }) => [kind, id])).toEqual([
      ["updated", "song"],
      ["timing_shift", "prayer"],
      ["timing_shift", "message"],
    ]);
    expect(summary.changes[1].fields).toEqual([{
      label: "Resulting start time",
      before: "09:05",
      after: "09:08",
    }]);

    const appliedWithoutSelection = applySelectedServicePlanImportChanges(
      current,
      proposed,
      summary,
      new Set(summary.changes.filter(({ kind }) => kind === "timing_shift").map(servicePlanImportChangeKey)),
    );
    expect(appliedWithoutSelection).toBe(current);
  });

  it("recalculates a consistent selected result after added or removed items", () => {
    const current = [
      namedSection("one", "Praise", [
        element("first", "Song", { sourcePlanningManaged: true, startTime: "09:00", durationSeconds: 300 }),
        element("removed", "Removed item", { sourcePlanningManaged: true, startTime: "09:05", durationSeconds: 120 }),
      ]),
      namedSection("two", "Message", [
        element("last", "Message", { sourcePlanningManaged: true, startTime: "09:07", durationSeconds: 600 }),
      ]),
    ];
    const proposed = [
      namedSection("one", "Praise", [
        element("first", "Song", { sourcePlanningManaged: true, startTime: "09:00", durationSeconds: 300 }),
        element("added", "New item", { sourcePlanningManaged: true, durationSeconds: 180 }),
      ]),
      namedSection("two", "Message", [
        element("last", "Message", { sourcePlanningManaged: true, startTime: "09:03", durationSeconds: 600 }),
      ]),
    ];
    const summary = summarizeServicePlanImport(current, proposed);
    const selected = new Set(summary.changes
      .filter(({ kind }) => kind === "added" || kind === "removed")
      .map(servicePlanImportChangeKey));
    const applied = applyPlanAnchorStartTime(
      applySelectedServicePlanImportChanges(current, proposed, summary, selected),
      "09:00",
    );

    expect(applied.flatMap((planSection) => planSection.elements).map(({ id, startTime }) => [id, startTime])).toEqual([
      ["first", "09:00"],
      ["added", "09:05"],
      ["last", "09:08"],
    ]);
  });

  it("applies only selected duration updates and cascades from the preserved anchor", () => {
    const current = [section([
      element("first", "First", { sourcePlanningManaged: true, startTime: "09:00", durationSeconds: 300 }),
      element("second", "Second", { sourcePlanningManaged: true, startTime: "09:05", durationSeconds: 600 }),
      element("third", "Third", { sourcePlanningManaged: true, startTime: "09:15", durationSeconds: 300 }),
    ])];
    const proposed = applyPlanAnchorStartTime([section([
      element("first", "First", { sourcePlanningManaged: true, startTime: "09:00", durationSeconds: 480 }),
      element("second", "Second", { sourcePlanningManaged: true, startTime: "09:08", durationSeconds: 720 }),
      element("third", "Third", { sourcePlanningManaged: true, startTime: "09:20", durationSeconds: 300 }),
    ])], "09:00");
    const summary = summarizeServicePlanImport(current, proposed, {}, { dependentTimingShifts: true });
    const firstUpdate = summary.changes.find(({ id, kind }) => id === "first" && kind === "updated");
    const selected = new Set(firstUpdate ? [servicePlanImportChangeKey(firstUpdate)] : []);
    const applied = applyPlanAnchorStartTime(
      applySelectedServicePlanImportChanges(current, proposed, summary, selected),
      "09:00",
    );

    expect(applied[0].elements.map(({ durationSeconds, startTime }) => [durationSeconds, startTime])).toEqual([
      [480, "09:00"],
      [600, "09:08"],
      [300, "09:18"],
    ]);
  });

  it("surfaces semantic microphone and IEM equipment changes in review", () => {
    const current = [section([element("equipment", "Prayer", {
      assignees: [{ id: "jamie", name: "Jamie", iemIds: ["iem-1"], microphoneIds: ["mic-1"] }],
    })])];
    const next = [section([element("equipment", "Prayer updated", {
      assignees: [{ id: "jamie", name: "Jamie", iemIds: ["iem-1"] }],
    })])];
    const summary = summarizeServicePlanImport(current, next, {
      microphones: [{ id: "mic-1", name: "Lead", type: "Handheld" }],
      iemEquipment: [{ id: "iem-1", name: "IEM 3", subtype: "wireless-beltpack" }],
    });
    expect(summary.changes[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Assignments and equipment",
        before: expect.stringContaining("Lead · Handheld"),
        after: expect.stringContaining("IEM 3 · wireless-beltpack"),
      }),
    ]));
    const applied = applySelectedServicePlanImportChanges(current, next, summary, new Set(["updated:equipment"]));
    expect(applied[0].elements[0].assignees).toEqual(next[0].elements[0].assignees);
  });

  it("ignores harmless equipment ID ordering differences", () => {
    const current = [section([element("equipment", "Prayer", {
      assignees: [{ id: "jamie", name: "Jamie", iemIds: ["iem-2", "iem-1"] }],
    })])];
    const next = [section([element("equipment", "Prayer", {
      assignees: [{ id: "jamie", name: "Jamie", iemIds: ["iem-1", "iem-2"] }],
    })])];
    expect(summarizeServicePlanImport(current, next).changes).toEqual([]);
  });

  it("uses safe generic labels when an equipment ID is unknown", () => {
    const current = [section([element("equipment", "Prayer", {
      assignees: [{ id: "slot", microphoneIds: ["missing-mic"], iemIds: ["missing-iem"] }],
    })])];
    const next = [section([element("equipment", "Prayer", {
      assignees: [{ id: "slot", name: "Clarence Jones", microphoneIds: ["missing-mic"], iemIds: ["missing-iem"] }],
    })])];

    const field = summarizeServicePlanImport(current, next).changes[0].fields[0];

    expect(field).toMatchObject({
      label: "Assignments and equipment",
      before: "Unassigned slot (IEM, Microphone)",
      after: "Clarence Jones (IEM, Microphone)",
    });
    expect(field.before).not.toContain("missing-mic");
    expect(field.before).not.toContain("missing-iem");
  });

  it("keeps a person-only equipment-slot change readable", () => {
    const current = [section([element("equipment", "Prayer", {
      assignees: [{ id: "slot", microphoneIds: ["mic-1"] }],
    })])];
    const next = [section([element("equipment", "Prayer", {
      assignees: [{ id: "slot", name: "Clarence Jones", microphoneIds: ["mic-1"] }],
    })])];

    const summary = summarizeServicePlanImport(current, next, {
      microphones: [{ id: "mic-1", name: "Lead", type: "Handheld" }],
    });

    expect(summary.changes[0].fields).toContainEqual({
      label: "Assignments and equipment",
      before: "Unassigned slot (Lead · Handheld)",
      after: "Clarence Jones (Lead · Handheld)",
    });
  });
  it("keeps changes in the order of items on the service", () => {
    const current = [section([
      element("first", "Zulu", { notes: plainTextToRichText("old") }),
      element("second", "Alpha", { notes: plainTextToRichText("old") }),
    ])];
    const next = [section([
      element("first", "Zulu", { notes: plainTextToRichText("new") }),
      element("second", "Alpha", { notes: plainTextToRichText("new") }),
    ])];

    expect(summarizeServicePlanImport(current, next).changes.map((change) => change.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("lists added, removed, and selected field updates", () => {
    const summary = summarizeServicePlanImport(
      [
        section([
          element("welcome", "Old welcome", {
            assignedName: "Avery",
            startTime: "09:00",
            durationSeconds: 60,
            notes: plainTextToRichText("Old note"),
          }),
          element("removed", "Deleted from source"),
        ]),
      ],
      [
        section([
          element("welcome", "Welcome", {
            assignedName: "Blair",
            startTime: "09:05",
            durationSeconds: 120,
            notes: plainTextToRichText("New note"),
          }),
          element("added", "Call to worship"),
        ]),
      ],
    );

    expect(summary).toMatchObject({ added: 1, removed: 1, updated: 1 });
    expect(summary.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "welcome",
          kind: "updated",
          itemName: "Welcome",
          fields: [
            { label: "Title", before: "Old welcome", after: "Welcome" },
            { label: "Assignments and equipment", before: "Avery", after: "Blair" },
            {
              label: "Time or duration",
              before: "09:00 · 1m",
              after: "09:05 · 2m",
            },
            {
              label: "Notes",
              before: "Shared: Old note",
              after: "Shared: New note",
            },
          ],
        }),
        expect.objectContaining({ id: "added", kind: "added" }),
        expect.objectContaining({ id: "removed", kind: "removed" }),
      ]),
    );
  });

  it("offers source identity adoption separately when no visible field changes", () => {
    const current = [section([element("sermon", "Sermon", {
      sourceTemplateElementId: "template-sermon",
      notes: plainTextToRichText("Operator notes"),
    })])];
    const next = [section([element("sermon", "Sermon", {
      sourceTemplateElementId: "template-sermon",
      sourceOccurrenceId: "external-sermon",
      sourcePlanningManaged: true,
      notes: plainTextToRichText("Operator notes"),
    })])];
    const summary = summarizeServicePlanImport(current, next);

    expect(summary.changes).toEqual([expect.objectContaining({
      id: "sermon",
      kind: "linked",
      fields: [],
    })]);
    const applied = applySelectedServicePlanImportChanges(
      current,
      next,
      summary,
      new Set(["linked:sermon"]),
    );
    expect(applied[0].elements[0]).toMatchObject({
      id: "sermon",
      sourceOccurrenceId: "external-sermon",
      sourcePlanningManaged: true,
    });
    expect(richTextToPlainText(applied[0].elements[0].notes)).toBe("Operator notes");
  });

  it("preserves item ownership when updates are accepted but source linking is declined", () => {
    const current = [namedSection("message", "Message", [element("sermon", "Sermon", {
      sourcePlanningManaged: false,
      sourceTemplateElementId: "template-sermon",
      notes: plainTextToRichText("Operator notes"),
    })])];
    const next = [{ ...namedSection("message", "Message", [element("sermon", "Sermon updated", {
      sourceOccurrenceId: "external-sermon",
      sourcePlanningManaged: true,
      sourceTemplateElementId: "template-sermon",
      notes: plainTextToRichText("Operator notes"),
    })]), sourcePlanningManaged: true }];
    const summary = summarizeServicePlanImport(current, next);

    expect(summary.changes.map(({ kind }) => kind)).toEqual(["linked", "updated"]);
    const applied = applySelectedServicePlanImportChanges(
      current,
      next,
      summary,
      new Set(["updated:sermon"]),
    );

    expect(applied[0].elements[0]).toMatchObject({
      id: "sermon",
      sourcePlanningManaged: false,
      sourceTemplateElementId: "template-sermon",
    });
    expect(applied[0].elements[0].sourceOccurrenceId).toBeUndefined();
    expect(applied[0].sourcePlanningManaged).toBeUndefined();
    expect(richTextToPlainText(applied[0].elements[0].notes)).toBe("Operator notes");

    const afterMissingSourceRow = refreshServicePlanFromImport(
      applied,
      [],
      { ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, removeMissing: true },
    );
    expect(afterMissingSourceRow).toEqual(applied);
  });

  it("reviews a relocation separately and applies selected moves in imported order", () => {
    const sermon = element("sermon", "Sermon", {
      sourceTemplateElementId: "template-sermon",
      notes: plainTextToRichText("Local note"),
    });
    const current = [
      namedSection("message", "Message", [sermon]),
      namedSection("response", "Response & Celebration", [element("closing", "Closing Song")]),
    ];
    const next = [
      namedSection("message", "Message", []),
      namedSection("response", "Response & Celebration", [
        { ...sermon, title: plainTextToRichText("Sermon updated"), notes: plainTextToRichText("New note") },
        element("new-song", "Response Song"),
        element("closing", "Closing Song"),
      ]),
    ];
    const summary = summarizeServicePlanImport(current, next);

    expect(summary).toMatchObject({ moved: 1, updated: 1, added: 1, removed: 0 });
    expect(summary.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "sermon", kind: "moved", fromSectionName: "Message", sectionName: "Response & Celebration",
      }),
      expect.objectContaining({ id: "sermon", kind: "updated" }),
    ]));
    const allChanges = new Set(summary.changes.map(servicePlanImportChangeKey));
    const applied = applySelectedServicePlanImportChanges(current, next, summary, allChanges);
    expect(applied.find(({ id }) => id === "response")?.elements.map(({ id }) => id)).toEqual([
      "sermon", "new-song", "closing",
    ]);
    expect(applied.find(({ id }) => id === "response")?.elements[0].id).toBe("sermon");
  });

  it("leaves a move unchecked while accepting an item update and another destination change", () => {
    const current = [
      namedSection("message", "Message", [element("sermon", "Sermon")]),
      namedSection("response", "Response", [element("song", "Old Song")]),
    ];
    const next = [
      namedSection("message", "Message", []),
      namedSection("response", "Response", [
        element("sermon", "Sermon updated", { notes: plainTextToRichText("new details") }),
        element("song", "New Song"),
        element("added", "Added after song"),
      ]),
    ];
    const summary = summarizeServicePlanImport(current, next);
    const selected = new Set(summary.changes
      .filter((change) => !(change.id === "sermon" && change.kind === "moved"))
      .map(servicePlanImportChangeKey));

    const applied = applySelectedServicePlanImportChanges(current, next, summary, selected);

    expect(applied.find(({ id }) => id === "message")?.elements[0]).toMatchObject({ id: "sermon" });
    expect(richTextToPlainText(applied.find(({ id }) => id === "message")!.elements[0].title)).toBe("Sermon updated");
    expect(applied.find(({ id }) => id === "response")?.elements.map(({ id }) => id)).toEqual(["song", "added"]);
    expect(richTextToPlainText(applied.find(({ id }) => id === "message")!.elements[0].notes)).toBe("new details");
  });

  it("does not report item type changes in the review fields", () => {
    const summary = summarizeServicePlanImport(
      [section([element("welcome", "Welcome", { type: "free" })])],
      [
        section([
          element("welcome", "Welcome", {
            type: "song",
            songRef: { kind: "library", songId: "song-1", songName: "Welcome" },
          }),
        ]),
      ],
    );

    expect(summary).toMatchObject({ added: 0, removed: 0, updated: 1 });
    expect(summary.changes[0]).toEqual(
      expect.objectContaining({
        id: "welcome",
        kind: "updated",
        fields: [
          {
            label: "Song",
            before: "No song",
            after: "Welcome",
          },
        ],
      }),
    );
  });

  it("does not report provenance-only changes", () => {
    const summary = summarizeServicePlanImport(
      [section([element("welcome", "Welcome")])],
      [
        section([
          element("welcome", "Welcome", { sourcePlanningManaged: true }),
        ]),
      ],
    );

    expect(summary).toEqual({ changes: [], added: 0, removed: 0, updated: 0, moved: 0 });
  });

  it("surfaces declined source changes for explicit review and keeps them out when unchecked", () => {
    const current = [section([element("item", "Old title", {
      servicePlanningImport: {
        observed: { elementType: "Reading", title: "New title", ledBy: "Avery", note: "" },
        applied: { elementType: "Reading", title: "Old title", ledBy: "Avery", note: "" },
        pendingFields: ["title"],
      },
    })])];
    const next = [section([element("item", "Old title", {
      servicePlanningImport: {
        observed: { elementType: "Reading", title: "New title", ledBy: "Avery", note: "" },
        applied: { elementType: "Reading", title: "New title", ledBy: "Avery", note: "" },
        pendingFields: [],
      },
    })])];
    const summary = summarizeServicePlanImport(current, next);

    expect(summary.changes[0].fields).toContainEqual(expect.objectContaining({
      label: "Source changes",
      before: "title: Old title → New title",
      after: "Up to date",
    }));
    expect(applySelectedServicePlanImportChanges(current, next, summary, new Set())).toEqual(current);
  });

  it("does not report regenerated IDs for unchanged imported team notes", () => {
    const current = section([
      element("welcome", "Welcome", {
        teamNotes: [
          {
            id: "existing-note",
            label: "Media Team",
            note: plainTextToRichText("Capture the greeting."),
          },
        ],
      }),
    ]);
    const next = section([
      element("welcome", "Welcome", {
        teamNotes: [
          {
            id: "newly-parsed-note",
            label: "Media Team",
            note: plainTextToRichText("Capture the greeting."),
          },
        ],
      }),
    ]);

    expect(summarizeServicePlanImport([current], [next])).toEqual({
      changes: [],
      added: 0,
      removed: 0,
      updated: 0,
      moved: 0,
    });
  });

  it("treats regenerated song occurrence IDs and normalized rich text as unchanged", () => {
    const current = [section([element("song", "  Welcome   Song ", {
      title: { blocks: [{ type: "paragraph", id: "title-1", spans: [{ text: "Welcome Song" }] }] },
      songRefs: [{ id: "occurrence-1", kind: "library", songId: "song-1", songName: "Welcome Song", key: "C" }],
      scriptureRefs: [{ id: "scripture-1", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
    })])];
    const next = [section([element("song", "Welcome Song", {
      title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome " }, { text: "Song" }] }] },
      songRefs: [{ id: "occurrence-2", kind: "library", songId: "song-1", songName: " Welcome Song ", key: "C" }],
      scriptureRefs: [{ id: "scripture-2", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
    })])];

    expect(summarizeServicePlanImport(current, next)).toEqual({
      changes: [], added: 0, removed: 0, updated: 0, moved: 0,
    });
  });

  it("compares span text without changing whitespace at boundaries", () => {
    const single = (text: string) => ({
      blocks: [{ type: "paragraph" as const, spans: [{ text }] }],
    });
    const joinedWord = {
      blocks: [{ type: "paragraph" as const, spans: [{ text: "Sun" }, { text: "day" }] }],
    };
    const joinedWords = {
      blocks: [{ type: "paragraph" as const, spans: [{ text: "Welcome " }, { text: "Home" }] }],
    };
    const meaningfulSpace = {
      blocks: [{ type: "paragraph" as const, spans: [{ text: "Sun" }, { text: " day" }] }],
    };

    expect(summarizeServicePlanImport(
      [section([element("item", "Title", { notes: single("Sunday") })])],
      [section([element("item", "Title", { notes: joinedWord })])],
    ).changes).toEqual([]);
    expect(summarizeServicePlanImport(
      [section([element("item", "Title", { notes: single("Welcome Home") })])],
      [section([element("item", "Title", { notes: joinedWords })])],
    ).changes).toEqual([]);
    expect(summarizeServicePlanImport(
      [section([element("item", "Title", { notes: single("Sunday") })])],
      [section([element("item", "Title", { notes: meaningfulSpace })])],
    ).changes[0]?.fields[0]).toMatchObject({ label: "Notes" });
  });

  it("ignores block IDs and span segmentation while retaining meaningful formatting", () => {
    const current = [section([element("item", "Title", {
      notes: { blocks: [{ type: "paragraph", id: "old-block", spans: [
        { text: "Wel", bold: true }, { text: "come", bold: true }, { text: " home" },
      ] }] },
    })])];
    const equivalent = [section([element("item", "Title", {
      notes: { blocks: [{ type: "paragraph", id: "new-block", spans: [
        { text: "Welcome", bold: true }, { text: " home" },
      ] }] },
    })])];
    const movedFormatting = [section([element("item", "Title", {
      notes: { blocks: [{ type: "paragraph", id: "new-block", spans: [
        { text: "Welcome " }, { text: "home", bold: true },
      ] }] },
    })])];

    expect(summarizeServicePlanImport(current, equivalent).changes).toEqual([]);
    expect(summarizeServicePlanImport(current, movedFormatting).changes[0]?.fields).toEqual([
      {
        label: "Notes",
        before: "Shared: [bold: Welcome] home",
        after: "Shared: Welcome [bold: home]",
      },
    ]);
    expect(summarizeServicePlanImport(
      [section([element("item", "Title", { notes: { blocks: [{ type: "paragraph", spans: [{ text: "One\r\nTwo" }] }] } })])],
      [section([element("item", "Title", { notes: { blocks: [{ type: "paragraph", id: "fresh", spans: [{ text: "One\nTwo" }] }] } })])],
    ).changes).toEqual([]);
    expect(summarizeServicePlanImport(
      [section([element("item", "Title", { notes: { blocks: [{ type: "paragraph", spans: [{ text: "One\nTwo" }] }] } })])],
      [section([element("item", "Title", { notes: { blocks: [
        { type: "paragraph", spans: [{ text: "One" }] },
        { type: "paragraph", spans: [{ text: "Two" }] },
      ] } })])],
    ).changes[0]?.fields[0]?.label).toBe("Notes");
  });

  it("reports inline and block formatting changes including list structure", () => {
    const before = [section([element("item", "Title", { notes: { blocks: [
      { type: "paragraph", spans: [{ text: "Words", bold: true, color: "#112233" }] },
      { type: "list-item", listStyle: "bullet", spans: [{ text: "Item" }] },
    ] } })])];
    const after = [section([element("item", "Title", { notes: { blocks: [
      { type: "paragraph", align: "center", size: "large", spans: [{ text: "Words", italic: true, underline: true, color: "#abcdef" }] },
      { type: "list-item", listStyle: "ordered", indent: 1, listStart: 3, spans: [{ text: "Item" }] },
    ] } })])];

    expect(summarizeServicePlanImport(before, after).changes[0]?.fields).toEqual([
      {
        label: "Notes",
        before: "Shared: [bold, color #112233: Words]\n[bulleted list] Item",
        after: "Shared: [center-aligned, large text] [italic, underlined, color #abcdef: Words]\n[numbered list, level 2, starts at 3] Item",
      },
    ]);
  });

  it("shows the position of title formatting and distinct song reference changes", () => {
    const before = [section([element("item", "Welcome home", {
      title: { blocks: [{ type: "paragraph", spans: [
        { text: "Welcome", bold: true }, { text: " home" },
      ] }] },
      songRefs: [{ kind: "library", songId: "song-old", songName: "Same title", key: "C" }],
    })])];
    const after = [section([element("item", "Welcome home", {
      title: { blocks: [{ type: "paragraph", spans: [
        { text: "Welcome " }, { text: "home", bold: true },
      ] }] },
      songRefs: [{ kind: "library", songId: "song-new", songName: "Same title", key: "C" }],
    })])];

    expect(summarizeServicePlanImport(before, after).changes[0]?.fields).toEqual([
      { label: "Title", before: "[bold: Welcome] home", after: "Welcome [bold: home]" },
      {
        label: "Song",
        before: "Same title (Key C)",
        after: "Same title (Key C) (linked library song changed)",
      },
    ]);
  });

  it("shows song identity, key, and pending lyric changes in the review", () => {
    const current = [section([element("set", "Songs", {
      songRefs: [
        { id: "a", kind: "library", songId: "song-1", songName: "First Song", key: "C" },
        { id: "b", kind: "pending", title: "Second Song", lyricsText: "Old verse", key: "G" },
      ],
    })])];
    const next = [section([element("set", "Songs", {
      songRefs: [
        { id: "a2", kind: "library", songId: "song-2", songName: "First Song", key: "D" },
        { id: "b2", kind: "pending", title: "Second Song", lyricsText: "New verse", key: "G" },
      ],
    })])];

    expect(summarizeServicePlanImport(current, next).changes[0].fields).toEqual([
      {
        label: "Song",
        before: "First Song (Key C), Second Song (Key G · Lyrics: Old verse)",
        after: "First Song (Key D), Second Song (Key G · Lyrics: New verse)",
      },
    ]);
  });

  it("ignores equivalent assignments, duration units, timing whitespace, and note serialization", () => {
    const current = [section([element("item", "Welcome", {
      assignees: [{ id: "a1", name: "Avery" }], sourceLedByRaw: " Avery  Smith ",
      startTime: "09:00", durationSeconds: 120,
      notes: { blocks: [{ type: "paragraph", id: "note-1", spans: [{ text: "Hello" }] }] },
      teamNotes: [{ id: "tn-1", label: "Media Team", note: { blocks: [{ type: "paragraph", spans: [{ text: "Capture " }, { text: "the greeting." }] }] } }],
    })])];
    const next = [section([element("item", "Welcome", {
      assignees: [{ id: "new-assignee", name: " Avery " }], sourceLedByRaw: "Avery Smith",
      startTime: " 09:00 ", durationMinutes: 2,
      notes: { blocks: [{ type: "paragraph", spans: [{ text: "Hello" }] }] },
      teamNotes: [{ id: "tn-2", label: "Media Team", note: { blocks: [{ type: "paragraph", spans: [{ text: "Capture the greeting." }] }] } }],
    })])];

    expect(summarizeServicePlanImport(current, next)).toEqual({
      changes: [], added: 0, removed: 0, updated: 0, moved: 0,
    });
  });

  it("still detects assignment, duration, shared note, and title formatting changes", () => {
    const current = [section([element("item", "Welcome", {
      assignees: [{ id: "a1", name: "Avery" }], durationMinutes: 2,
      notes: plainTextToRichText("Old note"),
    })])];
    const next = [section([element("item", "Welcome", {
      assignees: [{ id: "a2", name: "Blair" }], durationSeconds: 180,
      notes: plainTextToRichText("New note"),
      title: { blocks: [{ type: "paragraph", spans: [{ text: "Welcome", bold: true }] }] },
    })])];

    expect(summarizeServicePlanImport(current, next).changes[0].fields.map(({ label }) => label)).toEqual([
      "Title", "Assignments and equipment", "Time or duration", "Notes",
    ]);
  });

  it("keeps unchecked import changes out of the applied draft", () => {
    const current = [section([
      element("updated", "Old welcome"),
      element("removed", "Keep this local item"),
    ])];
    const next = [section([
      element("updated", "New welcome"),
      element("added", "New source item", { sourcePlanningManaged: true }),
    ])];
    const summary = summarizeServicePlanImport(current, next);
    const selectedChangeKeys = new Set(
      summary.changes
        .filter((change) => change.id === "updated")
        .map(servicePlanImportChangeKey),
    );

    const result = applySelectedServicePlanImportChanges(
      current,
      next,
      summary,
      selectedChangeKeys,
    );

    expect(result[0].elements.map((item) => item.id)).toEqual([
      "updated",
      "removed",
    ]);
    expect(result[0].elements[0].title).toEqual(plainTextToRichText("New welcome"));
  });

  it("preserves the complete refreshed result when every change is selected", () => {
    const current = [{
      ...section([element("welcome", "Old welcome")]),
      sourcePlanningManaged: true,
      name: "Old worship",
    }];
    const next = [{
      ...section([element("welcome", "Welcome"), element("prayer", "Prayer")]),
      sourcePlanningManaged: true,
      name: "Worship",
    }];
    const summary = summarizeServicePlanImport(current, next);

    expect(applySelectedServicePlanImportChanges(
      current,
      next,
      summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    )).toEqual(next);
  });

  it("applies a selected new section at its reviewed position", () => {
    const current = [
      namedSection("welcome", "Welcome", [element("greeting", "Greeting")]),
      namedSection("message", "Message", [element("sermon", "Sermon")]),
    ];
    const next = [
      current[0],
      namedSection("worship", "Worship", [
        element("song", "Song of Praise", { sourcePlanningManaged: true }),
      ]),
      current[1],
    ];
    const summary = summarizeServicePlanImport(current, next);

    expect(
      applySelectedServicePlanImportChanges(
        current,
        next,
        summary,
        new Set(summary.changes.map(servicePlanImportChangeKey)),
      ).map((item) => item.id),
    ).toEqual(["welcome", "worship", "message"]);
  });
});
