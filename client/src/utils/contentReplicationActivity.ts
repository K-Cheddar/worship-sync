const activeByDatabase = new Map<string, Set<symbol>>();
const bibleDocumentActivityByDatabase = new Map<string, Set<symbol>>();
const contentDatabaseSessions = new Map<
  string,
  { token: symbol; initialReplicationComplete: boolean }
>();
const activityListeners = new Set<() => void>();

const notifyActivityChanged = () => {
  activityListeners.forEach((listener) => listener());
};

export const subscribeToContentActivity = (listener: () => void) => {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
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
