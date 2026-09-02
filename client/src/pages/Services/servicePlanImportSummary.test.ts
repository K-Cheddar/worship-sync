import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import {
  applySelectedServicePlanImportChanges,
  servicePlanImportChangeKey,
  summarizeServicePlanImport,
} from "./servicePlanImportSummary";

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
            { label: "Assigned to", before: "Avery", after: "Blair" },
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

    expect(summary).toEqual({ changes: [], added: 0, removed: 0, updated: 0 });
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
    });
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
