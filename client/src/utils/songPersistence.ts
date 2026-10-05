import type {
  Arrangment,
  DBItem,
  ItemSlideType,
  SongV2ArrangementDocument,
  SongV2Documents,
  SongV2RootDocument,
  SongV2SlideDocument,
} from "../types";
import { applyPouchAudit } from "./pouchAudit";
import {
  normalizeItemSlides,
  normalizeSongForLibrary,
  normalizeSongForPersistence,
} from "./activeItemSlides";

export const SONG_SCHEMA_VERSION = 2 as const;
export const SONG_V2_ROOT_ID_PREFIX = "song-v2:root:";
export const SONG_V2_ARRANGEMENT_ID_PREFIX = "song-v2:arrangement:";
export const SONG_V2_SLIDE_ID_PREFIX = "song-v2:slide:";

const encodeIdPart = (id: string) => encodeURIComponent(id);

export const getSongV2RootDocId = (songId: string) =>
  `${SONG_V2_ROOT_ID_PREFIX}${encodeIdPart(songId)}`;

export const getSongV2ArrangementIdPrefix = (songId: string) =>
  `${SONG_V2_ARRANGEMENT_ID_PREFIX}${encodeIdPart(songId)}:`;

export const getSongV2ArrangementDocId = (
  songId: string,
  arrangementId: string,
) => `${getSongV2ArrangementIdPrefix(songId)}${encodeIdPart(arrangementId)}`;

export const getSongV2SlideIdPrefix = (songId: string, arrangementId: string) =>
  `${SONG_V2_SLIDE_ID_PREFIX}${encodeIdPart(songId)}:${encodeIdPart(arrangementId)}:`;

export const getSongV2SlideDocId = (
  songId: string,
  arrangementId: string,
  slideId: string,
) => `${getSongV2SlideIdPrefix(songId, arrangementId)}${encodeIdPart(slideId)}`;

export class SongV2DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongV2DocumentError";
  }
}

export class SongV2WriteNotEnabledError extends Error {
  constructor(songId: string, operation: "save" | "delete") {
    super(`Cannot ${operation} song ${songId}: schema v2 writes are not enabled.`);
    this.name = "SongV2WriteNotEnabledError";
  }
}

export class SongV2BaselineRequiredError extends Error {
  constructor(songId: string) {
    super(`Cannot save schema v2 song ${songId} without its authored editing baseline.`);
    this.name = "SongV2BaselineRequiredError";
  }
}

const getAuditFields = (
  song: Pick<DBItem, "createdAt" | "updatedAt" | "createdBy" | "updatedBy">,
) => ({
  ...(song.createdAt !== undefined ? { createdAt: song.createdAt } : {}),
  ...(song.updatedAt !== undefined ? { updatedAt: song.updatedAt } : {}),
  ...(song.createdBy !== undefined ? { createdBy: song.createdBy } : {}),
  ...(song.updatedBy !== undefined ? { updatedBy: song.updatedBy } : {}),
});

const assertUniqueIds = (ids: string[], description: string) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) {
      throw new SongV2DocumentError(
        `Song schema v2 requires unique, non-empty ${description} IDs; found ${JSON.stringify(id)}.`,
      );
    }
    seen.add(id);
  }
};

const assertValidV2Root = (root: SongV2RootDocument) => {
  if (
    root.docType !== "song-v2-root" ||
    "type" in root ||
    root._id !== getSongV2RootDocId(root.songId)
  ) {
    throw new SongV2DocumentError(
      `Song ${root.songId} has an invalid schema v2 root document.`,
    );
  }
  if (root.songSchemaVersion !== SONG_SCHEMA_VERSION) {
    throw new SongV2DocumentError(
      `Song ${root.songId} has unsupported schema version ${root.songSchemaVersion}.`,
    );
  }
  if (!Array.isArray(root.arrangementIds)) {
    throw new SongV2DocumentError(
      `Song ${root.songId} has no valid arrangement reference list.`,
    );
  }
};

/** Purely splits a hydrated song into deterministic v2 documents. */
export function serializeSongToV2Documents(song: DBItem): SongV2Documents {
  if (song.type !== "song") throw new Error("Only songs can be serialized as schema v2");
  const hydrated = normalizeSongForLibrary(song);
  const arrangements = hydrated.arrangements ?? [];
  const arrangementIds = arrangements.map(({ id }) => id);
  assertUniqueIds(arrangementIds, "arrangement");

  const root: SongV2RootDocument = {
    _id: getSongV2RootDocId(song._id),
    docType: "song-v2-root",
    songId: song._id,
    songSchemaVersion: SONG_SCHEMA_VERSION,
    name: hydrated.name,
    selectedArrangement: hydrated.selectedArrangement ?? 0,
    arrangementIds,
    ...getAuditFields(hydrated),
    ...(hydrated.shouldSkipTitle !== undefined
      ? { shouldSkipTitle: hydrated.shouldSkipTitle }
      : {}),
    ...(hydrated.background !== undefined ? { background: hydrated.background } : {}),
    ...(hydrated.shouldSendTo !== undefined
      ? { shouldSendTo: hydrated.shouldSendTo }
      : {}),
    ...(hydrated.songMetadata !== undefined
      ? { songMetadata: hydrated.songMetadata }
      : {}),
    ...(hydrated.songLinks !== undefined ? { songLinks: hydrated.songLinks } : {}),
    ...(hydrated.songAudio !== undefined ? { songAudio: hydrated.songAudio } : {}),
  };

  const arrangementDocuments: SongV2ArrangementDocument[] = [];
  const slideDocuments: SongV2SlideDocument[] = [];
  for (const arrangement of arrangements) {
    const slides = arrangement.slides ?? [];
    const slideIds = slides.map(({ id }) => id);
    assertUniqueIds(slideIds, `slide in arrangement ${arrangement.id}`);
    arrangementDocuments.push({
      _id: getSongV2ArrangementDocId(song._id, arrangement.id),
      docType: "song-v2-arrangement",
      songId: song._id,
      arrangementId: arrangement.id,
      name: arrangement.name,
      formattedLyrics: arrangement.formattedLyrics,
      songOrder: arrangement.songOrder,
      slideIds,
      ...getAuditFields(hydrated),
      ...(arrangement.monitorLayout !== undefined
        ? { monitorLayout: arrangement.monitorLayout }
        : {}),
    });

    for (const slide of slides) {
      const {
        monitorCurrentBandBoxes: _monitorCurrentBandBoxes,
        monitorNextBandBoxes: _monitorNextBandBoxes,
        ...durableSlide
      } = slide as ItemSlideType & {
        monitorCurrentBandBoxes?: ItemSlideType["boxes"];
        monitorNextBandBoxes?: ItemSlideType["boxes"];
      };
      slideDocuments.push({
        _id: getSongV2SlideDocId(song._id, arrangement.id, slide.id),
        ...durableSlide,
        docType: "song-v2-slide",
        songId: song._id,
        arrangementId: arrangement.id,
        ...getAuditFields(hydrated),
      });
    }
  }

  return { root, arrangements: arrangementDocuments, slides: slideDocuments };
}

/** Rebuilds the application-facing song shape using only authoritative references. */
export function hydrateSongFromV2Documents(
  root: SongV2RootDocument,
  arrangementDocuments: SongV2ArrangementDocument[],
  slideDocuments: SongV2SlideDocument[],
  structural = false,
): DBItem {
  assertValidV2Root(root);
  assertUniqueIds(root.arrangementIds, `song ${root.songId} arrangement reference`);

  const arrangementsById = new Map(
    arrangementDocuments
      .filter((document) => document.songId === root.songId)
      .map((document) => [document.arrangementId, document]),
  );
  const slidesByArrangement = new Map<string, Map<string, SongV2SlideDocument>>();
  for (const document of slideDocuments) {
    if (document.songId !== root.songId) continue;
    const slides = slidesByArrangement.get(document.arrangementId) ?? new Map();
    slides.set(document.id, document);
    slidesByArrangement.set(document.arrangementId, slides);
  }

  const arrangements: Arrangment[] = root.arrangementIds.map((arrangementId) => {
    const arrangement = arrangementsById.get(arrangementId);
    if (!arrangement) {
      throw new SongV2DocumentError(
        `Song ${root.songId} references missing arrangement ${arrangementId}.`,
      );
    }
    if (
      arrangement.docType !== "song-v2-arrangement" ||
      arrangement.songId !== root.songId ||
      arrangement.arrangementId !== arrangementId ||
      !Array.isArray(arrangement.slideIds)
    ) {
      throw new SongV2DocumentError(
        `Song ${root.songId} arrangement ${arrangementId} has an invalid document contract.`,
      );
    }
    assertUniqueIds(
      arrangement.slideIds,
      `song ${root.songId} arrangement ${arrangementId} slide reference`,
    );
    const slidesById = slidesByArrangement.get(arrangementId) ?? new Map();
    const slides = arrangement.slideIds.map((slideId) => {
      const slide = slidesById.get(slideId);
      if (!slide) {
        throw new SongV2DocumentError(
          `Song ${root.songId} arrangement ${arrangementId} references missing slide ${slideId}.`,
        );
      }
      if (
        slide.docType !== "song-v2-slide" ||
        slide.songId !== root.songId ||
        slide.arrangementId !== arrangementId
      ) {
        throw new SongV2DocumentError(
          `Song ${root.songId} arrangement ${arrangementId} slide ${slideId} has an invalid document contract.`,
        );
      }
      if (slide._id !== getSongV2SlideDocId(root.songId, arrangementId, slideId)) {
        throw new SongV2DocumentError(
          `Song ${root.songId} arrangement ${arrangementId} slide ${slideId} has an invalid document ID.`,
        );
      }
      const {
        _id,
        _rev,
        docType: _docType,
        songId: _songId,
        arrangementId: _arrangementId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        createdBy: _createdBy,
        updatedBy: _updatedBy,
        ...authoredSlide
      } = slide;
      return authoredSlide;
    });
    if (arrangement._id !== getSongV2ArrangementDocId(root.songId, arrangementId)) {
      throw new SongV2DocumentError(
        `Song ${root.songId} arrangement ${arrangementId} has an invalid document ID.`,
      );
    }
    return {
      id: arrangement.arrangementId,
      name: arrangement.name,
      formattedLyrics: arrangement.formattedLyrics,
      songOrder: arrangement.songOrder,
      ...(arrangement.monitorLayout !== undefined
        ? { monitorLayout: arrangement.monitorLayout }
        : {}),
      slides,
    };
  });

  const normalize = structural ? normalizeSongForLibrary : normalizeItemSlides;
  const hydrated = normalize({
    _id: root.songId,
    ...(root._rev !== undefined ? { _rev: root._rev } : {}),
    docType: root.docType,
    type: "song",
    name: root.name,
    selectedArrangement: root.selectedArrangement,
    arrangements,
    slides: [],
    ...(root.shouldSkipTitle !== undefined
      ? { shouldSkipTitle: root.shouldSkipTitle }
      : {}),
    ...(root.background !== undefined ? { background: root.background } : {}),
    ...(root.shouldSendTo !== undefined ? { shouldSendTo: root.shouldSendTo } : {}),
    ...(root.songMetadata !== undefined ? { songMetadata: root.songMetadata } : {}),
    ...(root.songLinks !== undefined ? { songLinks: root.songLinks } : {}),
    ...(root.songAudio !== undefined ? { songAudio: root.songAudio } : {}),
    ...getAuditFields(root),
  } as DBItem);
  return structural ? { ...hydrated, slides: [] } : hydrated;
}

/** A deterministic library read model; child revisions and authored slides stay in persistence. */
export function buildSongV2LibraryProjection(
  root: SongV2RootDocument,
  arrangementDocuments: SongV2ArrangementDocument[],
): DBItem {
  assertValidV2Root(root);
  assertUniqueIds(root.arrangementIds, "arrangement reference");
  for (const arrangement of arrangementDocuments) {
    if (arrangement.songId !== root.songId || !root.arrangementIds?.includes(arrangement.arrangementId)) continue;
    if (typeof arrangement.name !== "string" || !Array.isArray(arrangement.formattedLyrics) ||
      arrangement.formattedLyrics.some((lyric) => !lyric || typeof lyric.words !== "string") ||
      !Array.isArray(arrangement.songOrder) || !Array.isArray(arrangement.slideIds)) {
      throw new SongV2DocumentError(`Song ${root.songId} arrangement ${arrangement.arrangementId} has an invalid library contract.`);
    }
    assertUniqueIds(arrangement.slideIds, "slide reference");
  }
  return hydrateSongFromV2Documents(
    root,
    arrangementDocuments.map((arrangement) => ({ ...arrangement, slideIds: [] })),
    [],
    true,
  );
}

/** Resolves only the ordered arrangement manifest, never slide documents. */
export async function loadSongV2LibraryProjection(
  db: PouchDB.Database,
  root: SongV2RootDocument,
): Promise<DBItem> {
  assertValidV2Root(root);
  const arrangements = await getReferencedDocuments<SongV2ArrangementDocument>(
    db, root.arrangementIds.map((id) => getSongV2ArrangementDocId(root.songId, id)),
  );
  return buildSongV2LibraryProjection(root, arrangements);
}

/** Reduces an acknowledged hydrated v2 song to the global library read model. */
export function songToLibraryProjection(song: DBItem): DBItem {
  if (song.docType !== "song-v2-root") return song;
  const documents = serializeSongToV2Documents(song);
  const root = {
    ...documents.root,
    ...(song._rev ? { _rev: song._rev } : {}),
    ...getAuditFields(song),
  };
  return buildSongV2LibraryProjection(root, documents.arrangements);
}

export const isPouchNotFoundError = (error: unknown) =>
  typeof error === "object" && error !== null &&
  (("status" in error && error.status === 404) ||
    ("name" in error && error.name === "not_found"));

const getOptionalDocument = async <T,>(
  db: PouchDB.Database,
  id: string,
): Promise<T | null> => {
  try {
    return (await db.get(id)) as T;
  } catch (error) {
    if (isPouchNotFoundError(error)) return null;
    throw error;
  }
};

const getReferencedDocuments = async <T,>(
  db: PouchDB.Database,
  ids: string[],
): Promise<T[]> => {
  if (!ids.length) return [];
  const result = await db.allDocs({ keys: ids, include_docs: true });
  return result.rows.flatMap((row) =>
    "doc" in row && row.doc ? [row.doc as unknown as T] : [],
  );
};

export type SongV2Snapshot = SongV2Documents & { hydrated: DBItem };

const loadV2Documents = async (
  db: PouchDB.Database,
  root: SongV2RootDocument,
): Promise<SongV2Documents> => {
  const arrangementIds = root.arrangementIds.map((arrangementId) =>
    getSongV2ArrangementDocId(root.songId, arrangementId),
  );
  const arrangements = await getReferencedDocuments<SongV2ArrangementDocument>(
    db,
    arrangementIds,
  );
  for (const arrangement of arrangements) {
    if (!Array.isArray(arrangement.slideIds)) {
      throw new SongV2DocumentError(
        `Song ${root.songId} arrangement ${arrangement.arrangementId} has no valid slide reference list.`,
      );
    }
  }
  const slideIds = arrangements.flatMap((arrangement) =>
    arrangement.slideIds.map((slideId) =>
      getSongV2SlideDocId(root.songId, arrangement.arrangementId, slideId),
    ),
  );
  const slides = await getReferencedDocuments<SongV2SlideDocument>(db, slideIds);
  return { root, arrangements, slides };
};

/** Loads only authoritative v2 documents, retaining their physical revisions. */
export async function loadSongV2Snapshot(
  db: PouchDB.Database,
  songId: string,
): Promise<SongV2Snapshot> {
  const root = await db.get<SongV2RootDocument>(getSongV2RootDocId(songId));
  if (root.songId !== songId) throw new SongV2DocumentError("V2 snapshot song identity mismatch");
  assertValidV2Root(root);
  const documents = await loadV2Documents(db, root);
  return {
    ...documents,
    hydrated: hydrateSongFromV2Documents(documents.root, documents.arrangements, documents.slides, true),
  };
}

/** Loads a document and hydrates songs into the editor's canonical shape. */
export async function loadItemWithSongHydration(
  db: PouchDB.Database,
  itemId: string,
): Promise<DBItem> {
  const document = await getOptionalDocument<DBItem>(db, itemId);
  if (!document) return loadSong(db, itemId);
  return document.type === "song" ? loadSong(db, itemId) : document;
}

/** Loads one song document and returns its canonical hydrated application shape. */
export async function loadSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
  );
  if (v2Root) {
    if (v2Root.songId !== songId) {
      throw new SongV2DocumentError(
        `Song ${songId} has an invalid schema v2 root document.`,
      );
    }
    assertValidV2Root(v2Root);
    const snapshot = await loadV2Documents(db, v2Root);
    return hydrateSongFromV2Documents(snapshot.root, snapshot.arrangements, snapshot.slides);
  }
  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  return normalizeItemSlides(document);
}

/** Creates a song as one canonical Pouch document with the normal audit fields. */
export async function createSong(
  db: PouchDB.Database,
  song: DBItem,
): Promise<DBItem> {
  if (song.type !== "song") throw new Error("Only songs can be created here");
  const now = new Date().toISOString();
  const persisted = applyPouchAudit(
    null,
    normalizeSongForPersistence({
      ...song,
      createdAt: song.createdAt ?? now,
      updatedAt: song.updatedAt ?? now,
    }),
    { isNew: true },
  );
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/** Saves a song as one canonical Pouch document, preserving its current audit identity. */
export async function saveSong(
  db: PouchDB.Database,
  song: DBItem,
  currentSong?: DBItem,
): Promise<DBItem> {
  if (song.type !== "song") throw new Error("Only songs can be saved here");
  if (song.docType === "song-v2-root" || currentSong?.docType === "song-v2-root") {
    if (!currentSong || currentSong.docType !== "song-v2-root") {
      throw new SongV2BaselineRequiredError(song._id);
    }
    const { saveSongV2FromBaseline } = await import("./songV2Writer");
    return (await saveSongV2FromBaseline(db, currentSong, song)).song;
  }
  const existing = currentSong ?? await loadSong(db, song._id);
  if (existing.docType === "song-v2-root") {
    if (!currentSong) throw new SongV2BaselineRequiredError(song._id);
    const { saveSongV2FromBaseline } = await import("./songV2Writer");
    return (await saveSongV2FromBaseline(db, currentSong, song)).song;
  }
  if (existing.type !== "song") {
    throw new Error(`Document ${song._id} is not a song`);
  }
  if (existing._id !== song._id) {
    throw new Error("Cannot save a song using another song's revision");
  }
  const normalized = normalizeSongForPersistence({
    ...existing,
    ...song,
    _rev: existing._rev,
  });
  const persistedFields = normalized as Record<string, unknown>;
  for (const [key, value] of Object.entries(persistedFields)) {
    if (value === undefined) delete persistedFields[key];
  }
  const persisted = applyPouchAudit(existing, normalized, { isNew: false });
  const result = await db.put(persisted);
  return normalizeItemSlides({ ...persisted, _rev: result.rev });
}

/** Tombstones the single song document and returns its prior value for cleanup. */
export async function deleteSong(
  db: PouchDB.Database,
  songId: string,
): Promise<DBItem> {
  const v2Root = await getOptionalDocument<SongV2RootDocument>(
    db,
    getSongV2RootDocId(songId),
  );
  if (v2Root) throw new SongV2WriteNotEnabledError(songId, "delete");
  const document = (await db.get(songId)) as DBItem;
  if (document.type !== "song") {
    throw new Error(`Document ${songId} is not a song`);
  }
  await db.remove(document as PouchDB.Core.RemoveDocument);
  return document;
}
