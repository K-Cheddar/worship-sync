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
import { servicePlanResourceFingerprint } from "./servicePlanImportOwnership";
import { applyReviewedServicePlanParts } from "./servicePlanImportOwnership";
import { createServicePlanTextResource } from "./servicePlanResources";
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

  it("reopens an unresolved row when source text changes without changing extracted parts", () => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Special Feature",
      sourceTitle: "Unknown free-text Title",
      sourceLedBy: "",
      parts: [{ kind: "description" as const, value: "Unknown free-text Title", destination: "content" as const }],
      reasons: ["The title could be descriptive content or an assignee."],
      status: "unresolved" as const,
      sourceFingerprint: "old-source",
    };
    const current = [section("s1", "Worship", [element("e1", "Special Feature", { importAmbiguity: ambiguity })])];
    const next = [section("s1", "Worship", [element("e1", "Special Feature", {
      importAmbiguity: {
        ...ambiguity,
        sourceTitle: "Unknown free-text Title, revised",
        sourceFingerprint: "new-source",
      },
    })])];

    expect(getNewServicePlanImportAmbiguityIds(current, next)).toEqual(["e1"]);
  });

  it("does not repeat review for source whitespace changes with the same interpretation", () => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Special Feature",
      sourceTitle: "Unknown free-text Title",
      sourceLedBy: "",
      parts: [{ kind: "description" as const, value: "Unknown free-text Title", destination: "content" as const }],
      reasons: ["The title could be descriptive content or an assignee."],
      status: "deferred" as const,
      sourceFingerprint: "old-source",
    };
    const current = [section("s1", "Worship", [element("e1", "Special Feature", { importAmbiguity: ambiguity })])];
    const next = [section("s1", "Worship", [element("e1", "Special Feature", {
      importAmbiguity: {
        ...ambiguity,
        sourceTitle: "Unknown  free-text\nTitle",
        sourceFingerprint: "new-source",
        status: "unresolved",
      },
    })])];

    expect(getNewServicePlanImportAmbiguityIds(current, next)).toEqual([]);
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
    expect(refreshed.elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(refreshed.elements[0].importAmbiguity?.status).toBe("unresolved");
    expect(refreshed.elements[0].importAmbiguity?.songMappings).toEqual([{
      incoming: { kind: "pending", title: "Same Song", lyricsText: "New lyrics" },
      candidateOccurrenceIds: ["linked-one", "linked-two"],
      sourceFingerprint: JSON.stringify(["same song", "New lyrics", ""]),
    }]);
    expect(summarizeServicePlanImport(current, [refreshed]).changes[0]?.fields.map(({ label }) => label)).toContain("Import interpretation");
  });

  it("keeps a matched pending song occurrence ID when changed lyrics arrive with another ID", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [{ id: "stable-pending", kind: "pending", title: "New Song", lyricsText: "old lyrics" }],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      songRefs: [{ id: "generated-new", kind: "pending", title: "New Song", lyricsText: "new lyrics" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, [refreshed]);

    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "stable-pending", kind: "pending", title: "New Song", lyricsText: "new lyrics" },
    ]);
    expect(summary.changes[0]?.fields.map(({ label, before, after }) => ({ label, before, after }))).toContainEqual({
      label: "Song", before: "New Song (Lyrics: old lyrics)", after: "New Song (Lyrics: new lyrics)",
    });
  });

  it("keeps a matched library occurrence ID when its key changes and the import supplies another ID", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [{ id: "stable-library", kind: "library", songId: "song-1", songName: "New Song", key: "C" }],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      songRefs: [{ id: "generated-new", kind: "library", songId: "song-1", songName: "New Song", key: "D" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, [refreshed]);

    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "stable-library", kind: "library", songId: "song-1", songName: "New Song", key: "D" },
    ]);
    expect(summary.changes[0]?.fields).toContainEqual({ label: "Song", before: "New Song (Key C)", after: "New Song (Key D)" });
  });

  it("does not transfer an occurrence ID to an unrelated replacement song", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [{ id: "old-song", kind: "pending", title: "Old Song", lyricsText: "old lyrics" }],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      songRefs: [{ id: "new-song", kind: "pending", title: "Unrelated Song", lyricsText: "new lyrics" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "new-song", kind: "pending", title: "Unrelated Song", lyricsText: "new lyrics" },
    ]);
  });

  it("keeps changed duplicate songs in source order with their matching occurrence IDs", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [
        { id: "morning", kind: "pending", title: "Same Song", lyricsText: "morning lyrics" },
        { id: "evening", kind: "pending", title: "Same Song", lyricsText: "evening lyrics" },
      ],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      songRefs: [
        { id: "new-evening", kind: "pending", title: "Same Song", lyricsText: "evening lyrics" },
        { id: "new-morning", kind: "pending", title: "Same Song", lyricsText: "morning lyrics" },
      ],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed.elements[0].songRefs).toEqual([
      { id: "evening", kind: "pending", title: "Same Song", lyricsText: "evening lyrics" },
      { id: "morning", kind: "pending", title: "Same Song", lyricsText: "morning lyrics" },
    ]);
  });

  it("reports a genuinely removed song without creating a mapping ambiguity", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [{ id: "linked", kind: "library", songId: "song-1", songName: "Same Song" }],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", { songRefs: [] })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed.elements[0].songRefs).toEqual([]);
    expect(refreshed.elements[0].importAmbiguity?.songMappings).toBeUndefined();
    expect(summarizeServicePlanImport(current, [refreshed]).changes[0]?.fields.map(({ label }) => label)).toContain("Song");
  });

  it("does not reopen a confirmed keep-links choice on an unchanged import", () => {
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [
        { id: "linked-one", kind: "library", songId: "song-1", songName: "Same Song" },
        { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
      ],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Praise:0", sourceElementType: "Song", sourceTitle: "Worship Set",
        sourceLedBy: "", parts: [], reasons: [], status: "confirmed", sourceFingerprint: "source",
        songMappings: [{
          incoming: { kind: "pending", title: "Same Song", lyricsText: "New lyrics" },
          candidateOccurrenceIds: ["linked-one", "linked-two"],
          sourceFingerprint: JSON.stringify(["same song", "New lyrics", ""]),
          resolution: { kind: "keep" },
        }],
      },
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      sourceElementTypeRaw: "Song", sourceContentTitleRaw: "Worship Set",
      songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "New lyrics" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed.elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(refreshed.elements[0].importAmbiguity?.status).toBe("confirmed");
    expect(getNewServicePlanImportAmbiguityIds(current, [refreshed])).toEqual([]);
    expect(summarizeServicePlanImport(current, [refreshed]).changes).toEqual([]);

    const changedImport = [section("source", "Praise", [element("incoming", "Worship Set", {
      sourceElementTypeRaw: "Song", sourceContentTitleRaw: "Worship Set",
      songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "Changed lyrics" }],
    })])];
    const changedRefresh = refreshServicePlanFromImport([refreshed], changedImport, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(changedRefresh[0].elements[0].importAmbiguity?.status).toBe("unresolved");
    expect(summarizeServicePlanImport([refreshed], changedRefresh).changes[0]?.fields.map(({ label }) => label)).toContain("Import interpretation");
  });

  it("keeps the unselected duplicate link after an explicitly confirmed replacement", () => {
    const sourceFingerprint = JSON.stringify(["same song", "New lyrics", ""]);
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      songRefs: [
        { id: "incoming-occurrence", kind: "pending", title: "Same Song", lyricsText: "New lyrics" },
        { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
      ],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Praise:0", sourceElementType: "Song", sourceTitle: "Worship Set",
        sourceLedBy: "", parts: [], reasons: [], status: "confirmed", sourceFingerprint: "source",
        songMappings: [{
          incoming: { kind: "pending", title: "Same Song", lyricsText: "New lyrics" },
          candidateOccurrenceIds: ["linked-one", "linked-two"],
          sourceFingerprint,
          resolution: { kind: "replace", occurrenceId: "linked-one" },
        }],
      },
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      sourceElementTypeRaw: "Song", sourceContentTitleRaw: "Worship Set",
      songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "New lyrics" }],
    })])];

    const [repeated] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(repeated.elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(repeated.elements[0].importAmbiguity?.status).toBe("confirmed");
    expect(summarizeServicePlanImport(current, [repeated]).changes).toEqual([]);
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

  it("parses an ambiguous song, reviews it, applies safely, defers it, and stays quiet on repeat", () => {
    const source: ServicePlanningImportData = {
      planLabel: "Sunday worship",
      sections: [{
        sectionName: "Praise",
        rows: [{ elementType: "Song", title: "Same Song", songTitle: "Same Song", ledBy: "", note: "Keep this local note" }],
      }],
      teamAssignments: [],
    };
    const parsed = buildServicePlanSectionsFromImport(source, []);
    expect(parsed[0].elements[0].songRef?.kind).toBe("pending");
    const current = [section("section", "Praise", [element("service-song", "Same Song", {
      sourcePlanningManaged: true,
      type: "song",
      sourceElementTypeRaw: "Song",
      sourceContentTitleRaw: "Same Song",
      songRefs: [
        { id: "linked-one", kind: "library", songId: "song-one", songName: "Same Song", key: "C" },
        { id: "linked-two", kind: "library", songId: "song-two", songName: "Same Song", key: "G" },
      ],
      notes: plainTextToRichText("Keep this local note"),
      teamNotes: [{ id: "role-note", scope: "role", positionId: "band", label: "Band", note: plainTextToRichText("Keep the local cue") }],
    })])];

    const reconciled = refreshServicePlanFromImport(current, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, reconciled);
    const applied = applySelectedServicePlanImportChanges(
      current,
      reconciled,
      summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );
    const appliedElement = applied[0].elements[0];
    expect(appliedElement.songRefs).toEqual(current[0].elements[0].songRefs);
    expect(richTextToPlainText(appliedElement.notes)).toBe("Keep this local note");
    expect(appliedElement.teamNotes).toEqual(current[0].elements[0].teamNotes);
    expect(getNewServicePlanImportAmbiguityIds(current, applied)).toEqual(["service-song"]);

    const deferred = [{
      ...applied[0],
      elements: applied[0].elements.map((item) => item.id === "service-song" && item.importAmbiguity
        ? { ...item, importAmbiguity: { ...item.importAmbiguity, status: "deferred" as const } }
        : item),
    }];
    const repeated = refreshServicePlanFromImport(deferred, parsed, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(repeated[0].elements[0].songRefs).toEqual(current[0].elements[0].songRefs);
    expect(richTextToPlainText(repeated[0].elements[0].notes)).toBe("Keep this local note");
    expect(repeated[0].elements[0].importAmbiguity?.status).toBe("deferred");
    expect(getNewServicePlanImportAmbiguityIds(deferred, repeated)).toEqual([]);
    expect(summarizeServicePlanImport(deferred, repeated).changes).toEqual([]);
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

describe("refreshing reviewed source-owned occurrences", () => {
  const source = (title: string, ledBy: string) => ({
    elementType: "Reading the Word", title, ledBy, note: "",
  });

  it("updates Led By without restoring a Title person moved out of assignees", () => {
    const current = [section("current", "Reading", [element("same", "Reading the Word", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Psalms 97 (NLT) Jasmine Williams",
      sourceLedByRaw: "Jeriyah Brown",
      assignees: [{ id: "lead", name: "Jeriyah Brown", microphoneIds: ["mic-1"] }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word",
        sourceTitle: "Psalms 97 (NLT) Jasmine Williams", sourceLedBy: "Jeriyah Brown",
        parts: [{ kind: "person", value: "Jasmine Williams", destination: "content", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "initial",
      },
      servicePlanningImport: {
        observed: source("Psalms 97 (NLT) Jasmine Williams", "Jeriyah Brown"),
        applied: source("Psalms 97 (NLT) Jasmine Williams", "Jeriyah Brown"), pendingFields: [],
      },
    })])];
    const imported = [section("source", "Reading", [element("incoming", "Reading the Word", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Psalms 97 (NLT) Jasmine Williams",
      sourceLedByRaw: "Courtney Stephens",
      assignees: [{ id: "incoming-lead", name: "Courtney Stephens" }, { id: "incoming-title", name: "Jasmine Williams" }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word",
        sourceTitle: "Psalms 97 (NLT) Jasmine Williams", sourceLedBy: "Courtney Stephens",
        parts: [{ kind: "person", value: "Jasmine Williams", destination: "assignee", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "updated-lead",
      },
      servicePlanningImport: {
        observed: source("Psalms 97 (NLT) Jasmine Williams", "Courtney Stephens"),
        applied: source("Psalms 97 (NLT) Jasmine Williams", "Courtney Stephens"), pendingFields: [],
      },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, refreshed);
    const applied = applySelectedServicePlanImportChanges(
      current, refreshed, summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );

    expect(applied[0].elements[0].assignees).toEqual([
      expect.objectContaining({ id: "lead", name: "Courtney Stephens", microphoneIds: ["mic-1"] }),
    ]);
    expect(applied[0].elements[0].assignees).toHaveLength(1);
  });

  it("retains manual assignees and their member and microphone links during accepted Led By updates", () => {
    const current = [section("current", "Reading", [element("same", "Reading", {
      sourcePlanningManaged: true, sourceLedByRaw: "Jeriyah Brown",
      assignees: [
        { id: "lead", name: "Jeriyah Brown", microphoneIds: ["mic-1"] },
        { id: "manual", name: "Operator choice", memberId: "member-7", microphoneIds: ["mic-2"] },
      ],
      servicePlanningImport: { observed: source("Reading", "Jeriyah Brown"), applied: source("Reading", "Jeriyah Brown"), pendingFields: [], managedAssignees: [{ id: "lead", fields: ["ledBy"], fingerprint: JSON.stringify({ name: "Jeriyah Brown" }) }] },
    })])];
    const imported = [section("source", "Reading", [element("incoming", "Reading", {
      sourcePlanningManaged: true, sourceLedByRaw: "Courtney Stephens",
      assignees: [{ id: "incoming", name: "Courtney Stephens" }],
      servicePlanningImport: { observed: source("Reading", "Courtney Stephens"), applied: source("Reading", "Courtney Stephens"), pendingFields: [], managedAssignees: [{ id: "incoming", fields: ["ledBy"], fingerprint: JSON.stringify({ name: "Courtney Stephens" }) }] },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed[0].elements[0].assignees).toEqual([
      expect.objectContaining({ id: "lead", name: "Courtney Stephens", microphoneIds: ["mic-1"] }),
      { id: "manual", name: "Operator choice", memberId: "member-7", microphoneIds: ["mic-2"] },
    ]);
  });

  it("keeps one assignee when the same person is sourced by Title and Led By", () => {
    const sourcePerson = {
      fields: ["title", "ledBy"] as Array<"title" | "ledBy">,
      ledByIdentity: "p-1",
      fingerprint: JSON.stringify({ name: "Jasmine Williams" }),
    };
    const current = [section("current", "Reading", [element("same", "Reading", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Reading Jasmine Williams", sourceLedByRaw: "Jasmine Williams",
      assignees: [{ id: "person", name: "Jasmine Williams", memberId: "member-1", microphoneIds: ["mic-1"] }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: "Reading Jasmine Williams",
        sourceLedBy: "Jasmine Williams", parts: [{ kind: "person", value: "Jasmine Williams", destination: "assignee", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "same-person",
      },
      servicePlanningImport: { observed: source("Reading Jasmine Williams", "Jasmine Williams"), applied: source("Reading Jasmine Williams", "Jasmine Williams"), pendingFields: [], managedAssignees: [{ id: "person", ...sourcePerson }] },
    })])];
    const imported = [section("source", "Reading", [element("incoming", "Reading", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Reading Jasmine Williams", sourceLedByRaw: "Jasmine Williams",
      assignees: [{ id: "incoming", name: "Jasmine Williams" }],
      importAmbiguity: { ...current[0].elements[0].importAmbiguity!, status: "confirmed" },
      servicePlanningImport: { observed: source("Reading Jasmine Williams", "Jasmine Williams"), applied: source("Reading Jasmine Williams", "Jasmine Williams"), pendingFields: [], managedAssignees: [{ id: "incoming", ...sourcePerson }] },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed[0].elements[0].assignees).toHaveLength(1);
    expect(refreshed[0].elements[0].assignees?.[0]).toMatchObject({ id: "person", name: "Jasmine Williams", memberId: "member-1", microphoneIds: ["mic-1"] });
  });

  it("replaces only the managed scripture while retaining an additional manual passage", () => {
    const oldRef = { id: "source-psalm", label: "Psalm 98", book: "Psalms", chapter: "98", verseRange: "", version: "" };
    const manualRef = { id: "manual-john", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "" };
    const current = [section("current", "Reading", [element("same", "Psalms 98", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Psalms 98",
      scriptureRefs: [oldRef, manualRef],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word",
        sourceTitle: "Psalms 98", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "Psalms 98", destination: "scripture", sourceField: "title",
          managed: { kind: "scripture", id: "source-psalm", fingerprint: JSON.stringify({ label: oldRef.label, book: oldRef.book, chapter: oldRef.chapter, verseRange: oldRef.verseRange, version: oldRef.version }) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "psalm-98",
      },
      servicePlanningImport: {
        observed: source("Psalms 98", ""), applied: source("Psalms 98", ""), pendingFields: [],
      },
    })])];
    const nextRef = { label: "Psalm 97", book: "Psalms", chapter: "97", verseRange: "", version: "" };
    const imported = [section("source", "Reading", [element("incoming", "Psalms 97", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Psalms 97",
      scriptureRefs: [nextRef],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word",
        sourceTitle: "Psalms 97", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "Psalms 97", destination: "scripture", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "psalm-97",
      },
      servicePlanningImport: {
        observed: source("Psalms 97", ""), applied: source("Psalms 97", ""), pendingFields: [],
      },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, refreshed);
    const applied = applySelectedServicePlanImportChanges(
      current, refreshed, summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );

    expect(applied[0].elements[0].scriptureRefs).toEqual([
      { ...nextRef, id: "source-psalm", label: "Psalms 97" }, manualRef,
    ]);
  });

  it("preserves a locally edited managed scripture and flags the changed source for review", () => {
    const original = { id: "source-ref", label: "Psalm 98", book: "Psalms", chapter: "98", verseRange: "", version: "" };
    const edited = { ...original, label: "Psalm 98 (operator note)" };
    const current = [section("current", "Reading", [element("same", "Psalm 98", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Psalm 98", scriptureRefs: [edited],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word", sourceTitle: "Psalm 98", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "Psalm 98", destination: "scripture", sourceField: "title", managed: { kind: "scripture", id: original.id, fingerprint: JSON.stringify({ label: original.label, book: original.book, chapter: original.chapter, verseRange: original.verseRange, version: original.version }) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "old",
      },
      servicePlanningImport: { observed: source("Psalm 98", ""), applied: source("Psalm 98", ""), pendingFields: [] },
    })])];
    const imported = [section("source", "Reading", [element("incoming", "Psalm 97", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Psalm 97",
      scriptureRefs: [{ label: "Psalm 97", book: "Psalms", chapter: "97", verseRange: "", version: "" }],
      importAmbiguity: { ...current[0].elements[0].importAmbiguity!, sourceTitle: "Psalm 97", parts: [{ kind: "scripture", value: "Psalm 97", destination: "scripture", sourceField: "title" }], status: "confirmed" },
      servicePlanningImport: { observed: source("Psalm 97", ""), applied: source("Psalm 97", ""), pendingFields: [] },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed[0].elements[0].scriptureRefs).toEqual([edited]);
    expect(refreshed[0].elements[0].importAmbiguity?.status).toBe("unresolved");
  });

  it("removes only a source-owned scripture occurrence, keeping intentional repeated manual references", () => {
    const sourceRef = { id: "source-ref", label: "Psalm 98", book: "Psalms", chapter: "98", verseRange: "", version: "" };
    const manualA = { ...sourceRef, id: "manual-a" };
    const manualB = { ...sourceRef, id: "manual-b" };
    const current = [section("current", "Reading", [element("same", "Psalm 98", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Psalm 98", scriptureRefs: [sourceRef, manualA, manualB],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: "Psalm 98", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "Psalm 98", destination: "scripture", sourceField: "title", managed: { kind: "scripture", id: sourceRef.id, fingerprint: JSON.stringify({ label: sourceRef.label, book: sourceRef.book, chapter: sourceRef.chapter, verseRange: sourceRef.verseRange, version: sourceRef.version }) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "old",
      },
      servicePlanningImport: { observed: source("Psalm 98", ""), applied: source("Psalm 98", ""), pendingFields: [] },
    })])];
    const imported = [section("source", "Reading", [element("incoming", "Reading", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Reading", importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: "Reading", sourceLedBy: "",
        parts: [], reasons: [], status: "confirmed", sourceFingerprint: "removed-scripture",
      },
      servicePlanningImport: { observed: source("Reading", ""), applied: source("Reading", ""), pendingFields: [] },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed[0].elements[0].scriptureRefs).toEqual([manualA, manualB]);
  });

  it("replaces an unchanged managed description on accepted Title refresh", () => {
    const oldResource = { ...createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Skit/Mime – Walking With Jesus") }), id: "source-description" };
    const manualResource = { ...createServicePlanTextResource({ title: "Operator note", text: plainTextToRichText("Keep this") }), id: "manual-resource" };
    const part = {
      kind: "description" as const, value: "Skit/Mime – Walking With Jesus", destination: "content" as const,
      sourceField: "title" as const,
      managed: { kind: "resource" as const, id: oldResource.id, fingerprint: servicePlanResourceFingerprint(oldResource) },
    };
    const current = [section("current", "Special", [element("same", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – Walking With Jesus",
      resources: [oldResource, manualResource],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Skit/Mime",
        sourceTitle: "Skit/Mime – Walking With Jesus", sourceLedBy: "", parts: [part], reasons: [],
        status: "confirmed", sourceFingerprint: "old-description",
      },
      servicePlanningImport: {
        observed: source("Skit/Mime – Walking With Jesus", ""),
        applied: source("Skit/Mime – Walking With Jesus", ""), pendingFields: [],
      },
    })])];
    const imported = [section("source", "Special", [element("incoming", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – The Good Samaritan",
      resources: [{ ...createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Skit/Mime – The Good Samaritan") }), id: "new-description" }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Skit/Mime",
        sourceTitle: "Skit/Mime – The Good Samaritan", sourceLedBy: "",
        parts: [{ ...part, value: "Skit/Mime – The Good Samaritan", managed: undefined }], reasons: [],
        status: "confirmed", sourceFingerprint: "new-description",
      },
      servicePlanningImport: {
        observed: source("Skit/Mime – The Good Samaritan", ""),
        applied: source("Skit/Mime – The Good Samaritan", ""), pendingFields: [],
      },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, refreshed);
    expect(summary.changes[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Import interpretation",
        before: expect.stringContaining("Skit/Mime – Walking With Jesus"),
        after: expect.stringContaining("Skit/Mime – The Good Samaritan"),
      }),
    ]));
    const applied = applySelectedServicePlanImportChanges(
      current, refreshed, summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    );

    expect(applied[0].elements[0].resources).toEqual([
      expect.objectContaining({ title: "Imported description" }), manualResource,
    ]);
    expect(JSON.stringify(applied[0].elements[0].resources?.[0])).toContain("The Good Samaritan");
    expect(JSON.stringify(applied[0].elements[0].resources?.[0])).not.toContain("Walking With Jesus");
    const repeated = refreshServicePlanFromImport(applied, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(summarizeServicePlanImport(applied, repeated).changes).toEqual([]);
  });

  it("keeps an edited managed description without silently replacing it", () => {
    const oldResource = createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Walking With Jesus") });
    const editedResource = { ...oldResource, title: "Operator-edited description" };
    const current = [section("current", "Special", [element("same", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – Walking With Jesus", resources: [editedResource],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Skit/Mime", sourceTitle: "Skit/Mime – Walking With Jesus", sourceLedBy: "",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title", managed: { kind: "resource", id: oldResource.id, fingerprint: servicePlanResourceFingerprint(oldResource) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "old-description",
      },
      servicePlanningImport: { observed: source("Skit/Mime – Walking With Jesus", ""), applied: source("Skit/Mime – Walking With Jesus", ""), pendingFields: [] },
    })])];
    const imported = [section("source", "Special", [element("incoming", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – The Good Samaritan",
      resources: [createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("The Good Samaritan") })],
      importAmbiguity: { ...current[0].elements[0].importAmbiguity!, sourceTitle: "Skit/Mime – The Good Samaritan", parts: [{ kind: "description", value: "The Good Samaritan", destination: "content", sourceField: "title" }], status: "confirmed" },
      servicePlanningImport: { observed: source("Skit/Mime – The Good Samaritan", ""), applied: source("Skit/Mime – The Good Samaritan", ""), pendingFields: [] },
    })])];

    const refreshed = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(refreshed[0].elements[0].resources).toEqual([editedResource]);
    expect(refreshed[0].elements[0].importAmbiguity?.status).toBe("unresolved");
  });

  it("does not recreate a confirmed description moved to Notes on an unchanged refresh", () => {
    const note = { type: "paragraph" as const, id: "managed-note", spans: [{ text: "Walking With Jesus" }] };
    const current = [section("current", "Special", [element("same", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – Walking With Jesus",
      notes: { blocks: [note] },
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Skit/Mime", sourceTitle: "Skit/Mime – Walking With Jesus", sourceLedBy: "",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "notes", sourceField: "title", managed: { kind: "note", id: note.id, fingerprint: JSON.stringify(note) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "source",
      },
      servicePlanningImport: { observed: source("Skit/Mime – Walking With Jesus", ""), applied: source("Skit/Mime – Walking With Jesus", ""), pendingFields: [] },
    })])];
    const imported = [section("source", "Special", [element("incoming", "Skit/Mime", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Skit/Mime – Walking With Jesus",
      resources: [createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Walking With Jesus") })],
      importAmbiguity: { ...current[0].elements[0].importAmbiguity!, status: "confirmed", parts: [{ kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title" }] },
      servicePlanningImport: { observed: source("Skit/Mime – Walking With Jesus", ""), applied: source("Skit/Mime – Walking With Jesus", ""), pendingFields: [] },
    })])];

    const once = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const twice = refreshServicePlanFromImport(once, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(once[0].elements[0].resources).toBeUndefined();
    expect(once[0].elements[0].notes).toEqual({ blocks: [note] });
    expect(twice[0].elements[0]).toEqual(once[0].elements[0]);
  });

  it("persists confirmed ownership through serialization and a later Led By refresh", () => {
    const sourcePerson = { id: "title-person", name: "Jasmine Williams" };
    const lead = { id: "lead", name: "Jeriyah Brown" };
    const before = element("same", "Reading", {
      sourcePlanningManaged: true, sourceContentTitleRaw: "Psalms 97 Jasmine Williams", sourceLedByRaw: "Jeriyah Brown",
      assignees: [lead, sourcePerson],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: "Psalms 97 Jasmine Williams", sourceLedBy: "Jeriyah Brown",
        parts: [{ kind: "person", value: "Jasmine Williams", destination: "assignee", sourceField: "title", managed: { kind: "assignee", id: sourcePerson.id, fingerprint: JSON.stringify({ name: sourcePerson.name }) } }],
        reasons: [], status: "unresolved", sourceFingerprint: "first-import",
      },
      servicePlanningImport: { observed: source("Psalms 97 Jasmine Williams", "Jeriyah Brown"), applied: source("Psalms 97 Jasmine Williams", "Jeriyah Brown"), pendingFields: [] },
    });
    const confirmed = applyReviewedServicePlanParts(before, [
      { ...before.importAmbiguity!.parts[0], destination: "content" },
    ]);
    const savedAndReloaded = JSON.parse(JSON.stringify({
      ...confirmed.element,
      importAmbiguity: { ...before.importAmbiguity!, parts: confirmed.parts, status: "confirmed" },
    })) as ServicePlanElement;
    expect(savedAndReloaded.assignees?.map(({ name }) => name)).toEqual(["Jeriyah Brown"]);
    const refreshed = refreshServicePlanFromImport(
      [section("current", "Reading", [savedAndReloaded])],
      [section("source", "Reading", [element("incoming", "Reading", {
        sourcePlanningManaged: true, sourceContentTitleRaw: "Psalms 97 Jasmine Williams", sourceLedByRaw: "Courtney Stephens",
        assignees: [
          { id: "new-lead", name: "Courtney Stephens" },
          { id: "title-person-new", name: "Jasmine Williams" },
        ],
        importAmbiguity: { ...savedAndReloaded.importAmbiguity!, sourceLedBy: "Courtney Stephens", status: "confirmed" },
        servicePlanningImport: { observed: source("Psalms 97 Jasmine Williams", "Courtney Stephens"), applied: source("Psalms 97 Jasmine Williams", "Courtney Stephens"), pendingFields: [], managedAssignees: [
          { id: "new-lead", fields: ["ledBy"], fingerprint: JSON.stringify({ name: "Courtney Stephens" }) },
          { id: "title-person-new", fields: ["title"], fingerprint: JSON.stringify({ name: "Jasmine Williams" }) },
        ] },
      })])], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

    expect(refreshed[0].elements[0].assignees?.map(({ name }) => name)).toEqual(["Courtney Stephens"]);
    expect(refreshed[0].elements[0].importAmbiguity?.parts[0].destination).toBe("content");
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
