import {
  createSections,
  createNewSong,
  createNewFreeForm,
  createNewBible,
  createNewTimer,
  updateFormattedSections,
  makeUnique,
} from "./itemUtil";
import type { ServiceItem } from "../types";

jest.mock("./generateRandomId", () => ({
  __esModule: true,
  default: () => "fixed-id",
}));

jest.mock("./overflow", () => ({
  formatSong: (item: unknown) => item,
  formatFree: (item: unknown) => item,
  formatBible: (opts: { item: unknown }) => opts.item,
}));

describe("itemUtil", () => {
  describe("createSections", () => {
    it("parses unformatted lyrics by double newline and creates sections", () => {
      const result = createSections({
        unformattedLyrics: "Line one\n\nLine two\n\nLine three",
      });
      expect(result.formattedLyrics).toHaveLength(3);
      expect(result.songOrder).toHaveLength(3);
      expect(result.formattedLyrics[0].words).toBe("Line one");
      expect(result.formattedLyrics[0].name).toBe("Verse ");
      expect(result.formattedLyrics[0].type).toBe("Verse");
      expect(result.formattedLyrics[1].words).toBe("Line two");
      expect(result.formattedLyrics[2].words).toBe("Line three");
    });

    it("reuses existing section when words match", () => {
      const result = createSections({
        unformattedLyrics: "Same\n\nSame",
      });
      expect(result.formattedLyrics).toHaveLength(1);
      expect(result.songOrder).toHaveLength(2);
      expect(result.songOrder[0].name).toBe(result.songOrder[1].name);
    });

    it("uses existing formattedLyrics and songOrder when provided", () => {
      const existing = {
        formattedLyrics: [
          {
            type: "Verse" as const,
            name: "Verse 1",
            words: "Existing",
            id: "e1",
            slideSpan: 1,
          },
        ],
        songOrder: [{ name: "Verse 1", id: "s1" }],
      };
      const result = createSections({
        ...existing,
        unformattedLyrics: "New line",
      });
      expect(result.formattedLyrics[0].words).toBe("Existing");
      expect(result.formattedLyrics[1].words).toBe("New line");
      expect(result.songOrder).toHaveLength(2);
    });

    it("assigns deterministic ids when mocked", () => {
      const result = createSections({
        unformattedLyrics: "A\n\nB",
      });
      expect(result.formattedLyrics[0].id).toBe("fixed-id");
      expect(result.songOrder[0].id).toBe("fixed-id");
    });
  });

  describe("makeUnique", () => {
    it("returns value when not in list", () => {
      const list = [{ name: "Other" }, { name: "Another" }];
      expect(makeUnique({ value: "Unique", property: "name", list })).toBe(
        "Unique",
      );
    });

    it("returns value with (1) when value exists once", () => {
      const list = [{ name: "Item" }];
      expect(makeUnique({ value: "Item", property: "name", list })).toBe(
        "Item (1)",
      );
    });

    it("returns value with (2) when value and (1) exist", () => {
      const list = [{ name: "Item" }, { name: "Item (1)" }];
      expect(makeUnique({ value: "Item", property: "name", list })).toBe(
        "Item (2)",
      );
    });

    it("uses custom property", () => {
      const list = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ];
      expect(makeUnique({ value: "a", property: "id", list })).toBe("a (1)");
      expect(makeUnique({ value: "c", property: "id", list })).toBe("c");
    });
  });

  describe("createNewSong", () => {
    it("creates a new song with lyrics (formattedLyrics and songOrder)", async () => {
      const { formattedLyrics, songOrder } = createSections({
        unformattedLyrics: "First verse line\n\nChorus line\n\nSecond verse",
      });
      const list: ServiceItem[] = [];
      const item = await createNewSong({
        name: "My Song",
        formattedLyrics,
        songOrder,
        list,
        db: undefined,
        background: "#000",
        brightness: 100,
      });
      expect(item.type).toBe("song");
      expect(item.name).toBe("My Song");
      expect(item.arrangements).toHaveLength(1);
      expect(item.arrangements[0].formattedLyrics).toHaveLength(3);
      expect(item.arrangements[0].formattedLyrics[0].words).toBe(
        "First verse line",
      );
      expect(item.arrangements[0].formattedLyrics[1].words).toBe("Chorus line");
      expect(item.arrangements[0].formattedLyrics[2].words).toBe(
        "Second verse",
      );
      expect(item.arrangements[0].songOrder).toHaveLength(3);
      expect(item.arrangements[0].songOrder.map((s) => s.name)).toEqual(
        item.arrangements[0].formattedLyrics.map((f) => f.name),
      );
    });
  });

  describe("createNewFreeForm", () => {
    it("creates a new free form item with text", async () => {
      const list: ServiceItem[] = [];
      const item = await createNewFreeForm({
        name: "Announcement",
        text: "Welcome and greeting",
        list,
        db: undefined,
        background: "#1a1a1a",
        brightness: 100,
      });
      expect(item.type).toBe("free");
      expect(item.name).toBe("Announcement");
      expect(item.slides).toHaveLength(1);
      expect(item.slides[0].type).toBe("Section");
      expect(item.slides[0].name).toBe("Section 1");
      const textBox = item.slides[0].boxes?.find((b) =>
        b.words?.includes("Welcome"),
      );
      expect(textBox?.words).toContain("Welcome and greeting");
    });
  });

  describe("createNewBible", () => {
    it("creates a new bible item with book, chapter, version and verses", async () => {
      const list: ServiceItem[] = [];
      const verses = [
        { name: "1", index: 1, text: "In the beginning" },
        { name: "2", index: 2, text: "God created" },
      ];
      const item = await createNewBible({
        name: "Genesis 1",
        book: "Genesis",
        chapter: "1",
        version: "NIV",
        verses,
        list,
        db: undefined,
        background: "#000",
        brightness: 100,
        fontMode: "separate",
      });
      expect(item.type).toBe("bible");
      expect(item.name).toBe("Genesis 1");
      expect(item._id).toBe("Genesis 1");
    });
  });

  describe("createNewTimer", () => {
    it("creates a new timer item with duration and type", async () => {
      const list: ServiceItem[] = [];
      const item = await createNewTimer({
        name: "Welcome Timer",
        list,
        db: undefined,
        hostId: "host-1",
        duration: 300,
        countdownTime: "00:00",
        timerType: "timer",
        background: "#000",
        brightness: 100,
      });
      expect(item.type).toBe("timer");
      expect(item.name).toBe("Welcome Timer");
      expect(item.slides).toHaveLength(2);
      expect(item.timerInfo).toBeDefined();
      expect(item.timerInfo?.duration).toBe(300);
      expect(item.timerInfo?.timerType).toBe("timer");
      expect(item.timerInfo?.status).toBe("stopped");
    });

    it("creates a countdown timer with countdownTime", async () => {
      const list: ServiceItem[] = [];
      const item = await createNewTimer({
        name: "Countdown",
        list,
        db: undefined,
        hostId: "host-1",
        duration: 0,
        countdownTime: "12:00",
        timerType: "countdown",
        background: "#000",
        brightness: 100,
      });
      expect(item.type).toBe("timer");
      expect(item.timerInfo?.timerType).toBe("countdown");
      expect(item.timerInfo?.countdownTime).toBe("12:00");
    });
  });

  describe("updateFormattedSections", () => {
    it("normalizes section names (Verse -> Verse 1, Verse 2) when editing lyrics", () => {
      const formattedLyrics = [
        {
          type: "Verse",
          name: "Verse 1",
          words: "Line one",
          id: "v1",
          slideSpan: 1,
        },
        {
          type: "Verse",
          name: "Verse 2",
          words: "Line two",
          id: "v2",
          slideSpan: 1,
        },
      ];
      const songOrder = [
        { name: "Verse 1", id: "s1" },
        { name: "Verse 2", id: "s2" },
      ];
      const result = updateFormattedSections({ formattedLyrics, songOrder });
      expect(result.formattedLyrics[0].name).toBe("Verse 1");
      expect(result.formattedLyrics[1].name).toBe("Verse 2");
      expect(result.songOrder[0].name).toBe("Verse 1");
      expect(result.songOrder[1].name).toBe("Verse 2");
    });

    it("preserves single section name when only one section", () => {
      const formattedLyrics = [
        {
          type: "Chorus",
          name: "Chorus",
          words: "Repeat",
          id: "c1",
          slideSpan: 1,
        },
      ];
      const result = updateFormattedSections({
        formattedLyrics,
        songOrder: [{ name: "Chorus", id: "o1" }],
      });
      expect(result.formattedLyrics[0].name).toBe("Chorus");
      expect(result.songOrder[0].name).toBe("Chorus");
    });

    it("builds songOrder from section names when songOrder is empty (edit flow)", () => {
      const formattedLyrics = [
        {
          type: "Verse",
          name: "Verse",
          words: "Edited line",
          id: "v1",
          slideSpan: 1,
        },
      ];
      const result = updateFormattedSections({
        formattedLyrics,
        songOrder: [],
      });
      expect(result.songOrder).toHaveLength(1);
      expect(result.songOrder[0].name).toBe("Verse");
    });
  });
});
