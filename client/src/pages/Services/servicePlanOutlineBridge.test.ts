import { buildServicePlanOutlineItems } from "./servicePlanOutlineBridge";
import { createNewFreeForm, createNewHeading } from "../../utils/itemUtil";
import { createBibleItemFromParsedReference } from "../../utils/servicePlanningBibleImport";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";

jest.mock("../../utils/itemUtil", () => ({
  createNewHeading: jest.fn(),
  createNewFreeForm: jest.fn(),
}));

jest.mock("../../utils/servicePlanningBibleImport", () => ({
  createBibleItemFromParsedReference: jest.fn(),
}));

const mockCreateNewHeading = jest.mocked(createNewHeading);
const mockCreateNewFreeForm = jest.mocked(createNewFreeForm);
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

describe("buildServicePlanOutlineItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateNewHeading.mockImplementation(async ({ name }) => ({
      name,
      _id: `heading-${name}`,
      type: "heading",
    }));
    mockCreateNewFreeForm.mockImplementation(async ({ name }) => ({
      _id: name,
      name,
      type: "free",
      background: "",
      selectedArrangement: 0,
      selectedSlide: 0,
      selectedBox: 1,
      slides: [],
      arrangements: [],
      shouldSendTo: { projector: true, monitor: true, stream: true },
    }));
    mockCreateBibleItem.mockImplementation(async ({ parsedRef }) => ({
      _id: `bible-${parsedRef.book}-${parsedRef.chapter}`,
      name: `${parsedRef.book} ${parsedRef.chapter}`,
      type: "bible",
      background: "",
    }) as unknown as Awaited<ReturnType<typeof createBibleItemFromParsedReference>>);
  });

  it("creates a heading for the section and inserts the library-matched song directly", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });

    expect(mockCreateNewHeading).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Worship" }),
    );
    const songItem = result.items.find((item) => item.type === "song");
    expect(songItem).toEqual(
      expect.objectContaining({ _id: "song-1", name: "Great Are You Lord", type: "song" }),
    );
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.filter((item) => item.type === "song").map((item) => item._id))
      .toEqual(["song-1", "song-2"]);
    expect(result.updatedSections[0].elements[0].pushedOutlineListIds).toHaveLength(2);
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });
    const documentItems = first.items.filter((item) => item.type === "free");

    expect(first.items.map(({ type }) => type)).toEqual([
      "heading",
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
    expect(first.updatedSections[0].elements[0].pushedOutlineListIds).toEqual(
      first.items.slice(1).map(({ listId }) => listId),
    );
    expect(mockCreateNewFreeForm).not.toHaveBeenCalled();

    const second = await buildServicePlanOutlineItems({
      plan: { ...plan, sections: first.updatedSections },
      currentList: first.items,
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
      isContextCurrent: () => false,
    })).rejects.toThrow("The selected outline changed");

    expect(mockCreateNewHeading).not.toHaveBeenCalled();
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
      customDocuments,
    });
    expect(first.items.slice(1).map((item) => item.type)).toEqual([
      "free", "song", "bible", "song", "free",
    ]);
    expect(first.items.slice(1).map((item) => item._id)).toEqual([
      "document-2", "song-1", "bible-John-3", "song-1", "document-1",
    ]);
    expect(new Set(first.items.slice(1).map((item) => item.listId)).size).toBe(5);

    const second = await buildServicePlanOutlineItems({
      plan: { ...plan, sections: first.updatedSections },
      currentList: first.items,
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
      customDocuments: [],
    });

    expect(result.items).toEqual([]);
    expect(result.skippedTitles).toEqual(["Missing presentation"]);
    expect(mockCreateNewHeading).not.toHaveBeenCalled();
    expect(mockCreateNewFreeForm).not.toHaveBeenCalled();
  });

  it("skips a pending (not-yet-created) song and reports its title", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
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
      currentList: [],
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

  it("creates a blank free-form placeholder for a type with no real content reference", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });
    expect(mockCreateNewFreeForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Baptism Testimony" }),
    );
    expect(result.items.some((item) => item.name === "Baptism Testimony")).toBe(true);
  });

  it("stamps pushedOutlineListId onto newly-pushed elements for future idempotency", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });
    const [section] = result.updatedSections;
    expect(section.elements[0].pushedOutlineListId).toBeTruthy();
    // The skipped pending song never got a real item, so no listId to track.
    expect(section.elements[1].pushedOutlineListId).toBeUndefined();
    expect(section.elements[2].pushedOutlineListId).toBeTruthy();
  });

  it("counts only content elements, not headings, in insertedCount", async () => {
    const result = await buildServicePlanOutlineItems({
      plan: basePlan,
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });
    // 2 content items inserted (song + free-form placeholder); pending song skipped.
    expect(result.insertedCount).toBe(2);
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

    expect(mockCreateNewHeading).not.toHaveBeenCalled();
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });

    expect(result.items.map((item) => item._id)).toEqual([
      "heading-Worship",
      "song-1",
      "bible-John-3",
    ]);
    expect(result.insertedCount).toBe(2);
    // The operator is still told the unmatched song needs linking.
    expect(result.skippedTitles).toEqual(["Worship Set"]);
    expect(result.updatedSections[0].elements[0].pushedOutlineListIds).toHaveLength(2);
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
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });
    // The operator drops the first song from the live list, then pushes again.
    const listAfterDelete = first.items.filter((item) => item._id !== "song-1");

    const second = await buildServicePlanOutlineItems({
      plan: { ...twoSongPlan, sections: first.updatedSections },
      currentList: listAfterDelete,
      db: undefined,
      songs: librarySongs,
    });

    expect(second.items.map((item) => item._id)).toEqual(["heading-Worship", "song-1"]);
    expect(second.insertedCount).toBe(1);
  });

  it("does not re-push an element whose attachments are all still live", async () => {
    const songPlan: ServicePlan = {
      ...basePlan,
      sections: [{ ...basePlan.sections[0], elements: [basePlan.sections[0].elements[0]] }],
    };

    const first = await buildServicePlanOutlineItems({
      plan: songPlan,
      currentList: [],
      db: undefined,
      songs: librarySongs,
    });
    const second = await buildServicePlanOutlineItems({
      plan: { ...songPlan, sections: first.updatedSections },
      currentList: first.items,
      db: undefined,
      songs: librarySongs,
    });

    expect(second.items).toEqual([]);
    expect(second.insertedCount).toBe(0);
  });

  it("skips creating a heading for a section where nothing is new", async () => {
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

    await buildServicePlanOutlineItems({
      plan: noNewWorkPlan,
      currentList,
      db: undefined,
      songs: librarySongs,
    });

    expect(mockCreateNewHeading).toHaveBeenCalledTimes(1);
    expect(mockCreateNewHeading).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Worship" }),
    );
  });
});
