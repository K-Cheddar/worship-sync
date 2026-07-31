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
