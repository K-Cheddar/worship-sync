import type { DBItem } from "../../types";
import {
  getServicePlanElementSongRefs,
  type ServicePlanSection,
  type ServicePlanSongReference,
} from "../../types/servicePlan";

export type ServicePlanRehearsalEntry = {
  key: string;
  songRef: ServicePlanSongReference;
  song?: DBItem;
  usageCount: number;
  occurrenceNumbers: number[];
};

type PlanSongOccurrence = {
  key: string;
  songRef: ServicePlanSongReference;
  song?: DBItem;
};

export const getEffectiveServicePlanSongKey = (
  songRef: ServicePlanSongReference,
  song?: DBItem,
) =>
  songRef.key?.trim() || song?.songMetadata?.key?.trim() || "";

/** Stable, extensible identity for a rehearsal-equivalent song reference. */
export const getServicePlanRehearsalIdentity = (
  occurrence: PlanSongOccurrence,
) => {
  if (occurrence.songRef.kind === "library") {
    return JSON.stringify([
      "library",
      occurrence.songRef.songId,
      getEffectiveServicePlanSongKey(occurrence.songRef, occurrence.song),
    ]);
  }
  if (occurrence.songRef.id?.trim()) {
    return JSON.stringify(["pending", occurrence.songRef.id.trim()]);
  }
  return JSON.stringify(["pending-occurrence", occurrence.key]);
};

export const buildServicePlanRehearsalEntries = (
  sections: ServicePlanSection[] | null | undefined,
  songs: DBItem[],
  resolvedSongRefs: ReadonlyMap<string, ServicePlanSongReference[]>,
): ServicePlanRehearsalEntry[] => {
  const songsById = new Map(songs.map((song) => [song._id, song]));
  const grouped = new Map<string, ServicePlanRehearsalEntry>();
  let planElementNumber = 0;

  for (const section of sections ?? []) {
    for (const element of section.elements) {
      planElementNumber += 1;
      const songRefs =
        resolvedSongRefs.get(element.id) ?? getServicePlanElementSongRefs(element);
      for (const [songIndex, songRef] of songRefs.entries()) {
        const key = `${element.id}:${songIndex}`;
        const song = songRef.kind === "library" ? songsById.get(songRef.songId) : undefined;
        const identity = getServicePlanRehearsalIdentity({ key, songRef, song });
        const existing = grouped.get(identity);
        if (existing) {
          existing.usageCount += 1;
          existing.occurrenceNumbers.push(planElementNumber);
        } else {
          grouped.set(identity, {
            key,
            songRef,
            song,
            usageCount: 1,
            occurrenceNumbers: [planElementNumber],
          });
        }
      }
    }
  }

  return [...grouped.values()];
};
