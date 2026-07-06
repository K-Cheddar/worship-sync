const SECTION_LABEL_MAP: Record<string, string> = {
  verse: "Verse",
  chorus: "Chorus",
  "pre-chorus": "Pre-Chorus",
  prechorus: "Pre-Chorus",
  "pre chorus": "Pre-Chorus",
  bridge: "Bridge",
  intro: "Intro",
  outro: "Ending",
  tag: "Tag",
  interlude: "Interlude",
  hook: "Hook",
  refrain: "Refrain",
  vamp: "Vamp",
  instrumental: "Instrumental",
};

const WRAPPED_LABEL_RE = /^[[(]([^\])]*)[\])]$/;

export type ParsedLyricsSection = { type: string; words: string };

export const tryParseSectionLabel = (rawLine: string): string | null => {
  const line = rawLine.trim();
  const wrappedMatch = line.match(WRAPPED_LABEL_RE);
  const inner = wrappedMatch ? wrappedMatch[1].trim() : line;
  const base = inner.replace(/\s+\d+$/, "").trim();
  return SECTION_LABEL_MAP[base.toLowerCase()] ?? null;
};

export const normalizeLyricsText = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeComparableBlock = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeLine = (line: string): string =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getNormalizedLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean);

const MIN_CHORUS_SHARED_LINES = 3;
const CHORUS_SIMILARITY_THRESHOLD = 0.45;

const linesMatch = (left: string, right: string): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length < 10) return false;

  return longer.startsWith(shorter);
};

const countMatchingLines = (
  leftLines: string[],
  rightLines: string[],
): number => {
  let matches = 0;
  const usedRight = new Set<number>();

  for (const leftLine of leftLines) {
    for (let index = 0; index < rightLines.length; index++) {
      if (usedRight.has(index)) continue;
      if (linesMatch(leftLine, rightLines[index])) {
        matches += 1;
        usedRight.add(index);
        break;
      }
    }
  }

  return matches;
};

const blockSimilarity = (leftLines: string[], rightLines: string[]): number => {
  if (leftLines.length === 0 || rightLines.length === 0) return 0;

  const sharedCount = countMatchingLines(leftLines, rightLines);
  return sharedCount / Math.min(leftLines.length, rightLines.length);
};

const blocksLikelySameChorus = (
  leftWords: string,
  rightWords: string,
): boolean => {
  const leftLines = getNormalizedLines(leftWords);
  const rightLines = getNormalizedLines(rightWords);

  const sharedCount = countMatchingLines(leftLines, rightLines);
  if (sharedCount < MIN_CHORUS_SHARED_LINES) return false;

  return blockSimilarity(leftLines, rightLines) >= CHORUS_SIMILARITY_THRESHOLD;
};

/**
 * Inserts section breaks before explicit chart labels (Verse, Chorus, [BRIDGE], etc.)
 * when imported lyrics use single newlines only.
 */
export const enrichLyricsSectionBreaks = (text: string): string => {
  const normalized = normalizeLyricsText(text);
  if (!normalized || normalized.includes("\n\n")) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const enrichedLines: string[] = [];

  for (const line of lines) {
    const labelType = tryParseSectionLabel(line);
    if (labelType !== null && enrichedLines.length > 0) {
      enrichedLines.push("");
    }
    enrichedLines.push(line);
  }

  return enrichedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const parseWithSectionLabels = (
  normalizedText: string,
): ParsedLyricsSection[] => {
  const lines = normalizedText.split("\n");
  const sections: ParsedLyricsSection[] = [];
  let currentType: string | null = null;
  let contentLines: string[] = [];

  const flush = () => {
    if (currentType !== null) {
      sections.push({
        type: currentType,
        words: contentLines
          .join("\n")
          .replace(/\n{2,}/g, "\n")
          .trim(),
      });
      contentLines = [];
    }
  };

  for (const line of lines) {
    const labelType = tryParseSectionLabel(line);
    if (labelType !== null) {
      flush();
      currentType = labelType;
    } else if (currentType !== null) {
      contentLines.push(line);
    }
  }
  flush();

  return sections;
};

const parseSectionBlock = (block: string): ParsedLyricsSection => {
  const newlineIndex = block.indexOf("\n");
  if (newlineIndex !== -1) {
    const firstLine = block.slice(0, newlineIndex).trim();
    const canonical = SECTION_LABEL_MAP[firstLine.toLowerCase()];
    if (canonical) {
      return {
        type: canonical,
        words: block.slice(newlineIndex + 1).trimStart(),
      };
    }
  }
  return { type: "Verse", words: block.trim() };
};

const splitSingleBlockByRepeatedLines = (block: string): string[] => {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 8) {
    return [block.trim()];
  }

  for (
    let length = Math.min(8, Math.floor(lines.length / 2));
    length >= 3;
    length--
  ) {
    for (let start = 0; start <= lines.length - length * 2; start++) {
      const anchorNorm = normalizeComparableBlock(
        lines.slice(start, start + length).join("\n"),
      );
      if (!anchorNorm) continue;

      for (
        let repeatAt = start + length;
        repeatAt <= lines.length - length;
        repeatAt++
      ) {
        const repeatNorm = normalizeComparableBlock(
          lines.slice(repeatAt, repeatAt + length).join("\n"),
        );
        if (repeatNorm !== anchorNorm) continue;

        const before = lines.slice(0, repeatAt).join("\n").trim();
        const after = lines.slice(repeatAt).join("\n").trim();
        return [
          ...splitSingleBlockByRepeatedLines(before),
          ...splitSingleBlockByRepeatedLines(after),
        ].filter(Boolean);
      }
    }
  }

  return [block.trim()];
};

const splitIntoBlocks = (normalizedText: string): string[] => {
  const enriched = enrichLyricsSectionBreaks(normalizedText);
  const blocks = enriched
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 1 && blocks[0].includes("\n")) {
    return splitSingleBlockByRepeatedLines(blocks[0]);
  }

  return blocks;
};

const findSimilarVerseGroups = (
  sections: ParsedLyricsSection[],
): Set<number> => {
  const verseIndices = sections.flatMap((section, index) =>
    section.type === "Verse" ? [index] : [],
  );

  const parent = verseIndices.map((_, index) => index);

  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]);
    return parent[index];
  };

  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let left = 0; left < verseIndices.length; left++) {
    for (let right = left + 1; right < verseIndices.length; right++) {
      const leftSection = sections[verseIndices[left]];
      const rightSection = sections[verseIndices[right]];

      if (
        blocksLikelySameChorus(leftSection.words, rightSection.words) ||
        normalizeComparableBlock(leftSection.words) ===
          normalizeComparableBlock(rightSection.words)
      ) {
        union(left, right);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < verseIndices.length; index++) {
    const root = find(index);
    const members = groups.get(root) ?? [];
    members.push(verseIndices[index]);
    groups.set(root, members);
  }

  const chorusIndices = new Set<number>();
  for (const members of groups.values()) {
    if (members.length >= 2) {
      for (const index of members) {
        chorusIndices.add(index);
      }
    }
  }

  return chorusIndices;
};

const applyChorusTypeToRepeatedBlocks = (
  sections: ParsedLyricsSection[],
): ParsedLyricsSection[] => {
  const chorusIndices = findSimilarVerseGroups(sections);

  return sections.map((section, index) => {
    if (section.type !== "Verse" || !chorusIndices.has(index)) {
      return section;
    }

    return { ...section, type: "Chorus" };
  });
};

export const inferLyricsSections = (
  unformattedLyrics: string,
): ParsedLyricsSection[] => {
  const normalizedText = normalizeLyricsText(unformattedLyrics);
  if (!normalizedText) return [];

  const hasSectionLabels = normalizedText
    .split("\n")
    .some((line) => tryParseSectionLabel(line) !== null);

  const parsedSections = hasSectionLabels
    ? parseWithSectionLabels(normalizedText)
    : splitIntoBlocks(normalizedText).map(parseSectionBlock);

  return applyChorusTypeToRepeatedBlocks(parsedSections);
};
