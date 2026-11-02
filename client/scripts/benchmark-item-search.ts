import { performance } from "node:perf_hooks";
import {
  filterAndSortSongsForSearch,
  prepareItemSearchDocuments,
} from "../src/utils/songSearchUtils";
import type { DBItem } from "../src/types";

// From client/: node --expose-gc --import tsx scripts/benchmark-item-search.ts
const verses = [
  "Amazing grace how sweet the sound that saved a wretch like me I once was lost but now am found was blind but now I see",
  "The Lord is my shepherd I shall not want He leads me beside quiet waters and restores my soul through the valley of the shadow",
  "Holy holy holy Lord God almighty early in the morning our song shall rise to thee merciful and mighty blessed trinity we worship your name",
  "Great are you Lord you give life you are love you bring light to the darkness you give hope you restore every heart that is broken",
  "Hallelujah sing with joy forever all creation joins together heaven and earth proclaim your glory praise and honor wisdom power strength belong to you alone",
  "How great thou art when through the woods and forest glades I wander and hear the birds sing sweetly in the trees my soul will sing",
];
// Each song has its own lyric family; section/arrangement variation stays unique.
const makeLibrary = (size: number): DBItem[] =>
  Array.from({ length: size }, (_, i) => ({
    _id: `song-${i}`,
    name: `${["Amazing Grace", "Quiet Waters", "Holy Spirit", "Great Are You Lord", "Hallelujah", "How Great Thou Art"][i % 6]} ${i}`,
    type: "song",
    selectedArrangement: 0,
    slides: [],
    arrangements: Array.from({ length: 3 }, (_, a) => ({
      id: `arr-${a}`,
      name: `Arrangement ${a}`,
      songOrder: [],
      slides: [],
      formattedLyrics: Array.from({ length: 6 }, (_, section) => ({
        id: `section-${section}`,
        name: `Verse ${section}`,
        type: "Verse",
        slideSpan: 1,
        words: `${verses[i % verses.length]} ${a ? "Sing together with all our hearts" : ""} ${i} ${section}`,
      })),
    })),
  })) as DBItem[];
const queries = [
  "Amazing Grace 120",
  "how sweet the sound",
  "sound sweet",
  "sheperd",
  "holy spirt",
  "zzzzunmatched",
];
for (const size of [1000, 5000]) {
  const songs = makeLibrary(size);
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  filterAndSortSongsForSearch(songs, queries[0]);
  const coldMs = performance.now() - start;
  const vocabularySize = prepareItemSearchDocuments(songs).length;
  global.gc?.();
  const cacheMiB = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  console.log(
    JSON.stringify({
      size,
      arrangements: 3,
      sections: 6,
      vocabularySize,
      coldMs: +coldMs.toFixed(1),
      cacheMiB: +cacheMiB.toFixed(1),
    }),
  );
  for (const query of queries) {
    const timings: number[] = [];
    let results = 0;
    for (let iteration = 0; iteration < 12; iteration++) {
      const start = performance.now();
      results = filterAndSortSongsForSearch(songs, query).length;
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        query,
        results,
        medianMs: +timings[6].toFixed(1),
        p95Ms: +timings[11].toFixed(1),
      }),
    );
  }
}
