const commonWords = [
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "for",
  "to",
  "on",
  "at",
  "by",
];

export const punctuationRegex = new RegExp(/[.,#!$%^&*;:{}=\-_`~()]/g);

type getMatchType = {
  string: string;
  searchValue: string;
  allowPartial?: boolean;
};

// Levenshtein distance calculation for fuzzy matching
export const levenshteinDistance = (str1: string, str2: string): number => {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j - 1] + 1, // substitution
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1 // insertion
        );
      }
    }
  }
  return dp[m][n];
};

export const getMatchForString = ({
  string,
  searchValue,
  allowPartial = false,
}: getMatchType): number => {
  let match = 0;
  const searchTerms = searchValue.split(" ").filter((term) => term.trim()); // ignore spaces
  const cleanString = string
    .replace(punctuationRegex, "")
    .replaceAll("\n", " ")
    .trim()
    .toLowerCase();

  const stringWords = cleanString.split(" ");

  // Early return for empty search
  if (searchTerms.length === 0) return 0;

  // Exact match bonus
  if (cleanString === searchValue) {
    return searchTerms.length * 2;
  }

  // Whole phrase match bonus
  if (cleanString.includes(searchValue)) {
    return searchTerms.length * 1.5;
  }

  // Track matched words to avoid double counting
  const matchedWords = new Set<string>();

  for (let j = 0; j < searchTerms.length; j++) {
    const searchTerm = searchTerms[j];
    const lastSearchTerm = searchTerms[searchTerms.length - 1];
    const remainingSearchValue = searchTerms.slice(j).join(" ");

    if (cleanString === searchTerm) {
      // exact match
      match += searchTerms.length;
      break;
    } else if (cleanString.includes(searchValue)) {
      // whole phrase match
      match += searchTerms.length;
      break;
    } else if (
      remainingSearchValue !== lastSearchTerm &&
      cleanString.includes(remainingSearchValue)
    ) {
      // partial phrase match
      match += searchTerms.length - j;
      break;
    } else if (stringWords.some((word) => word === searchTerm)) {
      // whole word match
      const foundIndex = stringWords.findIndex((word) => word === searchTerm);
      const indexRank = allowPartial ? 0.1 : 1 / (foundIndex + 1);

      // Check if this word was already matched
      if (!matchedWords.has(searchTerm)) {
        matchedWords.add(searchTerm);
        match += commonWords.some((word) => word === searchTerm)
          ? 0.25 * indexRank // give partial credit for common words
          : 0.5 * indexRank;
      }
    } else if (allowPartial && cleanString.includes(lastSearchTerm)) {
      // only allow partial match on last word
      const foundIndex = stringWords.findIndex((word) =>
        word.includes(lastSearchTerm)
      );
      const indexRank = 1 / (foundIndex + 1);
      match += 0.125 * indexRank;
    }
  }

  // Bonus for matching multiple search terms
  if (matchedWords.size > 1) {
    match *= 1.2; // 20% bonus for matching multiple terms
  }

  return match;
};

type updateWordMatchesType = {
  matchedWords: string;
  match: number;
  wordMatches: {
    match: number;
    matchedWords: string;
  }[];
};

type matchesReturnType = {
  updatedMatchedWords: string;
  updatedMatch: number;
};

export const updateWordMatches = ({
  matchedWords,
  match,
  wordMatches,
}: updateWordMatchesType): matchesReturnType => {
  let updatedMatchedWords = matchedWords;
  let updatedMatch = 0;

  // most matched word if it exists
  const mostMatchedWords = wordMatches.reduce((prev, curr) => {
    if (curr.match > prev.match) return curr;
    return prev;
  }, wordMatches[0]);

  const wordMatch = mostMatchedWords?.match; // If there are no matches, wordMatch will be undefined

  if (wordMatch > 0) {
    updatedMatchedWords = mostMatchedWords.matchedWords;
    updatedMatch = wordMatch;
  }

  return {
    updatedMatchedWords,
    updatedMatch,
  };
};

type handleKeyDownTraverseType = {
  event: React.KeyboardEvent;
  advance: () => void | Promise<void>;
  previous: () => void | Promise<void>;
};
export const handleKeyDownTraverse = async ({
  event,
  advance,
  previous,
}: handleKeyDownTraverseType) => {
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    await advance();
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    await previous();
  }
};

type keepElementInViewType = {
  child: HTMLElement;
  parent: HTMLElement;
  shouldScrollToCenter?: boolean;
  keepNextInView?: boolean;
};

export const keepElementInView = ({
  child,
  parent,
  shouldScrollToCenter,
  keepNextInView,
}: keepElementInViewType) => {
  try {
    const parentRect = parent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    const childHeight = childRect.height;
    const parentHeight = parentRect.height;
    const currentScrollTop = parent.scrollTop;

    // Calculate padding based on scroll mode
    const scrollPadding = shouldScrollToCenter
      ? parentHeight / 2 - childHeight / 2
      : Math.max(0, Math.min(childHeight / 2, parentHeight - childHeight));

    // Account for next element visibility if needed
    const leadingDistance = keepNextInView ? childHeight : 0;

    // Calculate if child is above or below viewport
    const isAboveViewport = childRect.top - leadingDistance < parentRect.top;
    const isBelowViewport = childRect.bottom + leadingDistance > parentRect.bottom;

    if (isAboveViewport) {
      // Child is above viewport - scroll up
      const distanceAbove = parentRect.top - (childRect.top - leadingDistance);
      const targetScrollTop = currentScrollTop - distanceAbove - scrollPadding;
      parent.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: "smooth",
      });
    } else if (isBelowViewport) {
      // Child is below viewport - scroll down
      const distanceBelow = (childRect.bottom + leadingDistance) - parentRect.bottom;
      const targetScrollTop = currentScrollTop + distanceBelow + scrollPadding;
      const maxScroll = parent.scrollHeight - parentHeight;
      parent.scrollTo({
        top: Math.min(maxScroll, targetScrollTop),
        behavior: "smooth",
      });
    }
  } catch (error) {
    console.error(error);
  }
};

export const checkMediaType = (mediaUrl?: string) => {
  if (!mediaUrl) return "image";

  if (
    mediaUrl.includes("portable-media/video/upload") ||
    mediaUrl.includes("stream.mux.com")
  ) {
    return "video";
  }
  return "image";
};

export const getImageFromVideoUrl = (videoUrl?: string) => {
  if (!videoUrl) return "";
  
  // Handle Mux URLs
  if (videoUrl.includes("stream.mux.com")) {
    const playbackIdMatch = videoUrl.match(/stream\.mux\.com\/([a-zA-Z0-9]+)/);
    if (playbackIdMatch) {
      return `https://image.mux.com/${playbackIdMatch[1]}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
    }
  }
  
  // Handle Cloudinary URLs
  let updatedUrl = videoUrl.split("?")[0];
  updatedUrl = updatedUrl.replace(/sp_auto\/|\.m3u8/g, "");
  return updatedUrl + ".png";
};

export const getLetterFromIndex = (
  index: number,
  shouldWrapInZeroWidth = false
) => {
  let letter = "";
  if (index < 26) {
    letter = String.fromCharCode(97 + index); // 97 is the ASCII code for 'a'
  } else {
    // For indices >= 26, we'll use a base-26 system
    while (index >= 0) {
      letter = String.fromCharCode(97 + (index % 26)) + letter;
      index = Math.floor(index / 26) - 1;
    }
  }

  return shouldWrapInZeroWidth ? "\u200B" + letter + "\u200B" : letter;
};

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const backoff = async (
  attempt: number,
  base: number = 500,
  cap: number = 8000
) => {
  const ms = Math.min(cap, base * 2 ** attempt);
  await delay(ms);
};

export const capitalizeFirstLetter = (str?: string | null): string => {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
};
