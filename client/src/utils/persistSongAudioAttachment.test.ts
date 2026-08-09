import {
  deleteSongAudioBeforeClearingMetadata,
  persistSongAudioAttachment,
} from "./persistSongAudioAttachment";

describe("persistSongAudioAttachment", () => {
  const audio = {
    id: "audio-2",
    key: "churches/church-1/songs/song-1/audio-2.mp3",
    fileName: "reference.mp3",
    contentType: "audio/mpeg" as const,
    sizeBytes: 100,
    uploadedAt: "2026-08-06T00:00:00.000Z",
  };

  it("writes replacement metadata without mutating the previous document", async () => {
    const existing = {
      _id: "song-1",
      _rev: "1-old",
      name: "Song",
      type: "song",
      songAudio: { ...audio, id: "audio-1", key: "old-key" },
    };
    const put = jest.fn().mockResolvedValue({ rev: "2-new" });
    const db = { get: jest.fn().mockResolvedValue(existing), put } as any;

    const saved = await persistSongAudioAttachment({
      db,
      songId: "song-1",
      audio,
    });

    expect(existing.songAudio.id).toBe("audio-1");
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ songAudio: audio }));
    expect(saved).toEqual(expect.objectContaining({ _rev: "2-new", songAudio: audio }));
  });

  it("removes attachment metadata when requested", async () => {
    const existing = {
      _id: "song-1",
      _rev: "1-old",
      name: "Song",
      type: "song",
      songAudio: audio,
    };
    const put = jest.fn().mockResolvedValue({ rev: "2-new" });
    const db = { get: jest.fn().mockResolvedValue(existing), put } as any;

    const saved = await persistSongAudioAttachment({
      db,
      songId: "song-1",
      audio: null,
    });

    expect(put).toHaveBeenCalledWith(
      expect.not.objectContaining({ songAudio: expect.anything() }),
    );
    expect(saved.songAudio).toBeUndefined();
  });
});

describe("deleteSongAudioBeforeClearingMetadata", () => {
  it("clears metadata only after storage deletion succeeds", async () => {
    const operations: string[] = [];

    await deleteSongAudioBeforeClearingMetadata({
      deleteAudio: async () => {
        operations.push("delete");
      },
      clearMetadata: async () => {
        operations.push("persist");
        return "saved";
      },
    });

    expect(operations).toEqual(["delete", "persist"]);
  });

  it("preserves metadata when storage deletion fails", async () => {
    const clearMetadata = jest.fn();

    await expect(
      deleteSongAudioBeforeClearingMetadata({
        deleteAudio: async () => {
          throw new Error("R2 unavailable");
        },
        clearMetadata,
      }),
    ).rejects.toThrow("R2 unavailable");
    expect(clearMetadata).not.toHaveBeenCalled();
  });
});
