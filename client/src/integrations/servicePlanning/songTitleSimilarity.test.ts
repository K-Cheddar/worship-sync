import {
  isConfidentSongTitleMatch,
  normalizeSongTitleForMatch,
  songTitleSimilarity,
} from "./songTitleSimilarity";

describe("normalizeSongTitleForMatch", () => {
  it.each([
    // Plurals fold away, so a trailing "s" never decides a match on its own.
    // Applied to both sides, so a contraction folding too is harmless.
    ["There's a Welcome Here (C)", "there a welcome here"],
    // A trailing number is kept whichever kind it is — the chapter that names a
    // passage and the catalog number appended to a title both survive here, and
    // the extension rule reads the catalog case as the same song.
    ["Proverbs 3", "proverb 3"],
    ["He Hideth My Soul 520", "he hideth my soul 520"],
    // Not every trailing "s" is a plural.
    ["Jesus Loves Me", "jesus love me"],
    ["Bless the Lord", "bless the lord"],
    ["Oh How I Love Jesus", "o how i love jesus"],
    ["Great Is Thy Faithfulness", "great is your faithfulness"],
    ["Pass Me Not, O Gentle Saviour", "pass me not o gentle savior"],
    // Hymnal numbers at either end name a place in a book, not the song.
    ["He Hideth My Soul #520", "he hideth my soul"],
    ["520 He Hideth My Soul", "he hideth my soul"],
    // A longer number is part of the title, and its comma is not a word break.
    ["10,000 Reasons", "10000 reason"],
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
    // A plural is a systematic variation, not a typo — left to edit distance it
    // would depend on how long the word happens to be.
    ["Proverb 3", "Proverbs 3"],
    ["Psalm 23", "Psalms 23"],
    ["Revelations 21", "Revelation 21"],
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
    // Folding plurals must not reach endings where the "s" isn't one.
    ["Jesu", "Jesus"],
    ["Ble", "Bless"],
    ["Grade", "Grace"],
    // Songs named for a passage: the chapter is what tells them apart, so it
    // must not be mistaken for a hymnal number and dropped.
    ["Proverbs 4", "Proverbs 3"],
    ["Psalm 91", "Psalm 23"],
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
