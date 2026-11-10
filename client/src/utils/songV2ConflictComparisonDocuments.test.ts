import {
  loadSongV2ConflictComparisonDocuments,
  type SongV2ConflictRevisionOptions,
} from "./songV2ReplicationConflicts";
import {
  getSongV2ArrangementDocId,
  getSongV2SlideDocId,
  type SongV2Snapshot,
} from "./songPersistence";
import type { SongV2ArrangementDocument, SongV2RootDocument, SongV2SlideDocument } from "../types";

const currentArrangement = {
  _id: getSongV2ArrangementDocId("song-1", "current"),
  _rev: "2-current",
  docType: "song-v2-arrangement",
  songId: "song-1",
  arrangementId: "current",
  name: "Full Band",
  formattedLyrics: [],
  songOrder: [],
  slideIds: ["current-slide"],
} as SongV2ArrangementDocument;

const currentSlide = {
  _id: getSongV2SlideDocId("song-1", "current", "current-slide"),
  _rev: "1-current-slide",
  docType: "song-v2-slide",
  songId: "song-1",
  arrangementId: "current",
  id: "current-slide",
  name: "Verse 1A",
  type: "Verse",
  boxes: [],
} as SongV2SlideDocument;

const branchArrangement = {
  ...currentArrangement,
  _id: getSongV2ArrangementDocId("song-1", "branch"),
  _rev: "1-branch",
  arrangementId: "branch",
  name: "Acoustic",
  slideIds: ["branch-slide"],
} as SongV2ArrangementDocument;

const branchSlide = {
  ...currentSlide,
  _id: getSongV2SlideDocId("song-1", "branch", "branch-slide"),
  _rev: "1-branch-slide",
  arrangementId: "branch",
  id: "branch-slide",
  name: "Chorus 1",
} as SongV2SlideDocument;

const snapshot: SongV2Snapshot = {
  root: {
    _id: "song-v2:root:song-1",
    _rev: "1-root",
    docType: "song-v2-root",
    songId: "song-1",
    songSchemaVersion: 2,
    name: "Better",
    selectedArrangement: 0,
    arrangementIds: ["current"],
  } as SongV2RootDocument,
  arrangements: [currentArrangement],
  slides: [currentSlide],
  hydrated: {} as SongV2Snapshot["hydrated"],
};

describe("loadSongV2ConflictComparisonDocuments", () => {
  it("loads only historical arrangement and slide references missing from the reviewed snapshot", async () => {
    const alternativeRoot = {
      ...snapshot.root,
      _rev: "2-branch-root",
      arrangementIds: ["current", "branch"],
    } as SongV2RootDocument;
    const revisionOptions: SongV2ConflictRevisionOptions[] = [{
      conflict: { documentId: snapshot.root._id, winningRevision: snapshot.root._rev!, revisions: [alternativeRoot._rev!] },
      options: [
        { revision: snapshot.root._rev!, document: snapshot.root },
        { revision: alternativeRoot._rev!, document: alternativeRoot },
      ],
    }];
    const allDocs = jest.fn()
      .mockResolvedValueOnce({ rows: [{ key: branchArrangement._id, doc: branchArrangement }] })
      .mockResolvedValueOnce({ rows: [{ key: branchSlide._id, doc: branchSlide }] });
    const db = { allDocs } as unknown as PouchDB.Database;

    const result = await loadSongV2ConflictComparisonDocuments(db, snapshot, revisionOptions);

    expect(allDocs).toHaveBeenCalledTimes(2);
    expect(allDocs).toHaveBeenNthCalledWith(1, {
      keys: [getSongV2ArrangementDocId("song-1", "branch")],
      include_docs: true,
    });
    expect(allDocs).toHaveBeenNthCalledWith(2, {
      keys: [getSongV2SlideDocId("song-1", "branch", "branch-slide")],
      include_docs: true,
    });
    expect(result.arrangements).toEqual([currentArrangement, branchArrangement]);
    expect(result.slides).toEqual([currentSlide, branchSlide]);
    expect(result.missingArrangementIds).toEqual([]);
    expect(result.missingSlideIds).toEqual([]);
  });

  it("reports missing historical references when the targeted lookup fails", async () => {
    const alternativeRoot = {
      ...snapshot.root,
      _rev: "2-branch-root",
      arrangementIds: ["current", "unavailable"],
    } as SongV2RootDocument;
    const revisionOptions: SongV2ConflictRevisionOptions[] = [{
      conflict: { documentId: snapshot.root._id, winningRevision: snapshot.root._rev!, revisions: [alternativeRoot._rev!] },
      options: [
        { revision: snapshot.root._rev!, document: snapshot.root },
        { revision: alternativeRoot._rev!, document: alternativeRoot },
      ],
    }];
    const allDocs = jest.fn().mockRejectedValue(new Error("offline"));
    const db = { allDocs } as unknown as PouchDB.Database;

    const result = await loadSongV2ConflictComparisonDocuments(db, snapshot, revisionOptions);

    expect(allDocs).toHaveBeenCalledTimes(1);
    expect(allDocs).toHaveBeenCalledWith({
      keys: [getSongV2ArrangementDocId("song-1", "unavailable")],
      include_docs: true,
    });
    expect(result.missingArrangementIds).toEqual(["unavailable"]);
    expect(result.missingSlideIds).toEqual([]);
  });
});
