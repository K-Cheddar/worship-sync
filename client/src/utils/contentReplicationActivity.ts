const activeByDatabase = new Map<string, Set<symbol>>();
const bibleDocumentActivityByDatabase = new Map<string, Set<symbol>>();
const contentDatabaseSessions = new Map<
  string,
  { token: symbol; initialReplicationComplete: boolean }
>();
const activityListeners = new Set<() => void>();
const VERIFIED_CONTENT_REPLICATION_DOC_ID =
  "_local/worship-sync-initial-content-replication-v1";

type VerifiedContentReplicationDoc = {
  _id: string;
  _rev?: string;
  localDatabaseName: string;
  sourceDatabaseName: string;
  complete: true;
};

const isNotFound = (error: unknown) => {
  const pouchError = error as { status?: number | string; name?: string };
  return pouchError?.status === 404 || pouchError?.status === "404" || pouchError?.name === "not_found";
};

const notifyActivityChanged = () => {
  activityListeners.forEach((listener) => listener());
};

export const subscribeToContentActivity = (listener: () => void) => {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
};

export type ContentReplicationActivity = {
  setBusy: (busy: boolean) => void;
  release: () => void;
};

/** Track replication across Controller providers that share one local PouchDB. */
export const trackContentReplication = (
  databaseName: string,
): ContentReplicationActivity => {
  const token = Symbol(databaseName);
  let busy = false;
  let released = false;
  const setBusy = (nextBusy: boolean) => {
    if (released || busy === nextBusy) return;
    busy = nextBusy;
    const active = activeByDatabase.get(databaseName);
    if (busy) {
      const next = active ?? new Set<symbol>();
      next.add(token);
      activeByDatabase.set(databaseName, next);
    } else {
      active?.delete(token);
      if (active?.size === 0) activeByDatabase.delete(databaseName);
    }
    notifyActivityChanged();
  };
  const release = () => {
    if (released) return;
    released = true;
    if (!busy) return;
    busy = false;
    const active = activeByDatabase.get(databaseName);
    active?.delete(token);
    if (active?.size === 0) activeByDatabase.delete(databaseName);
    notifyActivityChanged();
  };
  setBusy(true);
  return { setBusy, release };
};

export const isContentReplicationIdle = (databaseName: string): boolean =>
  (activeByDatabase.get(databaseName)?.size ?? 0) === 0;

export const beginContentDatabaseSession = (databaseName: string) => {
  const token = Symbol(databaseName);
  contentDatabaseSessions.set(databaseName, {
    token,
    initialReplicationComplete: false,
  });
  notifyActivityChanged();

  return {
    token,
    markInitialReplicationComplete: () => {
      const current = contentDatabaseSessions.get(databaseName);
      if (current?.token !== token || current.initialReplicationComplete) return;
      contentDatabaseSessions.set(databaseName, {
        token,
        initialReplicationComplete: true,
      });
      notifyActivityChanged();
    },
    release: () => {
      if (contentDatabaseSessions.get(databaseName)?.token !== token) return;
      contentDatabaseSessions.delete(databaseName);
      notifyActivityChanged();
    },
  };
};

export const getContentDatabaseSessionToken = (databaseName: string) =>
  contentDatabaseSessions.get(databaseName)?.token ?? null;

export const hasSuccessfulInitialContentReplication = (
  databaseName: string,
  token: symbol | null = getContentDatabaseSessionToken(databaseName),
) => {
  const current = contentDatabaseSessions.get(databaseName);
  return Boolean(
    token && current?.token === token && current.initialReplicationComplete,
  );
};

/**
 * Persist the existing initial-pull readiness fact locally so a completed
 * library can still be used offline after the provider is recreated.
 * `_local` documents are not replicated to CouchDB.
 */
export async function recordVerifiedInitialContentReplication(
  db: PouchDB.Database,
  sourceDatabaseName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let current: VerifiedContentReplicationDoc | undefined;
    try {
      current = await db.get<VerifiedContentReplicationDoc>(VERIFIED_CONTENT_REPLICATION_DOC_ID);
      if (
        current.localDatabaseName === db.name &&
        current.sourceDatabaseName === sourceDatabaseName &&
        current.complete === true
      ) {
        return;
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    try {
      await db.put({
        _id: VERIFIED_CONTENT_REPLICATION_DOC_ID,
        ...(current?._rev ? { _rev: current._rev } : {}),
        localDatabaseName: db.name,
        sourceDatabaseName,
        complete: true,
      });
      return;
    } catch (error) {
      const pouchError = error as { status?: number | string; name?: string };
      const isConflict = pouchError?.status === 409 || pouchError?.name === "conflict";
      if (!isConflict || attempt === 2) throw error;
    }
  }
}

export async function hasVerifiedInitialContentReplication(
  db: PouchDB.Database,
  sourceDatabaseName: string = db.name,
): Promise<boolean> {
  try {
    const checkpoint = await db.get<VerifiedContentReplicationDoc>(VERIFIED_CONTENT_REPLICATION_DOC_ID);
    return checkpoint.localDatabaseName === db.name &&
      checkpoint.sourceDatabaseName === sourceDatabaseName &&
      checkpoint.complete === true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** Track Bible creation while its content document is being committed. */
export const trackBibleDocumentActivity = (databaseName: string) => {
  const token = Symbol(databaseName);
  const active = bibleDocumentActivityByDatabase.get(databaseName) ?? new Set<symbol>();
  active.add(token);
  bibleDocumentActivityByDatabase.set(databaseName, active);
  notifyActivityChanged();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = bibleDocumentActivityByDatabase.get(databaseName);
    current?.delete(token);
    if (current?.size === 0) bibleDocumentActivityByDatabase.delete(databaseName);
    notifyActivityChanged();
  };
};

export const isBibleDocumentActivityIdle = (databaseName: string) =>
  (bibleDocumentActivityByDatabase.get(databaseName)?.size ?? 0) === 0;
