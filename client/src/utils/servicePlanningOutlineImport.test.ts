import {
  executeServicePlanningOutlineSyncStep,
  insertServicePlanningOutlineCandidates,
  planServicePlanningOutlineSyncSteps,
} from "./servicePlanningOutlineImport";
import { createBibleItemFromParsedReference } from "./servicePlanningBibleImport";

jest.mock("./servicePlanningBibleImport", () => ({
  createBibleItemFromParsedReference: jest.fn(),
}));

const mockedCreateBibleItemFromParsedReference =
  createBibleItemFromParsedReference as jest.MockedFunction<
    typeof createBibleItemFromParsedReference
  >;

describe("insertServicePlanningOutlineCandidates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates and inserts Bible items under the matched heading", async () => {
    mockedCreateBibleItemFromParsedReference.mockResolvedValue({
      _id: "bible-john-3",
      name: "John 3:16-17 NIV",
      type: "bible",
      background: "background-a",
    } as any);

    const result = await insertServicePlanningOutlineCandidates({
      outlineCandidates: [
        {
          sectionName: "Message",
          headingName: "Scripture",
          elementType: "Scripture",
          title: "John 3:16-17 NIV",
          outlineItemType: "bible",
          cleanedTitle: "John 3:16-17 NIV",
          matchedLibraryItem: null,
          parsedRef: {
            book: "John",
            chapter: "3",
            verseRange: "16-17",
            version: "NIV",
          },
          overlayReady: false,
        },
      ],
      currentList: [
        {
          _id: "heading-1",
          name: "Scripture",
          type: "heading",
          listId: "list-heading-1",
        },
      ],
      allItems: [],
      db: undefined,
      bibleDb: undefined,
      defaultBibleBackground: "#000",
      defaultBibleBackgroundBrightness: 60,
      defaultBibleFontMode: "separate",
    });

    expect(mockedCreateBibleItemFromParsedReference).toHaveBeenCalled();
    expect(result.inserted).toBe(1);
    expect(result.listChanged).toBe(true);
    expect(result.createdAllItems).toEqual([
      expect.objectContaining({
        _id: "bible-john-3",
        name: "John 3:16-17 NIV",
        type: "bible",
      }),
    ]);
    expect(result.newList).toEqual([
      expect.objectContaining({ type: "heading", name: "Scripture" }),
      expect.objectContaining({
        _id: "bible-john-3",
        name: "John 3:16-17 NIV",
        type: "bible",
      }),
    ]);
  });

  it("reports no list changes when nothing is insertable", async () => {
    const result = await insertServicePlanningOutlineCandidates({
      outlineCandidates: [],
      currentList: [],
      allItems: [],
      db: undefined,
      bibleDb: undefined,
      defaultBibleBackground: "#000",
      defaultBibleBackgroundBrightness: 60,
      defaultBibleFontMode: "separate",
    });

    expect(result.inserted).toBe(0);
    expect(result.listChanged).toBe(false);
    expect(result.newList).toEqual([]);
  });

  it("plans heading and item steps in order for staged sync", () => {
    const steps = planServicePlanningOutlineSyncSteps([
      {
        sectionName: "Message",
        headingName: "Scripture",
        elementType: "Song of Praise",
        title: "Amazing Grace",
        outlineItemType: "song",
        cleanedTitle: "Amazing Grace",
        matchedLibraryItem: {
          _id: "song-1",
          name: "Amazing Grace",
          type: "song",
        } as any,
        parsedRef: null,
        overlayReady: false,
      },
    ]);

    expect(steps).toEqual([
      {
        kind: "ensureHeading",
        headingName: "Scripture",
      },
      expect.objectContaining({
        kind: "insertSong",
        headingName: "Scripture",
      }),
    ]);
  });

  it("executes one outline step at a time and skips duplicates under the same heading", async () => {
    const step = {
      kind: "insertSong" as const,
      headingName: "Praise",
      candidate: {
        sectionName: "Worship",
        headingName: "Praise",
        elementType: "Song of Praise",
        title: "You Deserve It",
        outlineItemType: "song" as const,
        cleanedTitle: "You Deserve It",
        matchedLibraryItem: {
          _id: "song-you-deserve-it",
          name: "You Deserve It",
          type: "song",
        } as any,
        parsedRef: null,
        overlayReady: false,
      },
    };

    const first = await executeServicePlanningOutlineSyncStep({
      step,
      currentList: [
        {
          _id: "heading-praise",
          name: "Praise",
          type: "heading",
          listId: "list-heading-praise",
        },
      ],
      allItems: [],
      db: undefined,
      bibleDb: undefined,
      defaultBibleBackground: "#000",
      defaultBibleBackgroundBrightness: 60,
      defaultBibleFontMode: "separate",
    });

    expect(first.inserted).toBe(1);
    expect(first.activeListId).toBeTruthy();

    const second = await executeServicePlanningOutlineSyncStep({
      step,
      currentList: first.newList,
      allItems: [],
      db: undefined,
      bibleDb: undefined,
      defaultBibleBackground: "#000",
      defaultBibleBackgroundBrightness: 60,
      defaultBibleFontMode: "separate",
    });

    expect(second.inserted).toBe(0);
    expect(second.newList).toHaveLength(first.newList.length);
  });
});
