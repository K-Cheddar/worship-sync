import { plainTextToRichText } from "../../types/richText";
import type {
  ServicePlanElement,
  ServicePlanSection,
} from "../../types/servicePlan";
import { summarizeServicePlanImport } from "./servicePlanImportSummary";

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

describe("summarizeServicePlanImport", () => {
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
});
