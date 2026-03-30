export const mapCursorPosition = (
  previousText: string,
  nextText: string,
  previousPosition: number,
) => {
  if (previousText === nextText) {
    return Math.min(previousPosition, nextText.length);
  }

  let commonPrefix = 0;
  const maxPrefix = Math.min(previousText.length, nextText.length);
  while (
    commonPrefix < maxPrefix &&
    previousText[commonPrefix] === nextText[commonPrefix]
  ) {
    commonPrefix += 1;
  }

  let commonSuffix = 0;
  const maxSuffix = Math.min(
    previousText.length - commonPrefix,
    nextText.length - commonPrefix,
  );
  while (
    commonSuffix < maxSuffix &&
    previousText[previousText.length - 1 - commonSuffix] ===
      nextText[nextText.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }

  if (previousPosition <= commonPrefix) {
    return previousPosition;
  }

  const previousMiddleEnd = previousText.length - commonSuffix;
  const nextMiddleEnd = nextText.length - commonSuffix;

  if (previousPosition >= previousMiddleEnd) {
    const offsetFromSuffix = previousPosition - previousMiddleEnd;
    return Math.max(
      0,
      Math.min(nextText.length, nextMiddleEnd + offsetFromSuffix),
    );
  }

  return Math.max(0, Math.min(nextText.length, nextMiddleEnd));
};

export const resolveFormattedCursorPosition = (
  previousText: string,
  nextText: string,
  previousPosition: number,
) => {
  const clampedPosition = Math.max(
    0,
    Math.min(previousPosition, nextText.length),
  );

  if (nextText.startsWith(previousText.slice(0, previousPosition))) {
    return clampedPosition;
  }

  return mapCursorPosition(previousText, nextText, previousPosition);
};
