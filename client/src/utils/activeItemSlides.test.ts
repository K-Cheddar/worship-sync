import { getSerializedSongSizeReport, getActiveItemSlides, normalizeItemSlides, normalizeSongForLibrary, normalizeSongForPersistence } from "./activeItemSlides";
import type { DBItem, ItemSlideType } from "../types";

const box = (words: string) => ({
  id: "content", words, width: 100, height: 50, fontSize: 42, fontColor: "#fff", background: "",
});
const slide = (id: string, words: string): ItemSlideType => ({
  id, name: id, type: "Verse", boxes: [{ ...box(""), id: `${id}-bg` }, box(words)],
});

describe("activeItemSlides", () => {
  it("reads songs from their selected arrangement and non-songs from root slides", () => {
    const song = {
      type: "song", slides: [], selectedArrangement: 1,
      arrangements: [
        { id: "a", name: "A", formattedLyrics: [], songOrder: [], slides: [slide("a", "first")] },
        { id: "b", name: "B", formattedLyrics: [], songOrder: [], slides: [slide("b", "second")] },
      ],
    } as any;
    expect(getActiveItemSlides(song)[0].boxes[1].words).toBe("second");
    const free = { type: "free", slides: [slide("free", "root")], arrangements: [], selectedArrangement: 0 } as any;
    expect(getActiveItemSlides(free)[0].boxes[1].words).toBe("root");
  });

  it("hydrates legacy root slides into an empty selected arrangement", () => {
    const legacySlide = slide("recover", "Recoverable text");
    const normalized = normalizeItemSlides({
      _id: "song-1", type: "song", name: "Song", selectedArrangement: 0, slides: [legacySlide],
      arrangements: [{ id: "arr", name: "Master", formattedLyrics: [], songOrder: [], slides: [] }],
    } as any);
    expect(normalized.slides).toEqual([]);
    expect(getActiveItemSlides(normalized as any)).toEqual([legacySlide]);
  });

  it("recovers root slides into the selected arrangement even when another arrangement is populated", () => {
    const legacySlide = slide("legacy", "stale root copy");
    const otherArrangementSlide = slide("other", "authoritative arrangement");
    const normalized = normalizeItemSlides({
      _id: "song-2", type: "song", name: "Song", selectedArrangement: 1,
      slides: [legacySlide],
      arrangements: [
        { id: "usable", name: "Usable", formattedLyrics: [], songOrder: [], slides: [otherArrangementSlide] },
        { id: "empty", name: "Selected", formattedLyrics: [], songOrder: [], slides: [] },
      ],
    } as any);
    expect(normalized.arrangements[0].slides).toEqual([otherArrangementSlide]);
    expect(normalized.arrangements[1].slides).toEqual([legacySlide]);
    expect(normalized.slides).toEqual([]);
    expect(getActiveItemSlides(normalized as any)).toEqual([legacySlide]);
  });

  it("keeps populated selected slides when root legacy slides are stale", () => {
    const activeSlide = slide("active", "active arrangement");
    const staleSlide = slide("stale", "stale root");
    const normalized = normalizeItemSlides({
      type: "song", selectedArrangement: 0, slides: [staleSlide],
      arrangements: [{ id: "a", name: "A", formattedLyrics: [], songOrder: [], slides: [activeSlide] }],
    } as any);
    expect(normalized.arrangements[0].slides).toEqual([activeSlide]);
    expect(getActiveItemSlides(normalized as any)).toEqual([activeSlide]);
  });

  it("creates an arrangement when recovering a song with no arrangements", () => {
    const legacySlide = slide("legacy-only", "legacy only");
    const normalized = normalizeItemSlides({
      _id: "song-no-arrangements", type: "song", selectedArrangement: 1,
      slides: [legacySlide], arrangements: [],
    } as any);
    expect(getActiveItemSlides(normalized as any)).toEqual([legacySlide]);
    expect(normalized.arrangements).toHaveLength(1);
    expect(normalized.selectedArrangement).toBe(0);
    expect(normalized.slides).toEqual([]);
  });

  it("keeps library normalization structural without measuring missing monitor layouts", () => {
    const legacySlide = slide("legacy-library", "library legacy");
    const normalized = normalizeSongForLibrary({
      type: "song", selectedArrangement: 0, slides: [legacySlide],
      arrangements: [{ id: "a", name: "A", formattedLyrics: [], songOrder: [], slides: [] }],
    } as any);
    expect(normalized).not.toHaveProperty("slides");
    expect(normalized).not.toHaveProperty("monitorLayout");
    expect(normalized.arrangements[0]).not.toHaveProperty("monitorLayout");
    expect(normalized.arrangements[0].slides).toEqual([legacySlide]);
  });

  it("recovers legacy slides once, then omits song-only root fields for persistence", () => {
    const legacySlide = slide("legacy-save", "recover before save");
    const persisted = normalizeSongForPersistence({
      _id: "song-3", type: "song", name: "Song", selectedArrangement: 0,
      slides: [legacySlide], monitorLayout: { currentFontSizePx: 40, nextFontSizePx: 39 },
      arrangements: [{ id: "arr", name: "Master", formattedLyrics: [], songOrder: [], slides: [] }],
    } as any);
    expect(persisted).not.toHaveProperty("slides");
    expect(persisted).not.toHaveProperty("monitorLayout");
    expect(persisted.arrangements[0].slides).toEqual([legacySlide]);
  });

  it("retains compact arrangement layout and strips legacy monitor clones on persistence", () => {
    const sourceSlide = {
      ...slide("monitor", "Monitor source"),
      monitorCurrentBandBoxes: [{ id: "current-clone", words: "old current band" }],
      monitorNextBandBoxes: [{ id: "next-clone", words: "old next band" }],
    } as ItemSlideType;
    const persisted = normalizeSongForPersistence({
      type: "song", slides: [sourceSlide],
      monitorLayout: { currentFontSizePx: 22, nextFontSizePx: 20 },
      arrangements: [{
        id: "a", name: "A", formattedLyrics: [], songOrder: [], slides: [],
        monitorLayout: { currentFontSizePx: 30, nextFontSizePx: 29 },
      }],
    } as any);
    expect(persisted).not.toHaveProperty("slides");
    expect(persisted).not.toHaveProperty("monitorLayout");
    expect(persisted.arrangements[0].monitorLayout).toEqual({ currentFontSizePx: 30, nextFontSizePx: 29 });
    expect(persisted.arrangements[0].slides[0]).not.toHaveProperty("monitorCurrentBandBoxes");
    expect(persisted.arrangements[0].slides[0]).not.toHaveProperty("monitorNextBandBoxes");
  });

  it("reports serialized size removed by root slides and monitor box clones", () => {
    const arrangements = Array.from({ length: 3 }, (_, arrangementIndex) => ({
      id: `arr-${arrangementIndex}`, name: `Arrangement ${arrangementIndex}`, formattedLyrics: [], songOrder: [],
      slides: Array.from({ length: 8 }, (_, slideIndex) => {
        const source = slide(`s-${arrangementIndex}-${slideIndex}`, "These are representative song lyrics duplicated on monitor output.");
        const clone = { ...source.boxes[1], words: source.boxes[1].words, monitorFontSizePx: 27 };
        return { ...source, monitorCurrentBandBoxes: [clone], monitorNextBandBoxes: [clone] };
      }),
    }));
    const song = {
      _id: "multi-arrangement-song", type: "song", name: "Representative", selectedArrangement: 0,
      arrangements, slides: arrangements[0].slides, shouldSendTo: { projector: true, monitor: true, stream: true },
    } as unknown as DBItem;
    const report = getSerializedSongSizeReport(song);
    expect(report.legacyBytes).toBeGreaterThan(report.normalizedBytes);
    expect(report.bytesRemoved).toBe(report.legacyBytes - report.normalizedBytes);
    expect(report.reductionPercent).toBeGreaterThan(20);
    expect(JSON.stringify(song)).toContain("monitorCurrentBandBoxes");
  });
});
