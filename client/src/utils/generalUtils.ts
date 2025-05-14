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

      match += commonWords.some((word) => word === searchTerm)
        ? 0.25 * indexRank // give partial credit for common words
        : 0.5 * indexRank;
    } else if (allowPartial && cleanString.includes(lastSearchTerm)) {
      // only allow partial match on last word
      const foundIndex = stringWords.findIndex((word) =>
        word.includes(lastSearchTerm)
      );
      const indexRank = 1 / (foundIndex + 1);
      match += 0.125 * indexRank;
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
  keepNextInView?: boolean;
};

export const keepElementInView = ({
  child,
  parent,
  shouldScrollToCenter,
  keepNextInView,
}: keepElementInViewType) => {
  try {
    child.focus();
    const parentRect = parent.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    const scrollPadding = shouldScrollToCenter
      ? parentRect.height / 2
      : Math.min(childRect.height / 2, parentRect.height - childRect.height);

    const leadingDistance = keepNextInView ? childRect.height : 0;

    if (childRect.top - leadingDistance < parentRect.top) {
      parent.scrollTo({
        top:
          parent.scrollTop - (parentRect.top - childRect.top) - scrollPadding,
        behavior: "smooth",
      });
    } else if (childRect.bottom + leadingDistance > parentRect.bottom) {
      parent.scrollTo({
        top:
          parent.scrollTop +
          (childRect.bottom - parentRect.bottom) +
          scrollPadding,
        behavior: "smooth",
      });
    }
  } catch (error) {
    console.error(error);
  }
};

export const checkMediaType = (mediaUrl?: string) => {
  if (!mediaUrl) return "unknown";
  const urlParts = mediaUrl.split(".");
  const extension = urlParts[urlParts.length - 1];
  const imageExtensions = ["jpg", "jpeg", "png", "gif", "webp"];
  const videoExtensions = ["mp4", "mov", "avi", "webm"];

  if (imageExtensions.includes(extension.toLowerCase())) {
    return "image";
  } else if (videoExtensions.includes(extension.toLowerCase())) {
    return "video";
  } else {
    return "unknown";
  }
};

export const getTimeDifference = (timeString: string) => {
  const now = new Date();
  const [hours, minutes] = timeString.split(":").map(Number);

  // Create a new Date object for today with the specified time
  const targetTime = new Date(now);
  targetTime.setHours(hours, minutes, 0, 0);

  // If the target time has already passed today, set it to tomorrow
  if (targetTime < now) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const secondsDiff = Math.floor((targetTime.getTime() - now.getTime()) / 1000);
  return secondsDiff;
};
