import { plainTextToRichText, richTextToPlainText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  DEFAULT_SERVICE_PLANNING_REFRESH_OPTIONS,
  mergeImportedAssignees,
  refreshServicePlanFromImport,
} from "./servicePlanImportSync";

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
