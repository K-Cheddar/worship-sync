import {
  buildServicePlanOutlineItems,
  planServicePlanOutlineItems,
} from "./servicePlanOutlineBridge";
import { createBibleItemFromParsedReference } from "../../utils/servicePlanningBibleImport";
import { plainTextToRichText } from "../../types/richText";
import type { ServicePlan } from "../../types/servicePlan";
import type { ServiceItem } from "../../types";

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

    expect(result.steps.map((step) => step.targetHeading)).toEqual([
      { listId: "heading-praise-id", name: "Praise & Worship" },
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
    expect(result.steps[0].targetHeading.listId).toBe(worshipHeading.listId);
    expect(result.placementIssues).toEqual([]);
  });

  it("does not fall back to a section name when a mapped heading is missing", () => {
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
    expect(result.steps).toEqual([]);
    expect(result.placementIssues).toEqual([{
      sectionName: "Worship",
      headingName: "Praise & Worship",
      reason: "mapped-heading-missing",
    }]);
  });

  it("reports an unmapped section without appending its items", () => {
    const similarlyNamedHeading: ServiceItem = {
      _id: "heading-announcements",
      name: "Announcements & Notices",
      type: "heading",
      listId: "heading-announcements-id",
    };
    const result = planServicePlanOutlineItems({
      plan: { ...basePlan, sections: [{ ...basePlan.sections[0], name: "Announcements" }] },
      currentList: [similarlyNamedHeading],
      songs: librarySongs,
    });
    expect(result.steps).toEqual([]);
    expect(result.placementIssues).toEqual([{
      sectionName: "Announcements",
      reason: "no-matching-heading",
    }]);
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
    expect(result.steps.map((step) => step.targetHeading.listId)).toEqual([
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
    expect(sharedResult.steps.map((step) => step.targetHeading.listId)).toEqual([
      worshipHeading.listId,
      worshipHeading.listId,
    ]);
  });
});
