import type { ServiceItem } from "../../types";
import { getMatchForString } from "../../utils/generalUtils";
import { cleanPlanningTitle } from "./cleanPlanningTitle";

const SONG_MATCH_THRESHOLD = 1;

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
  let bestSong: ServiceItem | null = null;
  let bestScore = SONG_MATCH_THRESHOLD;

  for (const song of songs) {
    const score = getServicePlanningSongMatchScore(planningTitle, song.name);
    if (score > bestScore) {
      bestScore = score;
      bestSong = song;
    }
  }

  return bestSong;
};
