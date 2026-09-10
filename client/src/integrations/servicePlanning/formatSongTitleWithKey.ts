/**
 * Planning / service-plan display: append a musical key as trailing
 * parentheses, matching printout style ("Great Are You Lord (G)").
 */
import type { ServicePlanSongReference } from "../../types/servicePlan";

const TRAILING_KEY =
  /\s*\(([A-G][#b]?(?:m)?(?:\s*(?:→|->|\u2192)\s*[A-G][#b]?(?:m)?)?)\)\s*$/iu;

/** Pull a trailing planning key off a title, if one is present. */
export const extractPlanningKey = (title: string): string => {
  const match = String(title || "")
    .trim()
    .match(TRAILING_KEY);
  return match?.[1]?.trim() || "";
};

/** True when the title already ends with a planning-style key suffix. */
export const hasPlanningKeySuffix = (title: string): boolean =>
  TRAILING_KEY.test(String(title || "").trim());

/**
 * Append `(key)` when the title does not already carry one. Empty keys are
 * ignored so callers can pass optional metadata without branching.
 */
export const formatSongTitleWithKey = (
  title: string,
  key?: string | null,
): string => {
  const base = String(title || "").trim();
  const trimmedKey = String(key || "").trim();
  if (!base) return trimmedKey ? `(${trimmedKey})` : "";
  if (!trimmedKey || hasPlanningKeySuffix(base)) return base;
  return `${base} (${trimmedKey})`;
};

/** Chip / setlist label for a service-plan song reference. */
export const getServicePlanSongRefLabel = (
  songRef: ServicePlanSongReference,
): string =>
  formatSongTitleWithKey(
    songRef.kind === "library"
      ? songRef.songName
      : songRef.title || "Untitled song",
    songRef.key,
  );

/** Build a library song ref, copying the song's stored key when present. */
export const libraryServicePlanSongRef = (song: {
  _id: string;
  name: string;
  songMetadata?: { key?: string } | null;
}): Extract<ServicePlanSongReference, { kind: "library" }> => {
  const key = song.songMetadata?.key?.trim();
  return {
    kind: "library",
    songId: song._id,
    songName: song.name,
    ...(key ? { key } : {}),
  };
};
