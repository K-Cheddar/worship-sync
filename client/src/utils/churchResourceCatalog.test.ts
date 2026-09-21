import { buildChurchResourceLibraryEntries, resourceEntryName } from "./churchResourceCatalog";
import type { DBItem } from "../types";

describe("church resource catalog", () => {
  it("combines ChurchResources with virtual SongAudio entries without migrating audio", () => {
    const resource = {
      id: "churchResource_1",
      churchId: "church-1",
      name: "Guidelines.pdf",
      kind: "document" as const,
      storage: {
        key: "churches/church-1/files/churchResource_1/original",
        fileName: "Guidelines.pdf",
        contentType: "application/pdf",
        sizeBytes: 100,
        uploadedAt: "2026-09-21T00:00:00.000Z",
      },
      createdAt: "2026-09-21T00:00:00.000Z",
      createdBy: "user-1",
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "user-1",
    };
    const song = {
      _id: "song-1",
      type: "song",
      name: "Trust and Obey",
      songAudio: {
        id: "audio-1",
        key: "churches/church-1/songs/song-1/audio-1.mp3",
        fileName: "rehearsal.mp3",
        contentType: "audio/mpeg" as const,
        sizeBytes: 200,
        uploadedAt: "2026-09-21T00:00:00.000Z",
      },
    } as DBItem;

    const entries = buildChurchResourceLibraryEntries({ resources: [resource], songs: [song] });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ source: "church-resource", resource });
    expect(entries[1]).toMatchObject({ source: "song-audio", songId: "song-1", songName: "Trust and Obey" });
    expect(resourceEntryName(entries[1])).toBe("rehearsal.mp3");
    expect(resource).not.toHaveProperty("songAudio");
  });
});

