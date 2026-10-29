import { mergeLyricText } from "./mergeLyricText";

it("merges multiple disjoint changes in either arrival order", () => {
  const base = "alpha beta gamma delta";
  const a = "ALPHA beta gamma DELTA";
  const b = "alpha beta GAMMA delta";
  expect(mergeLyricText(base, a, b)).toBe("ALPHA beta GAMMA DELTA");
  expect(mergeLyricText(base, b, a)).toBe("ALPHA beta GAMMA DELTA");
});
it("rejects overlapping edits and different additions at the same authored position", () => {
  expect(mergeLyricText("words", "word1", "word2")).toBeNull();
  expect(mergeLyricText("words", "words1", "words2")).toBeNull();
  expect(mergeLyricText("words", "words1", "words1")).toBe("words1");
});
it("preserves deletions and insertions on separate lines", () => {
  expect(mergeLyricText("one\ntwo\nthree", "\ntwo\nthree", "one\ntwo\nthree1"))
    .toBe("\ntwo\nthree1");
});
it("retains ambiguous repeated-line edits for review rather than guessing which copy was deleted", () => {
  expect(mergeLyricText("line\nline\nend", "line\nend", "LINE\nline\nend")).toBeNull();
});
