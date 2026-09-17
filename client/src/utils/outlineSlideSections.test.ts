import type { DBItem, ItemSlideType, ServiceItem } from "../types";
import {
  buildDocsById,
  buildOutlineSlideSections,
  buildOutlineVirtualRowIndex,
  buildOutlineVirtualRows,
  captureOutlineScrollAnchorFromVirtualItems,
  captureOutlineScrollAnchor,
  captureOutlineZoomFocalPoint,
  getControllerItemPath,
  getOutlineVirtualRowKey,
  getPinnedListIdFromVirtualItems,
  getNonHeadingOutlineItems,
  getPinnedListIdFromRowOffsets,
  getPrefetchItemIds,
  mergeDocsById,
  prepareItemForEditor,
  resolveOutlineScrollTopFromAnchor,
  resolveSlidesForOutlineItem,
  findOutlineRowIndexForItem,
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
        count: 2,
        firstSlideId: "a",
      }),
    );
    expect(rows[2]).toEqual(
      expect.objectContaining({
        type: "tiles",
        startIndex: 2,
        count: 1,
        firstSlideId: "c",
      }),
    );
  });

  it("keeps the large-service hot path bounded by the visible virtual range", () => {
    const sections = Array.from({ length: 100 }, (_, itemIndex) => ({
      listId: `list-${itemIndex}`,
      itemId: `item-${itemIndex}`,
      name: `Item ${itemIndex}`,
      type: "song",
      slides: Array.from({ length: 15 }, (_, slideIndex) =>
        slide(`slide-${itemIndex}-${slideIndex}`, `Slide ${slideIndex}`),
      ),
      isActive: itemIndex === 0,
    }));
    const rows = buildOutlineVirtualRows(sections, 5);
    const index = buildOutlineVirtualRowIndex(
      rows,
      new Map(sections.map((section) => [section.listId, section])),
    );
    const visibleItems = [
      { index: 198, start: 0, end: 140 },
      { index: 199, start: 144, end: 284 },
      { index: 200, start: 288, end: 428 },
    ];

    expect(rows).toHaveLength(400);
    expect(rows.every((row) => !Object.hasOwn(row, "slides"))).toBe(true);
    expect(index.rowIndexBySlideIndex.get("list-50:10")).toBe(203);
    expect(
      getPinnedListIdFromVirtualItems(rows, visibleItems, 160),
    ).toBe("list-49");
    expect(
      captureOutlineScrollAnchorFromVirtualItems(rows, visibleItems, 160),
    ).toEqual(
      expect.objectContaining({
        listId: "list-49",
        rowType: "tiles",
        localOffset: 16,
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

  it("restores scrollTop from a viewport row anchor after rows above grow", () => {
    const before = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("a1", "A1"), slide("a2", "A2")],
          isActive: true,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      2,
    );
    // label, tiles(a), label(b), tiles(b) → b's label is index 2
    const scrollTop = 80;
    const getBeforeStart = (index: number) => index * 40;
    const anchor = captureOutlineScrollAnchor(
      before,
      getBeforeStart,
      scrollTop,
    );
    expect(anchor).toEqual(
      expect.objectContaining({
        listId: "l-2",
        rowType: "sectionLabel",
        localOffset: 0,
      }),
    );

    const after = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [
            slide("a1", "A1"),
            slide("a2", "A2"),
            slide("a3", "A3"),
            slide("a4", "A4"),
          ],
          isActive: true,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      2,
    );
    // Extra tile row for A pushes B's label from index 2 → 3
    const getAfterStart = (index: number) => index * 40;
    expect(
      resolveOutlineScrollTopFromAnchor(after, getAfterStart, anchor!),
    ).toBe(120);
  });

  it("keeps the selected slide as the zoom focal point when it is on screen", () => {
    const rows = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("a1", "A1"), slide("a2", "A2"), slide("a3", "A3")],
          isActive: true,
        },
      ],
      2,
    );
    const getStart = (index: number) => index * 40;
    const getHeight = () => 40;

    expect(
      captureOutlineZoomFocalPoint(rows, getStart, getHeight, 0, 80, "l-1", 0),
    ).toEqual({
      kind: "selected",
      listId: "l-1",
      slideIndex: 0,
      viewportCenter: 60,
    });
  });

  it("keeps the selected slide as the focal point even when it is off screen", () => {
    const rows = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("a1", "A1"), slide("a2", "A2")],
          isActive: true,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      2,
    );
    const getStart = (index: number) => index * 40;
    const getHeight = () => 40;
    // label, tiles(a), label(b), tiles(b) — selected A1 is above the viewport.
    const focal = captureOutlineZoomFocalPoint(
      rows,
      getStart,
      getHeight,
      120,
      80,
      "l-1",
      0,
    );

    expect(focal).toEqual({
      kind: "selected",
      listId: "l-1",
      slideIndex: 0,
    });
  });

  it.each([
    [4, 2],
    [2, 6],
    [6, 1],
    [1, 5],
  ])(
    "keeps a deep-service selected slide visible when columns change %i to %i",
    (beforeCols, afterCols) => {
      const sections = Array.from({ length: 25 }, (_, sectionIndex) => ({
        listId: `item-${sectionIndex + 1}`,
        itemId: `item-${sectionIndex + 1}`,
        name: `Item ${sectionIndex + 1}`,
        type: "song",
        slides: Array.from({ length: 8 }, (_, slideIndex) =>
          slide(
            `item-${sectionIndex + 1}-slide-${slideIndex + 1}`,
            `Slide ${slideIndex + 1}`,
          ),
        ),
        isActive: sectionIndex === 19,
      }));
      const sectionsByListId = new Map(
        sections.map((section) => [section.listId, section]),
      );
      const beforeRows = buildOutlineVirtualRows(sections, beforeCols);
      const afterRows = buildOutlineVirtualRows(sections, afterCols);
      const getStart = (index: number) => index * 40;
      const getHeight = () => 40;
      const selectedSlide = 4;
      const selectedBeforeRow = findOutlineRowIndexForItem(
        beforeRows,
        "item-20",
        selectedSlide,
      );
      const focal = captureOutlineZoomFocalPoint(
        beforeRows,
        getStart,
        getHeight,
        getStart(selectedBeforeRow) - 10,
        80,
        "item-20",
        selectedSlide,
        sectionsByListId,
      );
      const selectedAfterRow = findOutlineRowIndexForItem(
        afterRows,
        "item-20",
        selectedSlide,
      );
      const restoredTop = Math.max(
        0,
        getStart(selectedAfterRow) + getHeight() / 2 -
          (focal?.kind === "selected" && focal.viewportCenter != null
            ? focal.viewportCenter
            : 40),
      );

      expect(focal).toEqual(
        expect.objectContaining({
          kind: "selected",
          listId: "item-20",
          slideIndex: selectedSlide,
        }),
      );
      expect(getStart(selectedAfterRow)).toBeLessThan(restoredTop + 80);
      expect(getStart(selectedAfterRow) + getHeight()).toBeGreaterThan(
        restoredTop,
      );
    },
  );

  it("falls back to the logical viewport anchor without a resolvable selection", () => {
    const sections = [
      {
        listId: "l-1",
        itemId: "a",
        name: "A",
        type: "song",
        slides: [slide("a1", "A1"), slide("a2", "A2")],
        isActive: true,
      },
    ];
    const rows = buildOutlineVirtualRows(sections, 2);
    const focal = captureOutlineZoomFocalPoint(
      rows,
      (index) => index * 40,
      () => 40,
      40,
      80,
      undefined,
      -1,
    );

    expect(focal).toEqual(
      expect.objectContaining({
        kind: "viewport",
        anchor: expect.objectContaining({ listId: "l-1" }),
      }),
    );
  });

  it.each([0, 4, 7])(
    "restores the selected item's %s slide position after repacking",
    (selectedSlide) => {
      const sections = [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: Array.from({ length: 8 }, (_, index) =>
            slide(`a${index + 1}`, `A${index + 1}`),
          ),
          isActive: true,
        },
      ];
      const beforeRows = buildOutlineVirtualRows(sections, 4);
      const afterRows = buildOutlineVirtualRows(sections, 2);
      const getStart = (index: number) => index * 40;
      const selectedBeforeRow = findOutlineRowIndexForItem(
        beforeRows,
        "l-1",
        selectedSlide,
      );
      const focal = captureOutlineZoomFocalPoint(
        beforeRows,
        getStart,
        () => 40,
        getStart(selectedBeforeRow),
        80,
        "l-1",
        selectedSlide,
      );
      const selectedAfterRow = findOutlineRowIndexForItem(
        afterRows,
        "l-1",
        selectedSlide,
      );
      const restoredTop =
        getStart(selectedAfterRow) + 20 -
        (focal?.kind === "selected" && focal.viewportCenter != null
          ? focal.viewportCenter
          : 40);

      expect(focal).toEqual(
        expect.objectContaining({
          kind: "selected",
          listId: "l-1",
          slideIndex: selectedSlide,
        }),
      );
      expect(getStart(selectedAfterRow)).toBeLessThan(restoredTop + 80);
      expect(getStart(selectedAfterRow) + 40).toBeGreaterThan(restoredTop);
    },
  );

  it("prefers slide id when matching a tiles-row anchor", () => {
    const section = {
      listId: "l-1",
      itemId: "a",
      name: "A",
      type: "song",
      slides: [
        slide("a1", "A1"),
        slide("a2", "A2"),
        slide("a3", "A3"),
        slide("a4", "A4"),
      ],
      isActive: true,
    };
    const rows = buildOutlineVirtualRows(
      [section],
      2,
    );
    const sectionMap = new Map([[
      "l-1",
      section,
    ]]);
    const anchor = captureOutlineScrollAnchor(
      rows,
      (index) => index * 40,
      40,
      sectionMap,
    );
    expect(anchor?.slideId).toBe("a1");

    // Insert a new first row of slides; a1 moves to the second tiles row.
    const grownSection = {
      ...section,
      slides: [
        slide("new1", "N1"),
        slide("new2", "N2"),
        slide("a1", "A1"),
        slide("a2", "A2"),
        slide("a3", "A3"),
        slide("a4", "A4"),
      ],
    };
    const grown = buildOutlineVirtualRows(
      [grownSection],
      2,
    );
    expect(
      resolveOutlineScrollTopFromAnchor(
        grown,
        (index) => index * 40,
        anchor!,
        buildOutlineVirtualRowIndex(grown, new Map([["l-1", grownSection]])),
      ),
    ).toBe(80);
  });

  it("finds the tile row for a slide, falling back to the section label", () => {
    const sections = [
      {
        listId: "l-1",
        itemId: "a",
        name: "A",
        type: "song",
        slides: [slide("s0", "0"), slide("s1", "1"), slide("s2", "2")],
        isActive: true,
      },
      {
        listId: "l-2",
        itemId: "b",
        name: "B",
        type: "song",
        slides: [],
        isActive: false,
      },
    ];
    const rows = buildOutlineVirtualRows(sections, 2);

    expect(findOutlineRowIndexForItem(rows, "l-1", 2)).toBe(2); // second tile row
    expect(findOutlineRowIndexForItem(rows, "l-1", 0)).toBe(1); // first tile row
    expect(findOutlineRowIndexForItem(rows, "l-2")).toBe(3); // section label
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
            id: "s1",
            type: "Section",
            name: "Section 1",
            boxes: [
              { words: "ignored", width: 1920, height: 1080 },
              { words: "Line one", width: 1920, height: 1080 },
            ],
          },
          {
            id: "s2",
            type: "Section",
            name: "Section 1",
            boxes: [
              { words: "ignored", width: 1920, height: 1080 },
              { words: "Line two", width: 1920, height: 1080 },
            ],
          },
        ],
        formattedSections: [],
        shouldSendTo: { projector: true, monitor: true, stream: true },
      } as unknown as DBItem,
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

  it("keeps logical row keys stable when rows are inserted above the viewport", () => {
    const before = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("a1", "A1"), slide("a2", "A2")],
          isActive: false,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      2,
    );
    const after = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("new", "New"), slide("a1", "A1"), slide("a2", "A2")],
          isActive: false,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      2,
    );

    expect(getOutlineVirtualRowKey(before[3])).toBe("l-2:tiles:0");
    expect(getOutlineVirtualRowKey(after[4])).toBe("l-2:tiles:0");
  });

  it("derives pin and anchor from the current virtual range", () => {
    const rows = buildOutlineVirtualRows(
      [
        {
          listId: "l-1",
          itemId: "a",
          name: "A",
          type: "song",
          slides: [slide("a1", "A1")],
          isActive: false,
        },
        {
          listId: "l-2",
          itemId: "b",
          name: "B",
          type: "song",
          slides: [slide("b1", "B1")],
          isActive: false,
        },
      ],
      1,
    );
    const virtualItems = [
      { index: 3, start: 120, end: 260 },
      { index: 4, start: 264, end: 404 },
    ];

    expect(getPinnedListIdFromVirtualItems(rows, virtualItems, 120)).toBe("l-2");
    expect(
      captureOutlineScrollAnchorFromVirtualItems(rows, virtualItems, 140),
    ).toEqual(
      expect.objectContaining({
        listId: "l-2",
        rowType: "tiles",
        localOffset: 20,
      }),
    );
  });

  it("reuses unrelated sections and rows when the active item changes", () => {
    const items = [
      outlineItem({ _id: "a", listId: "l-a", name: "A", type: "song" }),
      outlineItem({ _id: "b", listId: "l-b", name: "B", type: "song" }),
      outlineItem({ _id: "c", listId: "l-c", name: "C", type: "song" }),
    ];
    const docsById = buildDocsById({
      allSongDocs: [
        songDoc("a", "a-1", [slide("a1", "A1")]),
        songDoc("b", "b-1", [slide("b1", "B1")]),
        songDoc("c", "c-1", [slide("c1", "C1")]),
      ],
      allFreeFormDocs: [],
      allTimerDocs: [],
      allBibleDocs: [],
    });
    const sectionCache = new Map();
    const rowCache = new Map();
    const first = buildOutlineSlideSections(items, {
      activeItem: { _id: "a", listId: "l-a", slides: [slide("a1", "A1")] },
      docsById,
      sectionCache,
    });
    const firstRows = buildOutlineVirtualRows(first, 1, rowCache);
    const second = buildOutlineSlideSections(items, {
      activeItem: { _id: "b", listId: "l-b", slides: [slide("b1", "B1")] },
      docsById,
      sectionCache,
    });
    const secondRows = buildOutlineVirtualRows(second, 1, rowCache);

    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[2]).toBe(first[2]);
    expect(
      secondRows.find((row) => row.listId === "l-c" && row.type === "tiles"),
    ).toBe(
      firstRows.find((row) => row.listId === "l-c" && row.type === "tiles"),
    );
  });
});
