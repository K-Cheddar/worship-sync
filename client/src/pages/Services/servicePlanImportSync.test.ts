import { plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
  getNewServicePlanImportAmbiguityIds,
  mergeImportedAssignees,
  refreshServicePlanFromImport,
} from "./servicePlanImportSync";
import {
  applySelectedServicePlanImportChanges,
  servicePlanImportChangeKey,
  summarizeServicePlanImport,
} from "./servicePlanImportSummary";
import { buildServicePlanSectionsFromImport } from "./servicePlanFromImport";
import type { ServicePlanningImportData } from "../../containers/Overlays/eventParser";

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

const section = (
  id: string,
  name: string,
  elements: ServicePlanElement[],
  sourcePlanningManaged = true,
): ServicePlanSection => ({ id, name, elements, sourcePlanningManaged });

describe("getNewServicePlanImportAmbiguityIds", () => {
  it("does not repeat an unchanged review after source rows move", () => {
    const current = [section("section", "Worship", [element("same-id", "Skit", {
      importAmbiguity: {
        source: "servicePlanning",
        sourceKey: "Worship:4",
        sourceElementType: "Special Feature",
        sourceTitle: "Skit/Mime – Walking With Jesus",
        sourceLedBy: "",
        parts: [{ kind: "description", value: "Skit/Mime", destination: "content" }],
        reasons: ["The title could be descriptive content or an assignee."],
        status: "deferred",
        sourceFingerprint: "unchanged-source",
      },
    })])];
    const refreshed = [section("section", "Worship", [element("same-id", "Skit", {
      importAmbiguity: {
        ...current[0].elements[0].importAmbiguity!,
        sourceKey: "Worship:5",
        status: "unresolved",
      },
    })])];

    expect(getNewServicePlanImportAmbiguityIds(current, refreshed)).toEqual([]);
  });

  it("queues new rows and materially changed source interpretations", () => {
    const current = [section("section", "Worship", [element("same-id", "Skit", {
      importAmbiguity: {
        source: "servicePlanning",
        sourceKey: "Worship:4",
        sourceElementType: "Special Feature",
        sourceTitle: "Skit/Mime",
        sourceLedBy: "",
        parts: [{ kind: "description", value: "Skit/Mime", destination: "content" }],
        reasons: ["Review this title."],
        status: "confirmed",
        sourceFingerprint: "old-source",
      },
    })])];
    const refreshed = [section("section", "Worship", [
      element("same-id", "Skit", {
        importAmbiguity: {
          ...current[0].elements[0].importAmbiguity!,
          sourceTitle: "Skit/Mime – Walking With Jesus",
          status: "unresolved",
          sourceFingerprint: "changed-source",
        },
      }),
      element("new-id", "Special feature", {
        importAmbiguity: {
          ...current[0].elements[0].importAmbiguity!,
          sourceKey: "Worship:8",
          status: "unresolved",
          sourceFingerprint: "new-source",
        },
      }),
    ])];

    expect(getNewServicePlanImportAmbiguityIds(current, refreshed)).toEqual(["same-id", "new-id"]);
  });

  it("treats a changed interpretation source field as a new review", () => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Reading",
      sourceTitle: "John 3:16",
      sourceLedBy: "",
      parts: [{ kind: "scripture" as const, value: "John 3:16", destination: "scripture" as const, sourceField: "title" as const }],
      reasons: ["Review the source interpretation."],
      status: "unresolved" as const,
      sourceFingerprint: "same-source",
    };
    const current = [section("s1", "Worship", [element("e1", "Reading", { importAmbiguity: ambiguity })])];
    const next = [section("s1", "Worship", [element("e1", "Reading", {
      importAmbiguity: {
        ...ambiguity,
        parts: [{ ...ambiguity.parts[0], sourceField: "note" }],
      },
    })])];

    expect(getNewServicePlanImportAmbiguityIds(current, next)).toEqual(["e1"]);
  });
});

describe("refreshServicePlanFromImport", () => {
  it("updates selected source fields while keeping local identities and links", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Old welcome", {
          sourcePlanningManaged: true,
          assignedName: "Avery",
          assignedMemberId: "member-1",
          startTime: "09:00",
          durationSeconds: 60,
          notes: plainTextToRichText("Local note"),
          pushedOutlineListId: "outline-1",
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-element", "Welcome", {
          assignedName: "Blair",
          sourceLedByRaw: "Blair",
          startTime: "09:05",
          durationSeconds: 120,
          notes: plainTextToRichText("Source note"),
        }),
        element("source-new", "Call to worship"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(current, imported, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      updateAssignments: false,
      updateNotes: false,
    });
    const [updated, added] = refreshed[0].elements;

    expect(updated.id).toBe("element-1");
    expect(richTextToPlainText(updated.title)).toBe("Welcome");
    expect(updated.startTime).toBe("09:05");
    expect(updated.durationSeconds).toBe(120);
    expect(updated.assignedName).toBe("Avery");
    expect(updated.assignedMemberId).toBe("member-1");
    expect(richTextToPlainText(updated.notes)).toBe("Local note");
    expect(updated.pushedOutlineListId).toBe("outline-1");
    expect(added).toMatchObject({
      id: "source-new",
      sourcePlanningManaged: true,
    });
  });

  it("keeps a linked library song when the source still has no match for it", () => {
    const current = [
      section("section-1", "Praise", [
        element("element-1", "How Great is Our God", {
          sourcePlanningManaged: true,
          type: "song",
          songRef: {
            kind: "library",
            songId: "song-1",
            songName: "How Great Is Our God",
          },
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Praise", [
        element("source-element", "How Great is Our God", {
          type: "song",
          songRef: {
            kind: "pending",
            title: "How Great is Our God",
            lyricsText: "",
          },
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].songRef).toEqual({
      kind: "library",
      songId: "song-1",
      songName: "How Great Is Our God",
    });
  });

  it("keeps song occurrence IDs, duplicate order, and matching library links through refresh", () => {
    const current = [section("section-1", "Praise", [
      element("element-1", "Worship Set", {
        sourcePlanningManaged: true,
        songRefs: [
          { id: "linked-occurrence", kind: "library", songId: "song-2", songName: "Great Are You Lord" },
          { id: "first-repeat", kind: "pending", title: "Way Maker", lyricsText: "" },
          { id: "second-repeat", kind: "pending", title: "Way Maker", lyricsText: "" },
        ],
      }),
    ])];
    const imported = [section("source", "Praise", [
      element("incoming", "Worship Set", {
        songRefs: [
          { kind: "pending", title: "Way Maker", lyricsText: "Verse" },
          { kind: "pending", title: "Great Are You Lord", lyricsText: "" },
          { kind: "pending", title: "Way Maker", lyricsText: "" },
        ],
      }),
    ])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "first-repeat", kind: "pending", title: "Way Maker", lyricsText: "Verse" },
      { id: "linked-occurrence", kind: "library", songId: "song-2", songName: "Great Are You Lord" },
      { id: "second-repeat", kind: "pending", title: "Way Maker", lyricsText: "" },
    ]);
  });

  it("matches repeated pending occurrences by lyrics before title when the import reorders them", () => {
    const current = [section("section-1", "Praise", [
      element("element-1", "Worship Set", {
        sourcePlanningManaged: true,
        songRefs: [
          { id: "morning", kind: "pending", title: "Same Song", lyricsText: "Morning lyrics" },
          { id: "evening", kind: "pending", title: "Same Song", lyricsText: "Evening lyrics" },
        ],
      }),
    ])];
    const imported = [section("source", "Praise", [
      element("incoming", "Worship Set", {
        songRefs: [
          { kind: "pending", title: "Same Song", lyricsText: "Evening lyrics" },
          { kind: "pending", title: "Same Song", lyricsText: "Morning lyrics" },
        ],
      }),
    ])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "evening", kind: "pending", title: "Same Song", lyricsText: "Evening lyrics" },
      { id: "morning", kind: "pending", title: "Same Song", lyricsText: "Morning lyrics" },
    ]);
  });

  it("matches repeated library occurrences by key content and preserves their IDs", () => {
    const current = [section("section-1", "Praise", [
      element("element-1", "Worship Set", {
        sourcePlanningManaged: true,
        songRefs: [
          { id: "key-c", kind: "library", songId: "song-1", songName: "Same Song", key: "C" },
          { id: "key-g", kind: "library", songId: "song-1", songName: "Same Song", key: "G" },
        ],
      }),
    ])];
    const imported = [section("source", "Praise", [
      element("incoming", "Worship Set", {
        songRefs: [
          { kind: "library", songId: "song-1", songName: "Same Song", key: "G" },
          { kind: "library", songId: "song-1", songName: "Same Song", key: "C" },
        ],
      }),
    ])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "key-g", kind: "library", songId: "song-1", songName: "Same Song", key: "G" },
      { id: "key-c", kind: "library", songId: "song-1", songName: "Same Song", key: "C" },
    ]);
  });

  it("does not preserve one of multiple same-title library links for an ambiguous pending occurrence", () => {
    const current = [section("section-1", "Praise", [
      element("element-1", "Worship Set", {
        sourcePlanningManaged: true,
        songRefs: [
          { id: "linked-one", kind: "library", songId: "song-1", songName: "Same Song" },
          { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
        ],
      }),
    ])];
    const imported = [section("source", "Praise", [
      element("incoming", "Worship Set", {
        songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "New lyrics" }],
      }),
    ])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].songRefs).toEqual([
      { kind: "pending", title: "Same Song", lyricsText: "New lyrics" },
    ]);
  });

  it("treats adjacent same-format spans as the same note without adding spaces", () => {
    const current = [section("section-1", "Praise", [element("element-1", "Welcome", {
      sourcePlanningManaged: true,
      notes: { blocks: [{ type: "paragraph", id: "old", spans: [{ text: "Sun", bold: true }, { text: "day", bold: true }] }] },
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Welcome", {
      notes: { blocks: [{ type: "paragraph", id: "new", spans: [{ text: "Sunday", bold: true }] }] },
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].notes).toEqual(current[0].elements[0].notes);
    expect(summarizeServicePlanImport(current, [refreshed]).changes).toEqual([]);
  });

  it("makes a repeated refresh a no-op for equivalent songs, scripture, title, timing, and notes", () => {
    const current = [section("section-1", "Praise", [
      element("element-1", "Welcome", {
        sourcePlanningManaged: true,
        songRefs: [{ id: "song-occurrence", kind: "library", songId: "song-1", songName: "Welcome Song" }],
        scriptureRefs: [{ id: "scripture-occurrence", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
        durationSeconds: 120,
        startTime: "09:00",
        notes: plainTextToRichText("A shared note"),
        servicePlanningImport: {
          observed: { elementType: "Song", title: "Welcome", ledBy: "Avery", note: "A shared note" },
          applied: { elementType: "Song", title: "Welcome", ledBy: "Avery", note: "A shared note" },
          pendingFields: [],
        },
      }),
    ])];
    const imported = [section("source", "Praise", [
      element("incoming", " Welcome ", {
        songRefs: [{ kind: "library", songId: "song-1", songName: "Welcome Song" }],
        scriptureRefs: [{ id: "new-scripture-id", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
        durationMinutes: 2,
        startTime: " 09:00 ",
        notes: plainTextToRichText("A shared note"),
        sourceElementTypeRaw: "Song",
        servicePlanningImport: {
          observed: { elementType: "Song", title: "Welcome", ledBy: "Avery", note: "A shared note" },
          applied: { elementType: "Song", title: "Welcome", ledBy: "Avery", note: "A shared note" },
          pendingFields: [],
        },
      }),
    ])];

    const [once] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const [twice] = refreshServicePlanFromImport([once], imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(once.elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(once.elements[0].scriptureRefs).toEqual(current[0].elements[0].scriptureRefs);
    expect(twice.elements[0]).toEqual(once.elements[0]);
    expect(summarizeServicePlanImport([once], [twice])).toEqual({
      changes: [], added: 0, removed: 0, updated: 0,
    });
  });

  it("keeps an unchanged parsed import idempotent through reconciliation, review, and selected apply", () => {
    const source: ServicePlanningImportData = {
      planLabel: "Sunday worship",
      sections: [{
        sectionName: "Praise",
        rows: [{ elementType: "Song", title: "Way Maker", ledBy: "Avery", songTitle: "Way Maker" }],
      }],
      teamAssignments: [],
    };
    const parsed = buildServicePlanSectionsFromImport(source, [{ _id: "song-1", name: "Way Maker" }]);
    const current = [section("section-1", "Praise", [element("element-1", "Way Maker", {
      sourcePlanningManaged: true,
      sourceElementTypeRaw: "Song",
      sourceContentTitleRaw: "Way Maker",
      sourceLedByRaw: "Avery",
      songRefs: [{ id: "song-occurrence", kind: "library", songId: "song-1", songName: "Way Maker" }],
      assignees: [{ id: "assignee-1", name: "Avery", microphoneIds: ["mic-1"] }],
      servicePlanningImport: {
        observed: { elementType: "Song", title: "Way Maker", ledBy: "Avery", note: "" },
        applied: { elementType: "Song", title: "Way Maker", ledBy: "Avery", note: "" },
        pendingFields: [],
      },
    })])];

    const refreshed = refreshServicePlanFromImport(current, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, refreshed);
    const applied = applySelectedServicePlanImportChanges(
      current,
      refreshed,
      summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );
    const repeated = refreshServicePlanFromImport(applied, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(summary).toEqual({ changes: [], added: 0, removed: 0, updated: 0 });
    expect(applied[0].elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(applied[0].elements[0].assignees).toEqual(current[0].elements[0].assignees);
    expect(summarizeServicePlanImport(applied, repeated)).toEqual({
      changes: [], added: 0, removed: 0, updated: 0,
    });
  });

  it("parses multiple songs, reconciles them, and applies one reviewed item without disturbing a skipped item", () => {
    const source: ServicePlanningImportData = {
      planLabel: "Sunday worship",
      sections: [{
        sectionName: "Praise",
        rows: [
          { elementType: "Song", title: "First Song (D)", songTitle: "First Song (D)", ledBy: "" },
          { elementType: "Song", title: "Second Song (A)", songTitle: "Second Song (A)", ledBy: "" },
        ],
      }],
      teamAssignments: [],
    };
    const parsed = buildServicePlanSectionsFromImport(source, [
      { _id: "song-first", name: "First Song" },
      { _id: "song-second", name: "Second Song" },
    ]);
    const confirmed = {
      source: "servicePlanning" as const,
      sourceKey: "Praise:1",
      sourceElementType: "Song",
      sourceTitle: "Second Song",
      sourceLedBy: "",
      parts: [],
      reasons: [],
      status: "confirmed" as const,
      sourceFingerprint: "confirmed-second-song",
    };
    const current = [section("section-1", "Praise", [
      element("first", "First Song", {
        type: "song",
        sourcePlanningManaged: true,
        songRefs: [{ id: "first-occurrence", kind: "library", songId: "song-first", songName: "First Song", key: "C" }],
      }),
      element("second", "Second Song", {
        type: "song",
        sourcePlanningManaged: true,
        songRefs: [{ id: "second-occurrence", kind: "library", songId: "song-second", songName: "Second Song", key: "G" }],
        assignees: [{ id: "local-assignee", name: "Avery", microphoneIds: ["mic-1"] }],
        teamNotes: [{ id: "role-note", scope: "role", positionId: "camera", label: "Media · Camera", note: plainTextToRichText("Keep the wide shot.") }],
        importAmbiguity: confirmed,
      }),
    ])];

    const reconciled = refreshServicePlanFromImport(current, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, reconciled);
    const firstChange = summary.changes.find(({ id, itemName }) => id === "first" || itemName.includes("First Song"));
    expect(firstChange).toBeDefined();
    const applied = applySelectedServicePlanImportChanges(
      current,
      reconciled,
      summary,
      new Set(firstChange ? [servicePlanImportChangeKey(firstChange)] : []),
    );

    expect(summary.changes).toHaveLength(2);
    expect(applied[0].elements.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(applied[0].elements[0].songRefs).toEqual([
      { id: "first-occurrence", kind: "library", songId: "song-first", songName: "First Song", key: "D" },
    ]);
    expect(applied[0].elements[1]).toEqual(current[0].elements[1]);
    expect(summarizeServicePlanImport(applied, reconciled).changes.map(({ id }) => id)).toEqual(["second"]);
  });

  it("preserves a confirmed interpretation and its edited destinations on an unchanged refresh", () => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Reading the Word",
      sourceTitle: "Psalms 97 Jasmine Williams",
      sourceLedBy: "Jeriyah Brown",
      parts: [
        { kind: "scripture" as const, value: "Psalms 97", destination: "scripture" as const },
        { kind: "person" as const, value: "Jasmine Williams", destination: "assignee" as const },
      ],
      reasons: [],
      status: "confirmed" as const,
      sourceFingerprint: '["Reading the Word","Psalms 97 Jasmine Williams","Jeriyah Brown",""]',
    };
    const current = [section("s1", "Worship", [element("e1", "Reading the Word", {
      sourcePlanningManaged: true,
      importAmbiguity: ambiguity,
      assignees: [{ id: "a1", name: "Jeriyah Brown" }, { id: "a2", name: "Jasmine Williams" }],
      notes: plainTextToRichText("Operator-selected description"),
      scriptureRefs: [{ id: "b1", label: "Psalms 97", book: "Psalms", chapter: "97", verseRange: "", version: "" }],
    })])];
    const imported = [section("source", "Worship", [element("incoming", "Reading the Word", {
      importAmbiguity: { ...ambiguity, status: "unresolved" },
      assignees: [{ id: "new", name: "Jeriyah Brown" }],
      notes: plainTextToRichText(""),
      scriptureRefs: [{ label: "Psalms 97", book: "Psalms", chapter: "97", verseRange: "", version: "" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].importAmbiguity?.status).toBe("confirmed");
    expect(refreshed.elements[0].assignees?.map(({ name }) => name)).toEqual(["Jeriyah Brown", "Jasmine Williams"]);
    expect(richTextToPlainText(refreshed.elements[0].notes)).toBe("Operator-selected description");
  });

  it("keeps a deferred ambiguity record without making it a new import change", () => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Special Feature",
      sourceTitle: "Unknown title",
      sourceLedBy: "",
      parts: [{ kind: "description" as const, value: "Unknown title", destination: "content" as const }],
      reasons: ["Uncertain"],
      status: "deferred" as const,
      sourceFingerprint: '["Special Feature","Unknown title","",""]',
    };
    const current = [section("s1", "Worship", [element("e1", "Special Feature", { importAmbiguity: ambiguity })])];
    const imported = [section("source", "Worship", [element("incoming", "Special Feature", { importAmbiguity: { ...ambiguity, status: "unresolved" } })])];
    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].importAmbiguity).toEqual(ambiguity);
  });

  it("keeps a later library song link when an earlier slot is still pending", () => {
    const current = [
      section("section-1", "Praise", [
        element("element-1", "Worship Set", {
          sourcePlanningManaged: true,
          type: "song",
          songRefs: [
            { kind: "pending", title: "Opening Song", lyricsText: "" },
            {
              kind: "library",
              songId: "song-2",
              songName: "Great Are You Lord",
            },
          ],
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Praise", [
        element("source-element", "Worship Set", {
          type: "song",
          songRefs: [
            {
              kind: "pending",
              title: "Opening Song",
              lyricsText: "new lyrics",
            },
            { kind: "pending", title: "Great Are You Lord", lyricsText: "" },
          ],
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].songRefs).toEqual([
      { kind: "pending", title: "Opening Song", lyricsText: "new lyrics" },
      { kind: "library", songId: "song-2", songName: "Great Are You Lord" },
    ]);
  });

  it("drops the song when the source no longer names one", () => {
    const current = [
      section("section-1", "Praise", [
        element("element-1", "Call to Praise", {
          sourcePlanningManaged: true,
          type: "song",
          songRef: { kind: "pending", title: "Call to Praise", lyricsText: "" },
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Praise", [
        element("source-element", "Call to Praise", { type: "free" }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].songRef).toBeUndefined();
    expect(refreshed[0].elements[0].type).toBe("free");
  });

  it("does not let a source row consume a local item with the same title", () => {
    const current = [
      section("section-1", "Welcome", [
        element("imported-1", "Pastoral Greetings", {
          sourcePlanningManaged: true,
        }),
        element("local-1", "Welcome", {
          sourcePlanningManaged: false,
          startTime: "09:30",
          notes: plainTextToRichText("My own note"),
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Welcome", [
        element("source-1", "Pastoral Greetings"),
        element("source-2", "Welcome", {
          startTime: "11:10",
          notes: plainTextToRichText("Source note"),
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    const local = refreshed[0].elements.find((item) => item.id === "local-1");
    expect(local?.sourcePlanningManaged).toBe(false);
    expect(local?.startTime).toBe("09:30");
    expect(richTextToPlainText(local?.notes)).toBe("My own note");
    // The source row it collided with arrives as its own item instead.
    expect(refreshed[0].elements).toHaveLength(3);
  });

  it("still refreshes by title on a plan with no provenance at all", () => {
    // Nothing is marked, so a title is the only handle a legacy plan gives us —
    // pairing has to stay allowed or every source row would arrive twice.
    const current = [
      section(
        "section-1",
        "Welcome",
        [element("legacy-1", "Pastoral Greetings")],
        false,
      ),
    ];
    const imported = [
      section("source-section", "Welcome", [
        element("source-1", "Pastoral Greetings", { startTime: "11:00" }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements).toHaveLength(1);
    expect(refreshed[0].elements[0].id).toBe("legacy-1");
    expect(refreshed[0].elements[0].startTime).toBe("11:00");
  });

  it("pairs a legacy content-title item with its new Element label", () => {
    const current = [
      section(
        "section-1",
        "Music",
        [
          element("legacy-1", "Trust and Obey", {
            type: "song",
            songRef: {
              kind: "library",
              songId: "song-1",
              songName: "Trust and Obey",
            },
          }),
        ],
        false,
      ),
    ];
    const imported = [
      section("source-section", "Music", [
        element("source-1", "Special Music", {
          type: "song",
          sourceElementTypeRaw: "Special Music",
          sourceContentTitleRaw: "Trust and Obey",
          songRef: {
            kind: "pending",
            title: "Trust and Obey",
            lyricsText: "",
          },
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements).toHaveLength(1);
    expect(refreshed[0].elements[0].id).toBe("legacy-1");
    expect(richTextToPlainText(refreshed[0].elements[0].title)).toBe(
      "Special Music",
    );
    expect(refreshed[0].elements[0].sourceContentTitleRaw).toBe(
      "Trust and Obey",
    );
    expect(refreshed[0].elements[0].songRef).toEqual({
      kind: "library",
      songId: "song-1",
      songName: "Trust and Obey",
    });
  });

  it("keeps local additions on a tracked plan even when told to treat unmarked items as source", () => {
    // The opt-in exists for legacy plans. On a plan that records provenance,
    // an unmarked item is the operator's and removal must not reach it.
    const current = [
      section("section-1", "Welcome", [
        element("imported-1", "Pastoral Greetings", {
          sourcePlanningManaged: true,
        }),
        element("local-1", "Baby dedication", { sourcePlanningManaged: false }),
      ]),
    ];
    const imported = [
      section("source-section", "Welcome", [
        element("source-1", "Pastoral Greetings"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(current, imported, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      removeMissing: true,
      treatUnmarkedItemsAsSource: true,
    });

    expect(refreshed[0].elements.map((item) => item.id)).toEqual([
      "imported-1",
      "local-1",
    ]);
  });

  it("removes only missing source-managed items when removal is chosen", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Welcome", { sourcePlanningManaged: true }),
        element("element-2", "Deleted from source", {
          sourcePlanningManaged: true,
        }),
        element("element-3", "Local addition", {
          sourcePlanningManaged: false,
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-element", "Welcome"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(current, imported, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      addMissing: false,
      removeMissing: true,
    });

    expect(refreshed[0].elements.map((item) => item.id)).toEqual([
      "element-1",
      "element-3",
    ]);
  });

  it("keeps source items that disappear when removal is not selected", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Welcome", { sourcePlanningManaged: true }),
        element("element-2", "Keep me", { sourcePlanningManaged: true }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-element", "Welcome"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(current, imported, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      addMissing: false,
    });

    expect(refreshed[0].elements.map((item) => item.id)).toEqual([
      "element-1",
      "element-2",
    ]);
  });

  it("keeps an unmatched local item when adding a new source item", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Welcome", { sourcePlanningManaged: true }),
        element("local-item", "Local announcement", {
          sourcePlanningManaged: false,
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-welcome", "Welcome"),
        element("source-new", "Call to worship"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );
    const elements = refreshed[0].elements;

    expect(elements.map((item) => item.id)).toEqual([
      "element-1",
      "local-item",
      "source-new",
    ]);
    expect(richTextToPlainText(elements[1].title)).toBe("Local announcement");
    expect(elements[1].sourcePlanningManaged).toBe(false);
    expect(elements[2].sourcePlanningManaged).toBe(true);
  });

  it("adds unfamiliar source sections beside matched neighbors without consuming existing sections", () => {
    const current = [
      section("scratch", "Section", [
        element("together", "Together", { sourcePlanningManaged: false }),
        element("welcome-video", "Welcome Video", {
          sourcePlanningManaged: true,
        }),
      ]),
      section("teaching", "Teaching & Mission", [
        element("mission", "Mission Story", { sourcePlanningManaged: true }),
      ]),
      section("response", "Response & Celebration", [
        element("appeal", "Appeal Song", { sourcePlanningManaged: true }),
      ]),
      section("end", "End of Service", [
        element("stream-end", "End Online Stream", {
          sourcePlanningManaged: true,
        }),
      ]),
    ];
    const imported = [
      section("source-teaching", "Teaching & Mission", [
        element("source-mission", "Mission Story"),
      ]),
      section("source-response", "Response & Celebration", [
        element("source-appeal", "Appeal Song"),
      ]),
      section("source-gathering", "Gathering & Worship", [
        element("source-song", "Song of Praise"),
        element("source-welcome", "Welcome"),
        element("source-reading", "Reading the Word"),
      ]),
      section("source-communion", "Communion", [
        element("source-prayer", "Prayer"),
      ]),
      section("source-closing", "Closing", [
        element("source-stream-end", "End Online Stream"),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed.map((item) => item.name)).toEqual([
      "Section",
      "Teaching & Mission",
      "Response & Celebration",
      "Gathering & Worship",
      "Communion",
      "Closing",
      "End of Service",
    ]);
    expect(
      refreshed
        .find((item) => item.id === "scratch")
        ?.elements.map((item) => richTextToPlainText(item.title)),
    ).toEqual(["Together", "Welcome Video"]);
    expect(
      refreshed
        .find((item) => item.id === "source-gathering")
        ?.elements.map((item) => richTextToPlainText(item.title)),
    ).toEqual(["Song of Praise", "Welcome", "Reading the Word"]);
  });

  it("keeps local role notes when refreshing imported team notes", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Welcome", {
          sourcePlanningManaged: true,
          teamNotes: [
            {
              id: "role-note",
              scope: "role",
              positionId: "camera",
              label: "Media Team · Camera",
              note: plainTextToRichText("Stay wide for the welcome."),
            },
          ],
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-element", "Welcome", {
          teamNotes: [
            {
              id: "source-team-note",
              label: "Media Team",
              note: plainTextToRichText("Capture the greeting."),
            },
          ],
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].teamNotes).toEqual([
      expect.objectContaining({ id: "source-team-note", label: "Media Team" }),
      expect.objectContaining({
        id: "role-note",
        scope: "role",
        positionId: "camera",
      }),
    ]);
  });

  it("keeps matching imported team-note IDs on a repeated refresh", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Welcome", {
          sourcePlanningManaged: true,
          teamNotes: [
            {
              id: "existing-media-note",
              label: "Media Team",
              note: plainTextToRichText("Capture the greeting."),
            },
          ],
        }),
      ]),
    ];
    const imported = [
      section("source-section", "Worship", [
        element("source-element", "Welcome", {
          teamNotes: [
            {
              id: "newly-parsed-media-note",
              label: "Media Team",
              note: plainTextToRichText("Capture the greeting."),
            },
          ],
        }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(
      current,
      imported,
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].teamNotes?.[0].id).toBe(
      "existing-media-note",
    );
  });
});

describe("mergeImportedAssignees", () => {
  const withAssignees = (
    overrides: Partial<ServicePlanElement> = {},
  ): ServicePlanElement => ({
    id: "el-1",
    type: "free",
    title: plainTextToRichText("Welcome"),
    ...overrides,
  });

  it("takes the source's name while keeping the local microphone plan", () => {
    const merged = mergeImportedAssignees(
      withAssignees({
        assignees: [{ id: "a1", name: "Avery", microphoneIds: ["mic-orange"] }],
      }),
      withAssignees({ assignees: [{ id: "imported", name: "Blair" }] }),
    );

    expect(merged).toEqual([
      { id: "a1", name: "Blair", microphoneIds: ["mic-orange"] },
    ]);
  });

  it("keeps microphones with the person when the source reorders them", () => {
    const merged = mergeImportedAssignees(
      withAssignees({
        assignees: [
          { id: "a1", name: "Avery", microphoneIds: ["mic-orange"] },
          { id: "a2", name: "Sam", microphoneIds: ["mic-lapel"] },
        ],
      }),
      withAssignees({
        assignees: [
          { id: "imported-sam", name: "Sam" },
          { id: "imported-avery", name: "Avery" },
        ],
      }),
    );

    expect(merged).toEqual([
      { id: "a2", name: "Sam", microphoneIds: ["mic-lapel"] },
      { id: "a1", name: "Avery", microphoneIds: ["mic-orange"] },
    ]);
  });

  it("keeps local microphones the source does not name as an unassigned slot", () => {
    const merged = mergeImportedAssignees(
      withAssignees({
        assignees: [
          { id: "a1", name: "Avery" },
          { id: "a2", name: "Sam", microphoneIds: ["mic-lapel"] },
        ],
      }),
      withAssignees({ assignees: [{ id: "imported", name: "Blair" }] }),
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ name: "Blair" });
    // The person the source dropped goes; the microphone they held does not.
    expect(merged[1]).toEqual({ id: "a2", microphoneIds: ["mic-lapel"] });
  });

  it("unassigns rather than deletes when the source lists nobody", () => {
    const merged = mergeImportedAssignees(
      withAssignees({
        assignees: [{ id: "a1", name: "Avery", microphoneIds: ["mic-orange"] }],
      }),
      withAssignees(),
    );

    expect(merged).toEqual([{ id: "a1", microphoneIds: ["mic-orange"] }]);
  });

  it("drops a name the source cleared when nothing was being carried", () => {
    const merged = mergeImportedAssignees(
      withAssignees({ assignees: [{ id: "a1", name: "Avery" }] }),
      withAssignees(),
    );

    expect(merged).toEqual([]);
  });
});

describe("refresh source snapshots and field selections", () => {
  const source = (title: string, ledBy: string, note = "") => ({
    elementType: "Reading",
    title,
    ledBy,
    note,
  });

  it("records a changed title when Update titles is off without applying it or disturbing assignments", () => {
    const currentElement = element("same", "Old title", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Old title",
      assignees: [{ id: "manual", name: "Operator choice", microphoneIds: ["mic-1"] }],
      importAmbiguity: {
        source: "servicePlanning",
        sourceKey: "Reading:0",
        sourceElementType: "Reading",
        sourceTitle: "Old title",
        sourceLedBy: "Old source person",
        parts: [{ kind: "description", value: "Old title", destination: "content", sourceField: "title" }],
        reasons: [],
        status: "confirmed",
        sourceFingerprint: "old-source",
      },
      servicePlanningImport: {
        observed: source("Old title", "Old source person"),
        applied: source("Old title", "Old source person"),
        pendingFields: [],
      },
    });
    const incomingElement = element("new", "New title", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "New title",
      assignees: [{ id: "new-person", name: "New source person" }],
      importAmbiguity: {
        source: "servicePlanning",
        sourceKey: "Reading:0",
        sourceElementType: "Reading",
        sourceTitle: "New title",
        sourceLedBy: "New source person",
        parts: [{ kind: "description", value: "New title", destination: "content", sourceField: "title" }],
        reasons: ["Review the remaining title text."],
        status: "unresolved",
        sourceFingerprint: "new-source",
      },
      servicePlanningImport: {
        observed: source("New title", "New source person"),
        applied: source("New title", "New source person"),
        pendingFields: [],
      },
    });
    const [refreshed] = refreshServicePlanFromImport(
      [section("current", "Reading", [currentElement])],
      [section("source", "Reading", [incomingElement])],
      { ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, updateTitles: false, updateAssignments: false },
    );
    const result = refreshed.elements[0];

    expect(richTextToPlainText(result.title)).toBe("Old title");
    expect(result.assignees).toEqual([{ id: "manual", name: "Operator choice", microphoneIds: ["mic-1"] }]);
    expect(result.importAmbiguity?.status).toBe("confirmed");
    expect(result.importAmbiguity?.sourceTitle).toBe("New title");
    expect(result.servicePlanningImport).toEqual({
      observed: source("New title", "New source person"),
      applied: source("Old title", "Old source person"),
      pendingFields: ["title", "ledBy"],
    });
  });

  it("keeps a declined Led By change pending without applying the source assignee", () => {
    const currentElement = element("same", "Welcome", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Welcome",
      sourceLedByRaw: "Old source person",
      assignees: [{ id: "operator", name: "Manual person", microphoneIds: ["mic-a"] }],
      servicePlanningImport: {
        observed: source("Welcome", "Old source person"),
        applied: source("Welcome", "Old source person"),
        pendingFields: [],
      },
    });
    const incomingElement = element("fresh", "Welcome", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Welcome",
      sourceLedByRaw: "New source person",
      assignees: [{ id: "source", name: "New source person" }],
      servicePlanningImport: {
        observed: source("Welcome", "New source person"),
        applied: source("Welcome", "New source person"),
        pendingFields: [],
      },
    });
    const [refreshed] = refreshServicePlanFromImport(
      [section("current", "Welcome", [currentElement])],
      [section("source", "Welcome", [incomingElement])],
      { ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, updateAssignments: false },
    );

    expect(refreshed.elements[0].assignees).toEqual(currentElement.assignees);
    expect(refreshed.elements[0].sourceLedByRaw).toBe("Old source person");
    expect(refreshed.elements[0].servicePlanningImport?.pendingFields).toEqual(["ledBy"]);
    expect(refreshed.elements[0].servicePlanningImport?.observed.ledBy).toBe("New source person");
  });
});

// A template's microphone plan lands as unclaimed slots. An import brings the
// week's people, and the order pass hands the microphones out down the list —
// this is what makes "3 mics, 3 people" need no manual work at all.
describe("handing a template's microphone plan to imported people", () => {
  const planned = (
    microphoneIdsPerSlot: string[][],
  ): ServicePlanElement => ({
    id: "el-1",
    type: "free",
    title: plainTextToRichText("Worship set"),
    assignees: microphoneIdsPerSlot.map((microphoneIds, index) => ({
      id: `slot-${index + 1}`,
      microphoneIds,
    })),
  });

  const imported = (...names: string[]): ServicePlanElement => ({
    id: "el-1",
    type: "free",
    title: plainTextToRichText("Worship set"),
    assignees: names.map((name, index) => ({ id: `imported-${index}`, name })),
  });

  it("gives each person the next microphone in plan order", () => {
    const merged = mergeImportedAssignees(
      planned([["mic-a"], ["mic-b"], ["mic-c"]]),
      imported("Avery", "Blair", "Sam"),
    );

    expect(merged.map((assignee) => [assignee.name, assignee.microphoneIds])).toEqual([
      ["Avery", ["mic-a"]],
      ["Blair", ["mic-b"]],
      ["Sam", ["mic-c"]],
    ]);
  });

  it("leaves a fourth person without one rather than inventing a microphone", () => {
    const merged = mergeImportedAssignees(
      planned([["mic-a"], ["mic-b"], ["mic-c"]]),
      imported("Avery", "Blair", "Sam", "Jordan"),
    );

    expect(merged).toHaveLength(4);
    expect(merged[3]).toMatchObject({ name: "Jordan" });
    expect(merged[3].microphoneIds).toBeUndefined();
  });

  it("keeps a spare microphone unclaimed when fewer people turn up", () => {
    const merged = mergeImportedAssignees(
      planned([["mic-a"], ["mic-b"], ["mic-c"]]),
      imported("Avery", "Blair"),
    );

    expect(merged).toHaveLength(3);
    expect(merged[2]).toEqual({ id: "slot-3", microphoneIds: ["mic-c"] });
  });

  it("hands a whole slot to one group, so a choir keeps its three", () => {
    const merged = mergeImportedAssignees(
      planned([["mic-a"], ["choir-l", "choir-r", "choir-c"]]),
      imported("Avery", "Chorale"),
    );

    expect(merged[1]).toMatchObject({
      name: "Chorale",
      microphoneIds: ["choir-l", "choir-r", "choir-c"],
    });
  });
});
