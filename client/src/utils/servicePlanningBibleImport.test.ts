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
      libraryItems: [],
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

  it("uses the configured media URL when the saved Bible preference omits its background URL", async () => {
    mockedGetVersesApi.mockResolvedValue({
      name: "4",
      index: 3,
      verses: [{ name: "10", index: 9, text: "Bless me indeed" }],
    });
    mockedCreateNewBible.mockImplementation(
      jest.requireActual<typeof import("./itemUtil")>("./itemUtil").createNewBible,
    );
    const mediaInfo = {
      type: "image" as const,
      background: "https://media.example.test/bible.jpg",
      localImage: { id: "bible-image", cloudUrl: "https://media.example.test/bible.jpg" },
    } as any;

    const created = await createBibleItemFromParsedReference({
      parsedRef: {
        book: "1 Chronicles",
        chapter: "4",
        verseRange: "10",
        version: "NKJV",
      },
      db: undefined,
      bibleDb: undefined,
      libraryItems: [],
      background: "",
      mediaInfo,
      brightness: 47,
      fontMode: "separate",
    });

    expect(mockedCreateNewBible).toHaveBeenCalledWith(expect.objectContaining({
      background: "https://media.example.test/bible.jpg",
      mediaInfo,
      brightness: 47,
      fontMode: "separate",
    }));
    expect(created.background).toBe("https://media.example.test/bible.jpg");
    expect(created.slides.length).toBeGreaterThan(1);
    expect(created.slides.every((slide) =>
      slide.boxes[0]?.background === "https://media.example.test/bible.jpg",
    )).toBe(true);
    expect(created.slides[0].boxes[0].mediaInfo).toEqual(mediaInfo);
  });

  it("reuses cached Bible Gateway chapters before fetching remotely", async () => {
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
        isFromBibleGateway: true,
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
      libraryItems: [],
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

  it("ignores seeded (non-Bible-Gateway) cache and fetches the requested version", async () => {
    // The seeded bibleDb ships public-domain KJV text under every version key,
    // so trusting it would mislabel the verses (e.g. NKJV item with KJV text).
    const bibleDb = {
      get: jest.fn().mockResolvedValue({
        _id: "nkjv-John-3",
        book: "John",
        chapter: "3",
        version: "nkjv",
        verses: [
          { name: "1", index: 0, text: "Seed KJV verse 1" },
          { name: "2", index: 1, text: "Seed KJV verse 2" },
        ],
        lastUpdated: new Date().toISOString(),
        isFromBibleGateway: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      put: jest.fn().mockResolvedValue(undefined),
    };
    mockedGetVersesApi.mockResolvedValue({
      name: "3",
      index: 2,
      verses: [
        { name: "1", index: 0, text: "Live NKJV verse 1" },
        { name: "2", index: 1, text: "Live NKJV verse 2" },
      ],
    });
    mockedCreateNewBible.mockResolvedValue({
      _id: "john-3",
      name: "John 3:1-2 NKJV",
      type: "bible",
      background: "#000",
    } as any);

    await createBibleItemFromParsedReference({
      parsedRef: {
        book: "John",
        chapter: "3",
        verseRange: "1-2",
        version: "NKJV",
      },
      name: "John 3:1-2 NKJV",
      db: undefined,
      bibleDb,
      libraryItems: [],
      background: "#000",
      brightness: 60,
      fontMode: "separate",
    });

    expect(mockedGetVersesApi).toHaveBeenCalledWith({
      book: "John",
      chapter: 2,
      version: "nkjv",
    });
    expect(mockedCreateNewBible).toHaveBeenCalledWith(
      expect.objectContaining({
        verses: [
          { name: "1", index: 0, text: "Live NKJV verse 1" },
          { name: "2", index: 1, text: "Live NKJV verse 2" },
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
      libraryItems: [],
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

  it("uses the selected verse span for full-chapter names when no verse range is parsed", async () => {
    mockedGetVersesApi.mockResolvedValue({
      name: "91",
      index: 90,
      verses: [
        { name: "1", index: 0, text: "Verse 1" },
        { name: "13", index: 12, text: "Verse 13" },
      ],
    });
    mockedCreateNewBible.mockResolvedValue({
      _id: "psalms-91",
      name: "Psalms 91:1 - 13 NIV",
      type: "bible",
      background: "#000",
    } as any);

    await createBibleItemFromParsedReference({
      parsedRef: {
        book: "Psalms",
        chapter: "91",
        verseRange: "",
        version: "NIV",
      },
      db: undefined,
      bibleDb: undefined,
      libraryItems: [],
      background: "#000",
      brightness: 60,
      fontMode: "separate",
    });

    expect(mockedCreateNewBible).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Psalms 91:1 - 13 NIV",
        verses: [
          { name: "1", index: 0, text: "Verse 1" },
          { name: "13", index: 12, text: "Verse 13" },
        ],
      }),
    );
  });
});
