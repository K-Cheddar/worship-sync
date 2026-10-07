import { richTextToPlainText } from "../../types/richText";
import {
  getServicePlanElementSongRefs,
  type ServicePlanElement,
  type ServicePlanSongReference,
} from "../../types/servicePlan";
import { cleanPlanningTitle } from "../../integrations/servicePlanning/cleanPlanningTitle";

const normalizedLyrics = (value: string): string =>
  value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();

const compactFingerprint = (value: string): string => {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `v1-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
};

/** Stable song meaning, independent of the source occurrence ID. */
export const getServicePlanSongReferenceFingerprint = (
  songRef: ServicePlanSongReference,
): string => {
  const normalizedTitle = (songRef.kind === "pending" ? songRef.title : songRef.songName)
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
  const normalizedKey = (songRef.key || "").trim().toLocaleLowerCase();
  const meaning = JSON.stringify(songRef.kind === "pending"
    ? ["pending", normalizedTitle, normalizedLyrics(songRef.lyricsText), normalizedKey]
    : ["library", songRef.songId, normalizedTitle, normalizedKey]);
  return compactFingerprint(meaning);
};

/**
 * Build the shared song-reference patch for both Service Plan song-removal
 * surfaces. The dismissal records the source identity only when the final
 * source song is removed; a newly attached song clears that decision.
 */
export const getServicePlanSongReferencesUpdate = (
  element: ServicePlanElement,
  nextSongRefs: ServicePlanSongReference[],
): Partial<ServicePlanElement> => {
  const currentSongRefs = getServicePlanElementSongRefs(element);
  const sourceClassifiesSong = /\b(song|hymn|chorus|anthem)\b/i.test(element.sourceElementTypeRaw || "");
  const dismissedSourceRef = currentSongRefs[currentSongRefs.length - 1] || (
    sourceClassifiesSong
      ? {
        kind: "pending" as const,
        title: cleanPlanningTitle(element.sourceContentTitleRaw || richTextToPlainText(element.title)),
        lyricsText: "",
      }
      : undefined
  );
  const dismissal = !nextSongRefs.length && sourceClassifiesSong && dismissedSourceRef
    ? {
      sourceSongReferenceDismissed: true,
      sourceSongReferenceDismissedFingerprint: getServicePlanSongReferenceFingerprint(dismissedSourceRef),
      sourceSongReferenceDismissedOccurrenceId: element.sourceOccurrenceId,
    }
    : undefined;

  return {
    songRef: undefined,
    songRefs: nextSongRefs,
    ...(nextSongRefs.length
      ? {
        sourceSongReferenceDismissed: undefined,
        sourceSongReferenceDismissedFingerprint: undefined,
        sourceSongReferenceDismissedOccurrenceId: undefined,
      }
      : dismissal || {}),
  };
};
