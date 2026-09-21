import type { DBItem } from "../../types";
import {
  buildYouTubePlaylistQueue,
  findAvailablePlaylistIndex,
} from "./youtubePlaylist";

const song = (id: string, name: string, url?: string): DBItem =>
  ({
    _id: id,
    name,
    type: "song",
    selectedArrangement: 0,
    arrangements: [],
    slides: [],
    shouldSendTo: { projector: true, monitor: true, stream: true },
    ...(url ? { songLinks: [{ id: `${id}-link`, url }] } : {}),
  }) as DBItem;

describe("YouTube rehearsal playlist", () => {
  it("follows Set List order and excludes songs without a linked video", () => {
    const queue = buildYouTubePlaylistQueue([
      { key: "one", song: song("one", "First", "https://youtu.be/aaaaaaaaaaa") },
      { key: "two", song: song("two", "Missing") },
      { key: "three", song: song("three", "Third", "https://www.youtube.com/watch?v=bbbbbbbbbbb") },
    ]);

    expect(queue.map((entry) => [entry.entryKey, entry.title, entry.videoId])).toEqual([
      ["one", "First", "aaaaaaaaaaa"],
      ["three", "Third", "bbbbbbbbbbb"],
    ]);
  });

  it("supports Play All, next, previous, and skipped unavailable entries", () => {
    const queue = buildYouTubePlaylistQueue([
      { key: "one", song: song("one", "First", "https://youtu.be/aaaaaaaaaaa") },
      { key: "two", song: song("two", "Second", "https://youtu.be/bbbbbbbbbbb") },
      { key: "three", song: song("three", "Third", "https://youtu.be/ccccccccccc") },
    ]);
    const failed = new Set(["two"]);

    expect(findAvailablePlaylistIndex(queue, failed, 0, 1)).toBe(0);
    expect(findAvailablePlaylistIndex(queue, failed, 1, 1)).toBe(2);
    expect(findAvailablePlaylistIndex(queue, failed, 1, -1)).toBe(0);
    expect(findAvailablePlaylistIndex(queue, new Set(["one", "two", "three"]), 0, 1)).toBeNull();
  });
});
