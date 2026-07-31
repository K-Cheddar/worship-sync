import {
  isConfidentSongTitleMatch,
  normalizeSongTitleForMatch,
  songTitleSimilarity,
} from "./songTitleSimilarity";

describe("normalizeSongTitleForMatch", () => {
  it.each([
    ["There's a Welcome Here (C)", "theres a welcome here"],
    ["Oh How I Love Jesus", "o how i love jesus"],
    ["Great Is Thy Faithfulness", "great is your faithfulness"],
    ["Pass Me Not, O Gentle Saviour", "pass me not o gentle savior"],
    // Hymnal numbers at either end name a place in a book, not the song.
    ["He Hideth My Soul #520", "he hideth my soul"],
    ["520 He Hideth My Soul", "he hideth my soul"],
    // A longer number is part of the title, and its comma is not a word break.
    ["10,000 Reasons", "10000 reasons"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeSongTitleForMatch(raw)).toBe(expected);
  });

  it("never strips a title down to nothing", () => {
    expect(normalizeSongTitleForMatch("520")).toBe("520");
  });
});

describe("songTitleSimilarity", () => {
  const same: Array<[string, string]> = [
    ["Oh How I Love Jesus", "O How I Love Jesus"],
    ["Great Is Your Faithfulness", "Great Is Thy Faithfulness"],
    ["Pass Me Not O Gentle Saviour", "Pass Me Not, O Gentle Savior"],
    ["How Great Is Our God (Live)", "How Great Is Our God"],
    ["What A Beautiful Name It Is", "What a Beautiful Name"],
    ["He Hideth My Soul 520", "He Hideth My Soul"],
    // Same words, rearranged around the subtitle.
    ["Bless the Lord (10,000 Reasons)", "10,000 Reasons (Bless the Lord)"],
  ];

  it.each(same)("reads %s and %s as one song", (planning, library) => {
    expect(isConfidentSongTitleMatch(planning, library)).toBe(true);
  });

  it("is symmetric", () => {
    same.forEach(([planning, library]) => {
      expect(songTitleSimilarity(planning, library)).toBe(
        songTitleSimilarity(library, planning),
      );
      expect(isConfidentSongTitleMatch(planning, library)).toBe(
        isConfidentSongTitleMatch(library, planning),
      );
    });
  });

  it.each([
    // Holds every word of the library title, in another order, and is a
    // different song. Word overlap alone would have linked these.
    ["Owe You Praise", "Praise You"],
    ["I Owe You Praise", "I Will Praise You"],
    // Same words plus one, but not a continuation of the title.
    ["Come Thou Almighty Fount", "Come Thou Fount"],
    // One short word apart, and a different song — this is why whole-string
    // edit distance only decides near-identical titles.
    ["Jesus Loves You", "Jesus Loves Me"],
    ["Trust in Jesus", "Trust in God"],
    ["How Great Thou Art", "How Great Is Our God"],
    ["Come Thou Long Expected Jesus", "Come Thou Fount"],
    // A single distinctive word is not enough to name a song.
    ["God", "How Great Is Our God"],
    ["Amazing Grace My Chains Are Gone", "Amazing Grace"],
  ])("keeps %s and %s apart", (planning, library) => {
    expect(isConfidentSongTitleMatch(planning, library)).toBe(false);
  });

  it("still rates a near-miss as close, so it can be offered by hand", () => {
    // Not linkable — the words are shared but the order isn't — yet plainly the
    // song someone would pick from a short list.
    expect(isConfidentSongTitleMatch("Owe You Praise", "Praise You")).toBe(false);
    expect(songTitleSimilarity("Owe You Praise", "Praise You")).toBeGreaterThan(0.5);
    expect(songTitleSimilarity("Rolled the Sea Away", "Rolled Away"))
      .toBeGreaterThan(0.5);
  });
});
