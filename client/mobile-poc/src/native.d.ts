import type PouchDB from "pouchdb-browser";

declare module "pouchdb-adapter-cordova-sqlite" {
  const adapter: Parameters<typeof PouchDB.plugin>[0];
  export default adapter;
}

type NativeSqlResult = {
  rows: { length: number; item(index: number): Record<string, unknown> };
};

type NativeSqlTransaction = {
  executeSql(
    statement: string,
    values?: unknown[],
    success?: (transaction: NativeSqlTransaction, result: NativeSqlResult) => void,
    failure?: (transaction: NativeSqlTransaction, error: Error) => boolean | void,
  ): void;
};

type NativeSqlDatabase = {
  transaction(
    callback: (transaction: NativeSqlTransaction) => void,
    failure?: (error: Error) => void,
    success?: () => void,
  ): void;
  close?(success?: () => void, failure?: (error: Error) => void): void;
};

declare global {
  interface Window {
    __worshipSyncPocDeviceReady?: boolean;
    sqlitePlugin?: {
      openDatabase(options: Record<string, unknown>): NativeSqlDatabase;
    };
  }
}

export {};
