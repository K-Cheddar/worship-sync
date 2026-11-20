const generations = new WeakMap<PouchDB.Database, number>();

export const invalidateSongLibraryRefresh = (db: PouchDB.Database) => {
  const next = (generations.get(db) ?? 0) + 1;
  generations.set(db, next);
  return next;
};

export const beginSongLibraryRefresh = invalidateSongLibraryRefresh;

export const isCurrentSongLibraryRefresh = (db: PouchDB.Database, generation: number) =>
  generations.get(db) === generation;
