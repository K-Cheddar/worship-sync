import {
  enrichLyricsSectionBreaks,
  inferLyricsSections,
  tryParseSectionLabel,
} from "./lyricsSectionInference";

describe("lyricsSectionInference", () => {
  it("recognizes explicit chart labels only", () => {
    expect(tryParseSectionLabel("Chorus")).toBe("Chorus");
    expect(tryParseSectionLabel("[VERSE 1]")).toBe("Verse");
    expect(tryParseSectionLabel("Praises")).toBeNull();
  });

  it("inserts breaks before explicit chart labels in single-newline lyrics", () => {
    expect(
      enrichLyricsSectionBreaks("Verse 1\nLine one\nChorus\nHold on"),
    ).toBe("Verse 1\nLine one\n\nChorus\nHold on");
  });

  it("leaves lyrics alone when section breaks already exist", () => {
    const lyrics = "Verse one\n\nChorus line";
    expect(enrichLyricsSectionBreaks(lyrics)).toBe(lyrics);
  });

  it("marks repeated blocks as chorus sections", () => {
    const result = inferLyricsSections(
      [
        "Amazing grace",
        "How sweet the sound",
        "",
        "Saved a wretch like me",
        "Was lost but now I'm found",
        "",
        "Amazing grace",
        "How sweet the sound",
      ].join("\n"),
    );

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("Chorus");
    expect(result[1].type).toBe("Verse");
    expect(result[2].type).toBe("Chorus");
    expect(result[0].words).toBe("Amazing grace\nHow sweet the sound");
  });

  it("splits flat lyrics when a repeated line sequence appears later", () => {
    const result = inferLyricsSections(
      [
        "Line A",
        "Line B",
        "Line C",
        "Line D",
        "Line E",
        "Line F",
        "Line G",
        "Line H",
        "Line A",
        "Line B",
        "Line C",
        "Line D",
      ].join("\n"),
    );

    expect(result.length).toBeGreaterThan(1);
  });

  it("marks similar chorus blocks as chorus when lyrics vary between repeats", () => {
    const chorusA = [
      "Praises",
      "Oh Lord, You deserve",
      "Oh Lord, You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Only You deserve all my praise",
      "I have so many reasons",
      "You've given me so many reasons",
      "I can't count 'em all",
      "No no",
    ].join("\n");

    const chorusB = [
      "Praises",
      "Oh Lord, You deserve",
      "Oh Lord, You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Only You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Oh Lord, You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Only You deserve all my praise",
      "You've given me so many reasons",
      "So many reasons",
      "You've given me so many reasons",
      "I can't count 'em all, no",
    ].join("\n");

    const chorusC = [
      "Praises",
      "Oh Lord, You deserve",
      "Oh Lord, You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Only You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Oh Lord, You deserve all my",
      "Praises",
      "Oh Lord, You deserve",
      "Only You—",
    ].join("\n");

    const verse = [
      "You woke me up this morning",
      "Yeah my cup is overflowing",
      "You have blessed me and I know it",
      "So I owe You my praise",
    ].join("\n");

    const result = inferLyricsSections(
      [chorusA, "", verse, "", chorusB, "", chorusC].join("\n"),
    );

    expect(result).toHaveLength(4);
    expect(result[0].type).toBe("Chorus");
    expect(result[1].type).toBe("Verse");
    expect(result[2].type).toBe("Chorus");
    expect(result[3].type).toBe("Chorus");
  });

  it("preserves explicit bracketed section labels", () => {
    const result = inferLyricsSections(
      "[VERSE 1]\nLine one\n\n[CHORUS]\nChorus line\n\n[CHORUS]",
    );

    expect(result.map((section) => section.type)).toEqual([
      "Verse",
      "Chorus",
      "Chorus",
    ]);
    expect(result[2].words).toBe("");
  });
});
