/**
 * How alike two song titles are, 0–1, for deciding whether a title printed on a
 * service plan names a song the library already has.
 *
 * This is deliberately not the library search ranking (`getMatchForString`).
 * That function ranks candidates against what a person typed, and its score
 * reports which branch matched — exact, whole phrase, or loose word overlap —
 * rather than how alike two complete titles are. So its bands are far apart: an
 * exact hit scores 2x the search terms while "Great Is Your Faithfulness"
 * against "Great Is Thy Faithfulness" scores ~1.0 in total, no matter how long
 * the title is. It orders candidates well, which is what it's used for here;
 * the accept-or-not call needs a symmetric measure, which is this.
 */
import { commonWords, levenshteinDistance, punctuationRegex } from "../../utils/generalUtils";
import { cleanPlanningTitle } from "./cleanPlanningTitle";

/**
 * Spellings that name the same song. Applied to both titles, so this can only
 * ever merge variants of one name — it can never pull two different songs
 * together on its own.
 */
const TITLE_WORD_VARIANTS: Record<string, string> = {
  oh: "o",
  thy: "your",
  thine: "your",
  thee: "you",
  thou: "you",
  ye: "you",
  saviour: "savior",
  honour: "honor",
  favour: "favor",
  colour: "color",
  til: "till",
};

/** Hymnal numbers run to three digits; a longer number is part of the title
 * ("10,000 Reasons"), so only the short ones are treated as catalog numbers. */
const HYMNAL_NUMBER = /^\d{1,3}$/;

/** Below this, two titles are different songs. */
export const SONG_TITLE_MATCH_THRESHOLD = 0.85;

/** Near-identical strings: a stray letter or two, as in "Saviour"/"Savior". */
const MAX_TYPO_DISTANCE = 2;
const MIN_TYPO_RATIO = 0.9;
const TYPO_SIMILARITY = 0.95;

/** One title continuing the other — "(Live)", "Reprise", a subtitle — is the
 * same song. Order matters: see `isTitleExtension`. */
const MAX_EXTRA_WORDS = 2;
const MIN_EXTENSION_WORDS = 2;
const EXTENSION_SIMILARITY = 0.9;

/**
 * Strips the decoration a printout adds and folds spelling variants together,
 * so two ways of writing one title come out the same.
 */
export const normalizeSongTitleForMatch = (title: string): string => {
  const words = cleanPlanningTitle(title)
    .toLowerCase()
    .replace(/['‘’]/g, "")
    // Before punctuation becomes a word break, or "10,000 Reasons" splits into
    // a "10" and a "000" that then read as hymnal numbers.
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(punctuationRegex, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => TITLE_WORD_VARIANTS[word] ?? word);

  // A hymnal number at either end is where the song sits in a book, not part of
  // its name. Never strip the only word, or a title becomes empty.
  while (words.length > 1 && HYMNAL_NUMBER.test(words[0])) words.shift();
  while (words.length > 1 && HYMNAL_NUMBER.test(words[words.length - 1])) words.pop();

  return words.join(" ");
};

/** Distinctive words only: articles and prepositions don't identify a song. */
const contentWords = (normalizedTitle: string): Set<string> => {
  const words = normalizedTitle.split(" ").filter(Boolean);
  const distinctive = words.filter((word) => !commonWords.includes(word));
  // A title made entirely of filler ("To God Be...") still has to compare as
  // something, so fall back to every word rather than to nothing.
  return new Set(distinctive.length > 0 ? distinctive : words);
};

const countShared = (left: Set<string>, right: Set<string>): number => {
  let shared = 0;
  left.forEach((word) => {
    if (right.has(word)) shared += 1;
  });
  return shared;
};

/**
 * Whether one title carries on where the other stops — the same words, in the
 * same order, from the start, plus a short tail: "Come Thou Fount" and "Come
 * Thou Fount of Every Blessing".
 *
 * Word order is the whole point. Merely holding the same words is not enough:
 * "Owe You Praise" contains every word of "Praise You" and is a different song.
 * Requiring a leading run in order rejects that, and rejects "Come Thou
 * Almighty Fount" against "Come Thou Fount", while still accepting the trailing
 * "(Live)" and subtitle forms that a plan actually prints.
 */
const isTitleExtension = (shorter: string[], longer: string[]): boolean =>
  shorter.every((word, index) => longer[index] === word);

export type SongTitleComparison = {
  /** 0–1 closeness, for ranking and for offering near-misses to a person. */
  similarity: number;
  /** Whether these are the same song's name, safe to link without asking. */
  isConfident: boolean;
};

/**
 * How alike two titles are, and separately whether that's enough to link them.
 *
 * The two answers differ, and keeping them apart matters: "Rolled Away" is
 * plainly close to "Rolled the Sea Away" and worth offering, but must never be
 * linked automatically. A single number can't say both, so the measure stays
 * honest and the linking rules live in `isConfident`.
 *
 * Symmetric: swapping the arguments gives the same answer.
 */
export const compareSongTitles = (
  planningTitle: string,
  songName: string,
): SongTitleComparison => {
  const left = normalizeSongTitleForMatch(planningTitle);
  const right = normalizeSongTitleForMatch(songName);
  if (!left || !right) return { similarity: 0, isConfident: false };
  if (left === right) return { similarity: 1, isConfident: true };

  const leftWords = contentWords(left);
  const rightWords = contentWords(right);
  const shared = countShared(leftWords, rightWords);

  // Shorter and longer are picked by word count throughout, so the word sets
  // and the word sequences below always describe the same title.
  const [shorter, longer] =
    leftWords.size <= rightWords.size
      ? [{ words: leftWords, sequence: left }, { words: rightWords, sequence: right }]
      : [{ words: rightWords, sequence: right }, { words: leftWords, sequence: left }];
  const isExtension =
    shorter.words.size >= MIN_EXTENSION_WORDS &&
    longer.words.size - shorter.words.size <= MAX_EXTRA_WORDS &&
    isTitleExtension(shorter.sequence.split(" "), longer.sequence.split(" "));

  const overlap = (2 * shared) / (leftWords.size + rightWords.size);

  // Whole-string edit distance is only trustworthy for near-identical titles.
  // Loosening it would start merging real pairs like "Jesus Loves Me" and
  // "Jesus Loves You", which differ by one short word and nothing else.
  const distance = levenshteinDistance(left, right);
  const isTypo =
    distance <= MAX_TYPO_DISTANCE &&
    1 - distance / Math.max(left.length, right.length) >= MIN_TYPO_RATIO;

  const similarity = Math.max(
    overlap,
    isExtension ? EXTENSION_SIMILARITY : 0,
    isTypo ? TYPO_SIMILARITY : 0,
  );

  /**
   * One title holding every word of a shorter one scores high on overlap alone,
   * but bags of words can't tell "Come Thou Fount" plus a word from "Come Thou
   * Almighty Fount", or "Praise You" from "Owe You Praise". So containment only
   * counts toward linking when it is an ordered extension of the title.
   */
  const containsShorterTitle =
    shared === shorter.words.size && shorter.words.size !== longer.words.size;

  return {
    similarity,
    isConfident:
      similarity >= SONG_TITLE_MATCH_THRESHOLD &&
      (!containsShorterTitle || isExtension),
  };
};

/** 0–1 closeness on its own — for ranking and suggestions, never for linking. */
export const songTitleSimilarity = (
  planningTitle: string,
  songName: string,
): number => compareSongTitles(planningTitle, songName).similarity;

/** Whether two titles name the same song beyond doubt. */
export const isConfidentSongTitleMatch = (
  planningTitle: string,
  songName: string,
): boolean => compareSongTitles(planningTitle, songName).isConfident;
