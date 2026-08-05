import { buildServicePlanningPreview } from "./buildServicePlanningPreview";
import type { EventData } from "../../containers/Overlays/eventParser";
import type { ServiceItem } from "../../types";
import type { ServicePlanningConfig } from "../../types/integrations";

const song = (id: string, name: string): ServiceItem => ({
  _id: id,
  name,
  type: "song",
  listId: id,
});

const servicePlanning: ServicePlanningConfig = {
  enabled: true,
  people: [],
  sectionRules: [
    {
      id: "section-rule",
      matchSectionName: "Praise",
      matchMode: "contains",
      headingName: "Praise",
    },
  ],
  elementRules: [
    {
      id: "element-rule",
      matchElementType: "Song of Praise",
      matchMode: "contains",
      overlaySyncEnabled: false,
      displayName: "",
      nameSources: ["ledBy"],
      multiOverlay: { mode: "single" },
      outlineSync: { enabled: true, itemType: "song" },
    },
  ],
};

const buildPreview = (row: EventData, songs: ServiceItem[]) =>
  buildServicePlanningPreview({
    importData: {
      planLabel: "Sat, Aug 1",
      sections: [{ sectionName: "Praise & Prayer", rows: [row] }],
      teamAssignments: [],
    },
    servicePlanning,
    overlays: [],
    allItems: songs,
    activeOutlineList: [],
  });

const baseRow: EventData = {
  elementType: "Song of Praise",
  title: "How Great is Our God (E)",
  ledBy: "Praise Team",
};

describe("buildServicePlanningPreview song matching", () => {
  const library = [
    song("song-42", "How Great Is Our God"),
    song("song-99", "How Great Is Our God (Live)"),
  ];

  it("uses the song the plan already linked instead of matching the title again", () => {
    // The operator resolved this in Services; re-guessing could land on the
    // near-duplicate, and this row is on its way into the live outline.
    const { outlineCandidates } = buildPreview(
      { ...baseRow, songId: "song-99", songTitle: "How Great Is Our God (Live)" },
      library,
    );

    expect(outlineCandidates[0].matchedLibraryItem?._id).toBe("song-99");
  });

  it("matches on the plan's song title rather than the row title", () => {
    const { outlineCandidates } = buildPreview(
      { ...baseRow, title: "Song of Praise", songTitle: "How Great Is Our God" },
      library,
    );

    expect(outlineCandidates[0].matchedLibraryItem?._id).toBe("song-42");
  });

  it("still matches a scraped row that carries no song identity", () => {
    const { outlineCandidates } = buildPreview(baseRow, [
      song("song-42", "How Great Is Our God"),
    ]);

    expect(outlineCandidates[0].matchedLibraryItem?._id).toBe("song-42");
  });

  it("falls back to matching when the linked song has left the library", () => {
    const { outlineCandidates } = buildPreview(
      { ...baseRow, songId: "deleted-song", songTitle: "How Great Is Our God" },
      [song("song-42", "How Great Is Our God")],
    );

    expect(outlineCandidates[0].matchedLibraryItem?._id).toBe("song-42");
  });
});

describe("buildServicePlanningPreview scripture matching", () => {
  const psalm = {
    label: "Psalms 90:1-2 NLT",
    book: "Psalms",
    chapter: "90",
    verseRange: "1-2",
    version: "NLT",
  };
  const john = {
    label: "John 3:16 NLT",
    book: "John",
    chapter: "3",
    verseRange: "16",
    version: "NLT",
  };
  const parsed = ({ book, chapter, verseRange, version }: typeof psalm) => ({
    book,
    chapter,
    verseRange,
    version,
  });

  it("makes a scripture the operator attached a Bible row on its own", () => {
    // No element rule matches "bible" — the rules match the *source's* free-text
    // element type, which a hand-added plan element never has.
    const { outlineCandidates } = buildPreview(
      {
        elementType: "bible",
        title: "Sermon text",
        ledBy: "Pastor Lee",
        scriptureRefs: [psalm],
      },
      [],
    );

    expect(outlineCandidates).toHaveLength(1);
    expect(outlineCandidates[0].outlineItemType).toBe("bible");
    expect(outlineCandidates[0].parsedRef).toEqual(parsed(psalm));
  });

  it("gives every attached passage its own candidate, named by the passage", () => {
    const { outlineCandidates, lineItems } = buildPreview(
      {
        elementType: "bible",
        title: "Sermon text",
        ledBy: "",
        scriptureRefs: [psalm, john],
      },
      [],
    );

    expect(outlineCandidates.map((candidate) => candidate.title)).toEqual([
      "Psalms 90:1-2 NLT",
      "John 3:16 NLT",
    ]);
    expect(outlineCandidates.map((candidate) => candidate.parsedRef)).toEqual([
      parsed(psalm),
      parsed(john),
    ]);
    // The preview mirrors the source order of service, so the row stays one row.
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].title).toBe("Sermon text");
  });

  it("prefers the attached reference over re-reading the row title", () => {
    const { outlineCandidates } = buildPreview(
      {
        elementType: "Scripture Reading",
        title: "John 3:16",
        ledBy: "",
        scriptureRefs: [psalm],
      },
      [],
    );

    expect(outlineCandidates[0].parsedRef).toEqual(parsed(psalm));
  });

  it("leaves a row with no attached scripture to the element rules", () => {
    const { outlineCandidates } = buildPreview(
      { elementType: "Scripture Reading", title: "Psalms 90 (NLT)", ledBy: "" },
      [],
    );

    expect(outlineCandidates).toHaveLength(0);
  });
});
