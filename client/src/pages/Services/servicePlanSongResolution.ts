/**
 * Re-asks, against the library as it stands now, the question an import
 * answered once.
 *
 * A `pending` song reference records "this title matched nothing at import
 * time" — a fact about the past. Add the song to the library the next day and
 * the stored reference still says pending, so the plan keeps calling it missing
 * and a push to the outline keeps skipping it. What anyone actually wants to
 * know is whether the library has it *now*, which is derived, not stored.
 *
 * Deriving it costs one call to the same matcher the import used, behind the
 * same confidence gate, so this adds no risk the import didn't already take.
 * Nothing is written: a derived answer cannot go stale, while a stored one
 * would just rot in the other direction when a song is later renamed or
 * deleted.
 */
import { findBestSongMatchByName } from "../../integrations/servicePlanning/findServicePlanningSongMatch";
import type { ServicePlanSection, ServicePlanSongReference } from "../../types/servicePlan";

/**
 * The reference to use for a plan element right now — the stored one, unless a
 * pending title has since become a real library song.
 */
export const resolveServicePlanSongRef = <T extends { _id: string; name: string }>(
  songRef: ServicePlanSongReference | undefined,
  songs: T[],
): ServicePlanSongReference | undefined => {
  if (!songRef || songRef.kind !== "pending") return songRef;
  // A pending reference carrying its own lyrics holds content the library song
  // wouldn't show, so it stays as it is rather than being quietly replaced.
  if (songRef.lyricsText.trim()) return songRef;

  const matched = findBestSongMatchByName(songRef.title, songs);
  return matched
    ? { kind: "library", songId: matched._id, songName: matched.name }
    : songRef;
};

/**
 * Every element whose stored reference is now out of date, keyed by element id.
 *
 * Only changed entries are included, so callers fall back to the element's own
 * reference and the map stays empty for the common case where nothing has
 * moved. Built once per plan rather than per row — matching runs over the whole
 * library, and a plan has many rows.
 */
export const resolveServicePlanSongRefs = <T extends { _id: string; name: string }>(
  sections: ServicePlanSection[] | null | undefined,
  songs: T[],
): ReadonlyMap<string, ServicePlanSongReference> => {
  const resolved = new Map<string, ServicePlanSongReference>();
  if (!sections?.length || !songs.length) return resolved;

  for (const section of sections) {
    for (const element of section.elements) {
      const next = resolveServicePlanSongRef(element.songRef, songs);
      if (next && next !== element.songRef) resolved.set(element.id, next);
    }
  }
  return resolved;
};
