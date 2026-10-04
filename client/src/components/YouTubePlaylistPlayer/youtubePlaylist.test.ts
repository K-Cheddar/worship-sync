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

const linkedSong = (
  id: string,
  name: string,
  url: string,
  linkDetails: Record<string, unknown> = {},
) =>
  ({
    ...song(id, name),
    songLinks: [{ id: `${id}-link`, url, ...linkDetails }],
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

  it("preserves URL timestamps and explicit ordered ranges in one song entry", () => {
    const queue = buildYouTubePlaylistQueue([
      { key: "timestamp", song: linkedSong("timestamp", "Timestamp", "https://youtu.be/aaaaaaaaaaa?t=1m20s", { durationSeconds: 240 }) },
      { key: "single", song: linkedSong("single", "Single range", "https://youtu.be/ccccccccccc?t=5", {
        durationSeconds: 200,
        segments: [{ id: "only", startSeconds: 40, endSeconds: 65 }],
      }) },
      { key: "trimmed", song: linkedSong("trimmed", "Trimmed", "https://youtu.be/bbbbbbbbbbb?t=5", {
        durationSeconds: 300,
        segments: [
          { id: "first", startSeconds: 25, endSeconds: 55 },
          { id: "second", startSeconds: 90, endSeconds: 130 },
        ],
      }) },
    ]);

    expect(queue[0].playbackRanges).toEqual([{ startSeconds: 80 }]);
    expect(queue[0].durationSeconds).toBe(160);
    expect(queue[1].playbackRanges).toEqual([{ startSeconds: 40, endSeconds: 65 }]);
    expect(queue[1].durationSeconds).toBe(25);
    expect(queue[2].playbackRanges).toEqual([
      { startSeconds: 25, endSeconds: 55 },
      { startSeconds: 90, endSeconds: 130 },
    ]);
    expect(queue[2].durationSeconds).toBe(70);
    expect(queue[2].entryKey).toBe("trimmed");
  });

  it("calculates open-ended and unknown trimmed durations without inventing one", () => {
    const queue = buildYouTubePlaylistQueue([
      { key: "known", song: linkedSong("known", "Known", "https://youtu.be/aaaaaaaaaaa", {
        durationSeconds: 240,
        segments: [{ id: "open", startSeconds: 75 }],
      }) },
      { key: "unknown", song: linkedSong("unknown", "Unknown", "https://youtu.be/bbbbbbbbbbb", {
        segments: [{ id: "open", startSeconds: 75 }],
      }) },
    ]);

    expect(queue[0].durationSeconds).toBe(165);
    expect(queue[1].durationSeconds).toBeUndefined();
  });
});
