import type { ItemSlideType } from "../types";
import {
  filterExistingSlideIds,
  getAllMatchingSectionNameSlideIds,
  getAllMatchingTypeSlideIds,
  getContiguousSameTypeSlideIds,
  getThisSectionSlideIds,
  inclusiveRangeIndicesFromAnchor,
  normalizeSongSlideSectionName,
} from "./backgroundTargetResolution";

const slide = (
  id: string,
  type: ItemSlideType["type"],
  name?: string,
): ItemSlideType => ({
  id,
  type,
  name: name ?? id,
  boxes: [],
});

describe("backgroundTargetResolution", () => {
  const slides: ItemSlideType[] = [
    slide("a", "Verse"),
    slide("b", "Chorus"),
    slide("c", "Chorus"),
    slide("d", "Chorus"),
    slide("e", "Verse"),
  ];

  it("getContiguousSameTypeSlideIds expands to same-type neighbors only", () => {
    expect(getContiguousSameTypeSlideIds(slides, 2)).toEqual(["b", "c", "d"]);
    expect(getContiguousSameTypeSlideIds(slides, 0)).toEqual(["a"]);
    expect(getContiguousSameTypeSlideIds(slides, 4)).toEqual(["e"]);
  });

  it("normalizeSongSlideSectionName strips overflow letter suffixes", () => {
    expect(normalizeSongSlideSectionName("Verse 1")).toBe("Verse 1");
    expect(normalizeSongSlideSectionName(`Verse 1\u200Bb\u200B`)).toBe(
      "Verse 1",
    );
  });

  it("getAllMatchingSectionNameSlideIds matches by section name across arrangement", () => {
    const songSlides: ItemSlideType[] = [
      slide("v1", "Verse", "Verse 1"),
      slide("c1a", "Chorus", "Chorus 1"),
      slide("v2", "Verse", "Verse 2"),
      slide("c1b", "Chorus", "Chorus 1"),
      slide("c2", "Chorus", "Chorus 2"),
      slide("c1c", "Chorus", "Chorus 1"),
    ];
    expect(
      getAllMatchingSectionNameSlideIds(songSlides, 1, "song").sort(),
    ).toEqual(["c1a", "c1b", "c1c"].sort());
    expect(getAllMatchingSectionNameSlideIds(songSlides, 4, "song")).toEqual([
      "c2",
    ]);
    expect(getAllMatchingSectionNameSlideIds(songSlides, 1, "free")).toEqual(
      [],
    );
  });

  it("getThisSectionSlideIds for song uses section name not slide type", () => {
    const songSlides: ItemSlideType[] = [
      slide("t", "Title", "Title"),
      slide("v1a", "Verse", "Verse 1"),
      slide("v1b", "Verse", `Verse 1\u200Bb\u200B`),
      slide("ch", "Chorus", "Chorus"),
      slide("v2", "Verse", "Verse 2"),
    ];
    expect(getThisSectionSlideIds(songSlides, 1, "song")).toEqual([
      "v1a",
      "v1b",
    ]);
    expect(getThisSectionSlideIds(songSlides, 2, "song")).toEqual([
      "v1a",
      "v1b",
    ]);
    expect(getThisSectionSlideIds(songSlides, 4, "song")).toEqual(["v2"]);
    expect(getThisSectionSlideIds(songSlides, 3, "song")).toEqual(["ch"]);
  });

  it("getThisSectionSlideIds for non-song keeps contiguous same type", () => {
    expect(getThisSectionSlideIds(slides, 2, "free")).toEqual(["b", "c", "d"]);
  });

  it("getAllMatchingTypeSlideIds is song-only and spans full arrangement", () => {
    expect(getAllMatchingTypeSlideIds(slides, 2, "song")).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(getAllMatchingTypeSlideIds(slides, 2, "free")).toEqual([]);
  });

  it("filterExistingSlideIds drops stale ids", () => {
    expect(filterExistingSlideIds(slides, ["b", "x", "d"])).toEqual(["b", "d"]);
  });

  it("inclusiveRangeIndicesFromAnchor replaces-style range uses anchor or fallback", () => {
    expect(inclusiveRangeIndicesFromAnchor(slides, "b", 4, 0)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(inclusiveRangeIndicesFromAnchor(slides, null, 3, 1)).toEqual([
      1, 2, 3,
    ]);
  });
});
