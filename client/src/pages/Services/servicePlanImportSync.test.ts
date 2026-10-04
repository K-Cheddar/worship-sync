import { multilineTextToRichText, plainTextToRichText, richTextToPlainText } from "../../types/richText";
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
import { applyReviewedServicePlanParts, reconcileReviewedServicePlanParts, servicePlanNoteFingerprint, servicePlanResourceFingerprint } from "./servicePlanImportOwnership";
import { createServicePlanLinkResource, createServicePlanTextResource } from "./servicePlanResources";
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
  it("does not queue an empty-title-only ambiguity", () => {
    const informational = {
      source: "servicePlanning" as const,
      sourceKey: "Worship:0",
      sourceElementType: "Special Feature",
      sourceTitle: "",
      sourceLedBy: "",
      parts: [],
      reasons: ["The source title is empty."],
      status: "unresolved" as const,
      sourceFingerprint: "empty-title",
    };
    const current = [section("s1", "Worship", [element("e1", "Untitled", { importAmbiguity: informational })])];
    const next = [section("s1", "Worship", [element("e1", "Untitled", {
      importAmbiguity: { ...informational, status: "confirmed" },
    })])];

    expect(getNewServicePlanImportAmbiguityIds(current, next)).toEqual([]);
  });

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

describe("ambiguity reassignment and assignee equipment", () => {
  it("moves a source-managed person out of assignees without deleting their IEM", () => {
    const before = element("row", "Reading", {
      assignees: [{ id: "source-person", name: "Jamie", iemIds: ["iem-1"] }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading",
        sourceTitle: "Reading Jamie", sourceLedBy: "",
        parts: [{
          kind: "person", value: "Jamie", destination: "assignee", sourceField: "title",
          managed: { kind: "assignee", id: "source-person", fingerprint: JSON.stringify({ name: "Jamie" }) },
        }],
        reasons: [], status: "confirmed", sourceFingerprint: "source-person",
      },
    });
    const reviewed = applyReviewedServicePlanParts(before, [
      { ...before.importAmbiguity!.parts[0], destination: "unassigned" },
    ]);
    expect(reviewed.element.assignees).toEqual([{ id: "source-person", iemIds: ["iem-1"] }]);
  });

  it.each([
    ["microphone", { id: "mic-slot", microphoneIds: ["mic-orange"] }],
    ["IEM", { id: "iem-slot", iemIds: ["iem-1"] }],
    ["mixed equipment", { id: "mixed-slot", microphoneIds: ["mic-orange"], iemIds: ["iem-1"] }],
  ])("claims an existing %s slot when review confirms an assignee", (_label, slot) => {
    const before = element("row", "Reading", {
      assignees: [slot],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading",
        sourceTitle: "Reading Jasmine", sourceLedBy: "",
        parts: [{ kind: "person", value: "Jasmine", destination: "content", sourceField: "title" }],
        reasons: [], status: "unresolved", sourceFingerprint: "review-slot",
      },
    });

    const reviewed = applyReviewedServicePlanParts(before, [
      { ...before.importAmbiguity!.parts[0], destination: "assignee" },
    ]);

    expect(reviewed.element.assignees).toEqual([{ ...slot, name: "Jasmine" }]);
    expect(reviewed.parts[0].managed).toMatchObject({ kind: "assignee", id: slot.id });
  });

  it("hands multiple reviewed people equipment in stable order and appends excess people", () => {
    const slots = [
      { id: "mic-slot", microphoneIds: ["mic-orange"] },
      { id: "iem-slot", iemIds: ["iem-1"] },
    ];
    const before = element("row", "Reading", {
      assignees: slots,
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading",
        sourceTitle: "Reading", sourceLedBy: "", parts: [], reasons: [],
        status: "unresolved", sourceFingerprint: "multiple-reviewed",
      },
    });
    const parts = ["Jasmine", "Clarence", "Alex"].map((name) => ({
      kind: "person" as const, value: name, destination: "assignee" as const, sourceField: "title" as const,
    }));

    const reviewed = applyReviewedServicePlanParts(before, parts);

    expect(reviewed.element.assignees).toEqual([
      { ...slots[0], name: "Jasmine" },
      { ...slots[1], name: "Clarence" },
      expect.objectContaining({ name: "Alex" }),
    ]);
    expect(reviewed.parts.map((part) => part.managed?.id)).toEqual([
      "mic-slot", "iem-slot", reviewed.element.assignees?.[2].id,
    ]);
  });

  it("reuses same-name manual assignees without claiming them", () => {
    const manual = { id: "manual", name: "Jasmine", memberId: "member-1" };
    const before = element("row", "Reading", {
      assignees: [{ id: "slot", microphoneIds: ["mic-orange"] }, manual],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading",
        sourceTitle: "Reading Jasmine", sourceLedBy: "",
        parts: [{ kind: "person", value: "Jasmine", destination: "content", sourceField: "title" }],
        reasons: [], status: "unresolved", sourceFingerprint: "manual-same-name",
      },
    });

    const reviewed = applyReviewedServicePlanParts(before, [
      { ...before.importAmbiguity!.parts[0], destination: "assignee" },
    ]);

    expect(reviewed.element.assignees).toEqual([{ id: "slot", microphoneIds: ["mic-orange"] }, manual]);
    expect(reviewed.parts[0].managed).toBeUndefined();
  });

  it("repairs an append-only reviewed assignee into its original equipment slot on refresh", () => {
    const part = {
      kind: "person" as const, value: "Jasmine", destination: "assignee" as const,
      sourceField: "title" as const,
      managed: { kind: "assignee" as const, id: "import-person", fingerprint: JSON.stringify({ name: "Jasmine" }) },
    };
    const current = element("row", "Reading", {
      assignees: [{ id: "slot-1", microphoneIds: ["mic-orange"] }, { id: "import-person", name: "Jasmine" }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading",
        sourceTitle: "Reading Jasmine", sourceLedBy: "", parts: [part], reasons: [],
        status: "confirmed", sourceFingerprint: "old-append-only",
      },
    });
    const incoming = element("row", "Reading", {
      importAmbiguity: {
        ...current.importAmbiguity!,
        parts: [{ ...part, managed: undefined }],
      },
    });

    const once = reconcileReviewedServicePlanParts(current, incoming, new Set(["title"]));
    const saved = JSON.parse(JSON.stringify({
      element: { ...once.element, importAmbiguity: once.ambiguity },
      ambiguity: once.ambiguity,
    })) as typeof once;
    const twice = reconcileReviewedServicePlanParts(saved.element, incoming, new Set(["title"]));

    expect(once.element.assignees).toEqual([{ id: "slot-1", name: "Jasmine", microphoneIds: ["mic-orange"] }]);
    expect(once.ambiguity?.parts[0].managed).toMatchObject({ kind: "assignee", id: "slot-1" });
    expect(twice).toEqual(saved);
  });
});

describe("stable external row identity", () => {
  it("keeps local notes, equipment, and review state with duplicate rows through insertion and reorder", () => {
    const build = (rows: Array<{ sourceOccurrenceId: string; title: string }>) => buildServicePlanSectionsFromImport({
      planLabel: "Sunday worship",
      sections: [{ sectionName: "Worship", rows: rows.map((row) => ({ elementType: "Moment", ...row, ledBy: "" })) }],
      teamAssignments: [],
    }, []);
    const parsed = build([
      { sourceOccurrenceId: "prayer-1", title: "Prayer" },
      { sourceOccurrenceId: "prayer-2", title: "Prayer" },
      { sourceOccurrenceId: "music-1", title: "Special Music" },
      { sourceOccurrenceId: "music-2", title: "Special Music" },
    ]);
    const current = [section("section", "Worship", parsed[0].elements.map((item) => ({
      ...item,
      notes: plainTextToRichText(`Local note ${item.sourceOccurrenceId}`),
      assignees: [{ id: `slot-${item.sourceOccurrenceId}`, iemIds: [`iem-${item.sourceOccurrenceId}`], microphoneIds: [`mic-${item.sourceOccurrenceId}`] }],
      importAmbiguity: {
        source: "servicePlanning" as const,
        sourceKey: item.sourceOccurrenceId!,
        sourceElementType: "Moment",
        sourceTitle: "same source title",
        sourceLedBy: "",
        parts: [{ kind: "description" as const, value: `review-${item.sourceOccurrenceId}`, destination: "notes" as const }],
        reasons: [],
        status: "confirmed" as const,
        sourceFingerprint: item.sourceOccurrenceId!,
      },
    })) )];
    const incoming = build([
      { sourceOccurrenceId: "new-prayer", title: "Prayer" },
      { sourceOccurrenceId: "music-2", title: "Special Music" },
      { sourceOccurrenceId: "prayer-2", title: "Prayer" },
      { sourceOccurrenceId: "music-1", title: "Special Music" },
      { sourceOccurrenceId: "prayer-1", title: "Prayer" },
    ]);

    const refreshed = refreshServicePlanFromImport(current, incoming, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const originalRows = refreshed[0].elements.filter((item) => item.sourceOccurrenceId !== "new-prayer");

    expect(originalRows.map((item) => item.sourceOccurrenceId)).toEqual(["prayer-1", "prayer-2", "music-1", "music-2"]);
    originalRows.forEach((item) => {
      expect(richTextToPlainText(item.notes)).toBe(`Local note ${item.sourceOccurrenceId}`);
      expect(item.assignees?.[0]).toMatchObject({
        microphoneIds: [`mic-${item.sourceOccurrenceId}`],
        iemIds: [`iem-${item.sourceOccurrenceId}`],
      });
      expect(item.importAmbiguity?.sourceKey).toBe(item.sourceOccurrenceId);
    });
    const saved = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];
    const repeated = refreshServicePlanFromImport(saved, incoming, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(repeated).toEqual(saved);
  });

  it.each([false, true])("moves a source row across sections and keeps its local state (removeMissing=%s)", (removeMissing) => {
    const ambiguity = {
      source: "servicePlanning" as const,
      sourceKey: "pc-123",
      sourceElementType: "Moment",
      sourceTitle: "Prayer",
      sourceLedBy: "Jamie Lee",
      parts: [{ kind: "person" as const, value: "Jamie Lee", destination: "assignee" as const }],
      reasons: ["Review the imported assignment."],
      status: "confirmed" as const,
      sourceFingerprint: "reviewed-prayer",
    };
    const existing = element("worshipsync-prayer-id", "Prayer", {
      sourceOccurrenceId: "pc-123",
      sourcePlanningManaged: true,
      sourceElementTypeRaw: "Moment",
      sourceContentTitleRaw: "Prayer",
      sourceLedByRaw: "Jamie Lee",
      notes: plainTextToRichText("Local note"),
      teamNotes: [{ id: "team-note", scope: "role", positionId: "worship-lead", label: "Worship · Lead", note: plainTextToRichText("Local team note") }],
      assignees: [{ id: "jamie-slot", name: "Jamie Lee", memberId: "member-jamie", microphoneIds: ["mic-orange"], iemIds: ["iem-one"] }],
      servicePlanningImport: {
        observed: { elementType: "Moment", title: "Prayer", ledBy: "Jamie Lee", note: "" },
        applied: { elementType: "Moment", title: "Prayer", ledBy: "Jamie Lee", note: "" },
        pendingFields: [],
        managedAssignees: [{ id: "jamie-slot", fields: ["ledBy"], ledByIdentity: "jamie-source-id", fingerprint: JSON.stringify({ name: "Jamie Lee" }) }],
      },
      importAmbiguity: ambiguity,
      pushedOutlineListId: "outline-list",
      pushedOutlineListIds: ["outline-list", "outline-prayer"],
    });
    const current = [
      section("opening", "Opening", [existing]),
      section("worship", "Worship", [element("song", "Song", { sourcePlanningManaged: true })]),
    ];
    const incoming = [
      section("incoming-opening", "Opening", []),
      section("incoming-worship", "Worship", [
        element("new-prayer-id", "Prayer", {
          sourceOccurrenceId: "pc-123",
          sourcePlanningManaged: true,
          sourceElementTypeRaw: "Moment",
          sourceContentTitleRaw: "Prayer",
          sourceLedByRaw: "Jamie Lee",
          assignees: [{ id: "imported-jamie", name: "Jamie Lee" }],
          servicePlanningImport: {
            observed: { elementType: "Moment", title: "Prayer", ledBy: "Jamie Lee", note: "" },
            applied: { elementType: "Moment", title: "Prayer", ledBy: "Jamie Lee", note: "" },
            pendingFields: [],
            managedAssignees: [{ id: "imported-jamie", fields: ["ledBy"], ledByIdentity: "jamie-source-id", fingerprint: JSON.stringify({ name: "Jamie Lee" }) }],
          },
        }),
        element("incoming-song", "Song", { sourcePlanningManaged: true }),
      ]),
    ];
    const options = { ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, removeMissing };

    const refreshed = refreshServicePlanFromImport(current, incoming, options);
    const oldSection = refreshed.find((candidate) => candidate.name === "Opening");
    const newSection = refreshed.find((candidate) => candidate.name === "Worship");
    const moved = newSection?.elements.filter((candidate) => candidate.sourceOccurrenceId === "pc-123") || [];

    expect(oldSection?.elements.some((candidate) => candidate.sourceOccurrenceId === "pc-123")).toBeFalsy();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      id: "worshipsync-prayer-id",
      sourceOccurrenceId: "pc-123",
      pushedOutlineListId: "outline-list",
      pushedOutlineListIds: ["outline-list", "outline-prayer"],
      importAmbiguity: ambiguity,
    });
    expect(richTextToPlainText(moved[0].notes)).toBe("Local note");
    expect(richTextToPlainText(moved[0].teamNotes?.[0].note)).toBe("Local team note");
    expect(moved[0].assignees?.[0]).toMatchObject({
      memberId: "member-jamie",
      microphoneIds: ["mic-orange"],
      iemIds: ["iem-one"],
    });

    const reloaded = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];
    expect(refreshServicePlanFromImport(reloaded, incoming, options)).toEqual(reloaded);
  });

  it("keeps duplicate-title moved rows attached to their own durable identities", () => {
    const current = [
      section("a", "Section A", [
        element("prayer-one", "Prayer", { sourceOccurrenceId: "pc-prayer-1", sourcePlanningManaged: true, notes: plainTextToRichText("one") }),
        element("prayer-two", "Prayer", { sourceOccurrenceId: "pc-prayer-2", sourcePlanningManaged: true, notes: plainTextToRichText("two") }),
        element("local-prayer", "Prayer", { notes: plainTextToRichText("operator row") }),
      ]),
      section("b", "Section B", []),
    ];
    const incoming = [
      section("new-a", "Section A", []),
      section("new-b", "Section B", [
        element("new-two", "Prayer", { sourceOccurrenceId: "pc-prayer-2", sourcePlanningManaged: true }),
        element("new-one", "Prayer", { sourceOccurrenceId: "pc-prayer-1", sourcePlanningManaged: true }),
      ]),
    ];

    const refreshed = refreshServicePlanFromImport(current, incoming, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const movedRows = refreshed.find((candidate) => candidate.name === "Section B")?.elements || [];

    expect(movedRows.map(({ id, sourceOccurrenceId }) => [id, sourceOccurrenceId])).toEqual([
      ["prayer-two", "pc-prayer-2"],
      ["prayer-one", "pc-prayer-1"],
    ]);
    expect(movedRows.map((candidate) => richTextToPlainText(candidate.notes))).toEqual(["two", "one"]);
    expect(refreshed.flatMap((candidate) => candidate.elements).find(({ id }) => id === "local-prayer")).toBeDefined();
  });

  it("fails safe when Planning Center returns duplicate occurrence IDs", () => {
    const current = [section("a", "Section A", [
      element("original", "Prayer", { sourceOccurrenceId: "duplicate-id", sourcePlanningManaged: true, notes: plainTextToRichText("Keep local state") }),
    ])];
    const incoming = [section("b", "Section B", [
      element("incoming-one", "Prayer", { sourceOccurrenceId: "duplicate-id", sourcePlanningManaged: true }),
      element("incoming-two", "Prayer", { sourceOccurrenceId: "duplicate-id", sourcePlanningManaged: true }),
    ])];

    const refreshed = refreshServicePlanFromImport(current, incoming, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      removeMissing: true,
    });

    expect(refreshed.flatMap((candidate) => candidate.elements)).toEqual(current.flatMap((candidate) => candidate.elements));
    expect(richTextToPlainText(refreshed[0].elements[0].notes)).toBe("Keep local state");
  });
});

describe("remaining Service Planning import reconciliation defects", () => {
  const importState = (title: string, ledBy: string, note = "") => ({
    observed: { elementType: "Reading", title, ledBy, note },
    applied: { elementType: "Reading", title, ledBy, note },
    pendingFields: [] as Array<"elementType" | "title" | "ledBy" | "note">,
  });

  it("keeps Led By ownership valid across two accepted renames and serialization", () => {
    const initial = element("same", "Reading", {
      sourcePlanningManaged: true,
      sourceLedByRaw: "Jeriyah Brown",
      assignees: [{ id: "lead", name: "Jeriyah Brown", memberId: "jeriyah-member", microphoneIds: ["mic-1"] }],
      servicePlanningImport: {
        ...importState("Reading", "Jeriyah Brown"),
        managedAssignees: [{ id: "lead", fields: ["ledBy"], ledByIdentity: "jeriyah-source-id", fingerprint: JSON.stringify({ name: "Jeriyah Brown" }) }],
      },
    });
    const refreshLedBy = (current: ServicePlanElement, name: string, identity: string) => refreshServicePlanFromImport(
      [section("current", "Service", [current])],
      [section("incoming", "Service", [element("new", "Reading", {
        sourcePlanningManaged: true,
        sourceLedByRaw: name,
        assignees: [{ id: `incoming-${name}`, name }],
        servicePlanningImport: {
          ...importState("Reading", name),
          managedAssignees: [{ id: `incoming-${name}`, fields: ["ledBy"], ledByIdentity: identity, fingerprint: JSON.stringify({ name }) }],
        },
      })])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];
    const firstRefresh = refreshLedBy(initial, "Courtney Stephens", "courtney-source-id");
    const savedAndReloaded = JSON.parse(JSON.stringify(firstRefresh)) as ServicePlanElement;
    const secondRefresh = refreshLedBy(savedAndReloaded, "Taylor Smith", "taylor-source-id");
    const repeated = refreshLedBy(JSON.parse(JSON.stringify(secondRefresh)) as ServicePlanElement, "Taylor Smith", "taylor-source-id");

    expect(firstRefresh.assignees).toEqual([{ id: "lead", name: "Courtney Stephens", microphoneIds: ["mic-1"] }]);
    expect(secondRefresh.assignees).toEqual([{ id: "lead", name: "Taylor Smith", microphoneIds: ["mic-1"] }]);
    expect(secondRefresh.servicePlanningImport?.managedAssignees).toEqual([
      { id: "lead", fields: ["ledBy"], ledByIdentity: "taylor-source-id", fingerprint: JSON.stringify({ name: "Taylor Smith" }) },
    ]);
    expect(repeated.assignees).toEqual(secondRefresh.assignees);
    expect(repeated.servicePlanningImport?.managedAssignees).toEqual(secondRefresh.servicePlanningImport?.managedAssignees);
  });

  it("updates external Notes without replacing reviewed or operator-created paragraphs", () => {
    const titleNote = { type: "paragraph" as const, id: "reviewed-title", spans: [{ text: "Walking With Jesus" }] };
    const sourceNote = { type: "paragraph" as const, id: "external-note", spans: [{ text: "Video presentation" }] };
    const manualNote = { type: "paragraph" as const, id: "manual-note", spans: [{ text: "Operator reminder" }] };
    const current = element("same", "Skit/Mime", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation",
      notes: { blocks: [titleNote, sourceNote, manualNote] },
      servicePlanningImport: {
        ...importState("Skit/Mime – Walking With Jesus", "", "Video presentation"),
        managedNotes: [{ id: sourceNote.id, fingerprint: servicePlanNoteFingerprint(sourceNote) }],
      },
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Skit/Mime",
        sourceTitle: "Skit/Mime – Walking With Jesus", sourceLedBy: "", sourceNote: "Video presentation",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "notes", sourceField: "title",
          managed: { kind: "note", id: titleNote.id, fingerprint: JSON.stringify(titleNote) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "old",
      },
    });
    const imported = element("incoming", "Skit/Mime", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation — updated instructions",
      notes: { blocks: [{ type: "paragraph", id: "fresh-source-note", spans: [{ text: "Video presentation — updated instructions" }] }] },
      servicePlanningImport: {
        ...importState("Skit/Mime – Walking With Jesus", "", "Video presentation — updated instructions"),
        managedNotes: [{ id: "fresh-source-note", fingerprint: servicePlanNoteFingerprint({ type: "paragraph", id: "fresh-source-note", spans: [{ text: "Video presentation — updated instructions" }] }) }],
      },
      importAmbiguity: {
        ...current.importAmbiguity!,
        sourceNote: "Video presentation — updated instructions",
        parts: current.importAmbiguity!.parts,
      },
    });

    const refreshed = refreshServicePlanFromImport(
      [section("current", "Special", [current])],
      [section("incoming", "Special", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    expect(richTextToPlainText(refreshed.notes!)).toContain("Walking With Jesus");
    expect(richTextToPlainText(refreshed.notes!)).toContain("Video presentation — updated instructions");
    expect(richTextToPlainText(refreshed.notes!)).toContain("Operator reminder");
    expect(richTextToPlainText(refreshed.notes!)).not.toContain("Video presentation\n");
  });

  it("preserves a locally edited external Note and leaves the accepted source update pending", () => {
    const original = { type: "paragraph" as const, id: "external-note", spans: [{ text: "Video presentation" }] };
    const edited = { ...original, spans: [{ text: "Video presentation — operator edit" }] };
    const current = element("same", "Skit/Mime", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation",
      notes: { blocks: [edited] },
      servicePlanningImport: {
        ...importState("Skit/Mime", "", "Video presentation"),
        managedNotes: [{ id: original.id, fingerprint: servicePlanNoteFingerprint(original) }],
      },
    });
    const imported = element("incoming", "Skit/Mime", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation — updated instructions",
      notes: { blocks: [{ type: "paragraph", id: "new-note", spans: [{ text: "Video presentation — updated instructions" }] }] },
      servicePlanningImport: importState("Skit/Mime", "", "Video presentation — updated instructions"),
    });

    const refreshed = refreshServicePlanFromImport(
      [section("current", "Special", [current])], [section("incoming", "Special", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    expect(refreshed.notes).toEqual({ blocks: [edited] });
    expect(refreshed.servicePlanningImport?.applied.note).toBe("Video presentation");
    expect(refreshed.servicePlanningImport?.pendingFields).toContain("note");
    expect(refreshed.importAmbiguity?.status).toBe("unresolved");
  });

  it("keeps legacy Notes without reliable source provenance for operator review", () => {
    const current = element("same", "Reading", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation",
      notes: { blocks: [
        { type: "paragraph", id: "legacy-source-or-manual", spans: [{ text: "Video presentation" }] },
        { type: "paragraph", id: "manual", spans: [{ text: "Operator reminder" }] },
      ] },
      servicePlanningImport: importState("Reading", "", "Video presentation"),
    });
    const imported = element("incoming", "Reading", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation — changed",
      notes: { blocks: [{ type: "paragraph", id: "incoming-note", spans: [{ text: "Video presentation — changed" }] }] },
      servicePlanningImport: importState("Reading", "", "Video presentation — changed"),
    });
    const refreshed = refreshServicePlanFromImport(
      [section("current", "Reading", [current])], [section("incoming", "Reading", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    expect(refreshed.notes).toEqual(current.notes);
    expect(refreshed.servicePlanningImport?.applied.note).toBe("Video presentation");
    expect(refreshed.importAmbiguity?.status).toBe("unresolved");
  });

  it("updates multiline external Notes in place and does not duplicate paragraphs on repeat", () => {
    const original = multilineTextToRichText("Video presentation\nFirst cue").blocks.map((block, index) => ({
      ...block, id: `source-note-${index}`,
    }));
    const current = element("same", "Reading", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation\nFirst cue",
      notes: { blocks: [
        { type: "paragraph", id: "operator-before", spans: [{ text: "Operator note before" }] },
        ...original,
        { type: "paragraph", id: "operator-after", spans: [{ text: "Operator note after" }] },
      ] },
      servicePlanningImport: {
        ...importState("Reading", "", "Video presentation\nFirst cue"),
        managedNotes: original.map((block) => ({ id: block.id!, fingerprint: servicePlanNoteFingerprint(block) })),
      },
    });
    const incomingBlocks = multilineTextToRichText("Video presentation — updated\nFirst cue\nSecond cue").blocks.map((block, index) => ({
      ...block, id: `incoming-note-${index}`,
    }));
    const imported = element("incoming", "Reading", {
      sourcePlanningManaged: true,
      sourceNoteRaw: "Video presentation — updated\nFirst cue\nSecond cue",
      notes: { blocks: incomingBlocks },
      servicePlanningImport: {
        ...importState("Reading", "", "Video presentation — updated\nFirst cue\nSecond cue"),
        managedNotes: incomingBlocks.map((block) => ({ id: block.id!, fingerprint: servicePlanNoteFingerprint(block) })),
      },
    });
    const refresh = (item: ServicePlanElement) => refreshServicePlanFromImport(
      [section("current", "Reading", [item])], [section("incoming", "Reading", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    const once = refresh(current);
    const twice = refresh(JSON.parse(JSON.stringify(once)) as ServicePlanElement);

    expect(richTextToPlainText(once.notes!)).toBe("Operator note before\nVideo presentation — updated\nFirst cue\nSecond cue\nOperator note after");
    expect(twice.notes).toEqual(once.notes);
    expect(twice.servicePlanningImport?.managedNotes).toEqual(once.servicePlanningImport?.managedNotes);
  });

  it("classifies, reviews, serializes, refreshes, applies selected Notes, and stays stable on a second refresh", () => {
    const build = (note: string) => buildServicePlanSectionsFromImport({
      planLabel: "Sunday service",
      sections: [{ sectionName: "Special", rows: [{ elementType: "Special", title: "Walking With Jesus", ledBy: "", note }] }],
      teamAssignments: [],
    }, [], { classifyExternalTitle: true });
    const firstImport = build("Video presentation");
    const initiallyImported = firstImport[0].elements[0];
    expect(initiallyImported.importAmbiguity?.parts).toEqual([
      expect.objectContaining({ kind: "description", value: "Walking With Jesus", sourceField: "title" }),
    ]);
    const reviewed = applyReviewedServicePlanParts(initiallyImported, [
      { ...initiallyImported.importAmbiguity!.parts[0], destination: "notes" },
    ]);
    const saved = JSON.parse(JSON.stringify({
      ...reviewed.element,
      importAmbiguity: { ...initiallyImported.importAmbiguity!, parts: reviewed.parts, status: "confirmed" },
    })) as ServicePlanElement;
    const current = [section("current", "Special", [saved])];
    const secondImport = build("Video presentation — updated instructions");
    const preview = refreshServicePlanFromImport(current, secondImport, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(current, preview);
    const applied = applySelectedServicePlanImportChanges(current, preview, summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)));
    const reloaded = JSON.parse(JSON.stringify(applied)) as ServicePlanSection[];
    const repeated = refreshServicePlanFromImport(reloaded, secondImport, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const finalElement = repeated[0].elements[0];

    expect(richTextToPlainText(finalElement.notes!)).toContain("Walking With Jesus");
    expect(richTextToPlainText(finalElement.notes!)).toContain("Video presentation — updated instructions");
    expect(finalElement.importAmbiguity?.parts[0].destination).toBe("notes");
    expect(summarizeServicePlanImport(reloaded, repeated).changes).toEqual([]);
  });

  it("installs a newly classified scripture when an accepted Title changes kind", () => {
    const oldDescription = createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Walking With Jesus") });
    const current = element("same", "Special", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Walking With Jesus",
      resources: [oldDescription],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special",
        sourceTitle: "Walking With Jesus", sourceLedBy: "",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title",
          managed: { kind: "resource", id: oldDescription.id, fingerprint: servicePlanResourceFingerprint(oldDescription) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "description",
      },
      servicePlanningImport: importState("Walking With Jesus", ""),
    });
    const newReference = { id: "incoming-scripture", label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" };
    const imported = element("incoming", "Special", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "John 3:16 (NIV)",
      scriptureRefs: [newReference],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special",
        sourceTitle: "John 3:16 (NIV)", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "John 3:16 (NIV)", destination: "scripture", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "scripture",
      },
      servicePlanningImport: importState("John 3:16 (NIV)", ""),
    });

    const refreshed = refreshServicePlanFromImport(
      [section("current", "Special", [current])],
      [section("incoming", "Special", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];
    const summary = summarizeServicePlanImport([section("current", "Special", [current])], [section("refreshed", "Special", [refreshed])]);
    const applied = applySelectedServicePlanImportChanges(
      [section("current", "Special", [current])], [section("refreshed", "Special", [refreshed])], summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)),
    )[0].elements[0];

    expect(applied.resources).toBeUndefined();
    expect(applied.scriptureRefs).toEqual([expect.objectContaining({ book: "John", chapter: "3", verseRange: "16", version: "NIV" })]);
    expect(applied.importAmbiguity?.parts[0].managed?.kind).toBe("scripture");
  });

  it("keeps legacy Title attachments when ownership provenance is incomplete", () => {
    const legacyDescription = createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Walking With Jesus") });
    const current = element("same", "Special", {
      sourcePlanningManaged: true,
      resources: [legacyDescription],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special",
        sourceTitle: "Walking With Jesus", sourceLedBy: "",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "legacy",
      },
      servicePlanningImport: importState("Walking With Jesus", ""),
    });
    const imported = element("incoming", "Special", {
      sourcePlanningManaged: true,
      scriptureRefs: [{ label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "" }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special",
        sourceTitle: "John 3:16", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "John 3:16", destination: "scripture", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "new",
      },
      servicePlanningImport: importState("John 3:16", ""),
    });
    const refreshed = refreshServicePlanFromImport(
      [section("current", "Special", [current])], [section("incoming", "Special", [imported])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    expect(refreshed.resources).toEqual([legacyDescription]);
    expect(refreshed.scriptureRefs).toBeUndefined();
    expect(refreshed.importAmbiguity?.status).toBe("unresolved");
  });

  it.each([
    ["scripture", "description", "John 3:16", "Skit/Mime – Walking With Jesus"],
    ["description", "resource", "Walking With Jesus", "https://example.org/service"],
  ] as const)("reconciles a %s-to-%s classification transition while preserving manual attachments", (oldKind, nextDestination, oldValue, nextValue) => {
    const manualResource = { ...createServicePlanTextResource({ title: "Operator attachment", text: plainTextToRichText("Keep this") }), id: "manual-resource" };
    const oldReference = { id: "source-scripture", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "" };
    const oldResource = { ...createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText(oldValue) }), id: "source-description" };
    const oldPart = oldKind === "scripture"
      ? { kind: "scripture" as const, value: oldValue, destination: "scripture" as const, sourceField: "title" as const,
          managed: { kind: "scripture" as const, id: oldReference.id, fingerprint: JSON.stringify({ label: oldReference.label, book: oldReference.book, chapter: oldReference.chapter, verseRange: oldReference.verseRange, version: oldReference.version }) } }
      : { kind: "description" as const, value: oldValue, destination: "content" as const, sourceField: "title" as const,
          managed: { kind: "resource" as const, id: oldResource.id, fingerprint: servicePlanResourceFingerprint(oldResource) } };
    const nextResource = nextDestination === "resource"
      ? { ...createServicePlanLinkResource({ title: nextValue, url: nextValue }), id: "incoming-resource" }
      : { ...createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText(nextValue) }), id: "incoming-description" };
    const nextPart = nextDestination === "resource"
      ? { kind: "url" as const, value: nextValue, destination: "resource" as const, sourceField: "title" as const }
      : { kind: "description" as const, value: nextValue, destination: "content" as const, sourceField: "title" as const };
    const current = element("same", "Old content", {
      sourcePlanningManaged: true,
      resources: [manualResource, ...(oldKind === "description" ? [oldResource] : [])],
      ...(oldKind === "scripture" ? { scriptureRefs: [oldReference] } : {}),
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special", sourceTitle: oldValue, sourceLedBy: "",
        parts: [oldPart], reasons: [], status: "confirmed", sourceFingerprint: "old",
      },
      servicePlanningImport: importState(oldValue, ""),
    });
    const incoming = element("incoming", "New content", {
      sourcePlanningManaged: true,
      resources: [nextResource],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special", sourceTitle: nextValue, sourceLedBy: "",
        parts: [nextPart], reasons: [], status: "confirmed", sourceFingerprint: "new",
      },
      servicePlanningImport: importState(nextValue, ""),
    });
    const sections = [section("current", "Special", [current])];
    const refreshed = refreshServicePlanFromImport(sections, [section("incoming", "Special", [incoming])], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const summary = summarizeServicePlanImport(sections, refreshed);
    expect(summary.changes[0]?.fields.map(({ label }) => label)).toContain("Import interpretation");
    const applied = applySelectedServicePlanImportChanges(sections, refreshed, summary,
      new Set(summary.changes.map(servicePlanImportChangeKey)))[0].elements[0];
    const repeated = refreshServicePlanFromImport(
      [section("current", "Special", [applied])], [section("incoming", "Special", [incoming])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    )[0].elements[0];

    const expectedResources = nextDestination === "resource"
      ? [manualResource, expect.objectContaining({ url: "https://example.org/service" })]
      : [manualResource, expect.objectContaining({ title: nextValue })];
    expect(applied.resources).toContainEqual(manualResource);
    expect(applied.importAmbiguity?.parts[0].managed).toBeDefined();
    expect(applied.resources).toEqual(expectedResources);
    expect(applied.scriptureRefs).toBeUndefined();
    expect(repeated.resources).toEqual(applied.resources);
    expect(repeated.scriptureRefs).toEqual(applied.scriptureRefs);
  });

  it("does not install an unmatched Title part when only Notes were accepted", () => {
    const description = createServicePlanTextResource({ title: "Imported description", text: plainTextToRichText("Walking With Jesus") });
    const current = element("same", "Old title", {
      sourcePlanningManaged: true,
      resources: [description],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special", sourceTitle: "Walking With Jesus", sourceLedBy: "",
        parts: [{ kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title",
          managed: { kind: "resource", id: description.id, fingerprint: servicePlanResourceFingerprint(description) } }],
        reasons: [], status: "confirmed", sourceFingerprint: "old",
      },
      servicePlanningImport: importState("Walking With Jesus", "", "Original note"),
      sourceNoteRaw: "Original note",
    });
    const newReference = { label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "" };
    const imported = element("incoming", "John 3:16", {
      sourcePlanningManaged: true,
      scriptureRefs: [newReference],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special", sourceTitle: "John 3:16", sourceLedBy: "",
        parts: [{ kind: "scripture", value: "John 3:16", destination: "scripture", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "new",
      },
      servicePlanningImport: importState("John 3:16", "", "Updated note"),
      sourceNoteRaw: "Updated note",
      notes: { blocks: [{ type: "paragraph", id: "note", spans: [{ text: "Updated note" }] }] },
    });
    const refreshed = refreshServicePlanFromImport(
      [section("current", "Special", [current])], [section("incoming", "Special", [imported])],
      { ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS, updateTitles: false, updateNotes: true },
    )[0].elements[0];

    expect(refreshed.scriptureRefs).toBeUndefined();
    expect(refreshed.resources).toEqual([description]);
    expect(refreshed.servicePlanningImport?.pendingFields).toContain("title");
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

  it("replaces a legacy assigned name when assignment refresh is on", () => {
    const current = [
      section("section-1", "Worship", [
        element("element-1", "Old welcome", {
          sourcePlanningManaged: true,
          assignedName: "Avery",
          startTime: "09:00",
        }),
      ]),
    ];
    const imported = buildServicePlanSectionsFromImport({
      planLabel: "Sunday",
      sections: [{
        sectionName: "Worship",
        rows: [{ elementType: "Welcome", title: "Welcome home", ledBy: "Blair", startTime: "09:05" }],
      }],
      teamAssignments: [],
    }, []);

    const refreshed = refreshServicePlanFromImport(current, imported, {
      ...DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
      updateTiming: false,
    });

    expect(refreshed[0].elements[0].id).toBe("element-1");
    expect(refreshed[0].elements[0].assignees?.[0]?.name).toBe("Blair");
    expect(refreshed[0].elements[0].startTime).toBe("09:00");
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
      mappingId: JSON.stringify([JSON.stringify([JSON.stringify(["same song", "New lyrics", ""]), ["linked-one", "linked-two"]]), 0]),
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

  it("preserves distinct identities for identical incoming mappings across unrelated row insertion", () => {
    const current = [section("section", "Praise", [
      element("set", "Worship Set", {
        sourcePlanningManaged: true,
        songRefs: [
          { id: "linked-one", kind: "library", songId: "song-1", songName: "Same Song" },
          { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
        ],
      }),
    ])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      songRefs: [
        { kind: "pending", title: "Same Song", lyricsText: "Same lyrics" },
        { kind: "pending", title: "Same Song", lyricsText: "Same lyrics" },
      ],
    })])];

    const [first] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const mappings = first.elements[0].importAmbiguity?.songMappings || [];
    expect(mappings).toHaveLength(2);
    expect(new Set(mappings.map(({ mappingId }) => mappingId)).size).toBe(2);
    const saved = [{ ...first, elements: first.elements.map((item) => ({
      ...item,
      importAmbiguity: item.importAmbiguity && {
        ...item.importAmbiguity,
        status: "confirmed" as const,
        songMappings: item.importAmbiguity.songMappings?.map((mapping, index) => ({
          ...mapping,
          resolution: { kind: "replace" as const, occurrenceId: index ? "linked-two" : "linked-one" },
        })),
      },
      songRefs: [
        { id: "linked-one", kind: "pending" as const, title: "Same Song", lyricsText: "Same lyrics" },
        { id: "linked-two", kind: "pending" as const, title: "Same Song", lyricsText: "Same lyrics" },
      ],
    })) }];
    const reorderedSource = [section("source", "Praise", [
      element("unrelated", "Welcome"),
      imported[0].elements[0],
    ])];
    const repeated = refreshServicePlanFromImport(saved, reorderedSource, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const repeatedElement = repeated[0].elements.find(({ id }) => id === "set")!;

    expect(repeatedElement.importAmbiguity?.songMappings?.map(({ mappingId, resolution }) => ({ mappingId, resolution }))).toEqual(
      mappings.map(({ mappingId }, index) => ({
        mappingId,
        resolution: { kind: "replace", occurrenceId: index ? "linked-two" : "linked-one" },
      })),
    );
  });

  it("keeps a new song mapping when the accepted source title changes in the same refresh", () => {
    const currentState = {
      observed: { elementType: "Song", title: "Old set title", ledBy: "", note: "" },
      applied: { elementType: "Song", title: "Old set title", ledBy: "", note: "" },
      pendingFields: [],
    };
    const current = [section("section", "Praise", [element("set", "Old set title", {
      sourcePlanningManaged: true,
      sourceElementTypeRaw: "Song",
      sourceContentTitleRaw: "Old set title",
      servicePlanningImport: currentState,
      songRefs: [
        { id: "linked-one", kind: "library", songId: "song-1", songName: "Same Song" },
        { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
      ],
    })])];
    const imported = [section("source", "Praise", [element("incoming", "New set title", {
      sourceElementTypeRaw: "Song",
      sourceContentTitleRaw: "New set title",
      servicePlanningImport: {
        observed: { elementType: "Song", title: "New set title", ledBy: "", note: "" },
        applied: { elementType: "Song", title: "New set title", ledBy: "", note: "" },
        pendingFields: [],
      },
      songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "New lyrics" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed.elements[0].importAmbiguity?.status).toBe("unresolved");
    expect(refreshed.elements[0].importAmbiguity?.songMappings).toHaveLength(1);
    expect(getNewServicePlanImportAmbiguityIds(current, [refreshed])).toEqual(["set"]);
  });

  it("keeps confirmed title interpretation separate from a deferred song mapping", () => {
    const oldNote = { type: "paragraph" as const, id: "old-note", spans: [{ text: "Old note" }] };
    const newNote = { type: "paragraph" as const, id: "new-note", spans: [{ text: "New note" }] };
    const current = [section("section", "Praise", [element("set", "Worship Set", {
      sourcePlanningManaged: true,
      notes: { blocks: [oldNote] },
      servicePlanningImport: {
        observed: { elementType: "Song", title: "Worship Set", ledBy: "", note: "Old note" },
        applied: { elementType: "Song", title: "Worship Set", ledBy: "", note: "Old note" },
        pendingFields: [],
        managedNotes: [{ id: oldNote.id, fingerprint: servicePlanNoteFingerprint(oldNote) }],
      },
      songRefs: [
        { id: "linked-one", kind: "library", songId: "song-1", songName: "Same Song" },
        { id: "linked-two", kind: "library", songId: "song-2", songName: "Same Song" },
      ],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Praise:0", sourceElementType: "Song", sourceTitle: "Worship Set",
        sourceLedBy: "", parts: [{ kind: "description", value: "Worship Set", destination: "content", sourceField: "title" }],
        reasons: ["A pending song matches multiple linked library songs."], status: "deferred", sourceFingerprint: "title-source",
        songMappings: [{
          incoming: { kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" },
          candidateOccurrenceIds: ["linked-one", "linked-two"],
          mappingId: "same-song-mapping",
          sourceFingerprint: JSON.stringify(["same song", "Updated lyrics", ""]),
        }],
      },
    })])];
    const imported = [section("source", "Praise", [element("incoming", "Worship Set", {
      sourceElementTypeRaw: "Song",
      servicePlanningImport: {
        observed: { elementType: "Song", title: "Worship Set", ledBy: "", note: "New note" },
        applied: { elementType: "Song", title: "Worship Set", ledBy: "", note: "New note" },
        pendingFields: [],
        managedNotes: [{ id: newNote.id, fingerprint: servicePlanNoteFingerprint(newNote) }],
      },
      sourceNoteRaw: "New note",
      notes: { blocks: [newNote] },
      songRefs: [{ kind: "pending", title: "Same Song", lyricsText: "Updated lyrics" }],
    })])];

    const [refreshed] = refreshServicePlanFromImport(current, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const ambiguity = refreshed.elements[0].importAmbiguity;

    expect(ambiguity?.status).toBe("deferred");
    expect(ambiguity?.parts).toEqual(current[0].elements[0].importAmbiguity?.parts);
    expect(ambiguity?.songMappings?.[0]).toMatchObject({
      mappingId: "same-song-mapping",
      sourceFingerprint: JSON.stringify(["same song", "Updated lyrics", ""]),
    });
    expect(getNewServicePlanImportAmbiguityIds(current, [refreshed])).toEqual([]);
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
  const managedAssigneeElement = (
    people: Array<{ id: string; name: string; sourceId: string; memberId?: string; microphoneIds?: string[]; iemIds?: string[] }>,
    ledBy: string,
  ) => element("source-row", "Prayer", {
    sourcePlanningManaged: true,
    sourceElementTypeRaw: "Prayer",
    sourceLedByRaw: ledBy,
    assignees: people.map(({ sourceId, ...person }) => person),
    servicePlanningImport: {
      observed: { elementType: "Prayer", title: "Prayer", ledBy, note: "" },
      applied: { elementType: "Prayer", title: "Prayer", ledBy, note: "" },
      pendingFields: [],
      managedAssignees: people.map(({ id, name, sourceId }) => ({
        id,
        fields: ["ledBy" as const],
        ledByIdentity: sourceId,
        fingerprint: JSON.stringify({ name }),
      })),
    },
  });

  const managedRefresh = (currentElement: ServicePlanElement, importedElement: ServicePlanElement) =>
    refreshServicePlanFromImport(
      [section("section", "Worship", [currentElement])],
      [section("section", "Worship", [importedElement])],
      DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
    );

  const importedDescription = (title: string) => buildServicePlanSectionsFromImport({
    planLabel: "Sunday",
    sections: [{ sectionName: "Special", rows: [{ elementType: "Special Feature", title, ledBy: "" }] }],
    teamAssignments: [],
  }, [], { classifyExternalTitle: true });

  it("reconciles a meaningful-title imported text resource on accepted source refresh", () => {
    const [oldImport] = importedDescription("Skit/Mime – Pathfinder Pledge");
    const [newImport] = importedDescription("Skit/Mime – Walking With Jesus");
    const oldResource = oldImport.elements[0].resources![0];
    const current = element("source-row", "Special Feature", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Skit/Mime – Pathfinder Pledge",
      resources: [oldResource],
      importAmbiguity: oldImport.elements[0].importAmbiguity,
      servicePlanningImport: {
        observed: { elementType: "Special Feature", title: "Skit/Mime – Pathfinder Pledge", ledBy: "", note: "" },
        applied: { elementType: "Special Feature", title: "Skit/Mime – Pathfinder Pledge", ledBy: "", note: "" },
        pendingFields: [],
      },
    });
    const refreshed = managedRefresh(current, newImport.elements[0])[0].elements[0];

    expect(refreshed.resources).toHaveLength(1);
    expect(refreshed.resources![0]).toMatchObject({ title: "Skit/Mime – Walking With Jesus", type: "text" });
    expect(richTextToPlainText(refreshed.resources![0].data!.text as never)).toBe("Skit/Mime – Walking With Jesus");
    expect(refreshed.importAmbiguity?.parts[0].managed).toMatchObject({
      kind: "resource",
      id: refreshed.resources![0].id,
      fingerprint: servicePlanResourceFingerprint(refreshed.resources![0]),
    });
  });

  it("keeps imported text titles stable across serialize and repeated import", () => {
    const [fresh] = importedDescription("Skit/Mime – Walking With Jesus");
    const imported = [section("section", "Worship", [fresh.elements[0]])];
    const firstRefresh = refreshServicePlanFromImport(imported, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const serialized = JSON.parse(JSON.stringify(firstRefresh)) as ServicePlanSection[];
    const repeatedRefresh = refreshServicePlanFromImport(serialized, imported, DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(serialized[0].elements[0].resources?.[0].title).toBe("Skit/Mime – Walking With Jesus");
    expect(repeatedRefresh).toEqual(serialized);
  });

  it("upgrades a legacy placeholder only when its saved managed provenance matches", () => {
    const [incoming] = importedDescription("Walking With Jesus");
    const legacyResource = { ...createServicePlanTextResource({
      title: "Imported description",
      text: plainTextToRichText("Walking With Jesus"),
    }), id: "legacy-imported-description" };
    const current = element("source-row", "Special Feature", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Walking With Jesus",
      resources: [legacyResource],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special Feature",
        sourceTitle: "Walking With Jesus", sourceLedBy: "", parts: [{
          kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title",
          managed: { kind: "resource", id: legacyResource.id, fingerprint: servicePlanResourceFingerprint(legacyResource) },
        }], reasons: [], status: "confirmed", sourceFingerprint: "legacy-description",
      },
      servicePlanningImport: {
        observed: { elementType: "Special Feature", title: "Walking With Jesus", ledBy: "", note: "" },
        applied: { elementType: "Special Feature", title: "Walking With Jesus", ledBy: "", note: "" },
        pendingFields: [],
      },
    });
    const refreshed = managedRefresh(current, incoming.elements[0]);
    const serialized = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];

    expect(serialized[0].elements[0].resources![0]).toMatchObject({ id: legacyResource.id, title: "Walking With Jesus" });
    expect(serialized[0].elements[0].importAmbiguity?.parts[0].managed?.fingerprint)
      .toBe(servicePlanResourceFingerprint(serialized[0].elements[0].resources![0]));
    expect(refreshServicePlanFromImport(serialized, [section("section", "Worship", [incoming.elements[0]])], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS)).toEqual(serialized);
  });

  it("does not claim or rename an operator resource with matching imported text", () => {
    const [incoming] = importedDescription("Walking With Jesus");
    const operatorResource = createServicePlanTextResource({
      title: "Operator attachment",
      text: plainTextToRichText("Walking With Jesus"),
    });
    const current = element("source-row", "Special Feature", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: "Walking With Jesus",
      resources: [operatorResource],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Special:0", sourceElementType: "Special Feature",
        sourceTitle: "Walking With Jesus", sourceLedBy: "", parts: [{
          kind: "description", value: "Walking With Jesus", destination: "content", sourceField: "title",
        }], reasons: [], status: "confirmed", sourceFingerprint: "legacy-with-operator-resource",
      },
      servicePlanningImport: {
        observed: { elementType: "Special Feature", title: "Walking With Jesus", ledBy: "", note: "" },
        applied: { elementType: "Special Feature", title: "Walking With Jesus", ledBy: "", note: "" },
        pendingFields: [],
      },
    });

    const refreshed = managedRefresh(current, incoming.elements[0])[0].elements[0];
    expect(refreshed.resources).toEqual([operatorResource]);
    expect(refreshed.importAmbiguity?.parts[0].managed).toBeUndefined();
  });

  it.each([
    ["IEM only", { iemIds: ["iem-2"] }],
    ["microphone and IEM", { microphoneIds: ["mic-1"], iemIds: ["iem-2"] }],
  ])("preserves %s when an imported Led By person is renamed", (_label, equipment) => {
    const current = managedAssigneeElement([{ id: "managed", name: "Jamie", sourceId: "person-1", ...equipment }], "Jamie");
    const incoming = managedAssigneeElement([{ id: "fresh", name: "Jamey", sourceId: "person-1" }], "Jamey");
    const refreshed = managedRefresh(current, incoming);
    expect(refreshed[0].elements[0].assignees).toEqual([{ id: "managed", name: "Jamey", ...equipment }]);
    const serialized = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];
    const repeated = refreshServicePlanFromImport(serialized, [section("section", "Worship", [incoming])], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(repeated).toEqual(serialized);
  });

  it.each([
    ["IEM-only", { iemIds: ["iem-1"] }],
    ["microphone and IEM", { microphoneIds: ["mic-1"], iemIds: ["iem-1"] }],
  ])("leaves a removed imported person as an unassigned %s equipment slot", (_label, equipment) => {
    const current = managedAssigneeElement([{ id: "managed", name: "Jamie", sourceId: "person-1", ...equipment }], "Jamie");
    const removed = managedAssigneeElement([], "");
    const refreshed = managedRefresh(current, removed);
    expect(refreshed[0].elements[0].assignees).toEqual([{ id: "managed", ...equipment }]);
    const serialized = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];
    const repeated = refreshServicePlanFromImport(serialized, [section("section", "Worship", [removed])], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(repeated).toEqual(serialized);
  });

  it("keeps equipment attached to the stable person identity when imported people reorder", () => {
    const current = managedAssigneeElement([
      { id: "one", name: "Jamie", sourceId: "person-1", iemIds: ["iem-1"] },
      { id: "two", name: "Riley", sourceId: "person-2", microphoneIds: ["mic-2"], iemIds: ["iem-2"] },
    ], "Jamie, Riley");
    const incoming = managedAssigneeElement([
      { id: "new-two", name: "Riley", sourceId: "person-2" },
      { id: "new-one", name: "Jamie", sourceId: "person-1" },
    ], "Riley, Jamie");
    const refreshed = managedRefresh(current, incoming);
    expect(refreshed[0].elements[0].assignees).toEqual([
      { id: "one", name: "Jamie", iemIds: ["iem-1"] },
      { id: "two", name: "Riley", microphoneIds: ["mic-2"], iemIds: ["iem-2"] },
    ]);
  });

  const blankEquipmentElement = (
    assignees: NonNullable<ServicePlanElement["assignees"]>,
  ) => element("source-row", "Prayer", {
    sourcePlanningManaged: true,
    sourceLedByRaw: "",
    assignees,
    servicePlanningImport: {
      observed: { elementType: "Prayer", title: "Prayer", ledBy: "", note: "" },
      applied: { elementType: "Prayer", title: "Prayer", ledBy: "", note: "" },
      pendingFields: [],
    },
  });

  it("gives one imported person the first existing unassigned microphone slot", () => {
    const current = blankEquipmentElement([
      { id: "slot-1", microphoneIds: ["mic-lead"] },
      { id: "slot-2", microphoneIds: ["mic-spare"] },
      { id: "slot-3", microphoneIds: ["mic-lapel"] },
    ]);
    const incoming = managedAssigneeElement([{ id: "fresh", name: "Clarence Jones", sourceId: "clarence" }], "Clarence Jones");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "slot-1", name: "Clarence Jones", microphoneIds: ["mic-lead"] },
      { id: "slot-2", microphoneIds: ["mic-spare"] },
      { id: "slot-3", microphoneIds: ["mic-lapel"] },
    ]);
  });

  it("assigns multiple imported people to mixed equipment slots in stable order", () => {
    const current = blankEquipmentElement([
      { id: "slot-1", microphoneIds: ["mic-lead"] },
      { id: "slot-2", iemIds: ["iem-vocal"] },
      { id: "slot-3", microphoneIds: ["mic-band"], iemIds: ["iem-band"] },
    ]);
    const incoming = managedAssigneeElement([
      { id: "fresh-1", name: "Clarence Jones", sourceId: "clarence", memberId: "unverified-member" },
      { id: "fresh-2", name: "Jordan Smith", sourceId: "jordan" },
    ], "Clarence Jones, Jordan Smith");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "slot-1", name: "Clarence Jones", microphoneIds: ["mic-lead"] },
      { id: "slot-2", name: "Jordan Smith", iemIds: ["iem-vocal"] },
      { id: "slot-3", microphoneIds: ["mic-band"], iemIds: ["iem-band"] },
    ]);
  });

  it("appends only the people who exceed available equipment slots", () => {
    const current = blankEquipmentElement([{ id: "slot-1", microphoneIds: ["mic-lead"] }]);
    const incoming = managedAssigneeElement([
      { id: "fresh-1", name: "Clarence Jones", sourceId: "clarence" },
      { id: "fresh-2", name: "Jordan Smith", sourceId: "jordan" },
    ], "Clarence Jones, Jordan Smith");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "slot-1", name: "Clarence Jones", microphoneIds: ["mic-lead"] },
      { id: "fresh-2", name: "Jordan Smith" },
    ]);
  });

  it("does not displace a manually assigned person and does not claim that row", () => {
    const current = blankEquipmentElement([
      { id: "manual", name: "Operator choice", memberId: "member-7", microphoneIds: ["mic-manual"] },
      { id: "slot-1", microphoneIds: ["mic-lead"] },
    ]);
    const incoming = managedAssigneeElement([{ id: "fresh", name: "Clarence Jones", sourceId: "clarence" }], "Clarence Jones");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "manual", name: "Operator choice", memberId: "member-7", microphoneIds: ["mic-manual"] },
      { id: "slot-1", name: "Clarence Jones", microphoneIds: ["mic-lead"] },
    ]);
    expect(refreshed.elements[0].servicePlanningImport?.managedAssignees).toEqual([
      expect.objectContaining({ id: "slot-1", ledByIdentity: "clarence" }),
    ]);
  });

  it("reuses a same-name operator row without assigning it source ownership", () => {
    const current = blankEquipmentElement([
      { id: "manual", name: "Clarence Jones", memberId: "member-clarence", microphoneIds: ["mic-manual"] },
    ]);
    const incoming = managedAssigneeElement([{ id: "fresh", name: "Clarence Jones", sourceId: "clarence" }], "Clarence Jones");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "manual", name: "Clarence Jones", memberId: "member-clarence", microphoneIds: ["mic-manual"] },
    ]);
    expect(refreshed.elements[0].servicePlanningImport?.managedAssignees).toBeUndefined();
  });

  it("lets a source identity match win over a blank-slot fallback", () => {
    const current = managedAssigneeElement([
      { id: "managed", name: "Clarence Jones", sourceId: "clarence", microphoneIds: ["mic-lead"] },
    ], "Clarence Jones");
    current.assignees = [
      ...(current.assignees || []),
      { id: "slot-1", microphoneIds: ["mic-spare"] },
    ];
    const incoming = managedAssigneeElement([
      { id: "fresh", name: "Clarence Jones", sourceId: "clarence" },
    ], "Clarence Jones");

    const [refreshed] = managedRefresh(current, incoming);

    expect(refreshed.elements[0].assignees).toEqual([
      { id: "managed", name: "Clarence Jones", microphoneIds: ["mic-lead"] },
      { id: "slot-1", microphoneIds: ["mic-spare"] },
    ]);
  });

  it("keeps the fallback result stable across repeated serialized refreshes", () => {
    const current = blankEquipmentElement([
      { id: "slot-1", microphoneIds: ["mic-lead"] },
      { id: "slot-2", iemIds: ["iem-vocal"] },
    ]);
    const incoming = managedAssigneeElement([
      { id: "fresh-1", name: "Clarence Jones", sourceId: "clarence" },
      { id: "fresh-2", name: "Jordan Smith", sourceId: "jordan" },
    ], "Clarence Jones, Jordan Smith");

    const [once] = managedRefresh(current, incoming);
    const serialized = JSON.parse(JSON.stringify(once.elements[0])) as ServicePlanElement;
    const [twice] = managedRefresh(serialized, incoming);

    expect(twice).toEqual(once);
  });

  const source = (title: string, ledBy: string) => ({
    elementType: "Reading the Word", title, ledBy, note: "",
  });

  it("imports title-derived people on new and matching items and stays stable after serialization", () => {
    const title = "Co-Hosts - Oniel Campbell, Jackie Mullings, Candice Bailey";
    const sourceData: ServicePlanningImportData = {
      planLabel: "Sunday worship",
      sections: [{ sectionName: "Reading", rows: [{ elementType: "Reading the Word", title, ledBy: "Clarence Jones" }] }],
      teamAssignments: [],
    };
    const [fresh] = buildServicePlanSectionsFromImport(sourceData, [], {
      classifyExternalTitle: true,
      knownPeople: ["Oniel Campbell", "Jackie Mullings", "Candice Bailey", "Clarence Jones"],
    });
    const freshElement = fresh.elements[0];
    expect(freshElement.assignees?.map(({ name }) => name)).toEqual([
      "Clarence Jones", "Oniel Campbell", "Jackie Mullings", "Candice Bailey",
    ]);
    expect(freshElement.sourceContentTitleRaw).toBe(title);
    expect(freshElement.importAmbiguity?.sourceTitle).toBe(title);
    expect(freshElement.importAmbiguity?.parts.map(({ value }) => value)).toEqual([
      "Oniel Campbell", "Jackie Mullings", "Candice Bailey",
    ]);

    const current = [section("current", "Reading", [element("same", "Reading the Word", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: title,
      sourceLedByRaw: "Clarence Jones",
      assignees: [{ id: "lead", name: "Clarence Jones" }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading the Word",
        sourceTitle: title, sourceLedBy: "Clarence Jones", parts: [], reasons: [],
        status: "confirmed", sourceFingerprint: "prior-import",
      },
      servicePlanningImport: {
        observed: source(title, "Clarence Jones"), applied: source(title, "Clarence Jones"), pendingFields: [],
        managedAssignees: [{ id: "lead", fields: ["ledBy"], fingerprint: JSON.stringify({ name: "Clarence Jones" }) }],
      },
    })])];
    const refreshed = refreshServicePlanFromImport(current, [fresh], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed[0].elements[0].assignees?.map(({ name }) => name)).toEqual([
      "Clarence Jones", "Oniel Campbell", "Jackie Mullings", "Candice Bailey",
    ]);
    const serialized = JSON.parse(JSON.stringify(refreshed)) as ServicePlanSection[];
    expect(refreshServicePlanFromImport(serialized, [fresh], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS)).toEqual(serialized);
  });

  it("continues reconciling an explicitly confirmed title assignee when the title is unchanged", () => {
    const title = "Psalms 97 (NLT) Jasmine Williams";
    const [incoming] = buildServicePlanSectionsFromImport({
      planLabel: "Sunday", sections: [{ sectionName: "Reading", rows: [{ elementType: "Reading", title, ledBy: "" }] }], teamAssignments: [],
    }, [], { classifyExternalTitle: true, knownPeople: ["Jasmine Williams"] });
    const current = [section("current", "Reading", [element("same", "Reading", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: title,
      assignees: [{ id: "title-slot", microphoneIds: ["mic-orange"] }],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: title,
        sourceLedBy: "", parts: [{ kind: "person", value: "Jasmine Williams", destination: "assignee", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "reviewed-title-person",
      },
      servicePlanningImport: {
        observed: source(title, ""), applied: source(title, ""), pendingFields: [],
      },
    })])];
    const refreshed = refreshServicePlanFromImport(current, [incoming], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    expect(refreshed[0].elements[0].assignees).toEqual([
      { id: "title-slot", name: "Jasmine Williams", microphoneIds: ["mic-orange"] },
    ]);
  });

  it("repairs a source-managed title person left beside its equipment slot", () => {
    const title = "Psalms 97 (NLT) Jasmine Williams";
    const [incoming] = buildServicePlanSectionsFromImport({
      planLabel: "Sunday", sections: [{ sectionName: "Reading", rows: [{ elementType: "Reading", title, ledBy: "" }] }], teamAssignments: [],
    }, [], { classifyExternalTitle: true, knownPeople: ["Jasmine Williams"] });
    const current = [section("current", "Reading", [element("same", "Reading", {
      sourcePlanningManaged: true,
      sourceContentTitleRaw: title,
      assignees: [
        { id: "title-slot", microphoneIds: ["mic-orange"] },
        { id: "import-person", name: "Jasmine Williams" },
      ],
      importAmbiguity: {
        source: "servicePlanning", sourceKey: "Reading:0", sourceElementType: "Reading", sourceTitle: title,
        sourceLedBy: "", parts: [{ kind: "person", value: "Jasmine Williams", destination: "assignee", sourceField: "title" }],
        reasons: [], status: "confirmed", sourceFingerprint: "old-append-only-title",
      },
      servicePlanningImport: {
        observed: source(title, ""), applied: source(title, ""), pendingFields: [],
        managedAssignees: [{ id: "import-person", fields: ["title"], fingerprint: JSON.stringify({ name: "Jasmine Williams" }) }],
      },
    })])];

    const once = refreshServicePlanFromImport(current, [incoming], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);
    const saved = JSON.parse(JSON.stringify(once)) as ServicePlanSection[];
    const twice = refreshServicePlanFromImport(saved, [incoming], DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS);

    expect(once[0].elements[0].assignees).toEqual([
      { id: "title-slot", name: "Jasmine Williams", microphoneIds: ["mic-orange"] },
    ]);
    expect(once[0].elements[0].servicePlanningImport?.managedAssignees).toEqual([
      expect.objectContaining({ id: "title-slot", fields: ["ledBy", "title"] }),
    ]);
    expect(twice).toEqual(saved);
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
      expect.objectContaining({ title: "Skit/Mime – The Good Samaritan" }), manualResource,
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
