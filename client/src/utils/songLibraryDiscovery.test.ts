import type { DBItem } from "../types";
import { discoverSongLibrary } from "./songLibraryDiscovery";
import { buildSongV2LibraryProjection, loadSongV2LibraryProjection, serializeSongToV2Documents } from "./songPersistence";
import { filterAndSortSongsForSearchWithEnrichment } from "./songSearchUtils";
import * as monitor from "./monitorSlideFormatter";

const fixture = () => serializeSongToV2Documents({
  _id: "song/1", type: "song", name: "Living Hope", selectedArrangement: 0,
  songMetadata: { artistName: "Phil Wickham" },
  arrangements: [
    { id: "a", name: "Master", formattedLyrics: [{ words: "Amazing grace" }], songOrder: [], slides: [{ id: "a1", type: "Verse", name: "Verse", boxes: [] }] },
    { id: "b", name: "Acoustic", formattedLyrics: [{ words: "Mercy everlasting" }], songOrder: [], slides: [{ id: "b1", type: "Verse", name: "Verse", boxes: [] }] },
  ], slides: [],
} as unknown as DBItem);

describe("song library discovery", () => {
  afterEach(() => jest.restoreAllMocks());

  it("leaves v1 documents unchanged", () => {
    const song = { _id: "legacy", type: "song", name: "Legacy" } as DBItem;
    expect(discoverSongLibrary([song])).toEqual({ songs: [song], diagnostics: [] });
    expect(discoverSongLibrary([song]).songs[0]).toBe(song);
  });

  it("projects root metadata and arrangements without slides, child revisions, or DOM measurement", () => {
    const docs = fixture();
    docs.root._rev = "1-root";
    docs.arrangements[0]._rev = "4-child";
    const measurement = jest.spyOn(monitor, "getMonitorLayoutForSlides").mockImplementation(() => { throw new Error("DOM measurement"); });
    const result = discoverSongLibrary([docs.root, ...docs.arrangements]);
    expect(result.diagnostics).toEqual([]);
    expect(result.songs).toHaveLength(1);
    expect(result.songs[0]).toMatchObject({ _id: "song/1", _rev: "1-root", docType: "song-v2-root", type: "song", name: "Living Hope" });
    expect(result.songs[0].arrangements.map((arrangement) => arrangement.slides)).toEqual([[], []]);
    expect(result.songs[0].arrangements[0]).not.toHaveProperty("_rev");
    expect(measurement).not.toHaveBeenCalled();
  });

  it.each(["living hope", "phil wickham", "amazing grace", "mercy everlasting"])("finds %s without any slide read, including non-selected lyrics", async (query) => {
    const docs = fixture();
    const allDocs = jest.fn(async () => ({ rows: [...docs.arrangements].reverse().map((doc) => ({ doc })) }));
    const db = { allDocs } as unknown as PouchDB.Database;
    const projection = await loadSongV2LibraryProjection(db, docs.root);
    expect(filterAndSortSongsForSearchWithEnrichment([projection], query).map((row) => row.song._id)).toEqual([docs.root.songId]);
    expect(allDocs).toHaveBeenCalledTimes(1);
    expect(allDocs).toHaveBeenCalledWith({ keys: docs.arrangements.map((doc) => doc._id), include_docs: true });
  });

  it("uses manifest order and ignores orphan arrangements and slides", () => {
    const docs = fixture();
    docs.root.arrangementIds = ["b", "a"];
    const orphan = { ...docs.arrangements[0], arrangementId: "orphan", _id: "orphan" };
    const result = discoverSongLibrary([orphan, ...docs.slides, docs.root, ...docs.arrangements]);
    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].arrangements.map((arrangement) => arrangement.id)).toEqual(["b", "a"]);
    expect(discoverSongLibrary([orphan, ...docs.slides]).songs).toEqual([]);
  });

  it.each([false, true])("gives v2 authority independent of scan order (%s)", (reverse) => {
    const docs = fixture();
    const v1 = { _id: docs.root.songId, type: "song", name: "Stale", background: "stale" } as DBItem;
    const documents = [v1, docs.root, ...docs.arrangements];
    const result = discoverSongLibrary(reverse ? documents.reverse() : documents);
    expect(result.songs).toHaveLength(1);
    expect(result.songs[0].name).toBe(docs.root.name);
    expect(result.songs[0].background).toBeUndefined();
  });

  it("excludes incomplete activated songs and converges when replication supplies children", () => {
    const docs = fixture();
    const v1 = { _id: docs.root.songId, type: "song", name: "Stale" } as DBItem;
    const incomplete = discoverSongLibrary([v1, docs.root, docs.arrangements[0]]);
    expect(incomplete.songs).toEqual([]);
    expect(incomplete.diagnostics).toEqual([expect.objectContaining({ songId: docs.root.songId, code: "incomplete-v2", message: expect.stringContaining("missing arrangement b") })]);
    expect(discoverSongLibrary([v1, docs.root, ...docs.arrangements]).diagnostics).toEqual([]);
    expect(discoverSongLibrary([v1, docs.root, ...docs.arrangements]).songs).toHaveLength(1);
  });

  it("rejects invalid referenced arrangements instead of returning legacy data", () => {
    const docs = fixture();
    const invalid = { ...docs.arrangements[0], _id: "wrong-id" };
    expect(discoverSongLibrary([{ _id: docs.root.songId, type: "song" }, docs.root, invalid, docs.arrangements[1]]).songs).toEqual([]);
    expect(() => buildSongV2LibraryProjection(docs.root, [invalid, docs.arrangements[1]])).toThrow("invalid document ID");
  });
  it("diagnoses invalid lyric payloads before they can break library search", () => {
    const docs = fixture();
    const invalid = { ...docs.arrangements[0], formattedLyrics: [null] };
    const result = discoverSongLibrary([{ _id: docs.root.songId, type: "song", name: "Stale" }, docs.root, invalid, docs.arrangements[1]]);
    expect(result.songs).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "incomplete-v2", message: expect.stringContaining("invalid library contract") })]);
  });

});
