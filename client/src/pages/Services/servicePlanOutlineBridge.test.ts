import {
  buildServicePlanOutlineItems,
  planServicePlanOutlineItems,
  placeServicePlanOutlineItem,
} from "./servicePlanOutlineBridge";
import { createBibleItemFromParsedReference } from "../../utils/servicePlanningBibleImport";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";
import { getVerses } from "../../api/getVerses";
import { createNewBible } from "../../utils/itemUtil";

jest.mock("../../api/getVerses", () => ({ getVerses: jest.fn() }));
jest.mock("../../utils/itemUtil", () => ({
  ...jest.requireActual("../../utils/itemUtil"),
  createNewBible: jest.fn(),
}));

jest.mock("../../utils/servicePlanningBibleImport", () => ({
  createBibleItemFromParsedReference: jest.fn(),
}));

const mockCreateBibleItem = jest.mocked(createBibleItemFromParsedReference);

const basePlan: ServicePlan = {
  planId: "plan-1",
  churchId: "church-1",
  planKey: "service-1@2026-07-26",
  serviceId: "service-1",
  date: "2026-07-26",
  name: "Sunday Service",
  sections: [
    {
      id: "section-1",
      name: "Worship",
      elements: [
        {
          id: "el-song",
          type: "song",
          title: plainTextToRichText("Great Are You Lord"),
          songRef: { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
        },
        {
          id: "el-pending",
          type: "song",
          title: plainTextToRichText("Unwritten Song"),
          songRef: { kind: "pending", title: "Unwritten Song", lyricsText: "" },
        },
        {
          id: "el-video",
          type: "video",
          title: plainTextToRichText("Baptism Testimony"),
        },
      ],
    },
  ],
};

const librarySongs: ServiceItem[] = [
  { _id: "song-1", name: "Great Are You Lord", type: "song", listId: "library-song-1" },
  { _id: "song-2", name: "Build My Life", type: "song", listId: "library-song-2" },
];

const worshipHeading: ServiceItem = {
  _id: "heading-worship",
  name: "Worship",
  type: "heading",
  listId: "heading-worship-list",
};

describe("buildServicePlanOutlineItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateBibleItem.mockImplementation(async ({ parsedRef }) => ({
      _id: `bible-${parsedRef.book}-${parsedRef.chapter}`,
      name: `${parsedRef.book} ${parsedRef.chapter}`,
      type: "bible",
      background: "",
    }) as unknown as Awaited<ReturnType<typeof createBibleItemFromParsedReference>>);
  });

  it("loads Psalms 105 as a whole chapter and John 3:16–18 as a range, preserving versions, order and IDs", async () => {
    const actual = jest.requireActual<typeof import("../../utils/servicePlanningBibleImport")>("../../utils/servicePlanningBibleImport");
    mockCreateBibleItem.mockImplementation(actual.createBibleItemFromParsedReference);
    const chapterVerses = Array.from({ length: 45 }, (_, index) => ({ name: String(index + 1), index, text: `Verse ${index + 1}` }));
    jest.mocked(getVerses).mockResolvedValue({ name: "105", index: 104, verses: chapterVerses });
    jest.mocked(createNewBible).mockImplementation(async ({ name }) => ({ _id: name, name, type: "bible", background: "" }) as Awaited<ReturnType<typeof createNewBible>>);
    const plan: ServicePlan = { ...basePlan, sections: [{ id: "reading", name: "Reading the Word", elements: [{
      id: "mixed", type: "bible", title: plainTextToRichText("Reading the Word"),
      songRefs: [{ id: "song", kind: "library", songId: "song-1", songName: librarySongs[0].name }],
      scriptureRefs: [
        { id: "psalm", label: "Psalms 105", book: "Psalms", chapter: "105", verseRange: "", version: "NIV" },
        { id: "john", label: "John 3:16–18", book: "John", chapter: "3", verseRange: "16–18", version: "NKJV" },
      ],
      contentOrder: ["psalm", "song", "john"],
    }] }] };
    const saved = JSON.stringify(plan);
    const result = await buildServicePlanOutlineItems({ plan, currentList: [], db: undefined, songs: librarySongs });
    expect(result.items.map((item) => item.type)).toEqual(["bible", "song", "bible"]);
    expect(result.items.map((item) => item.listId)).toEqual(["mixed::attachment:psalm", "mixed::attachment:song", "mixed::attachment:john"]);
    expect(jest.mocked(getVerses).mock.calls.map(([args]) => args)).toEqual([
      { book: "Psalms", chapter: 104, version: "niv" }, { book: "John", chapter: 2, version: "nkjv" },
    ]);
    expect(jest.mocked(createNewBible).mock.calls[0][0]).toEqual(expect.objectContaining({ verses: chapterVerses, version: "niv" }));
    expect(jest.mocked(createNewBible).mock.calls[1][0]).toEqual(expect.objectContaining({ verses: chapterVerses.slice(15, 18), version: "nkjv" }));
    const repeated = await buildServicePlanOutlineItems({ plan, currentList: result.items, db: undefined, songs: librarySongs });
    expect(repeated.items).toEqual([]);
    expect(getVerses).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(plan)).toBe(saved);
  });

  it.each(["scripture", "scriptureRef", "flat"])("supports explicit whole-chapter Scripture in %s data", async (shape) => {
    const reference = { label: "Psalms 105", book: "Psalms", chapter: "105", verseRange: "", version: "NIV" };
    const plan: ServicePlan = { ...basePlan, sections: [{ id: "reading", name: "Reading", elements: [{
      id: "reading", type: "bible", title: plainTextToRichText("Reading the Word"),
      resources: [{ id: "chapter", type: "scripture", title: reference.label,
        data: shape === "flat" ? reference : { [shape]: reference } }],
    }] }] };
    const result = await buildServicePlanOutlineItems({ plan, currentList: [], db: undefined, songs: [] });
    expect(result.skippedTitles).toEqual([]);
    expect(result.items[0].listId).toBe("reading::attachment:chapter");
    expect(mockCreateBibleItem).toHaveBeenCalledWith(expect.objectContaining({ parsedRef: {
      book: "Psalms", chapter: "105", verseRange: "", version: "NIV",
    } }));
  });

  it("reports invalid scripture and rejects unavailable chapters without creating empty Bible items", async () => {
    const plan: ServicePlan = { ...basePlan, sections: [{ id: "reading", name: "Reading", elements: [{
      id: "invalid", type: "bible", title: plainTextToRichText("Invalid reading"),
      scriptureRef: { label: "Unknown 1", book: "Unknown", chapter: "1", verseRange: "", version: "NIV" },
    }] }] };
    const result = await buildServicePlanOutlineItems({ plan, currentList: [], db: undefined, songs: [] });
    expect(result.skippedTitles).toEqual(["Invalid reading"]);
    expect(mockCreateBibleItem).not.toHaveBeenCalled();
    for (const [chapter, verseRange] of [["3", "18-16"], ["3", "0"], ["0", ""]]) {
      plan.sections[0].elements[0].scriptureRef = { label: "Invalid", book: "John", chapter, verseRange, version: "NIV" };
      const invalid = await buildServicePlanOutlineItems({ plan, currentList: [], db: undefined, songs: [] });
      expect(invalid.skippedTitles).toEqual(["Invalid reading"]);
      expect(invalid.items).toEqual([]);
    }
    expect(mockCreateBibleItem).not.toHaveBeenCalled();
    plan.sections[0].elements[0].scriptureRef = { label: "Psalms 105", book: "Psalms", chapter: "105", verseRange: "", version: "NIV" };
    mockCreateBibleItem.mockImplementation(jest.requireActual<typeof import("../../utils/servicePlanningBibleImport")>("../../utils/servicePlanningBibleImport").createBibleItemFromParsedReference);
    jest.mocked(getVerses).mockResolvedValue({ name: "105", index: 104, verses: [] });
    await expect(buildServicePlanOutlineItems({ plan, currentList: [], db: undefined, songs: [] })).rejects.toThrow("Could not load Bible passage");
    expect(createNewBible).not.toHaveBeenCalled();
  });

  it("appends multiple missing mappings in plan order and reports only successful additions", async () => {
    const plan: ServicePlan = { ...basePlan, sections: ["Praise & Prayer", "Praise & Worship"].map((name, index) => ({
      id: `section-${index}`, name,
      elements: [{ ...basePlan.sections[0].elements[0], id: `element-${index}` }],
    })) };
    const sectionRules = plan.sections.map((section, index) => ({ id: section.id, matchSectionName: section.name, matchMode: "exact" as const, headingName: ["Call to Prayer", "Praise and Worship"][index] }));
    const tail: ServiceItem = { _id: "tail", listId: "tail", type: "song", name: "Tail" };
    const result = await buildServicePlanOutlineItems({ plan, currentList: [worshipHeading, tail], db: undefined, songs: librarySongs, sectionRules });
    expect(result.insertedCount).toBe(2);
    expect(result.skippedTitles).toEqual([]);
    expect(result.placementFallbacks.map((fallback) => fallback.headingName)).toEqual(["Call to Prayer", "Praise and Worship"]);
    const planned = planServicePlanOutlineItems({ plan, currentList: [worshipHeading, tail], songs: librarySongs, sectionRules });
    const outline = planned.steps.reduce((list, step, index) => placeServicePlanOutlineItem(list, result.items[index], step).list, [worshipHeading, tail]);
    expect(outline.map((item) => item.listId)).toEqual([worshipHeading.listId, tail.listId, ...result.items.map((item) => item.listId)]);
    const repeated = await buildServicePlanOutlineItems({ plan, currentList: outline, db: undefined, songs: librarySongs, sectionRules });
    expect(repeated.insertedCount).toBe(0);
    expect(repeated.placementFallbacks).toEqual([]);
  });

  it("inserts the library-matched song without creating a section heading", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.map((item) => item.type)).toEqual(["song"]);
    const songItem = result.items.find((item) => item.type === "song");
    expect(songItem).toEqual(
      expect.objectContaining({ _id: "song-1", name: "Great Are You Lord", type: "song" }),
    );
  });

  it("preserves library song display metadata and assigns a deterministic occurrence listId", async () => {
    const librarySong: ServiceItem = {
      _id: "song-1",
      name: "Great Are You Lord",
      type: "song",
      listId: "library-song-1",
      background: "https://cdn.example.com/song-background.jpg",
      localImage: {
        id: "image-asset-1",
        storagePolicy: "local-only",
      } as ServiceItem["localImage"],
    };
    const sourceBeforeSync = { ...librarySong };
    const plan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [basePlan.sections[0].elements[0]],
      }],
    };

    const first = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: [librarySong],
    });

    expect(first.items[0]).toEqual({
      ...librarySong,
      listId: "el-song::attachment:legacy-song-0-library",
    });
    expect(librarySong).toEqual(sourceBeforeSync);

    const second = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading, ...first.items],
      db: undefined,
      songs: [librarySong],
    });
    expect(second.items).toEqual([]);
  });

  it("retains video thumbnail and local-media metadata on the outline occurrence", async () => {
    const librarySong: ServiceItem = {
      _id: "song-1",
      name: "Great Are You Lord",
      type: "song",
      listId: "library-song-1",
      background: "https://cdn.example.com/video-poster.jpg",
      localVideoFile: {
        id: "video-asset-1",
        storagePolicy: "local-only",
      } as ServiceItem["localVideoFile"],
    };
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: [librarySong],
    });

    expect(result.items[0]).toEqual({
      ...librarySong,
      listId: "el-song::attachment:legacy-song-0-library",
    });
    expect(result.items[0].localVideoFile).toEqual(librarySong.localVideoFile);
  });

  it("pushes every song attached to one plan element in order", async () => {
    const plan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          ...basePlan.sections[0].elements[0],
          songRefs: [
            { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
            { kind: "library", songId: "song-2", songName: "Build My Life" },
          ],
          songRef: undefined,
        }],
      }],
    };

    const result = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.filter((item) => item.type === "song").map((item) => item._id))
      .toEqual(["song-1", "song-2"]);
  });

  it("references multiple custom documents by stable ids and skips them on a repeated push", async () => {
    const plan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "el-documents",
          type: "free",
          title: plainTextToRichText("Presentation Notes"),
          songRefs: [{ kind: "library", songId: "song-1", songName: "Great Are You Lord" }],
          scriptureRefs: [{ label: "John 3:16 NIV", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
          resources: [
            { id: "doc-ref-1", type: "custom-document", title: "Shared title", data: { customDocumentId: "document-1" } },
            { id: "doc-ref-2", type: "custom-document", title: "Shared title", data: { customDocumentId: "document-2" } },
          ],
        }],
      }],
    };
    const customDocuments = [
      { _id: "document-1", name: "Shared title", type: "free" as const, listId: "library-1", slides: [{ words: ["Slide one"] }] },
      { _id: "document-2", name: "Shared title", type: "free" as const, listId: "library-2", slides: [{ words: ["Slide two"] }] },
    ];

    const first = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });
    const documentItems = first.items.filter((item) => item.type === "free");

    expect(first.items.map(({ type }) => type)).toEqual([
      "song",
      "bible",
      "free",
      "free",
    ]);
    expect(documentItems.map(({ _id }) => _id)).toEqual(["document-1", "document-2"]);
    expect(documentItems.every((item) => !("slides" in item))).toBe(true);
    expect(documentItems.map(({ listId }) => listId)).toEqual([
      "el-documents::attachment:doc-ref-1",
      "el-documents::attachment:doc-ref-2",
    ]);

    const second = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading, ...first.items],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });

    expect(second.items).toEqual([]);
    expect(second.insertedCount).toBe(0);
  });

  it("stops before creating live items when the selected outline has changed", async () => {
    await expect(buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
      isContextCurrent: () => false,
    })).rejects.toThrow("The selected outline changed");

    expect(mockCreateBibleItem).not.toHaveBeenCalled();
  });

  it("imports mixed and repeated attachment occurrences in saved operator order idempotently", async () => {
    const plan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "el-ordered",
          type: "free",
          title: plainTextToRichText("Mixed set"),
          songRefs: [
            { id: "song-occurrence-a", kind: "library", songId: "song-1", songName: "Great Are You Lord" },
            { id: "song-occurrence-b", kind: "library", songId: "song-1", songName: "Great Are You Lord" },
          ],
          scriptureRefs: [{ id: "scripture-occurrence", label: "John 3:16", book: "John", chapter: "3", verseRange: "16", version: "NIV" }],
          resources: [
            { id: "doc-a", type: "custom-document", title: "First", data: { customDocumentId: "document-1" } },
            { id: "doc-b", type: "custom-document", title: "Second", data: { customDocumentId: "document-2" } },
          ],
          contentOrder: ["doc-b", "song-occurrence-b", "scripture-occurrence", "song-occurrence-a", "doc-a"],
        }],
      }],
    };
    const customDocuments = [
      { _id: "document-1", name: "First", type: "free" as const },
      { _id: "document-2", name: "Second", type: "free" as const },
    ];
    const first = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });
    expect(first.items.map((item) => item.type)).toEqual([
      "free", "song", "bible", "song", "free",
    ]);
    expect(first.items.map((item) => item._id)).toEqual([
      "document-2", "song-1", "bible-John-3", "song-1", "document-1",
    ]);
    expect(new Set(first.items.map((item) => item.listId)).size).toBe(5);

    const second = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading, ...first.items],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });
    expect(second.items).toEqual([]);
  });

  it("reports unavailable custom documents without creating blank placeholders", async () => {
    const plan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "el-missing-document",
          type: "free",
          title: plainTextToRichText("Missing presentation"),
          resources: [{
            id: "missing-ref",
            type: "custom-document",
            title: "Deleted presentation",
            data: { customDocumentId: "deleted-document" },
          }],
        }],
      }],
    };

    const result = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
      customDocuments: [],
    });

    expect(result.items).toEqual([]);
    expect(result.skippedTitles).toEqual(["Missing presentation"]);
  });

  it("skips a pending (not-yet-created) song and reports its title", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    expect(result.skippedTitles).toEqual(["Unwritten Song"]);
  });

  it("does not substitute a same-titled library song for an unresolved saved-plan attachment", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: {
        ...basePlan,
        sections: [{
          ...basePlan.sections[0],
          elements: [basePlan.sections[0].elements[1]],
        }],
      },
      currentList: [worshipHeading],
      db: undefined,
      songs: [
        {
          _id: "song-7",
          name: "Unwritten Song",
          type: "song",
          listId: "song-7",
        },
      ],
    });

    expect(result.skippedTitles).toEqual(["Unwritten Song"]);
    expect(result.items).toEqual([]);
  });

  it("skips title-only items, generic resources, URLs, and notes", async () => {
    const plan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "welcome",
          type: "free",
          title: plainTextToRichText("Welcome"),
          notes: plainTextToRichText("Operator notes"),
          resources: [{ id: "web", type: "url", title: "Welcome video", url: "https://example.com" }],
        }],
      }],
    };
    const result = await buildServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    expect(result.items).toEqual([]);
  });

  it("does not stamp Service Plan sections or elements as outline headings", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    expect(result.items.every((item) => item.type !== "heading")).toBe(true);
  });

  it("counts only content elements, not headings, in insertedCount", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    expect(result.insertedCount).toBe(1);
  });

  it("does not re-push an element whose previously-pushed listId is still live", async () => {
    const alreadyPushedPlan: ServicePlan = {
      ...basePlan,
      sections: [
        {
          ...basePlan.sections[0],
          elements: [
            { ...basePlan.sections[0].elements[0], pushedOutlineListId: "already-live-id" },
          ],
        },
      ],
    };
    const currentList: ServiceItem[] = [
      { _id: "song-1", name: "Great Are You Lord", type: "song", listId: "already-live-id" },
    ];

    const result = await buildServicePlanOutlineItems({
      plan: alreadyPushedPlan,
      currentList,
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items).toEqual([]);
    expect(result.insertedCount).toBe(0);
  });

  // One song nobody has added to the library yet used to take the whole element
  // down with it: the operator got neither the song that did resolve nor the
  // scripture, and the Bible doc built for that scripture was left orphaned.
  it("pushes the attachments that resolved even when a sibling song did not", async () => {
    const mixedPlan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "el-mixed",
          type: "song",
          title: plainTextToRichText("Worship Set"),
          songRefs: [
            { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
            { kind: "pending", title: "Unwritten Song", lyricsText: "" },
          ],
          scriptureRefs: [
            { label: "John 3:16 (NIV)", book: "John", chapter: "3", verseRange: "16", version: "NIV" },
          ],
        }],
      }],
    };

    const result = await buildServicePlanOutlineItems({
      plan: mixedPlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.map((item) => item._id)).toEqual([
      "song-1",
      "bible-John-3",
    ]);
    expect(result.insertedCount).toBe(2);
    // The operator is still told the unmatched song needs linking.
    expect(result.skippedTitles).toEqual(["Worship Set"]);
  });

  // Idempotency is per attachment: deleting one item from a multi-attachment
  // element used to make the whole element look un-pushed, so a re-push put a
  // second copy of everything else on the list mid-service.
  it("re-adds only the deleted item when an element is pushed again", async () => {
    const twoSongPlan: ServicePlan = {
      ...basePlan,
      sections: [{
        ...basePlan.sections[0],
        elements: [{
          id: "el-two-songs",
          type: "song",
          title: plainTextToRichText("Worship Set"),
          songRefs: [
            { kind: "library", songId: "song-1", songName: "Great Are You Lord" },
            { kind: "library", songId: "song-2", songName: "Build My Life" },
          ],
        }],
      }],
    };

    const first = await buildServicePlanOutlineItems({
      plan: twoSongPlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    // The operator drops the first song from the live list, then pushes again.
    const listAfterDelete = first.items.filter((item) => item._id !== "song-1");

    const second = await buildServicePlanOutlineItems({
      plan: twoSongPlan,
      currentList: [worshipHeading, ...listAfterDelete],
      db: undefined,
      songs: librarySongs,
    });

    expect(second.items.map((item) => item._id)).toEqual(["song-1"]);
    expect(second.insertedCount).toBe(1);
  });

  it("does not re-push an element whose attachments are all still live", async () => {
    const songPlan: ServicePlan = {
      ...basePlan,
      sections: [{ ...basePlan.sections[0], elements: [basePlan.sections[0].elements[0]] }],
    };

    const first = await buildServicePlanOutlineItems({
      plan: songPlan,
      currentList: [worshipHeading],
      db: undefined,
      songs: librarySongs,
    });
    const second = await buildServicePlanOutlineItems({
      plan: songPlan,
      currentList: [worshipHeading, ...first.items],
      db: undefined,
      songs: librarySongs,
    });

    expect(second.items).toEqual([]);
    expect(second.insertedCount).toBe(0);
  });

  it("does not create Service Plan sections as outline headings", async () => {
    const noNewWorkPlan: ServicePlan = {
      ...basePlan,
      sections: [
        {
          id: "section-done",
          name: "Already pushed",
          elements: [
            { ...basePlan.sections[0].elements[0], pushedOutlineListId: "still-here" },
          ],
        },
        basePlan.sections[0],
      ],
    };
    const currentList: ServiceItem[] = [
      { _id: "song-1", name: "Great Are You Lord", type: "song", listId: "still-here" },
    ];

    const result = await buildServicePlanOutlineItems({
      plan: noNewWorkPlan,
      currentList,
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.every((item) => item.type !== "heading")).toBe(true);
  });

  it("maps native sections through configured rules to existing headings", () => {
    const plan = {
      ...basePlan,
      sections: [{ ...basePlan.sections[0], name: "Worship" }],
    };
    const mappedHeading: ServiceItem = {
      ...worshipHeading,
      _id: "heading-praise",
      name: "Praise & Worship",
      listId: "heading-praise-id",
    };
    const result = planServicePlanOutlineItems({
      plan,
      currentList: [mappedHeading],
      songs: librarySongs,
      sectionRules: [{
        id: "rule-worship",
        matchSectionName: "Worship",
        matchMode: "exact",
        headingName: "Praise & Worship",
      }],
    });

    expect(result.steps.map((step) => step.destination)).toEqual([
      { kind: "heading", listId: "heading-praise-id", name: "Praise & Worship" },
    ]);
    expect(result.steps.every((step) => step.planned.listId === "el-song::attachment:legacy-song-0-library")).toBe(true);
  });

  it("uses normalized direct heading identity only when no rule matches", () => {
    const plan = { ...basePlan, sections: [{ ...basePlan.sections[0], name: "  wOrShIP  " }] };
    const result = planServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      songs: librarySongs,
    });
    expect(result.steps[0].destination).toEqual({
      kind: "heading",
      listId: worshipHeading.listId,
      name: worshipHeading.name,
    });
    expect(result.steps.every((step) => !step.placementFallback)).toBe(true);
  });

  it("plans outline-end insertion without substituting a heading when an explicit mapping is missing", () => {
    const result = planServicePlanOutlineItems({
      plan: basePlan,
      currentList: [worshipHeading],
      songs: librarySongs,
      sectionRules: [{
        id: "rule-worship",
        matchSectionName: "Worship",
        matchMode: "exact",
        headingName: "Praise & Worship",
      }],
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].destination).toEqual({ kind: "outline-end" });
    expect(result.steps[0].placementFallback).toEqual({
      sectionName: "Worship",
      headingName: "Praise & Worship",
      reason: "mapped-heading-missing",
    });
  });

  it("appends an unmatched section to the actual outline end without a placement warning", () => {
    const similarlyNamedHeading: ServiceItem = {
      _id: "heading-announcements",
      name: "Announcements & Notices",
      type: "heading",
      listId: "heading-announcements-id",
    };
    const result = planServicePlanOutlineItems({
      plan: { ...basePlan, sections: [{ ...basePlan.sections[0], name: "Announcements" }] },
      currentList: [similarlyNamedHeading, { _id: "existing", name: "Existing", type: "song", listId: "existing" }],
      songs: librarySongs,
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].destination).toEqual({ kind: "outline-end" });
    expect(result.steps[0].planned.listId).toBe("el-song::attachment:legacy-song-0-library");
    expect(result.steps.every((step) => !step.placementFallback)).toBe(true);
  });

  it("keeps all unmatched actionable items and sections in Service Plan order at the outline end", () => {
    const firstSection = {
      ...basePlan.sections[0],
      id: "section-special",
      name: "Special Feature",
      elements: [
        { ...basePlan.sections[0].elements[0], id: "special-one" },
        { ...basePlan.sections[0].elements[0], id: "special-two" },
      ],
    };
    const secondSection = {
      ...basePlan.sections[0],
      id: "section-other",
      name: "Other Unmatched",
      elements: [{ ...basePlan.sections[0].elements[0], id: "other-one" }],
    };
    const result = planServicePlanOutlineItems({
      plan: { ...basePlan, sections: [firstSection, secondSection] },
      currentList: [worshipHeading, { _id: "last-heading", name: "Message", type: "heading", listId: "last-heading" }],
      songs: librarySongs,
    });

    expect(result.steps.map((step) => step.destination)).toEqual([
      { kind: "outline-end" },
      { kind: "outline-end" },
      { kind: "outline-end" },
    ]);
    expect(result.steps.map((step) => step.planned.listId)).toEqual([
      "special-one::attachment:legacy-song-0-library",
      "special-two::attachment:legacy-song-0-library",
      "other-one::attachment:legacy-song-0-library",
    ]);
    expect(result.steps.every((step) => !step.placementFallback)).toBe(true);
  });

  it("keeps plan order when sections resolve to different or shared heading occurrences", () => {
    const secondSection = {
      id: "section-message",
      name: "Message",
      elements: [{ ...basePlan.sections[0].elements[0], id: "el-message" }],
    };
    const secondSong = { ...librarySongs[0], _id: "song-1", name: "Great Are You Lord" };
    const messageHeading: ServiceItem = {
      _id: "heading-message",
      name: "Message",
      type: "heading",
      listId: "heading-message-id",
    };
    const plan = { ...basePlan, sections: [basePlan.sections[0], secondSection] };
    const result = planServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading, messageHeading],
      songs: [secondSong],
    });
    expect(result.steps.map((step) => step.destination)).toEqual([
      { kind: "heading", listId: worshipHeading.listId, name: worshipHeading.name },
      { kind: "heading", listId: messageHeading.listId, name: messageHeading.name },
    ]);
    expect(result.steps.map((step) => step.destination.kind === "heading" ? step.destination.listId : null)).toEqual([
      worshipHeading.listId,
      messageHeading.listId,
    ]);

    const sharedHeadingRules = [
      { id: "rule-worship", matchSectionName: "Worship", matchMode: "exact" as const, headingName: "Worship" },
      { id: "rule-message", matchSectionName: "Message", matchMode: "exact" as const, headingName: "Worship" },
    ];
    const sharedResult = planServicePlanOutlineItems({
      plan,
      currentList: [worshipHeading],
      songs: [secondSong],
      sectionRules: sharedHeadingRules,
    });
    expect(sharedResult.steps.map((step) => step.destination.kind === "heading" ? step.destination.listId : null)).toEqual([
      worshipHeading.listId,
      worshipHeading.listId,
    ]);
  });
});
