import type { DBItem } from "../types";
import { commonWords } from "./generalUtils";
import { getBoxPlainText } from "./presentationText";

type SearchItem = { _id: string; name: string; type: string };
type Field = {
  text: string;
  words: string[];
  vocabulary: string[];
  normalized: string;
};
type PreparedItem = {
  title: Field;
  artist: Field;
  passages: Field[];
  vocabulary: string[];
};
const common = new Set(commonWords);
const collator = new Intl.Collator("en", { numeric: true });
type FieldMatch = { best: number[]; coverage: number; passageScore: number };
// Immutable Redux documents are weak keys: old revisions/churches can retire.
const preparedDocuments = new WeakMap<DBItem, PreparedItem>();
const libraryVocabularies = new WeakMap<readonly DBItem[], string[]>();
const wordPattern = () =>
  new RegExp("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*", "gu");
const normalizeWord = (word: string) => word.toLowerCase().replace(/['’]/g, "");
const wordsOf = (text: string) =>
  (text.match(wordPattern()) || []).map(normalizeWord);
const prepareField = (text: string, pool?: Map<string, string>): Field => {
  const words = wordsOf(text).map((word) => {
    const cached = pool?.get(word);
    if (cached) return cached;
    pool?.set(word, word);
    return word;
  });
  return {
    text,
    words,
    vocabulary: [...new Set(words)],
    normalized: ` ${words.join(" ")} `,
  };
};

const prepareDocument = (doc: DBItem): PreparedItem => {
  const cached = preparedDocuments.get(doc);
  if (cached) return cached;
  let texts: string[] = [];
  if (doc.type === "song") {
    texts = (doc.arrangements || []).flatMap((arrangement) =>
      (arrangement.formattedLyrics || []).map((lyric) => lyric.words),
    );
  } else if (doc.type === "free") {
    texts = (doc.slides || []).flatMap((slide) =>
      slide.boxes.map(getBoxPlainText),
    );
  }
  const pool = new Map<string, string>();
  const title = prepareField(doc.name, pool);
  const artist = prepareField(
    doc.type === "song" ? doc.songMetadata?.artistName || "" : "",
    pool,
  );
  const passages = [...new Set(texts.filter(Boolean))].map((text) =>
    prepareField(text, pool),
  );
  const vocabulary = [
    ...new Set(
      [title, artist, ...passages].flatMap((field) => field.vocabulary),
    ),
  ];
  const prepared = { title, artist, passages, vocabulary };
  preparedDocuments.set(doc, prepared);
  return prepared;
};

/** Prepare once when a library snapshot changes, outside the typing path. */
export const prepareItemSearchDocuments = (
  documents: readonly DBItem[],
): string[] => {
  const cached = libraryVocabularies.get(documents);
  if (cached) return cached;
  const vocabulary = [
    ...new Set(documents.flatMap((doc) => prepareDocument(doc).vocabulary)),
  ];
  libraryVocabularies.set(documents, vocabulary);
  return vocabulary;
};

/** Bounded edit distance with adjacent transpositions. Legacy Levenshtein and
 * automatic song identification deliberately keep their existing contracts. */
const withinEdits = (a: string, b: string, limit: number): boolean => {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previousPrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(limit + 1);
    row[0] = i;
    let minimum = row[0];
    for (
      let j = Math.max(1, i - limit);
      j <= Math.min(b.length, i + limit);
      j++
    ) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], previousPrevious[j - 2] + 1);
      }
      minimum = Math.min(minimum, row[j]);
    }
    if (minimum > limit) return false;
    previousPrevious = previous;
    previous = row;
  }
  return previous[b.length] <= limit;
};

const prepareQuery = (text: string, vocabulary?: readonly string[]) => {
  const phrase = wordsOf(text);
  const terms = [...new Set(phrase)];
  // Repeated query words do not create extra scoring evidence. Keep the
  // original phrase separately for exact-title and exact-phrase recognition.
  const phraseIndices = terms.map((_, index) => index);
  const normalized = phrase.join(" ");
  const weights = terms.map((term) => (common.has(term) ? 0.2 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // Each library word is compared once per query, not per lyric occurrence.
  const comparisons = new Map<string, number[]>();
  const qualities = (word: string): number[] => {
    const cached = comparisons.get(word);
    if (cached) return cached;
    const result = terms.map((term) => {
      if (word === term) return 1;
      if (term === phrase[phrase.length - 1] && word.includes(term)) {
        return word.startsWith(term) ? 0.85 : 0.4;
      }
      if (
        common.has(term) ||
        common.has(word) ||
        Math.min(term.length, word.length) < 4
      )
        return 0;
      const length = Math.max(term.length, word.length);
      const limit = Math.min(
        term.length >= 8 ? 2 : 1,
        Math.floor(length * 0.25),
      );
      return withinEdits(term, word, limit) ? 0.65 : 0;
    });
    comparisons.set(word, result);
    return result;
  };
  const candidates = vocabulary?.filter((word) =>
    qualities(word).some(Boolean),
  );
  return {
    phrase,
    phraseIndices,
    normalized,
    terms,
    weights,
    total,
    qualities,
    candidates,
    fields: new Map<string, FieldMatch>(),
  };
};
type Query = ReturnType<typeof prepareQuery>;
const coverage = (qualities: number[], query: Query) =>
  query.total
    ? qualities.reduce(
        (sum, quality, i) => sum + quality * query.weights[i],
        0,
      ) / query.total
    : 0;

const evaluateField = (
  field: Field,
  query: Query,
  candidates = field.vocabulary,
): FieldMatch => {
  const cached = query.fields.get(field.text);
  if (cached) return cached;
  const best = query.terms.map(() => 0);
  for (const word of candidates.length < field.vocabulary.length
    ? candidates
    : field.vocabulary) {
    if (!field.vocabulary.includes(word)) continue;
    const qualities = query.qualities(word);
    for (let i = 0; i < best.length; i++)
      best[i] = Math.max(best[i], qualities[i]);
  }
  const matched = best.filter(Boolean).length;
  if (!matched) {
    const result = { best, coverage: 0, passageScore: 0 };
    query.fields.set(field.text, result);
    return result;
  }
  const fieldCoverage = coverage(best, query);
  // Most live queries are one word, a phrase, or hit only one term in a
  // passage. These cases need no positional scan of the whole lyric section.
  if (matched === 1 || field.normalized.includes(` ${query.normalized} `)) {
    const phrase = query.phrase.length === 1 || matched > 1;
    const result = {
      best,
      coverage: fieldCoverage,
      passageScore:
        (phrase ? 60 * fieldCoverage : 0) +
        20 * fieldCoverage +
        (matched > 1 ? 10 * fieldCoverage : 0),
    };
    query.fields.set(field.text, result);
    return result;
  }
  // Linear phrase evaluation. Repetitions cannot exceed full query credit.
  let phraseCredit = 0;
  const { phraseIndices } = query;
  const previous = phraseIndices.map(() => 0);
  const previousPositions = query.terms.map(() => -1);
  let smallestWindow = field.words.length;
  let orderedProximity = 0;
  for (let position = 0; position < field.words.length; position++) {
    const qualities = query.qualities(field.words[position]);
    for (let j = phraseIndices.length - 1; j >= 0; j--) {
      const index = phraseIndices[j];
      const quality = qualities[index];
      if (!quality) {
        previous[j] = 0;
        continue;
      }
      const credit =
        quality * query.weights[index] + (j > 0 ? previous[j - 1] : 0);
      if (query.phrase.length === 1 || (j > 0 && previous[j - 1] > 0)) {
        phraseCredit = Math.max(
          phraseCredit,
          Math.min(1, credit / query.total),
        );
      }
      previous[j] = credit;
    }
    for (let i = 0; i < qualities.length; i++) {
      if (qualities[i]) previousPositions[i] = position;
    }
    let earliest = position;
    let complete = true;
    let orderedPairs = 0;
    let previousTermPosition = -1;
    for (let i = 0; i < best.length; i++) {
      if (!best[i]) continue;
      if (previousPositions[i] < 0) {
        complete = false;
        break;
      }
      earliest = Math.min(earliest, previousPositions[i]);
      if (
        previousTermPosition >= 0 &&
        previousPositions[i] > previousTermPosition
      )
        orderedPairs++;
      previousTermPosition = previousPositions[i];
    }
    if (complete) {
      const window = position - earliest + 1;
      smallestWindow = Math.min(smallestWindow, window);
      if (matched > 1)
        orderedProximity = Math.max(
          orderedProximity,
          (orderedPairs / (matched - 1)) * Math.min(1, matched / window),
        );
    }
  }
  const result = {
    best,
    coverage: fieldCoverage,
    passageScore:
      60 * phraseCredit +
      fieldCoverage *
        (20 * Math.min(1, matched / smallestWindow) + 10 * orderedProximity),
  };
  query.fields.set(field.text, result);
  return result;
};

export type SearchEnrichment = {
  titleMatch: number;
  artistMatch: number;
  matchRank: number;
  matchedWords: string;
  showWords: boolean;
};
const emptyEnrichment: SearchEnrichment = {
  titleMatch: 0,
  artistMatch: 0,
  matchRank: 0,
  matchedWords: "",
  showWords: false,
};
const enrich = (
  item: SearchItem,
  doc: DBItem | undefined,
  query: Query,
): SearchEnrichment => {
  if (!query.terms.length) return emptyEnrichment;
  const prepared = doc ? prepareDocument(doc) : undefined;
  // The indexed title can be available before (or newer than) the full doc.
  const title =
    prepared?.title.text === item.name
      ? prepared.title
      : prepareField(item.name);
  const candidates =
    query.candidates ||
    prepared?.vocabulary.filter((word) => query.qualities(word).some(Boolean));
  const titleResult = evaluateField(title, query);
  const artistResult = evaluateField(
    prepared?.artist || prepareField(""),
    query,
    candidates,
  );
  const overall = titleResult.best.map((quality, i) =>
    Math.max(quality, artistResult.best[i]),
  );
  let bestPassage = "";
  let bestPassageScore = 0;
  let contentBonus = 0;
  for (const passage of prepared?.passages || []) {
    const result = evaluateField(passage, query, candidates);
    result.best.forEach((quality, i) => {
      overall[i] = Math.max(overall[i], quality);
    });
    const score = 100 * result.coverage + result.passageScore;
    if (score > bestPassageScore) {
      bestPassageScore = score;
      bestPassage = passage.text;
      contentBonus = result.passageScore;
    }
  }
  const meaningfulIndices = query.terms
    .map((term, i) => (!common.has(term) ? i : -1))
    .filter((i) => i >= 0);
  const relevantIndices = meaningfulIndices.length
    ? meaningfulIndices
    : query.terms.map((_, i) => i);
  const strong = relevantIndices.some(
    (i) => overall[i] > 0.65 || overall[i] === 0.4,
  );
  const fuzzyCoverage = relevantIndices.reduce((sum, i) => sum + overall[i], 0);
  const eligible = strong || fuzzyCoverage >= relevantIndices.length / 2;
  const exactTitle = title.words.join(" ") === query.normalized;
  const prefixTitle = title.words.join(" ").startsWith(query.normalized);
  const completeTitle =
    title.words.length === query.terms.length &&
    titleResult.best.every((quality) => quality === 1);
  const titleScore =
    25 * titleResult.coverage +
    titleResult.passageScore +
    (prefixTitle ? 30 : 0) +
    (completeTitle ? 30 : 0);
  const matchRank = eligible
    ? (exactTitle ? 1000 : 0) +
      100 * coverage(overall, query) +
      Math.max(
        titleScore,
        contentBonus,
        artistResult.passageScore + 12 * artistResult.coverage,
      )
    : 0;
  return {
    titleMatch: titleResult.coverage,
    artistMatch: artistResult.coverage,
    matchRank,
    matchedWords: bestPassage,
    showWords:
      Boolean(bestPassage) &&
      bestPassageScore > 100 * titleResult.coverage + titleScore,
  };
};

type Rank = {
  name: string;
  matchRank: number;
  artist?: string;
  type?: string;
  id?: string;
};
export const compareItemSearchRanks = (a: Rank, b: Rank): number =>
  b.matchRank - a.matchRank ||
  collator.compare(a.name, b.name) ||
  collator.compare(a.artist || "", b.artist || "") ||
  (a.type || "").localeCompare(b.type || "") ||
  (a.id || "").localeCompare(b.id || "");

/** Category filtering never changes relevance. No I/O during search. */
export const filterAndSortItemsForSearch = <T extends SearchItem>(
  items: readonly T[],
  documents: readonly DBItem[],
  searchValue: string,
  type = "all",
): (T & SearchEnrichment)[] => {
  const query = prepareQuery(
    searchValue,
    wordsOf(searchValue).length
      ? prepareItemSearchDocuments(documents)
      : undefined,
  );
  const docs = new Map(documents.map((doc) => [doc._id, doc]));
  return items
    .filter(
      (item) =>
        ["song", "free", "timer"].includes(item.type) &&
        (type === "all" || item.type === type),
    )
    .map((item) => {
      const candidate = docs.get(item._id);
      const doc = candidate?.type === item.type ? candidate : undefined;
      return { ...item, ...enrich(item, doc, query) };
    })
    .filter((item) => !query.terms.length || item.matchRank > 0)
    .sort((a, b) =>
      compareItemSearchRanks(
        {
          name: a.name,
          type: a.type,
          matchRank: a.matchRank,
          id: a._id,
          artist: docs.get(a._id)?.songMetadata?.artistName?.trim(),
        },
        {
          name: b.name,
          type: b.type,
          matchRank: b.matchRank,
          id: b._id,
          artist: docs.get(b._id)?.songMetadata?.artistName?.trim(),
        },
      ),
    );
};

export const computeSongSearchEnrichment = (
  song: DBItem,
  searchValue: string,
): SearchEnrichment => enrich(song, song, prepareQuery(searchValue));

export type SongSearchRow = SearchEnrichment & { song: DBItem };
export const filterAndSortSongsForSearchWithEnrichment = (
  songs: DBItem[],
  searchValue: string,
): SongSearchRow[] => {
  const byId = new Map(songs.map((song) => [song._id, song]));
  return filterAndSortItemsForSearch(songs, songs, searchValue, "song").map(
    (row) => ({
      song: byId.get(row._id)!,
      titleMatch: row.titleMatch,
      artistMatch: row.artistMatch,
      matchRank: row.matchRank,
      matchedWords: row.matchedWords,
      showWords: row.showWords,
    }),
  );
};
export const filterAndSortSongsForSearch = (
  songs: DBItem[],
  searchValue: string,
): DBItem[] =>
  filterAndSortSongsForSearchWithEnrichment(songs, searchValue).map(
    (row) => row.song,
  );

/** Original offsets use exactly the retrieval token rules, including typos. */
export const getSearchHighlightRanges = (text: string, searchValue: string) => {
  const query = prepareQuery(searchValue);
  return [...text.matchAll(wordPattern())].flatMap((match) => {
    const quality = Math.max(0, ...query.qualities(normalizeWord(match[0])));
    return quality
      ? [{ start: match.index!, end: match.index! + match[0].length, quality }]
      : [];
  });
};
