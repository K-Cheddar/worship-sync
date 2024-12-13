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

export const punctuationRegex = new RegExp(/[.,/#!$%^&*;:{}=\-_`~()]/g, "");

type getMatchType = {
  string: string;
  searchTerms: string[];
};

export const getMatchForString = ({
  string,
  searchTerms,
}: getMatchType): number => {
  let match = 0;
  const stringWords = string.split(" ");
  for (let j = 0; j < searchTerms.length; j++) {
    const searchTerm = searchTerms[j].toLowerCase();

    if (string === searchTerm) {
      // exact match
      match += searchTerms.length;
      break;
    } else if (stringWords.some((word) => word === searchTerm)) {
      // whole word match
      match += commonWords.some((word) => word === searchTerm) ? 0.5 : 1; // give partial credit for common words
    } else if (string.includes(searchTerms[searchTerms.length - 1])) {
      // only allow partial match on last word
      match += 0.25;
    }
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
  advance: () => void;
  previous: () => void;
};
export const handleKeyDownTraverse = ({
  event,
  advance,
  previous,
}: handleKeyDownTraverseType) => {
  if (
    event.key === " " ||
    event.key === "ArrowRight" ||
    event.key === "ArrowDown"
  ) {
    event.preventDefault();
    advance();
  }
  if (
    (event.key === " " && event.shiftKey) ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowUp"
  ) {
    event.preventDefault();
    previous();
  }
};

type keepElementInViewType = {
  child: HTMLElement;
  parent: HTMLElement;
  shouldScrollToCenter?: boolean;
};
export const keepElementInView = ({
  child,
  parent,
  shouldScrollToCenter,
}: keepElementInViewType) => {
  try {
    child.focus();
    const parentRect = parent.getBoundingClientRect();
    const verseRect = child.getBoundingClientRect();
    const scrollDistance = shouldScrollToCenter
      ? parentRect.height / 2
      : verseRect.height;
    if (verseRect.top - verseRect.height < parentRect.top) {
      parent.scrollTo({
        top: parent.scrollTop - scrollDistance,
        behavior: "smooth",
      });
    } else if (verseRect.bottom + verseRect.height > parentRect.bottom) {
      parent.scrollTo({
        top: parent.scrollTop + scrollDistance,
        behavior: "smooth",
      });
    }
  } catch (error) {
    console.error(error);
  }
};
