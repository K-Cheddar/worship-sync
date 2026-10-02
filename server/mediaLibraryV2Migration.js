import { isDeepStrictEqual } from "node:util";

export const MEDIA_ITEM_PREFIX = "media-item:";
export const MEDIA_FOLDERS_ID = "media-folders";
export const MEDIA_LIBRARY_META_ID = "media-library-meta";
export const MEDIA_LIBRARY_SCHEMA_VERSION = 2;
export const MEDIA_MIGRATION_BATCH_SIZE = 50;

const encoded = (value) => encodeURIComponent(value);

const isMissing = (error) => error?.response?.status === 404 || error?.status === 404;

const readOptionalDoc = async (client, url) => {
  try {
    const response = await client.get(url);
    return response.data;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const batches = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

export async function migrateMediaLibraryV2({
  client,
  database,
  dryRun = false,
  batchSize = MEDIA_MIGRATION_BATCH_SIZE,
}) {
  const report = {
    database,
    church: String(database).replace(/^worship-sync-/, ""),
    legacyCount: 0,
    v2DocsAlreadyPresent: 0,
    docsCreated: 0,
    docsUpdated: 0,
    migratedFolderCount: 0,
    verificationResult: "not_run",
    schemaVersionResult: "not_set",
    failures: [],
  };
  const dbUrl = `/${encoded(database)}`;

  try {
    const legacy = await readOptionalDoc(client, `${dbUrl}/media`);
    if (!legacy) throw new Error("Legacy media document is missing; refusing to activate schema v2.");
    const list = Array.isArray(legacy?.list) ? legacy.list : [];
    report.legacyCount = list.length;
    report.migratedFolderCount = Array.isArray(legacy?.folders)
      ? legacy.folders.length
      : 0;
    const ids = list.map((item) => item?.id);
    const invalidIds = ids.filter((id) => typeof id !== "string" || !id);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (invalidIds.length || duplicateIds.length) {
      throw new Error("Legacy media contains missing or duplicate item IDs.");
    }

    const [existingItemsResponse, existingFolders, existingMeta] = await Promise.all([
      client.get(
        `${dbUrl}/_all_docs?include_docs=true&startkey=${encoded(`\"${MEDIA_ITEM_PREFIX}\"`)}&endkey=${encoded(`\"${MEDIA_ITEM_PREFIX}\uffff\"`)}`,
      ),
      readOptionalDoc(client, `${dbUrl}/${MEDIA_FOLDERS_ID}`),
      readOptionalDoc(client, `${dbUrl}/${MEDIA_LIBRARY_META_ID}`),
    ]);
    const existingById = new Map(
      (existingItemsResponse.data?.rows || [])
        .map((row) => row.doc)
        .filter((doc) => doc?.docType === "mediaItem" && typeof doc.id === "string")
        .map((doc) => [doc.id, doc]),
    );
    report.v2DocsAlreadyPresent = existingById.size;
    if (existingMeta?.schemaVersion >= MEDIA_LIBRARY_SCHEMA_VERSION) {
      report.verificationResult = "already_v2";
      report.schemaVersionResult = "already_v2";
      return report;
    }

    const itemDocs = list.map((item) => {
      const current = existingById.get(item.id);
      return {
        ...current,
        ...item,
        ...(current?._rev ? { _rev: current._rev } : {}),
        _id: `${MEDIA_ITEM_PREFIX}${item.id}`,
        docType: "mediaItem",
        id: item.id,
      };
    });
    report.docsCreated = itemDocs.filter((doc) => !existingById.has(doc.id)).length;
    report.docsUpdated = itemDocs.length - report.docsCreated;

    const folderDoc = {
      ...(existingFolders || {}),
      _id: MEDIA_FOLDERS_ID,
      docType: "mediaFolders",
      folders: Array.isArray(legacy?.folders) ? legacy.folders : [],
    };

    if (dryRun) {
      report.verificationResult = "skipped_dry_run";
      report.schemaVersionResult = existingMeta?.schemaVersion >= MEDIA_LIBRARY_SCHEMA_VERSION
        ? "already_v2"
        : "not_set_dry_run";
      return report;
    }

    for (const batch of batches(itemDocs, batchSize)) {
      const response = await client.post(`${dbUrl}/_bulk_docs`, { docs: batch });
      const failures = (response.data || []).filter((result) => result.error);
      if (failures.length) {
        throw new Error(`CouchDB rejected a media batch (${failures.length} document failures).`);
      }
    }

    await client.put(`${dbUrl}/${MEDIA_FOLDERS_ID}`, folderDoc);

    const verifiedResponse = await client.get(
      `${dbUrl}/_all_docs?include_docs=true&startkey=${encoded(`\"${MEDIA_ITEM_PREFIX}\"`)}&endkey=${encoded(`\"${MEDIA_ITEM_PREFIX}\uffff\"`)}`,
    );
    const verifiedDocs = new Map(
      (verifiedResponse.data?.rows || [])
        .map((row) => row.doc)
        .filter((doc) => doc?.docType === "mediaItem" && typeof doc.id === "string")
        .map((doc) => [doc.id, doc]),
    );
    const missing = list.filter((item) => !verifiedDocs.has(item.id));
    const mismatched = list.filter((item) => {
      const actual = verifiedDocs.get(item.id);
      return actual && !isDeepStrictEqual(stripPouchFields(actual), item);
    });
    if (missing.length || mismatched.length || verifiedDocs.size !== list.length) {
      report.verificationResult = "failed";
      throw new Error(
        `Media verification failed: ${missing.length} missing, ${mismatched.length} mismatched, ${verifiedDocs.size} v2 items for ${list.length} legacy items.`,
      );
    }
    const verifiedFolder = await client.get(`${dbUrl}/${MEDIA_FOLDERS_ID}`);
    if (!isDeepStrictEqual(verifiedFolder.data.folders || [], Array.isArray(legacy.folders) ? legacy.folders : [])) {
      report.verificationResult = "failed";
      throw new Error("Media folder verification failed.");
    }
    const currentLegacy = await client.get(`${dbUrl}/media`);
    if (legacy._rev && currentLegacy.data._rev !== legacy._rev) {
      report.verificationResult = "failed";
      throw new Error("Legacy media changed during migration; rerun after media writes stop.");
    }
    report.verificationResult = "passed";

    const meta = {
      ...(existingMeta || {}),
      _id: MEDIA_LIBRARY_META_ID,
      docType: "mediaLibraryMeta",
      schemaVersion: MEDIA_LIBRARY_SCHEMA_VERSION,
    };
    await client.put(`${dbUrl}/${MEDIA_LIBRARY_META_ID}`, meta);
    const savedMeta = await client.get(`${dbUrl}/${MEDIA_LIBRARY_META_ID}`);
    if (savedMeta.data.schemaVersion !== MEDIA_LIBRARY_SCHEMA_VERSION) {
      throw new Error("Media schema marker verification failed.");
    }
    report.schemaVersionResult = "set_v2";
  } catch (error) {
    report.failures.push(error?.message || "Unknown media migration failure.");
    if (report.verificationResult === "not_run") report.verificationResult = "failed";
  }
  return report;
}

const stripPouchFields = (doc) => {
  const item = { ...doc };
  delete item._id;
  delete item._rev;
  delete item.docType;
  return item;
};
