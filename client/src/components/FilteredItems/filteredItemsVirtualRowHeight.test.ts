import {
  COLLAPSED_FILTERED_ITEM_ROW_HEIGHT,
  estimateFilteredItemRowHeight,
  getLibraryItemVirtualKey,
  isFilteredItemLyricsExpanded,
} from "./filteredItemsVirtualRowHeight";
import type { filteredItemsListType } from "./FilteredItems";

const baseItem = (
  overrides: Partial<filteredItemsListType> = {},
): filteredItemsListType =>
  ({
    _id: "song-1",
    name: "Test Song",
    type: "song",
    ...overrides,
  }) as filteredItemsListType;

describe("estimateFilteredItemRowHeight", () => {
  it("uses collapsed height when lyrics are not expanded", () => {
    expect(
      estimateFilteredItemRowHeight(
        baseItem({ matchedWords: "The Lord is my shepherd" }),
        false,
        false,
      ),
    ).toBeGreaterThanOrEqual(COLLAPSED_FILTERED_ITEM_ROW_HEIGHT);
  });

  it("estimates taller rows for expanded lyric snippets", () => {
    const collapsed = estimateFilteredItemRowHeight(
      baseItem({ matchedWords: "short line" }),
      false,
      false,
    );
    const expanded = estimateFilteredItemRowHeight(
      baseItem({ matchedWords: "short line", showWords: true }),
      false,
      false,
    );

    expect(expanded).toBeGreaterThan(collapsed);
    expect(expanded).toBeLessThan(220);
  });

  it("adds height when artist metadata is shown", () => {
    const title = "697 - Shout With Joy To God, All The Earth!";
    const withoutArtist = estimateFilteredItemRowHeight(
      baseItem({ name: title }),
      false,
      false,
    );
    const withArtist = estimateFilteredItemRowHeight(
      baseItem({ name: title }),
      false,
      true,
    );

    expect(withArtist).toBeGreaterThan(withoutArtist);
  });

  it("accounts for long titles that wrap in collapsed rows", () => {
    const shortTitle = estimateFilteredItemRowHeight(
      baseItem({ name: "Short title" }),
      false,
      false,
    );
    const longTitle = estimateFilteredItemRowHeight(
      baseItem({
        name: "697 - Shout With Joy To God, All The Earth! A Very Long Hymn Title That Keeps Going",
      }),
      false,
      false,
    );

    expect(longTitle).toBeGreaterThan(shortTitle);
  });
});

describe("getLibraryItemVirtualKey", () => {
  it("changes when lyrics expand or collapse", () => {
    const item = baseItem({ matchedWords: "praise the Lord" });
    const collapsed = getLibraryItemVirtualKey(item, false);
    const expanded = getLibraryItemVirtualKey(
      { ...item, showWords: true },
      false,
    );

    expect(collapsed).not.toBe(expanded);
    expect(isFilteredItemLyricsExpanded(item, false)).toBe(false);
    expect(isFilteredItemLyricsExpanded({ ...item, showWords: true }, false)).toBe(
      true,
    );
  });
});
