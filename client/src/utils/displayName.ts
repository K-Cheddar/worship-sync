/** First token before the first space; if no space, returns the trimmed string. */
export const firstNameFromDisplayName = (displayName: string): string => {
  const t = displayName.trim();
  if (!t) {
    return "";
  }
  const space = t.indexOf(" ");
  return space === -1 ? t : t.slice(0, space);
};
