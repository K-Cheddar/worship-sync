import PouchDB from "pouchdb-browser";
import cordovaSqliteAdapter from "pouchdb-adapter-cordova-sqlite";
import { Capacitor } from "@capacitor/core";
import { requireNativeSqliteRuntime } from "./platformChecks";

export const CONTENT_LOCAL_DB = "worshipsync-mobile-poc-demo-content.db";
export const BOARD_LOCAL_DB = "worshipsync-mobile-poc-demo-boards.db";
export const NATIVE_ADAPTER = "cordova-sqlite";

export type NativeDbRole = "content" | "boards";
export type NativeDbInfo = {
  role: NativeDbRole;
  name: string;
  adapter: string;
  verifiedBackend: "SQLite";
  docCount: number;
  updateSeq: unknown;
  storageBytes: number;
  sqliteTables: string[];
};

type NativeSqlRow = Record<string, unknown>;
type NativeSqlHandle = NonNullable<Window["sqlitePlugin"]> extends { openDatabase: (...args: any[]) => infer T } ? T : never;

const databasePromises = new Map<NativeDbRole, Promise<PouchDB.Database>>();
let deviceReadyPromise: Promise<void> | null = null;

PouchDB.plugin(cordovaSqliteAdapter);

export const getRuntime = () => ({
  platform: Capacitor.getPlatform(),
  isNative: Capacitor.isNativePlatform(),
  capacitor: __CAPACITOR_VERSION__,
  pouchDb: PouchDB.version,
  selectedAdapter: NATIVE_ADAPTER,
  sqlitePluginAvailable: Boolean(window.sqlitePlugin?.openDatabase),
});

export const assertNativeSqliteAvailable = () => {
  requireNativeSqliteRuntime({
    platform: Capacitor.getPlatform(),
    isNative: Capacitor.isNativePlatform(),
    sqlitePluginAvailable: typeof window.sqlitePlugin?.openDatabase === "function",
  });
};

const waitForNativeSqlitePlugin = async () => {
  if (!Capacitor.isNativePlatform()) {
    assertNativeSqliteAvailable();
  }
  if (!window.__worshipSyncPocDeviceReady) {
    if (!deviceReadyPromise) {
      deviceReadyPromise = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Cordova deviceready did not fire within 20 seconds. Native SQLite was not initialized.")), 20_000);
        document.addEventListener("deviceready", () => {
          window.clearTimeout(timeout);
          window.__worshipSyncPocDeviceReady = true;
          resolve();
        }, { once: true });
      });
    }
    try { await deviceReadyPromise; }
    catch (error) {
      deviceReadyPromise = null;
      throw error;
    }
  }
  assertNativeSqliteAvailable();
};

const databaseNameForRole = (role: NativeDbRole) =>
  role === "content" ? CONTENT_LOCAL_DB : BOARD_LOCAL_DB;

export const openNativeDatabase = (role: NativeDbRole): Promise<PouchDB.Database> => {
  const existing = databasePromises.get(role);
  if (existing) return existing;

  const name = databaseNameForRole(role);
  const promise = (async () => {
    await waitForNativeSqlitePlugin();
    const db = new PouchDB(name, {
      adapter: NATIVE_ADAPTER,
      iosDatabaseLocation: "Library",
    });
    const nativeDb = db as PouchDB.Database & { adapter?: string };
    try {
      await db.info();
      if (nativeDb.adapter !== NATIVE_ADAPTER) {
        throw new Error(`PouchDB selected ${nativeDb.adapter || "an unknown adapter"}; native ${NATIVE_ADAPTER} is required.`);
      }
      return db;
    } catch (error) {
      await db.close().catch(() => undefined);
      throw error;
    }
  })();

  databasePromises.set(role, promise);
  void promise.catch(() => {
    if (databasePromises.get(role) === promise) databasePromises.delete(role);
  });
  return promise;
};

const queryNativeSql = (database: NativeSqlHandle, statement: string): Promise<NativeSqlRow[]> =>
  new Promise((resolve, reject) => {
    database.transaction((transaction) => {
      transaction.executeSql(
        statement,
        [],
        (_tx, result) => {
          const rows: NativeSqlRow[] = [];
          for (let index = 0; index < result.rows.length; index += 1) rows.push(result.rows.item(index));
          resolve(rows);
        },
        (_tx, error) => {
          reject(error);
          return true;
        },
      );
    }, reject);
  });

const closeNativeSql = (database: NativeSqlHandle) =>
  new Promise<void>((resolve, reject) => {
    if (!database.close) {
      resolve();
      return;
    }
    database.close(resolve, reject);
  });

/**
 * Opens the same database file through the installed native SQLite plugin and
 * checks PouchDB's SQLite tables. It never writes through this second handle.
 */
export const inspectNativeSqliteFile = async (name: string) => {
  assertNativeSqliteAvailable();
  const database = window.sqlitePlugin!.openDatabase({
    name,
    location: "default",
    iosDatabaseLocation: "Library",
  }) as NativeSqlHandle;
  try {
    const tableRows = await queryNativeSql(
      database,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const tables = tableRows.map((row) => String(row.name));
    const pouchTables = ["document-store", "by-sequence", "metadata-store"];
    if (!pouchTables.every((table) => tables.includes(table))) {
      throw new Error(`The native SQLite file ${name} does not contain the expected PouchDB tables.`);
    }
    const [pageCountRow] = await queryNativeSql(database, "PRAGMA page_count");
    const [pageSizeRow] = await queryNativeSql(database, "PRAGMA page_size");
    const pageCount = Number(pageCountRow?.page_count ?? 0);
    const pageSize = Number(pageSizeRow?.page_size ?? 0);
    if (!pageCount || !pageSize) throw new Error("Native SQLite did not report a measurable database file size.");
    return { sqliteTables: tables, storageBytes: pageCount * pageSize };
  } finally {
    await closeNativeSql(database);
  }
};

export const inspectNativeDatabase = async (role: NativeDbRole): Promise<NativeDbInfo> => {
  const db = await openNativeDatabase(role);
  const adapter = (db as PouchDB.Database & { adapter?: string }).adapter;
  if (adapter !== NATIVE_ADAPTER) throw new Error(`Storage verification failed: PouchDB adapter is ${adapter}.`);
  const [info, nativeFile] = await Promise.all([
    db.info(),
    inspectNativeSqliteFile(databaseNameForRole(role)),
  ]);
  return {
    role,
    name: databaseNameForRole(role),
    adapter,
    verifiedBackend: "SQLite",
    docCount: info.doc_count,
    updateSeq: info.update_seq,
    ...nativeFile,
  };
};

export const closeNativeDatabases = async () => {
  const databases = await Promise.allSettled([...databasePromises.values()]);
  databasePromises.clear();
  await Promise.all(databases.flatMap((result) => result.status === "fulfilled" ? [result.value.close()] : []));
};

export const resetNativeDatabaseRegistryForTests = () => databasePromises.clear();
