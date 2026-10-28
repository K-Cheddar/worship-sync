import diff from "fast-diff";
import type {
  Arrangment, DBItem, FormattedLyrics, SongV2ArrangementDocument,
  SongV2RootDocument, SongV2SlideDocument,
} from "../types";

export type SongV2RevisionDocument =
  | SongV2RootDocument
  | SongV2ArrangementDocument
  | SongV2SlideDocument;

export type SongV2ComparisonSide = {
  arrangements?: readonly SongV2ArrangementDocument[];
  slides?: readonly SongV2SlideDocument[];
  missingArrangementIds?: readonly string[];
  missingSlideIds?: readonly string[];
};

export type SongV2ConflictComparisonContext = {
  current?: SongV2ComparisonSide;
  alternative?: SongV2ComparisonSide;
};

export type SongV2DiffTextKind = "unchanged" | "added" | "removed";
export type SongV2DiffTextSegment = { kind: SongV2DiffTextKind; text: string };
export type SongV2DiffTextLine = { segments: SongV2DiffTextSegment[]; changed: boolean };
export type SongV2DiffExcerptLine = SongV2DiffTextLine | { kind: "ellipsis" };
export type SongV2DiffTextSide = {
  excerpt: SongV2DiffExcerptLine[];
  full: SongV2DiffTextSegment[];
  hasText: boolean;
  omittedContext: boolean;
};

export type SongV2LyricSectionDiff = {
  id: string;
  name: string;
  status: "changed" | "added" | "removed";
  summary: string;
  current: SongV2DiffTextSide;
  alternative: SongV2DiffTextSide;
};

export type SongV2ConflictChange = {
  category: "structure" | "formatting" | "media" | "other";
  summary: string;
};

export type SongV2ConflictDiffModel = {
  documentKind: "song" | "arrangement" | "slide";
  documentLabel: string;
  identicalContent: boolean;
  lyricsIdentical: boolean | null;
  summary: string;
  sections: SongV2LyricSectionDiff[];
  changes: SongV2ConflictChange[];
};

type NamedItem = { id?: string; name: string; type?: string };
type EntityMatch<T> = {
  left: T;
  right: T;
  leftIndex: number;
  rightIndex: number;
  token: string;
  matchedBy: "id" | "content" | "name";
};
type EntityComparison<T> = {
  matches: EntityMatch<T>[];
  added: Array<{ item: T; index: number }>;
  removed: Array<{ item: T; index: number }>;
  moved: EntityMatch<T>[];
};

const AUDIT_FIELDS = new Set([
  "_rev", "_revisions", "_conflicts", "createdAt", "createdBy", "updatedAt", "updatedBy",
]);
const SLIDE_IDENTITY_FIELDS = new Set(["_id", "_rev", "_revisions", "_conflicts", "id", "slideIndex", ...AUDIT_FIELDS]);

const appendSegment = (
  segments: SongV2DiffTextSegment[],
  kind: SongV2DiffTextKind,
  text: string,
) => {
  if (!text) return;
  const previous = segments[segments.length - 1];
  if (previous?.kind === kind) previous.text += text;
  else segments.push({ kind, text });
};

const sideSegments = (
  operations: [number, string][],
  side: "current" | "alternative",
): SongV2DiffTextSegment[] => {
  const segments: SongV2DiffTextSegment[] = [];
  for (const [operation, text] of operations) {
    if (operation === 0) appendSegment(segments, "unchanged", text);
    else if (side === "current" && operation === -1) appendSegment(segments, "removed", text);
    else if (side === "alternative" && operation === 1) appendSegment(segments, "added", text);
  }
  return segments;
};

const linesFromSegments = (segments: SongV2DiffTextSegment[]): SongV2DiffTextLine[] => {
  const lines: SongV2DiffTextLine[] = [];
  let lineSegments: SongV2DiffTextSegment[] = [];
  let changed = false;
  for (const segment of segments) {
    for (const character of segment.text) {
      appendSegment(lineSegments, segment.kind, character);
      if (segment.kind !== "unchanged") changed = true;
      if (character === "\n") {
        lines.push({ segments: lineSegments, changed });
        lineSegments = [];
        changed = false;
      }
    }
  }
  if (lineSegments.length) lines.push({ segments: lineSegments, changed });
  return lines;
};

const excerptLines = (lines: SongV2DiffTextLine[]): {
  excerpt: SongV2DiffExcerptLine[];
  omittedContext: boolean;
} => {
  const changedIndexes = lines.flatMap((line, index) => line.changed ? [index] : []);
  if (!changedIndexes.length) return { excerpt: lines, omittedContext: false };
  const included = new Set<number>();
  for (const index of changedIndexes) {
    for (let context = Math.max(0, index - 1); context <= Math.min(lines.length - 1, index + 1); context += 1) {
      included.add(context);
    }
  }
  const excerpt: SongV2DiffExcerptLine[] = [];
  let omittedContext = false;
  let previous = -1;
  for (const index of [...included].sort((left, right) => left - right)) {
    if (previous >= 0 && index > previous + 1) {
      excerpt.push({ kind: "ellipsis" });
      omittedContext = true;
    }
    excerpt.push(lines[index]);
    previous = index;
  }
  return { excerpt, omittedContext };
};

const buildTextSide = (
  operations: [number, string][],
  side: "current" | "alternative",
): SongV2DiffTextSide => {
  const full = sideSegments(operations, side);
  const context = excerptLines(linesFromSegments(full));
  return { excerpt: context.excerpt, full, hasText: full.length > 0, omittedContext: context.omittedContext };
};

const changedLineCount = (side: SongV2DiffTextSide) =>
  side.excerpt.reduce((count, line) => count + ("segments" in line && line.changed ? 1 : 0), 0);
const plural = (count: number, singular: string, multiple = `${singular}s`) =>
  `${count} ${count === 1 ? singular : multiple}`;

const canonical = (value: unknown, ignored = AUDIT_FIELDS): unknown => {
  if (Array.isArray(value)) return value.map(child => canonical(child, ignored));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, child]) => child !== undefined && !ignored.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child, ignored)]));
  }
  return value;
};
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const change = (category: SongV2ConflictChange["category"], summary: string): SongV2ConflictChange => ({ category, summary });

const textFromBox = (box: SongV2SlideDocument["boxes"][number]): string =>
  box.textDocument?.blocks?.map(block => block.spans.map(span => span.text).join("")).join("\n") ?? box.words ?? "";

const formattingOnly = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const document = value as { blocks?: Array<{ align?: string; spans?: Array<Record<string, unknown>> }> };
  return {
    blocks: (document.blocks ?? []).map(block => ({
      align: block.align,
      spans: (block.spans ?? []).map(span => Object.fromEntries(Object.entries(span).filter(([key]) => key !== "text"))),
    })),
  };
};

const occurrenceLabels = <T extends { name: string }>(items: readonly T[]) => {
  const totals = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const item of items) totals.set(item.name, (totals.get(item.name) ?? 0) + 1);
  return items.map(item => {
    const occurrence = (positions.get(item.name) ?? 0) + 1;
    positions.set(item.name, occurrence);
    return (totals.get(item.name) ?? 0) > 1 ? `${item.name} (${occurrence})` : item.name;
  });
};

const matchEntities = <T extends object>(
  left: readonly T[],
  right: readonly T[],
  options: {
    stableKey?: (item: T, index: number) => string | undefined;
    equivalentKey?: (item: T, index: number) => string | undefined;
    logicalKey?: (item: T, index: number) => string | undefined;
  } = {},
): EntityComparison<T> => {
  const matches: EntityMatch<T>[] = [];
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  let pairIndex = 0;

  const pairByKey = (getKey: (item: T, index: number) => string | undefined, matchedBy: EntityMatch<T>["matchedBy"]) => {
    const rightIndexes = new Map<string, number[]>();
    right.forEach((item, index) => {
      if (usedRight.has(index)) return;
      const key = getKey(item, index);
      if (key === undefined) return;
      rightIndexes.set(key, [...(rightIndexes.get(key) ?? []), index]);
    });
    left.forEach((item, leftIndex) => {
      if (usedLeft.has(leftIndex)) return;
      const key = getKey(item, leftIndex);
      const rightIndex = key === undefined ? undefined : rightIndexes.get(key)?.shift();
      if (rightIndex === undefined || usedRight.has(rightIndex)) return;
      usedLeft.add(leftIndex);
      usedRight.add(rightIndex);
      matches.push({ left: item, right: right[rightIndex], leftIndex, rightIndex, token: `pair-${pairIndex++}`, matchedBy });
    });
  };

  if (options.stableKey) pairByKey((item, index) => options.stableKey!(item, index), "id");
  if (options.equivalentKey) pairByKey((item, index) => options.equivalentKey!(item, index), "content");
  if (options.logicalKey) pairByKey((item, index) => options.logicalKey!(item, index), "name");

  const leftTokens = new Map(matches.map(match => [match.leftIndex, match.token]));
  const rightTokens = new Map(matches.map(match => [match.rightIndex, match.token]));
  left.forEach((_item, index) => { if (!leftTokens.has(index)) leftTokens.set(index, `left-${index}`); });
  right.forEach((_item, index) => { if (!rightTokens.has(index)) rightTokens.set(index, `right-${index}`); });
  const sharedTokens = longestCommonSubsequence(
    left.map((_item, index) => leftTokens.get(index)!),
    right.map((_item, index) => rightTokens.get(index)!),
  );
  const inOrder = new Set(sharedTokens);
  const movedTokens = new Set(matches.filter(match => !inOrder.has(match.token)).map(match => match.token));
  for (let leftIndex = 0; leftIndex < matches.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < matches.length; rightIndex += 1) {
      const leftMatch = matches[leftIndex];
      const rightMatch = matches[rightIndex];
      const currentOrder = Math.sign(leftMatch.leftIndex - rightMatch.leftIndex);
      const alternativeOrder = Math.sign(leftMatch.rightIndex - rightMatch.rightIndex);
      if (currentOrder !== alternativeOrder) {
        movedTokens.add(leftMatch.token);
        movedTokens.add(rightMatch.token);
      }
    }
  }
  return {
    matches,
    added: right.flatMap((item, index) => usedRight.has(index) ? [] : [{ item, index }]),
    removed: left.flatMap((item, index) => usedLeft.has(index) ? [] : [{ item, index }]),
    moved: matches.filter(match => movedTokens.has(match.token)),
  };
};

const longestCommonSubsequence = (left: string[], right: string[]) => {
  const lengths = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i] === right[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { result.push(left[i]); i += 1; j += 1; }
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1;
    else j += 1;
  }
  return result;
};

const compareNamedOrder = <T extends NamedItem>(
  current: readonly T[],
  alternative: readonly T[],
  label: string,
  changes: SongV2ConflictChange[],
) => {
  const comparison = matchEntities(current, alternative, {
    stableKey: item => item.id || undefined,
    logicalKey: item => item.id ? undefined : `${item.type ?? ""}:${item.name}`,
  });
  const identities = (items: readonly T[]) => {
    const occurrences = new Map<string, number>();
    return items.map(item => {
      const occurrence = (occurrences.get(item.name) ?? 0) + 1;
      occurrences.set(item.name, occurrence);
      return item.id ? `id:${item.id}` : `name:${item.type ?? ""}:${item.name}:${occurrence}`;
    });
  };
  const currentIds = identities(current);
  const alternativeIds = identities(alternative);
  const namesByIdentity = new Map<string, string>();
  current.forEach((item, index) => namesByIdentity.set(currentIds[index], item.name));
  alternative.forEach((item, index) => {
    if (!namesByIdentity.has(alternativeIds[index])) namesByIdentity.set(alternativeIds[index], item.name);
  });
  const totals = new Map<string, number>();
  for (const name of namesByIdentity.values()) totals.set(name, (totals.get(name) ?? 0) + 1);
  const counters = new Map<string, number>();
  const labelsByIdentity = new Map<string, string>();
  for (const [identity, name] of namesByIdentity) {
    const occurrence = (counters.get(name) ?? 0) + 1;
    counters.set(name, occurrence);
    labelsByIdentity.set(identity, (totals.get(name) ?? 0) > 1 ? `${name} (${occurrence})` : name);
  }
  const currentLabels = currentIds.map(id => labelsByIdentity.get(id) ?? "Section");
  const alternativeLabels = alternativeIds.map(id => labelsByIdentity.get(id) ?? "Section");
  for (const { index } of comparison.removed) {
    changes.push(change("structure", `${label} ${quote(currentLabels[index])} removed from position ${index + 1}.`));
  }
  for (const { index } of comparison.added) {
    changes.push(change("structure", `${label} ${quote(alternativeLabels[index])} added at position ${index + 1}.`));
  }
  for (const move of comparison.moved) {
    const name = alternativeLabels[move.rightIndex];
    changes.push(change("structure", `${label} ${quote(name)} moved from position ${move.leftIndex + 1} to position ${move.rightIndex + 1}.`));
  }
};

const quote = (value: string) => `“${value}”`;
const sideArrangementMap = (side?: SongV2ComparisonSide) => new Map(
  (side?.arrangements ?? []).map(arrangement => [arrangement.arrangementId, arrangement]),
);
const sideSlideMap = (side?: SongV2ComparisonSide) => new Map(
  (side?.slides ?? []).map(slide => [`${slide.arrangementId}:${slide.id}`, slide]),
);

const rootLyricsSignature = (root: SongV2RootDocument, side?: SongV2ComparisonSide): string[] | null => {
  const byId = sideArrangementMap(side);
  const signatures: string[] = [];
  for (const arrangementId of root.arrangementIds) {
    const arrangement = byId.get(arrangementId);
    if (!arrangement) return null;
    signatures.push(JSON.stringify(arrangement.formattedLyrics.map(({ name, type, words }) => [name, type, words]).sort((a, b) =>
      `${a[0]}|${a[1]}|${a[2]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}`),
    )));
  }
  return signatures.sort();
};

const rootChanges = (
  current: SongV2RootDocument,
  alternative: SongV2RootDocument,
  context: SongV2ConflictComparisonContext,
): { changes: SongV2ConflictChange[]; lyricsIdentical: boolean | null } => {
  const changes: SongV2ConflictChange[] = [];
  if (current.name !== alternative.name) changes.push(change("structure", `Song title: ${current.name} → ${alternative.name}.`));
  if (!!current.deletedAt !== !!alternative.deletedAt) {
    changes.push(change("structure", alternative.deletedAt ? "Song removed from the library." : "Song restored to the library."));
  }
  const currentArrangements = sideArrangementMap(context.current);
  const alternativeArrangements = sideArrangementMap(context.alternative);
  compareNamedOrder(
    current.arrangementIds.map(id => ({ id, name: currentArrangements.get(id)?.name ?? "Arrangement" })),
    alternative.arrangementIds.map(id => ({ id, name: alternativeArrangements.get(id)?.name ?? "Arrangement" })),
    "Arrangement",
    changes,
  );
  if (current.selectedArrangement !== alternative.selectedArrangement) {
    const previous = current.arrangementIds[current.selectedArrangement];
    const next = alternative.arrangementIds[alternative.selectedArrangement];
    changes.push(change("structure", `Starting arrangement: ${currentArrangements.get(previous ?? "")?.name ?? "previous selection"} → ${alternativeArrangements.get(next ?? "")?.name ?? "new selection"}.`));
  }
  if (current.shouldSkipTitle !== alternative.shouldSkipTitle) {
    changes.push(change("formatting", `Title slide: ${current.shouldSkipTitle ? "skipped" : "shown"} → ${alternative.shouldSkipTitle ? "skipped" : "shown"}.`));
  }
  if (!same(current.background, alternative.background)) changes.push(change("media", "Song background changed."));
  if (!same(current.songAudio, alternative.songAudio)) changes.push(change("media", "Song audio changed."));
  if (!same(current.songMetadata, alternative.songMetadata)) changes.push(change("other", "Song details changed."));
  if (!same(current.songLinks, alternative.songLinks)) changes.push(change("other", "Song links changed."));
  if (!same(current.shouldSendTo, alternative.shouldSendTo)) changes.push(change("other", "Output settings changed."));
  const known = new Set([
    "_id", "docType", "songId", "songSchemaVersion", "name", "deletedAt", "selectedArrangement",
    "arrangementIds", "shouldSkipTitle", "background", "songAudio", "songMetadata", "songLinks", "shouldSendTo",
  ]);
  if (Object.keys(current).some(key => !known.has(key) && !AUDIT_FIELDS.has(key)) ||
    Object.keys(alternative).some(key => !known.has(key) && !AUDIT_FIELDS.has(key))) {
    const extraFields = [...new Set([...Object.keys(current), ...Object.keys(alternative)])]
      .filter(key => !known.has(key) && !AUDIT_FIELDS.has(key));
    if (extraFields.some(key => !same((current as unknown as Record<string, unknown>)[key], (alternative as unknown as Record<string, unknown>)[key]))) {
      changes.push(change("other", "Other song settings changed."));
    }
  }
  const left = rootLyricsSignature(current, context.current);
  const right = rootLyricsSignature(alternative, context.alternative);
  return { changes, lyricsIdentical: left && right ? same(left, right) : null };
};

const matchedSections = (current: readonly FormattedLyrics[], alternative: readonly FormattedLyrics[]) => {
  const currentWithIds = current.filter(section => section.id);
  const alternativeWithIds = alternative.filter(section => section.id);
  const sharedIds = new Set(currentWithIds.map(section => section.id).filter(id => alternativeWithIds.some(section => section.id === id)));
  const usedAlternative = new Set<number>();
  const pairs: Array<{ current?: FormattedLyrics; alternative?: FormattedLyrics }> = [];

  current.forEach(section => {
    const id = section.id && sharedIds.has(section.id) ? section.id : undefined;
    const alternativeIndex = id
      ? alternative.findIndex((candidate, index) => !usedAlternative.has(index) && candidate.id === id)
      : undefined;
    if (alternativeIndex !== undefined && alternativeIndex >= 0) {
      usedAlternative.add(alternativeIndex);
      pairs.push({ current: section, alternative: alternative[alternativeIndex] });
      return;
    }
    if (!section.id) {
      const fallbackIndex = alternative.findIndex((candidate, index) => !usedAlternative.has(index) && !candidate.id && candidate.name === section.name);
      if (fallbackIndex >= 0) {
        usedAlternative.add(fallbackIndex);
        pairs.push({ current: section, alternative: alternative[fallbackIndex] });
        return;
      }
    }
    pairs.push({ current: section });
  });

  alternative.forEach((section, index) => {
    if (!usedAlternative.has(index)) pairs.push({ alternative: section });
  });

  return pairs;
};

const sectionNames = (current: readonly FormattedLyrics[], alternative: readonly FormattedLyrics[]) => {
  const namesByIdentity = new Map<string, string>();
  const makeIdentity = (sections: readonly FormattedLyrics[]) => {
    const idOccurrences = new Map<string, number>();
    const nameOccurrences = new Map<string, number>();
    return sections.map(section => {
      const occurrence = section.id
        ? (idOccurrences.set(section.id, (idOccurrences.get(section.id) ?? 0) + 1), idOccurrences.get(section.id)!)
        : (nameOccurrences.set(section.name, (nameOccurrences.get(section.name) ?? 0) + 1), nameOccurrences.get(section.name)!);
      const identity = section.id ? `id:${section.id}:${occurrence}` : `name:${section.name}:${occurrence}`;
      if (!namesByIdentity.has(identity)) {
        namesByIdentity.set(identity, section.name);
      }
      return identity;
    });
  };
  const currentIds = makeIdentity(current);
  const alternativeIds = makeIdentity(alternative);
  const totals = new Map<string, number>();
  for (const name of namesByIdentity.values()) totals.set(name, (totals.get(name) ?? 0) + 1);
  const counters = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const [identity, name] of namesByIdentity) {
    const occurrence = (counters.get(name) ?? 0) + 1;
    counters.set(name, occurrence);
    labels.set(identity, (totals.get(name) ?? 0) > 1 ? `${name} (${occurrence})` : name);
  }
  return { current: currentIds.map(id => labels.get(id) ?? "Section"), alternative: alternativeIds.map(id => labels.get(id) ?? "Section") };
};

const sectionDiffs = (
  current: SongV2ArrangementDocument,
  alternative: SongV2ArrangementDocument,
): { sections: SongV2LyricSectionDiff[]; lyricsIdentical: boolean } => {
  const pairs = matchedSections(current.formattedLyrics, alternative.formattedLyrics);
  const names = sectionNames(current.formattedLyrics, alternative.formattedLyrics);
  const sections = pairs.flatMap((pair): SongV2LyricSectionDiff[] => {
    const left = pair.current;
    const right = pair.alternative;
    if (!left || !right) {
      const section = left ?? right!;
      const status = left ? "removed" : "added";
      const index = left ? current.formattedLyrics.indexOf(left) : alternative.formattedLyrics.indexOf(section);
      const operation: [number, string][] = section.words ? [[status === "removed" ? -1 : 1, section.words]] : [];
      return [{
        id: section.id,
        name: left ? names.current[index] : names.alternative[index],
        status,
        summary: status === "removed" ? "Section removed" : "Section added",
        current: buildTextSide(operation, "current"),
        alternative: buildTextSide(operation, "alternative"),
      }];
    }
    const operations = diff(left.words, right.words) as [number, string][];
    if (left.words === right.words) return [];
    const currentText = buildTextSide(operations, "current");
    const alternativeText = buildTextSide(operations, "alternative");
    const lines = Math.max(changedLineCount(currentText), changedLineCount(alternativeText), 1);
    return [{
      id: right.id || left.id,
      name: names.alternative[alternative.formattedLyrics.indexOf(right)] ?? right.name,
      status: "changed",
      summary: `${plural(lines, "line")} changed`,
      current: currentText,
      alternative: alternativeText,
    }];
  });
  const lyricSignature = (lyrics: readonly FormattedLyrics[]) => lyrics.map(section => section.words).sort();
  const lyricsIdentical = same(lyricSignature(current.formattedLyrics), lyricSignature(alternative.formattedLyrics));
  return { sections, lyricsIdentical };
};

const textForSlide = (slide: SongV2SlideDocument) => (slide.boxes ?? []).map(textFromBox).filter(Boolean).join("\n");
const comparableSlide = (slide: SongV2SlideDocument) => canonical(slide, SLIDE_IDENTITY_FIELDS);
const slideContentKey = (slide: SongV2SlideDocument) => JSON.stringify(comparableSlide(slide));
const slideLogicalKey = (slide: SongV2SlideDocument) => `${slide.type}:${slide.name}`;

const slideIndex = (slide: SongV2SlideDocument, side?: SongV2ComparisonSide) => {
  const arrangement = (side?.arrangements ?? []).find(item => item.arrangementId === slide.arrangementId);
  const index = arrangement?.slideIds.indexOf(slide.id) ?? -1;
  return index >= 0 ? index + 1 : undefined;
};
const positionLabel = (name: string, position?: number) => position ? `${quote(name)} (position ${position})` : quote(name);

const normalizedText = (text: string) => text.replace(/\s+/gu, " ").trim();
const removalExplanation = (
  entry: { id: string; name: string; document?: SongV2SlideDocument; position: number },
  alternativeEntries: Array<{ id: string; name: string; document?: SongV2SlideDocument; position: number }>,
  alternativeSide?: SongV2ComparisonSide,
) => {
  const previous = positionLabel(entry.name, entry.position);
  if (!entry.document) return `Could not verify ${previous}; the slide may have been removed or regenerated.`;
  const text = normalizedText(textForSlide(entry.document));
  if (!text) {
    if (entry.document.type === "Blank") return `Blank slide ${previous} removed.`;
    const hasMissing = (alternativeSide?.missingSlideIds ?? []).length > 0 || alternativeEntries.some(item => !item.document);
    return hasMissing
      ? `Could not verify whether the content from ${previous} remains; some slides could not be loaded.`
      : `Slide ${previous} removed; its non-lyric content is not present on the remaining slides.`;
  }
  const combined = normalizedText(alternativeEntries.map(item => item.document ? textForSlide(item.document) : "").join("\n"));
  if (combined.includes(text)) {
    const pages = alternativeEntries.filter(item => item.document && normalizedText(textForSlide(item.document))
      .split(" ").some(word => word.length > 3 && text.includes(word)));
    const labels = pages.length ? [...new Set(pages.map(page => positionLabel(page.name, page.position)))] : [];
    return labels.length
      ? `Slide ${previous} no longer has its own reference; its lyrics remain on ${labels.join(", ")}. This may be a reflow.`
      : `Slide ${previous} no longer has its own reference; its lyrics remain elsewhere. This may be a reflow.`;
  }
  const missing = (alternativeSide?.missingSlideIds ?? []).length > 0 || alternativeEntries.some(item => !item.document);
  return missing
    ? `Could not verify whether the lyrics from ${previous} remain; some slides could not be loaded.`
    : `Slide ${previous} removed; its lyrics are not present on the remaining slides.`;
};

const compareSlideReferences = (
  current: SongV2ArrangementDocument,
  alternative: SongV2ArrangementDocument,
  context: SongV2ConflictComparisonContext,
) => {
  const currentSlides = sideSlideMap(context.current);
  const alternativeSlides = sideSlideMap(context.alternative);
  const left = current.slideIds.map((id, index) => ({
    id, index, document: currentSlides.get(`${current.arrangementId}:${id}`),
  }));
  const right = alternative.slideIds.map((id, index) => ({
    id, index, document: alternativeSlides.get(`${alternative.arrangementId}:${id}`),
  }));
  const leftNames = occurrenceLabels(left.map(item => ({ name: item.document?.name ?? "Slide" })));
  const rightNames = occurrenceLabels(right.map(item => ({ name: item.document?.name ?? "Slide" })));
  const toMatchable = (entries: typeof left, labels: string[]) => entries.map((item, index) => ({
    ...item,
    name: labels[index],
    type: item.document?.type ?? "unknown",
  }));
  const leftItems = toMatchable(left, leftNames);
  const rightItems = toMatchable(right, rightNames);
  const comparison = matchEntities(leftItems, rightItems, {
    stableKey: item => item.id,
    equivalentKey: item => item.document ? slideContentKey(item.document) : undefined,
    logicalKey: item => item.document ? slideLogicalKey(item.document) : undefined,
  });
  const leftEntries = left.map((item, index) => ({
    id: item.id, name: leftNames[index], document: item.document, position: index + 1,
  }));
  const rightEntries = right.map((item, index) => ({
    id: item.id, name: rightNames[index], document: item.document, position: index + 1,
  }));
  return { comparison, leftEntries, rightEntries };
};

const formatValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "not set";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "string") return value.replace(/^./, character => character.toUpperCase());
  return String(value);
};

const boxLabel = (box: SongV2SlideDocument["boxes"][number], index: number, total: number) => {
  const label = box.label || (box.words || box.textDocument ? "Text box" : "Content box");
  return total > 1 ? `${label} ${index + 1}` : label;
};

const slideChanges = (
  current: SongV2SlideDocument,
  alternative: SongV2SlideDocument,
  context: SongV2ConflictComparisonContext,
): { sections: SongV2LyricSectionDiff[]; changes: SongV2ConflictChange[] } => {
  const changes: SongV2ConflictChange[] = [];
  const sections: SongV2LyricSectionDiff[] = [];
  const alternativePosition = slideIndex(alternative, context.alternative);
  const alternativeLabel = positionLabel(alternative.name, alternativePosition);
  if (current.name !== alternative.name) changes.push(change("structure", `Slide name: ${current.name} → ${alternative.name}.`));
  if (current.type !== alternative.type) changes.push(change("structure", `Slide type: ${current.type} → ${alternative.type}.`));
  if (current.overflow !== alternative.overflow) changes.push(change("formatting", `Text overflow: ${formatValue(current.overflow)} → ${formatValue(alternative.overflow)}.`));
  if (!same(current.mediaSource, alternative.mediaSource)) changes.push(change("media", `Media assignment changed on ${alternativeLabel}.`));
  if (current.videoBackgroundSendMode !== alternative.videoBackgroundSendMode) {
    changes.push(change("media", `Video background mode: ${formatValue(current.videoBackgroundSendMode)} → ${formatValue(alternative.videoBackgroundSendMode)}.`));
  }
  if (!same(current.formattedTextDisplayInfo, alternative.formattedTextDisplayInfo)) {
    changes.push(change("formatting", `Text display formatting changed on ${alternativeLabel}.`));
  }

  const boxes = matchEntities(current.boxes ?? [], alternative.boxes ?? [], {
    stableKey: box => box.id || undefined,
    equivalentKey: box => JSON.stringify(canonical({ ...box, id: undefined }, new Set(["id", "slideIndex", ...AUDIT_FIELDS]))),
    logicalKey: (_box, index) => String(index),
  });
  for (const { item, index } of boxes.removed) {
    const text = textFromBox(item);
    const operation: [number, string][] = text ? [[-1, text]] : [];
    sections.push({
      id: item.id ?? `removed-box-${index}`,
      name: boxLabel(item, index, current.boxes.length),
      status: "removed",
      summary: "Slide text removed",
      current: buildTextSide(operation, "current"),
      alternative: buildTextSide(operation, "alternative"),
    });
  }
  for (const { item, index } of boxes.added) {
    const text = textFromBox(item);
    const operation: [number, string][] = text ? [[1, text]] : [];
    sections.push({
      id: item.id ?? `added-box-${index}`,
      name: boxLabel(item, index, alternative.boxes.length),
      status: "added",
      summary: "Slide text added",
      current: buildTextSide(operation, "current"),
      alternative: buildTextSide(operation, "alternative"),
    });
  }
  for (const match of boxes.matches) {
    const left = match.left;
    const right = match.right;
    const oldText = textFromBox(left);
    const newText = textFromBox(right);
    if (oldText !== newText) {
      const operations = diff(oldText, newText) as [number, string][];
      const currentText = buildTextSide(operations, "current");
      const alternativeText = buildTextSide(operations, "alternative");
      const lines = Math.max(changedLineCount(currentText), changedLineCount(alternativeText), 1);
      sections.push({
        id: right.id ?? left.id ?? `box-${match.rightIndex}`,
        name: boxLabel(right, match.rightIndex, alternative.boxes.length),
        status: "changed",
        summary: `${plural(lines, "line")} changed`,
        current: currentText,
        alternative: alternativeText,
      });
    }
    const label = boxLabel(right, match.rightIndex, alternative.boxes.length);
    if (left.fontSize !== right.fontSize) changes.push(change("formatting", `${label} font size: ${formatValue(left.fontSize)} → ${formatValue(right.fontSize)}.`));
    if (left.align !== right.align) changes.push(change("formatting", `${label} text alignment: ${formatValue(left.align)} → ${formatValue(right.align)}.`));
    if (left.fontColor !== right.fontColor) changes.push(change("formatting", `${label} text color changed.`));
    if (left.isBold !== right.isBold) changes.push(change("formatting", `${label} bold: ${formatValue(left.isBold)} → ${formatValue(right.isBold)}.`));
    if (left.isItalic !== right.isItalic) changes.push(change("formatting", `${label} italic: ${formatValue(left.isItalic)} → ${formatValue(right.isItalic)}.`));
    if (!same(formattingOnly(left.textDocument), formattingOnly(right.textDocument))) {
      changes.push(change("formatting", `${label} inline text formatting changed.`));
    }
    if (!same(left.background, right.background)) changes.push(change("media", `${label} background changed.`));
    if (!same(left.mediaInfo, right.mediaInfo)) changes.push(change("media", `${label} media assignment changed.`));
    if (["width", "height", "x", "y"].some(key =>
      (left as unknown as Record<string, unknown>)[key] !== (right as unknown as Record<string, unknown>)[key],
    )) changes.push(change("formatting", `${label} position or size changed.`));
    const knownBoxFields = new Set([
      "id", "words", "textDocument", "background", "mediaInfo", "width", "height", "x", "y", "label",
      "fontSize", "fontColor", "align", "isBold", "isItalic", "brightness", "shouldKeepAspectRatio",
      "excludeFromOverflow", "transparent", "topMargin", "sideMargin", "slideIndex", "monitorFontSizePx",
    ]);
    const leftOther = Object.fromEntries(Object.entries(left).filter(([key]) => !knownBoxFields.has(key)));
    const rightOther = Object.fromEntries(Object.entries(right).filter(([key]) => !knownBoxFields.has(key)));
    if (!same(leftOther, rightOther)) changes.push(change("other", `${label} other settings changed.`));
  }
  const knownSlideFields = new Set([
    "_id", "_rev", "docType", "songId", "arrangementId", "createdAt", "createdBy", "updatedAt", "updatedBy",
    "id", "name", "type", "boxes", "mediaSource", "videoBackgroundSendMode", "overflow", "formattedTextDisplayInfo",
    "monitorCurrentBandBoxes", "monitorNextBandBoxes",
  ]);
  const oldOther = Object.fromEntries(Object.entries(current).filter(([key]) => !knownSlideFields.has(key)));
  const newOther = Object.fromEntries(Object.entries(alternative).filter(([key]) => !knownSlideFields.has(key)));
  if (!same(oldOther, newOther)) changes.push(change("other", "Other slide details changed."));
  return { sections, changes };
};

const arrangementChanges = (
  current: SongV2ArrangementDocument,
  alternative: SongV2ArrangementDocument,
  context: SongV2ConflictComparisonContext,
): { sections: SongV2LyricSectionDiff[]; changes: SongV2ConflictChange[]; lyricsIdentical: boolean } => {
  const sectionResult = sectionDiffs(current, alternative);
  const sections = sectionResult.sections;
  let lyricsIdentical = sectionResult.lyricsIdentical;
  const changes: SongV2ConflictChange[] = [];
  for (const pair of matchedSections(current.formattedLyrics, alternative.formattedLyrics)) {
    if (!pair.current || !pair.alternative) continue;
    if (pair.current.name !== pair.alternative.name) {
      changes.push(change("structure", `Section name: ${pair.current.name} → ${pair.alternative.name}.`));
    }
    if (pair.current.type !== pair.alternative.type) {
      changes.push(change("structure", `Section type: ${pair.current.type} → ${pair.alternative.type}.`));
    }
    if (!same(formattingOnly(pair.current.textDocument), formattingOnly(pair.alternative.textDocument))) {
      changes.push(change("formatting", `${pair.alternative.name} lyric formatting changed.`));
    }
  }
  const currentOrder = current.songOrder.map(({ id, name }) => ({ id, name }));
  const alternativeOrder = alternative.songOrder.map(({ id, name }) => ({ id, name }));
  compareNamedOrder(currentOrder, alternativeOrder, "Section", changes);
  if (current.name !== alternative.name) changes.push(change("structure", `Arrangement name: ${current.name} → ${alternative.name}.`));
  if (!same(current.monitorLayout, alternative.monitorLayout)) {
    if (current.monitorLayout?.currentFontSizePx !== alternative.monitorLayout?.currentFontSizePx) {
      changes.push(change("formatting", `Monitor text size: ${formatValue(current.monitorLayout?.currentFontSizePx)} → ${formatValue(alternative.monitorLayout?.currentFontSizePx)}.`));
    }
    if (current.monitorLayout?.nextFontSizePx !== alternative.monitorLayout?.nextFontSizePx) {
      changes.push(change("formatting", `Next-slide text size: ${formatValue(current.monitorLayout?.nextFontSizePx)} → ${formatValue(alternative.monitorLayout?.nextFontSizePx)}.`));
    }
  }
  const knownArrangementFields = new Set([
    "_id", "_rev", "docType", "songId", "arrangementId", "createdAt", "createdBy", "updatedAt", "updatedBy",
    "name", "formattedLyrics", "songOrder", "slideIds", "monitorLayout", "monitorCurrentBandBoxes", "monitorNextBandBoxes",
  ]);
  const oldOther = Object.fromEntries(Object.entries(current).filter(([key]) => !knownArrangementFields.has(key)));
  const newOther = Object.fromEntries(Object.entries(alternative).filter(([key]) => !knownArrangementFields.has(key)));
  if (!same(oldOther, newOther)) changes.push(change("other", "Other arrangement settings changed."));

  const slideComparison = compareSlideReferences(current, alternative, context);
  const { comparison, leftEntries, rightEntries } = slideComparison;
  for (const { item, index } of comparison.added) {
    changes.push(change("structure", `Slide ${positionLabel(item.document?.name ?? "Slide", index + 1)} added.`));
  }
  const slideSectionStart = sections.length;
  let slideTextChanged = false;
  for (const { index } of comparison.removed) {
    const entry = leftEntries[index];
    const explanation = removalExplanation(entry, rightEntries, context.alternative);
    changes.push(change("structure", explanation));
    if (explanation.includes("its lyrics are not present")) lyricsIdentical = false;
  }
  for (const move of comparison.moved) {
    changes.push(change("structure", `Slide ${quote(move.right.document?.name ?? move.left.document?.name ?? "Slide")} moved from position ${move.leftIndex + 1} to position ${move.rightIndex + 1}.`));
  }
  for (const match of comparison.matches) {
    const leftSlide = match.left.document;
    const rightSlide = match.right.document;
    if (!leftSlide || !rightSlide) {
      if (match.left.id !== match.right.id) {
        changes.push(change("structure", `Slide identity changed, but the page content could not be verified.`));
      }
      continue;
    }
    if (match.matchedBy === "content" && match.left.id !== match.right.id) {
      changes.push(change("structure", `Slide identity regenerated for ${quote(rightSlide.name)}; authored content is unchanged.`));
      if (leftSlide.name !== rightSlide.name) changes.push(change("structure", `Slide name: ${leftSlide.name} → ${rightSlide.name}.`));
    } else {
      const slideResult = slideChanges(leftSlide, rightSlide, context);
      changes.push(...slideResult.changes);
      slideTextChanged ||= slideResult.sections.length > 0;
      sections.push(...slideResult.sections.map(section => ({ ...section, name: `${rightSlide.name}: ${section.name}` })));
    }
  }
  const leftPages = leftEntries.filter(entry => entry.document && !["Title", "Blank"].includes(entry.document.type));
  const rightPages = rightEntries.filter(entry => entry.document && !["Title", "Blank"].includes(entry.document.type));
  const leftText = normalizedText(leftPages.map(entry => textForSlide(entry.document!)).join("\n"));
  const rightText = normalizedText(rightPages.map(entry => textForSlide(entry.document!)).join("\n"));
  const pageBreaksChanged = leftPages.length !== rightPages.length || leftPages.some((entry, index) => {
    const rightPage = rightPages[index]?.document;
    return !rightPage || normalizedText(textForSlide(entry.document!)) !== normalizedText(textForSlide(rightPage));
  });
  const allPagesLoaded = leftEntries.every(entry => !!entry.document) && rightEntries.every(entry => !!entry.document);
  const lyricsReflowed = lyricsIdentical && allPagesLoaded && !!leftText && leftText === rightText &&
    pageBreaksChanged && !comparison.moved.length;
  if (lyricsReflowed) {
    sections.splice(slideSectionStart);
    changes.push(change("structure", "Lyrics were reflowed across slides; the canonical section lyrics are unchanged."));
  } else if (slideTextChanged) {
    lyricsIdentical = false;
  }
  return { sections, changes, lyricsIdentical };
};

const rootDocumentKind = (doc: SongV2RevisionDocument): SongV2ConflictDiffModel["documentKind"] =>
  doc.docType === "song-v2-root" ? "song" : doc.docType === "song-v2-arrangement" ? "arrangement" : "slide";

const documentLabel = (doc: SongV2RevisionDocument, context: SongV2ConflictComparisonContext) => {
  if (doc.docType === "song-v2-root") return `Song: ${doc.name}`;
  if (doc.docType === "song-v2-arrangement") return `Arrangement: ${doc.name}`;
  const position = slideIndex(doc, context.current);
  return `Slide: ${positionLabel(doc.name, position)}`;
};

const modelSummary = (sections: SongV2LyricSectionDiff[], changes: SongV2ConflictChange[], lyricsIdentical: boolean | null) => {
  if (lyricsIdentical === true) return "Lyrics are identical.";
  const changed = sections.filter(section => section.status === "changed").length;
  const added = sections.filter(section => section.status === "added").length;
  const removed = sections.filter(section => section.status === "removed").length;
  const lines = [
    ...(changed ? [`${plural(changed, "section")} contain changed lyrics`] : []),
    ...(added ? [`${plural(added, "section")} added`] : []),
    ...(removed ? [`${plural(removed, "section")} removed`] : []),
  ];
  if (lines.length) return lines.join(" · ");
  if (changes.length === 1) return changes[0].summary;
  if (changes.length) return "Saved song details changed.";
  return lyricsIdentical === null ? "No authored differences in this saved document." : "Lyrics are identical.";
};

/** Compares two already-loaded physical revisions for display only. */
export function buildSongV2ConflictDiffModel(
  current: SongV2RevisionDocument,
  alternative: SongV2RevisionDocument,
  context: SongV2ConflictComparisonContext = {},
): SongV2ConflictDiffModel {
  let sections: SongV2LyricSectionDiff[] = [];
  let changes: SongV2ConflictChange[] = [];
  let lyricsIdentical: boolean | null = null;
  if (current.docType === "song-v2-root" && alternative.docType === "song-v2-root") {
    const result = rootChanges(current, alternative, context);
    changes = result.changes;
    lyricsIdentical = result.lyricsIdentical;
  } else if (current.docType === "song-v2-arrangement" && alternative.docType === "song-v2-arrangement") {
    const result = arrangementChanges(current, alternative, context);
    sections = result.sections;
    changes = result.changes;
    lyricsIdentical = result.lyricsIdentical;
  } else if (current.docType === "song-v2-slide" && alternative.docType === "song-v2-slide") {
    const result = slideChanges(current, alternative, context);
    sections = result.sections;
    changes = result.changes;
    lyricsIdentical = sections.length === 0;
  } else {
    changes = [change("other", "These saved versions have different content types and cannot be compared reliably.")];
  }
  const identicalContent = changes.length === 0 && sections.length === 0;
  return {
    documentKind: rootDocumentKind(current),
    documentLabel: documentLabel(current, context),
    identicalContent,
    lyricsIdentical,
    summary: modelSummary(sections, changes, lyricsIdentical),
    sections,
    changes,
  };
}

const songComparisonDocuments = (song: DBItem) => {
  const arrangements = (song.arrangements ?? []) as Arrangment[];
  const root = {
    _id: `song-v2:root:${song._id}`,
    docType: "song-v2-root" as const,
    songId: song._id,
    songSchemaVersion: 2 as const,
    name: song.name,
    selectedArrangement: song.selectedArrangement ?? 0,
    arrangementIds: arrangements.map(arrangement => arrangement.id),
    ...(song.shouldSkipTitle !== undefined ? { shouldSkipTitle: song.shouldSkipTitle } : {}),
    ...(song.background !== undefined ? { background: song.background } : {}),
    ...(song.shouldSendTo !== undefined ? { shouldSendTo: song.shouldSendTo } : {}),
    ...(song.songMetadata !== undefined ? { songMetadata: song.songMetadata } : {}),
    ...(song.songLinks !== undefined ? { songLinks: song.songLinks } : {}),
    ...(song.songAudio !== undefined ? { songAudio: song.songAudio } : {}),
  } as SongV2RootDocument;
  const arrangementDocuments: SongV2ArrangementDocument[] = arrangements.map(arrangement => ({
    _id: `song-v2:arrangement:${song._id}:${arrangement.id}`,
    docType: "song-v2-arrangement",
    songId: song._id,
    arrangementId: arrangement.id,
    name: arrangement.name,
    formattedLyrics: arrangement.formattedLyrics,
    songOrder: arrangement.songOrder,
    slideIds: (arrangement.slides ?? []).map(slide => slide.id),
    ...(arrangement.monitorLayout !== undefined ? { monitorLayout: arrangement.monitorLayout } : {}),
  }));
  const slides: SongV2SlideDocument[] = arrangements.flatMap(arrangement => (arrangement.slides ?? []).map(slide => ({
    ...slide,
    _id: `song-v2:slide:${song._id}:${arrangement.id}:${slide.id}`,
    docType: "song-v2-slide",
    songId: song._id,
    arrangementId: arrangement.id,
  })));
  return { root, arrangements: arrangementDocuments, slides };
};

/** Compares two fully hydrated songs without formatting or database reads. */
export function buildSongV2SongDiffModel(current: DBItem, alternative: DBItem): SongV2ConflictDiffModel {
  const left = songComparisonDocuments(current);
  const right = songComparisonDocuments(alternative);
  const currentSide: SongV2ComparisonSide = { arrangements: left.arrangements, slides: left.slides };
  const alternativeSide: SongV2ComparisonSide = { arrangements: right.arrangements, slides: right.slides };
  const context = { current: currentSide, alternative: alternativeSide };
  const changes: SongV2ConflictChange[] = [];
  const sections: SongV2LyricSectionDiff[] = [];
  const rootResult = rootChanges(left.root, right.root, context);
  let arrangementLyricsIdentical = true;
  changes.push(...rootResult.changes);
  const rightArrangements = new Map(right.arrangements.map(arrangement => [arrangement.arrangementId, arrangement]));
  for (const arrangement of left.arrangements) {
    const next = rightArrangements.get(arrangement.arrangementId);
    if (!next) continue;
    const result = arrangementChanges(arrangement, next, context);
    arrangementLyricsIdentical &&= result.lyricsIdentical;
    sections.push(...result.sections.map(section => ({ ...section, name: `${next.name}: ${section.name}` })));
    changes.push(...result.changes);
  }
  const uniqueChanges = changes.filter((item, index) => changes.findIndex(other => other.summary === item.summary) === index);
  const lyricsIdentical = rootResult.lyricsIdentical === true && arrangementLyricsIdentical && sections.length === 0 &&
    left.arrangements.length === right.arrangements.length &&
    left.arrangements.every(arrangement => rightArrangements.has(arrangement.arrangementId));
  return {
    documentKind: "song",
    documentLabel: `Song: ${current.name}`,
    identicalContent: uniqueChanges.length === 0 && sections.length === 0,
    lyricsIdentical,
    summary: modelSummary(sections, uniqueChanges, lyricsIdentical),
    sections,
    changes: uniqueChanges,
  };
}
