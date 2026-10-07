import type { DBItem, SongAudio } from "../../types";
import type { ServicePlanSongReference } from "../../types/servicePlan";
import { buildRehearsalPlaybackQueue } from "./rehearsalPlaybackQueue";

const audio: SongAudio = {
  id: "audio-1",
  key: "songs/audio-1.mp3",
  fileName: "reference.mp3",
  contentType: "audio/mpeg",
  sizeBytes: 1024,
  uploadedAt: "2026-01-01T00:00:00.000Z",
};

const song = (id: string, options: { youtube?: string; audio?: SongAudio } = {}) => ({
  _id: id,
  name: id,
  type: "song",
  songMetadata: { source: "manual", artistName: "Artist", key: "G" },
  ...(options.youtube ? { songLinks: [{ id: `${id}-link`, url: options.youtube }] } : {}),
  ...(options.audio ? { songAudio: options.audio } : {}),
}) as unknown as DBItem;

const input = (item: DBItem, key = item._id) => ({
  key,
  song: item,
  songRef: { kind: "library", songId: item._id, songName: item.name } as ServicePlanSongReference,
});

describe("buildRehearsalPlaybackQueue", () => {
  it("creates one YouTube entry for a YouTube-only song", () => {
    const [entry] = buildRehearsalPlaybackQueue([input(song("youtube", { youtube: "https://youtu.be/aaaaaaaaaaa?t=42" }))]);
    expect(entry).toMatchObject({
      songId: "youtube",
      effectiveKey: "G",
      source: { kind: "youtube", videoId: "aaaaaaaaaaa", ranges: [{ startSeconds: 42 }] },
    });
  });

  it("creates an audio entry for an MP3-only song", () => {
    const [entry] = buildRehearsalPlaybackQueue([input(song("mp3", { audio }))]);
    expect(entry.source).toEqual({ kind: "audio", audio });
  });

  it("keeps a song with both sources as one YouTube entry by default", () => {
    const queue = buildRehearsalPlaybackQueue([input(song("both", { youtube: "https://youtu.be/aaaaaaaaaaa", audio }))]);
    expect(queue).toHaveLength(1);
    expect(queue[0].source.kind).toBe("youtube");
  });

  it("supports an explicit MP3 request without duplicating the song", () => {
    const queue = buildRehearsalPlaybackQueue([input(song("both", { youtube: "https://youtu.be/aaaaaaaaaaa", audio }))], "both");
    expect(queue).toHaveLength(1);
    expect(queue[0].source).toEqual({ kind: "audio", audio });
  });

  it("keeps a mixed YouTube to MP3 to YouTube queue in rehearsal order", () => {
    const queue = buildRehearsalPlaybackQueue([
      input(song("youtube-a", { youtube: "https://youtu.be/aaaaaaaaaaa" })),
      input(song("mp3-b", { audio })),
      input(song("youtube-c", { youtube: "https://youtu.be/ccccccccccc" })),
    ]);
    expect(queue.map(({ source }) => source.kind)).toEqual(["youtube", "audio", "youtube"]);
  });

  it("scopes queue entry keys to a service plan", () => {
    const entry = input(song("shared-song", { youtube: "https://youtu.be/aaaaaaaaaaa" }), "element-1:0");
    const serviceA = buildRehearsalPlaybackQueue([entry], undefined, "service-a");
    const serviceB = buildRehearsalPlaybackQueue([entry], undefined, "service-b");
    expect(serviceA[0].entryKey).toBe("service-a:element-1:0");
    expect(serviceB[0].entryKey).toBe("service-b:element-1:0");
  });
});
