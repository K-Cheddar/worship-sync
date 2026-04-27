import type { ServiceItem } from "../../types";
import { getMatchForString } from "../../utils/generalUtils";
import { cleanPlanningTitle } from "./cleanPlanningTitle";

const SONG_MATCH_THRESHOLD = 1;
const SONG_MATCH_MIN_RATIO = 0.75;

const uniqueNonEmptyValues = (values: string[]): string[] =>
  Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value)),
  );

export const getServicePlanningSongMatchScore = (
  planningTitle: string,
  songName: string,
): number => {
  const searchValues = uniqueNonEmptyValues([
    cleanPlanningTitle(planningTitle).toLowerCase(),
  ]);
  const songNameVariants = uniqueNonEmptyValues([
    songName,
    cleanPlanningTitle(songName),
  ]);

  let bestScore = 0;

  for (const searchValue of searchValues) {
    for (const songNameVariant of songNameVariants) {
      bestScore = Math.max(
        bestScore,
        getMatchForString({
          string: songNameVariant,
          searchValue,
        }),
      );
    }
  }

  return bestScore;
};

export const findBestServicePlanningSongMatch = (
  planningTitle: string,
  songs: ServiceItem[],
): ServiceItem | null => {
  const termCount = cleanPlanningTitle(planningTitle)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean).length;
  const threshold = Math.max(SONG_MATCH_THRESHOLD, termCount * SONG_MATCH_MIN_RATIO);

  let bestSong: ServiceItem | null = null;
  let bestScore = threshold;

  for (const song of songs) {
    const score = getServicePlanningSongMatchScore(planningTitle, song.name);
    if (score > bestScore) {
      bestScore = score;
      bestSong = song;
    }
  }

  return bestSong;
};
