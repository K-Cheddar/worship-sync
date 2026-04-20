import { createBibleItemFromParsedReference } from "./servicePlanningBibleImport";
import { createNewBible } from "./itemUtil";
import { getVerses as getVersesApi } from "../api/getVerses";

jest.mock("../api/getVerses", () => ({
  getVerses: jest.fn(),
}));

jest.mock("./itemUtil", () => {
  const actual = jest.requireActual("./itemUtil");
  return {
    ...actual,
    createNewBible: jest.fn(),
  };
});

const mockedGetVersesApi = getVersesApi as jest.MockedFunction<
  typeof getVersesApi
>;
const mockedCreateNewBible = createNewBible as jest.MockedFunction<
  typeof createNewBible
>;

describe("createBibleItemFromParsedReference", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses canonical Bible book names when importing Psalm references", async () => {
    mockedGetVersesApi.mockResolvedValue({
      name: "78",
      index: 77,
      verses: [
        { name: "1", index: 0, text: "Verse 1" },
        { name: "2", index: 1, text: "Verse 2" },
      ],
    });
    mockedCreateNewBible.mockResolvedValue({
      _id: "psalm-78",
      name: "Psalm 78:1-2 NIV",
      type: "bible",
      background: "#000",
    } as any);

    await createBibleItemFromParsedReference({
      parsedRef: {
        book: "Psalm",
        chapter: "78",
        verseRange: "1-2",
        version: "NIV",
      },
      name: "Psalm 78:1-2 NIV",
      db: undefined,
      bibleDb: undefined,
      allItems: [],
      background: "#000",
      brightness: 60,
      fontMode: "separate",
    });

    expect(mockedGetVersesApi).toHaveBeenCalledWith({
      book: "Psalms",
      chapter: 77,
      version: "niv",
    });
    expect(mockedCreateNewBible).toHaveBeenCalledWith(
      expect.objectContaining({
        book: "Psalms",
        version: "niv",
      }),
    );
  });

  it("uses cached local Bible chapters before fetching remotely", async () => {
    const bibleDb = {
      get: jest.fn().mockResolvedValue({
        _id: "niv-Psalms-78",
        book: "Psalms",
        chapter: "78",
        version: "niv",
        verses: [
          { name: "1", index: 0, text: "Cached verse 1" },
          { name: "2", index: 1, text: "Cached verse 2" },
        ],
        lastUpdated: new Date().toISOString(),
        isFromBibleGateway: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      put: jest.fn(),
    };
    mockedCreateNewBible.mockResolvedValue({
      _id: "psalm-78",
      name: "Psalm 78:1-2 NIV",
      type: "bible",
      background: "#000",
    } as any);

    await createBibleItemFromParsedReference({
      parsedRef: {
        book: "Psalm",
        chapter: "78",
        verseRange: "1-2",
        version: "NIV",
      },
      name: "Psalm 78:1-2 NIV",
      db: undefined,
      bibleDb,
      allItems: [],
      background: "#000",
      brightness: 60,
      fontMode: "separate",
    });

    expect(bibleDb.get).toHaveBeenCalledWith("niv-Psalms-78");
    expect(mockedGetVersesApi).not.toHaveBeenCalled();
    expect(mockedCreateNewBible).toHaveBeenCalledWith(
      expect.objectContaining({
        verses: [
          { name: "1", index: 0, text: "Cached verse 1" },
          { name: "2", index: 1, text: "Cached verse 2" },
        ],
      }),
    );
  });

  it("creates a Bible item with the requested verse range and normalized version", async () => {
    mockedGetVersesApi.mockResolvedValue({
      name: "1",
      index: 0,
      verses: [
        { name: "1", index: 0, text: "Verse 1" },
        { name: "2", index: 1, text: "Verse 2" },
        { name: "3", index: 2, text: "Verse 3" },
      ],
    });
    mockedCreateNewBible.mockResolvedValue({
      _id: "john-3-16-17",
      name: "John 3:16-17 NIV",
      type: "bible",
      background: "#000",
    } as any);

    await createBibleItemFromParsedReference({
      parsedRef: {
        book: "John",
        chapter: "3",
        verseRange: "2-3",
        version: "NIV",
      },
      name: "John 3:16-17 NIV",
      db: undefined,
      bibleDb: undefined,
      allItems: [],
      background: "#000",
      brightness: 60,
      fontMode: "separate",
    });

    expect(mockedGetVersesApi).toHaveBeenCalledWith({
      book: "John",
      chapter: 2,
      version: "niv",
    });
    expect(mockedCreateNewBible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "John 3:16-17 NIV",
        version: "niv",
        verses: [
          { name: "2", index: 1, text: "Verse 2" },
          { name: "3", index: 2, text: "Verse 3" },
        ],
      }),
    );
  });
});
