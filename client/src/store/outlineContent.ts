import { createAction } from "@reduxjs/toolkit";

// Document IDs and database names can repeat across concrete DB sessions.
const databaseKeys = new WeakMap<object, string>();
let nextDatabaseKey = 0;
export const getOutlineDatabaseKey = (database: object): string => {
  let key = databaseKeys.get(database);
  if (!key) {
    key = String(++nextDatabaseKey);
    databaseKeys.set(database, key);
  }
  return key;
};

export const getOutlineOwnerKey = (
  databaseKey: string,
  outlineId?: string,
) => JSON.stringify([databaseKey, outlineId ?? null]);

export const hasPendingOutlineDraftsForDatabase = (
  drafts: Record<string, unknown> | undefined,
  database: object,
) => Object.keys(drafts ?? {}).some((key) => key.startsWith(`[${JSON.stringify(getOutlineDatabaseKey(database))},`));

export const setOutlineContentDatabase = createAction<string>("outlineContent/database");
export const activateOutlineContent = createAction<{
  ownerKey: string;
  hasSelection: boolean;
}>("outlineContent/activate");
