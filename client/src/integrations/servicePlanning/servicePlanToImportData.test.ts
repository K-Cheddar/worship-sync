import { servicePlanToImportData } from "./servicePlanToImportData";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlanElement } from "../../types/servicePlan";

const element = (overrides: Partial<ServicePlanElement>): ServicePlanElement => ({
  id: "element-1",
  type: "free",
  title: plainTextToRichText("Untitled"),
  ...overrides,
});

const planWith = (elements: ServicePlanElement[], name = "Sabbath Service") => ({
  name,
  sections: [{ id: "section-1", name: "Worship", elements }],
});

describe("servicePlanToImportData", () => {
  it("prefers the raw scraped source strings over the derived enum", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "song",
          title: plainTextToRichText("How Great Thou Art"),
          sourceElementTypeRaw: "Worship Set",
          sourceLedByRaw: "Dana R.",
          assignedName: "Dana Robinson",
        }),
      ]),
    );

    expect(sections[0].rows[0]).toMatchObject({
      elementType: "Worship Set",
      title: "How Great Thou Art",
      ledBy: "Dana R.",
      assigneeNames: ["Dana Robinson"],
    });
  });

  it("keeps source led-by data for matching while exposing all current assignees", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          sourceLedByRaw: "Dana R.",
          assignees: [
            { id: "a1", name: "Dana Robinson" },
            { id: "a2", name: "Morgan Lee" },
            { id: "a3", name: "Taylor Smith" },
          ],
        }),
      ]),
    );

    expect(sections[0].rows[0]).toMatchObject({
      ledBy: "Dana R.",
      assigneeNames: ["Dana Robinson", "Morgan Lee", "Taylor Smith"],
    });
  });

  it("falls back to the element's own type and assignment when hand-created", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "bible",
          title: plainTextToRichText("John 3:16"),
          assignedName: "Sam",
        }),
      ]),
    );

    expect(sections[0].rows[0]).toMatchObject({
      elementType: "bible",
      title: "John 3:16",
      ledBy: "Sam",
    });
  });

  it("leaves ledBy empty rather than undefined when nobody is assigned", () => {
    const { sections } = servicePlanToImportData(
      planWith([element({ title: plainTextToRichText("Offering") })]),
    );

    expect(sections[0].rows[0].ledBy).toBe("");
  });

  it("converts canonical durationSeconds to minutes, ignoring the legacy mirror", () => {
    const { sections } = servicePlanToImportData(
      planWith([element({ durationSeconds: 90, durationMinutes: 5 })]),
    );

    expect(sections[0].rows[0].durationMinutes).toBe(1.5);
  });

  it("uses legacy durationMinutes when no seconds value is stored", () => {
    const { sections } = servicePlanToImportData(
      planWith([element({ durationMinutes: 4 })]),
    );

    expect(sections[0].rows[0].durationMinutes).toBe(4);
  });

  it("omits duration entirely when the element has none", () => {
    const { sections } = servicePlanToImportData(planWith([element({})]));

    expect(sections[0].rows[0]).not.toHaveProperty("durationMinutes");
  });

  it("carries notes and named team notes across, dropping empty ones", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          notes: plainTextToRichText("Fade the pads out"),
          teamNotes: [
            { id: "note-1", label: "Band", note: plainTextToRichText("Key of G") },
            { id: "note-2", label: "Media", note: plainTextToRichText("  ") },
          ],
        }),
      ]),
    );

    expect(sections[0].rows[0].note).toBe("Fade the pads out");
    expect(sections[0].rows[0].teamNotes).toEqual([
      { teamName: "Band", note: "Key of G" },
    ]);
  });

  it("carries a linked library song across as an identity, not a title to re-guess", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "song",
          title: plainTextToRichText("How Great is Our God (E)"),
          songRef: {
            kind: "library",
            songId: "song-42",
            songName: "How Great Is Our God",
          },
        }),
      ]),
    );

    expect(sections[0].rows[0]).toMatchObject({
      songId: "song-42",
      songTitle: "How Great Is Our God",
    });
  });

  it("carries an unlinked song as a title only", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "song",
          title: plainTextToRichText("Rolled the Sea Away (Bb)"),
          songRef: { kind: "pending", title: "Rolled the Sea Away", lyricsText: "" },
        }),
      ]),
    );

    expect(sections[0].rows[0].songTitle).toBe("Rolled the Sea Away");
    expect(sections[0].rows[0].songId).toBeUndefined();
  });

  it("carries every attached scripture across as a parsed reference", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "bible",
          title: plainTextToRichText("Sermon text"),
          scriptureRefs: [
            {
              label: "Psalms 90:1-2 NLT",
              book: "Psalms",
              chapter: "90",
              verseRange: "1-2",
              version: "NLT",
            },
            {
              label: "John 3:16 NLT",
              book: "John",
              chapter: "3",
              verseRange: "16",
              version: "NLT",
            },
          ],
        }),
      ]),
    );

    expect(sections[0].rows[0].scriptureRefs).toEqual([
      {
        label: "Psalms 90:1-2 NLT",
        book: "Psalms",
        chapter: "90",
        verseRange: "1-2",
        version: "NLT",
      },
      {
        label: "John 3:16 NLT",
        book: "John",
        chapter: "3",
        verseRange: "16",
        version: "NLT",
      },
    ]);
  });

  it("carries a legacy single scriptureRef the same way", () => {
    const { sections } = servicePlanToImportData(
      planWith([
        element({
          type: "bible",
          title: plainTextToRichText("Sermon text"),
          scriptureRef: {
            label: "Psalms 90:1-2 NLT",
            book: "Psalms",
            chapter: "90",
            verseRange: "1-2",
            version: "NLT",
          },
        }),
      ]),
    );

    expect(sections[0].rows[0].scriptureRefs).toEqual([
      {
        label: "Psalms 90:1-2 NLT",
        book: "Psalms",
        chapter: "90",
        verseRange: "1-2",
        version: "NLT",
      },
    ]);
  });

  it("leaves rows with no song alone", () => {
    const { sections } = servicePlanToImportData(
      planWith([element({ title: plainTextToRichText("Announcements") })]),
    );

    expect(sections[0].rows[0].songTitle).toBeUndefined();
    expect(sections[0].rows[0].songId).toBeUndefined();
  });

  it("labels the plan and reports no scraped assignments", () => {
    const importData = servicePlanToImportData(planWith([element({})], "  "));

    expect(importData.planLabel).toBe("Service plan");
    expect(importData.teamAssignments).toEqual([]);
  });
});
