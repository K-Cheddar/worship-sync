import type PouchDB from "pouchdb-browser";
import type { DBItem } from "@worshipsync/types";
import { discoverSongLibrary } from "@worshipsync/utils/songLibraryDiscovery";
import { loadSong } from "@worshipsync/utils/songPersistence";
import { filterAndSortSongsForSearchWithEnrichment } from "@worshipsync/utils/songSearchUtils";
import { libraryServicePlanSongRef } from "@worshipsync/integrations/servicePlanning/formatSongTitleWithKey";

const PAGE_SIZE = 200;

export type SongLibrarySnapshot = {
  songs: DBItem[];
  diagnostics: ReturnType<typeof discoverSongLibrary>["diagnostics"];
  sourceDocumentCount: number;
  docTypeCounts: Record<string, number>;
  elapsedMs: number;
};

/** Page through the local database and retain only the song read model inputs. */
export const readSongLibrary = async (db: PouchDB.Database): Promise<SongLibrarySnapshot> => {
  const startedAt = performance.now();
  const songDocuments: unknown[] = [];
  const docTypeCounts: Record<string, number> = {};
  let sourceDocumentCount = 0;
  let startkey: string | undefined;

  while (true) {
    const page = await db.allDocs({
      include_docs: true,
      limit: PAGE_SIZE,
      ...(startkey ? { startkey, skip: 1 } : {}),
    });
    if (!page.rows.length) break;
    for (const row of page.rows) {
      if (!row.doc) continue;
      sourceDocumentCount += 1;
      const docType = "docType" in row.doc && typeof row.doc.docType === "string" ? row.doc.docType : "legacy";
      if (docType === "legacy" || docType === "item" || docType.startsWith("song-v2-")) {
        const possibleSong = row.doc as unknown as Record<string, unknown>;
        if (possibleSong.type === "song" || docType.startsWith("song-v2-")) {
          songDocuments.push(row.doc);
          docTypeCounts[docType] = (docTypeCounts[docType] ?? 0) + 1;
        }
      }
    }
    const lastId = page.rows[page.rows.length - 1]?.id;
    if (!lastId || page.rows.length < PAGE_SIZE || lastId === startkey) break;
    startkey = lastId;
  }

  const result = discoverSongLibrary(songDocuments);
  return {
    songs: result.songs,
    diagnostics: result.diagnostics,
    sourceDocumentCount,
    docTypeCounts,
    elapsedMs: performance.now() - startedAt,
  };
};

export const searchSongLibrary = (songs: DBItem[], query: string) =>
  filterAndSortSongsForSearchWithEnrichment(songs, query);

export const createServicePlanReference = (song: DBItem) => libraryServicePlanSongRef(song);

export const hydrateSongFromLocalDatabase = (db: PouchDB.Database, songId: string) => loadSong(db, songId);

export const readFirstDemoBoard = async (db: PouchDB.Database) => {
  const firstPost = await db.allDocs({
    include_docs: true,
    startkey: "post:",
    endkey: "post:\ufff0",
    limit: 1,
  });
  const firstId = firstPost.rows[0]?.id;
  if (!firstId) return { boardId: null, posts: [] as unknown[] };
  const match = /^post:([^:]+):/.exec(firstId);
  if (!match) return { boardId: null, posts: [] as unknown[] };
  const { getLocalBoardPosts } = await import("@worshipsync/boards/boardSyncData");
  return { boardId: match[1], posts: await getLocalBoardPosts(db, match[1]) };
};
