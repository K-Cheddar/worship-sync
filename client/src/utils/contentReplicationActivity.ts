const activeByDatabase = new Map<string, Set<symbol>>();

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
  };
  const release = () => {
    if (released) return;
    released = true;
    if (!busy) return;
    busy = false;
    const active = activeByDatabase.get(databaseName);
    active?.delete(token);
    if (active?.size === 0) activeByDatabase.delete(databaseName);
  };
  setBusy(true);
  return { setBusy, release };
};

export const isContentReplicationIdle = (databaseName: string): boolean =>
  (activeByDatabase.get(databaseName)?.size ?? 0) === 0;
