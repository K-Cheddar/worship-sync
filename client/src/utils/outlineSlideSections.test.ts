import type { DBItem, ItemSlideType, ServiceItem } from "../types";
import {
  buildDocsById,
  buildOutlineSlideSections,
  buildOutlineVirtualRows,
  getControllerItemPath,
  getNonHeadingOutlineItems,
  getPinnedListIdFromRowOffsets,
  getPrefetchItemIds,
  mergeDocsById,
  prepareItemForEditor,
  resolveSlidesForOutlineItem,
} from "./outlineSlideSections";

const slide = (id: string, name: string): ItemSlideType =>
  ({
    id,
    name,
    type: "Verse",
    boxes: [],
  }) as ItemSlideType;

const outlineItem = (
  overrides: Partial<ServiceItem> &
    Pick<ServiceItem, "_id" | "listId" | "name" | "type">,
): ServiceItem => overrides as ServiceItem;

const songDoc = (id: string, rev: string, slides: ItemSlideType[]): DBItem =>
  ({
    _id: id,
    _rev: rev,
    name: id,
    type: "song",
    selectedArrangement: 0,
    arrangements: [
      {
        id: "arr-1",
        name: "Default",
        formattedLyrics: [],
        songOrder: [],
        slides,
      },
    ],
    slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
  }) as DBItem;

describe("outlineSlideSections", () => {
  it("skips heading rows and keeps outline order", () => {
    const items = getNonHeadingOutlineItems([
      outlineItem({
        _id: "h1",
        listId: "l-h",
        name: "Section 1",
        type: "heading",
      }),
      outlineItem({ _id: "s1", listId: "l-1", name: "Song", type: "song" }),
      outlineItem({
        _id: "h2",
        listId: "l-h2",
        name: "Section 2",
        type: "heading",
      }),
      outlineItem({ _id: "b1", listId: "l-2", name: "Bible", type: "bible" }),
    ]);

    expect(items.map((item) => item.listId)).toEqual(["l-1", "l-2"]);
  });

  it("prefers arrangement slides for songs and active itemSlice over allDocs", () => {
    const docsById = buildDocsById({
      allSongDocs: [songDoc("song-1", "1-a", [slide("cached", "Cached")])],
      allFreeFormDocs: [],
      allTimerDocs: [],
      allBibleDocs: [],
    });
    const activeSlides = resolveSlidesForOutlineItem(
      outlineItem({ _id: "song-1", listId: "l-1", name: "Song", type: "song" }),
      {
        activeItem: {
          _id: "song-1",
          listId: "l-1",
          type: "song",
          selectedArrangement: 0,
          arrangements: [
            {
              id: "arr-1",
              name: "Default",
              formattedLyrics: [],
              songOrder: [],
              slides: [slide("live", "Live")],
            },
          ],
          slides: [],
        },
        docsById,
      },
    );
    const neighborSlides = resolveSlidesForOutlineItem(
      outlineItem({ _id: "song-1", listId: "l-2", name: "Song", type: "song" }),
      {
        activeItem: {
          _id: "song-1",
          listId: "l-1",
          type: "song",
          selectedArrangement: 0,
          arrangements: [
            {
              id: "arr-1",
              name: "Default",
              formattedLyrics: [],
              songOrder: [],
              slides: [slide("live", "Live")],
            },
          ],
        },
        docsById,
      },
    );

    expect(activeSlides.map((item) => item.id)).toEqual(["live"]);
    expect(neighborSlides.map((item) => item.id)).toEqual(["cached"]);
  });

  it("uses allDocs slides for inactive items and keys sections by listId", () => {
    const docsById = buildDocsById({
      allSongDocs: [
        songDoc("song-2", "3-b", [slide("a", "A"), slide("b", "B")]),
      ],
      allFreeFormDocs: [
        {
          _id: "free-1",
          name: "Welcome",
          type: "free",
          selectedArrangement: 0,
          arrangements: [],
          slides: [slide("w1", "Welcome 1")],
          shouldSendTo: { projector: true, monitor: true, stream: true },
        } as DBItem,
      ],
      allTimerDocs: [],
      allBibleDocs: [],
    });
    const sections = buildOutlineSlideSections(
      [
        outlineItem({
          _id: "song-2",
          listId: "l-a",
          name: "Song",
          type: "song",
        }),
        outlineItem({
          _id: "free-1",
          listId: "l-b",
          name: "Welcome",
          type: "free",
        }),
      ],
      {
        activeItem: { _id: "song-2", listId: "l-a", name: "Live name" },
        docsById,
      },
    );

    expect(sections[0]).toEqual(
      expect.objectContaining({
        listId: "l-a",
        isActive: true,
        name: "Live name",
        slides: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
        ],
      }),
    );
    expect(sections[1].isActive).toBe(false);
    expect(sections[1].rev).toBeUndefined();
    expect(sections[1].slides.map((item) => item.id)).toEqual(["w1"]);
  });

  it("builds label rows then tiled slide rows", () => {
    const rows = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "song-1",
          name: "Song",
          type: "song",
          slides: [slide("a", "A"), slide("b", "B"), slide("c", "C")],
          isActive: true,
        },
        {
          listId: "l-2",
          itemId: "free-1",
          name: "Empty",
          type: "free",
          slides: [],
          isActive: false,
        },
      ],
      2,
    );

    expect(rows.map((row) => row.type)).toEqual([
      "sectionLabel",
      "tiles",
      "tiles",
      "sectionLabel",
      "empty",
    ]);
    expect(rows[1]).toEqual(
      expect.objectContaining({
        type: "tiles",
        startIndex: 0,
        slides: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
        ],
      }),
    );
    expect(rows[2]).toEqual(
      expect.objectContaining({
        type: "tiles",
        startIndex: 2,
        slides: [expect.objectContaining({ id: "c" })],
      }),
    );
  });

  it("prefetches unique ids around the pinned item", () => {
    const items = [
      outlineItem({ _id: "a", listId: "1", name: "A", type: "song" }),
      outlineItem({ _id: "b", listId: "2", name: "B", type: "song" }),
      outlineItem({ _id: "b", listId: "3", name: "B copy", type: "song" }),
      outlineItem({ _id: "c", listId: "4", name: "C", type: "song" }),
      outlineItem({ _id: "d", listId: "5", name: "D", type: "song" }),
    ];

    expect(getPrefetchItemIds(items, "3", 1)).toEqual(["b", "c"]);
    expect(getPrefetchItemIds(items, "missing", 1)).toEqual(["a", "b"]);
  });

  it("pins the last section whose row has reached the top", () => {
    const rows = [
      { listId: "l-1" },
      { listId: "l-1" },
      { listId: "l-2" },
      { listId: "l-2" },
    ];
    const starts = [0, 40, 200, 240];

    expect(
      getPinnedListIdFromRowOffsets(rows, (index) => starts[index], 0),
    ).toBe("l-1");
    expect(
      getPinnedListIdFromRowOffsets(rows, (index) => starts[index], 196),
    ).toBe("l-2");
  });

  it("merges extra pouch docs that allDocs does not hold", () => {
    const merged = mergeDocsById(
      {
        allSongDocs: [songDoc("song-1", "1", [slide("a", "A")])],
        allFreeFormDocs: [],
        allTimerDocs: [],
        allBibleDocs: [],
      },
      new Map([
        [
          "service-time",
          {
            _id: "service-time",
            name: "Countdown",
            type: "service-time",
            slides: [slide("t", "Timer")],
          } as DBItem,
        ],
      ]),
    );

    expect(merged.get("song-1")?._rev).toBe("1");
    expect(merged.get("service-time")?.name).toBe("Countdown");
  });

  it("backfills formatted sections when preparing a free item", () => {
    const prepared = prepareItemForEditor(
      {
        _id: "free-1",
        name: "Welcome",
        type: "free",
        selectedArrangement: 0,
        arrangements: [],
        slides: [
          {
            name: "Section 1",
            boxes: [{ words: "ignored" }, { words: "Line one" }],
          },
          {
            name: "Section 1",
            boxes: [{ words: "ignored" }, { words: "Line two" }],
          },
        ],
        formattedSections: [],
        shouldSendTo: { projector: true, monitor: true, stream: true },
      } as DBItem,
      "list-1",
    );

    expect(prepared.listId).toBe("list-1");
    expect(prepared.formattedSections).toHaveLength(1);
    expect(prepared.formattedSections?.[0]).toEqual(
      expect.objectContaining({
        sectionNum: 1,
        words: "Line one\nLine two",
        slideSpan: 2,
      }),
    );
  });

  it("encodes controller item paths", () => {
    const path = getControllerItemPath({ _id: "song/1", listId: "list 2" });
    expect(path).toBe(
      `/controller/item/${window.btoa(encodeURI("song/1"))}/${window.btoa(
        encodeURI("list 2"),
      )}`,
    );
  });
});
