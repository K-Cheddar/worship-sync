import { toWorshipSyncContentDbName } from "./couchContentDatabase.js";

/** Resolves migration targets from Firestore church contentDatabaseKey values. */
export const resolveContentMigrationDatabases = (churchDocs) => {
  const databases = new Set();
  const skippedChurches = [];

  for (const church of churchDocs) {
    const data = typeof church.data === "function" ? church.data() : church;
    const contentDatabaseKey = data?.contentDatabaseKey;
    if (typeof contentDatabaseKey !== "string" || !contentDatabaseKey.trim()) {
      skippedChurches.push({
        churchId: church.id || data?.churchId || "<unknown church>",
        reason: "Missing contentDatabaseKey.",
      });
      continue;
    }
    try {
      databases.add(toWorshipSyncContentDbName(contentDatabaseKey));
    } catch (error) {
      skippedChurches.push({
        churchId: church.id || data?.churchId || "<unknown church>",
        contentDatabaseKey,
        reason: error?.message || "Invalid contentDatabaseKey.",
      });
    }
  }

  return { databases: [...databases], skippedChurches };
};
