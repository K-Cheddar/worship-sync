#!/usr/bin/env node
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TAIL_REVISION_COUNT = 350;
const DEFAULT_TOP_COUNT = 15;
const EXCLUDED_DOCUMENT_IDS = new Set(["media"]);
const MAX_PAGE_SIZE = 500;
const MAX_BULK_GET_SIZE = 200;
const MAX_CONCURRENCY = 4;
const MAX_TOP_COUNT = 50;
const MAX_PAGES = 100_000;
const MAX_REQUEST_TIMEOUT_MS = 30_000;

export const isReadOnlyRequestAllowed = (method, endpoint) =>
  method === "GET" || (method === "POST" && endpoint === "_bulk_get");

const positiveInteger = (value, fallback, max, label) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${label} must be an integer from 1 to ${max}.`);
  }
  return parsed;
};

export const normalizeDatabaseName = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Pass a CouchDB database key or exact database name with --database.");
  }
  return trimmed.startsWith("worship-sync-") ? trimmed : `worship-sync-${trimmed.toLowerCase()}`;
};

export const createChangeFeedState = (tailLimit = DEFAULT_TAIL_REVISION_COUNT) => ({
  feedRowCount: 0,
  uniqueRevisionCount: 0,
  uniqueRevisionKeys: new Set(),
  latestLeafRevisionsById: new Map(),
  firstFeedRowById: new Map(),
  lastFeedRowById: new Map(),
  lastRevisionWindow: [],
  tailLimit,
  firstSequence: null,
  lastSequence: null,
});

const sequenceLabel = (sequence) => {
  if (sequence === undefined || sequence === null) return null;
  if (typeof sequence === "string" || typeof sequence === "number") return String(sequence);
  return JSON.stringify(sequence);
};

/**
 * Fold one ordered CouchDB `_changes?style=all_docs` page into bounded metadata.
 * Feed rows, document IDs and leaf revision identities are separate counters.
 */
export const acceptChangeFeedPage = (state, rows) => {
  for (const row of rows) {
    const rowIndex = state.feedRowCount++;
    const id = typeof row.id === "string" ? row.id : "";
    const sequence = sequenceLabel(row.seq);
    if (rowIndex === 0) state.firstSequence = sequence;
    state.lastSequence = sequence;

    const revisions = Array.isArray(row.changes)
      ? row.changes.map((entry) => entry?.rev).filter((rev) => typeof rev === "string")
      : [];
    if (!id || EXCLUDED_DOCUMENT_IDS.has(id)) continue;

    if (!state.firstFeedRowById.has(id)) state.firstFeedRowById.set(id, rowIndex);
    state.lastFeedRowById.set(id, rowIndex);
    state.latestLeafRevisionsById.set(id, revisions);
    for (const rev of revisions) {
      const key = `${id}\u0000${rev}`;
      if (state.uniqueRevisionKeys.has(key)) continue;
      state.uniqueRevisionKeys.add(key);
      state.uniqueRevisionCount += 1;
      state.lastRevisionWindow.push({ id, rev, sequence, feedRowIndex: rowIndex });
      if (state.lastRevisionWindow.length > state.tailLimit) state.lastRevisionWindow.shift();
    }
  }
};

const getUsage = () => [
  "Read-only CouchDB revision inspector",
  "",
  "Usage:",
  "  node --env-file=.env scripts/inspect-couchdb-revisions.mjs --database <church-key>",
  "",
  "Options:",
  "  --database <key-or-name>       Required; worship-sync- prefix is added to keys",
  "  --page-size <1-500>            Changes and all-docs page size (default 100)",
  "  --bulk-get-size <1-200>        Revisions per read-only _bulk_get request (default 100)",
  "  --concurrency <1-4>            Concurrent _bulk_get requests (default 2)",
  "  --tail-revisions <1-1000>      Unique feed-derived revision tail (default 350)",
  "  --top <1-50>                   Outliers per ranking (default 15)",
  "  --include-document-ids         Emit exact IDs; otherwise emit stable hashes",
  "  --help",
  "",
  "Credentials are read from COUCHDB_HOST, COUCHDB_USER and COUCHDB_PASSWORD.",
  "The only POST is to CouchDB's read-only _bulk_get endpoint.",
].join("\n");

export const parseArgs = (argv) => {
  const result = {
    database: null,
    pageSize: DEFAULT_PAGE_SIZE,
    bulkGetSize: DEFAULT_PAGE_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    tailRevisions: DEFAULT_TAIL_REVISION_COUNT,
    top: DEFAULT_TOP_COUNT,
    includeDocumentIds: false,
    help: false,
  };
  const valueOptions = new Map([
    ["--database", "database"],
    ["--page-size", "pageSize"],
    ["--bulk-get-size", "bulkGetSize"],
    ["--concurrency", "concurrency"],
    ["--tail-revisions", "tailRevisions"],
    ["--top", "top"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--include-document-ids") {
      result.includeDocumentIds = true;
      continue;
    }
    const key = valueOptions.get(arg);
    if (!key) throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    result[key] = value;
    index += 1;
  }
  if (result.help) return result;
  if (!result.database) throw new Error("--database is required.");
  result.database = normalizeDatabaseName(result.database);
  result.pageSize = positiveInteger(result.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, "--page-size");
  result.bulkGetSize = positiveInteger(result.bulkGetSize, DEFAULT_PAGE_SIZE, MAX_BULK_GET_SIZE, "--bulk-get-size");
  result.concurrency = positiveInteger(result.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY, "--concurrency");
  result.tailRevisions = positiveInteger(result.tailRevisions, DEFAULT_TAIL_REVISION_COUNT, 1000, "--tail-revisions");
  result.top = positiveInteger(result.top, DEFAULT_TOP_COUNT, MAX_TOP_COUNT, "--top");
  return result;
};

const normalizeHost = (value) => {
  const host = String(value ?? "").trim();
  if (!host) throw new Error("COUCHDB_HOST is not configured.");
  const url = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("COUCHDB_HOST must not contain credentials, a query, or a fragment.");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Use HTTPS for remote CouchDB hosts.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
};

const createReadOnlyClient = ({ host, user, password, database, fetchImpl = fetch }) => {
  const base = new URL(`${encodeURIComponent(database)}/`, host);
  const authorization = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

  return async (endpoint, { method = "GET", query, body } = {}) => {
    if (!isReadOnlyRequestAllowed(method, endpoint)) {
      throw new Error("Refusing a request outside the read-only CouchDB endpoint allowlist.");
    }
    const url = new URL(endpoint, base);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MAX_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error(`CouchDB read failed with HTTP ${response.status} at ${endpoint}.`);
      }
      try {
        return await response.json();
      } catch {
        throw new Error(`CouchDB returned invalid JSON at ${endpoint}.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("CouchDB ")) throw error;
      throw new Error(`CouchDB request failed at ${endpoint}; check network access and local credentials.`);
    } finally {
      clearTimeout(timeout);
    }
  };
};

const mapLimit = async (items, concurrency, worker) => {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
};

const chunksOf = (items, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const serializedBytes = (value) => {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
  } catch {
    return null;
  }
};

const revisionGeneration = (rev) => {
  const match = typeof rev === "string" ? /^(\d+)-/.exec(rev) : null;
  return match ? Number(match[1]) : null;
};

const getEmbeddedMediaStats = (document) => {
  const pending = [{ value: document, key: "" }];
  let count = 0;
  let bytes = 0;
  while (pending.length) {
    const { value, key } = pending.pop();
    if (typeof value === "string") {
      const isDataUri = /^data:(image|audio|video)\//i.test(value);
      const isMediaField = /^(data|base64|mediaData|imageData|audioData|videoData)$/i.test(key);
      if (value.length >= 4096 && (isDataUri || isMediaField)) {
        count += 1;
        bytes += Buffer.byteLength(value, "utf8");
      }
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push({ value: item, key });
    } else if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        pending.push({ value: child, key: childKey });
      }
    }
  }
  return { count, bytes };
};

const getAttachmentStats = (document) => {
  const attachments = document?._attachments;
  if (!attachments || typeof attachments !== "object") return { count: 0, bytes: 0 };
  let bytes = 0;
  const entries = Object.values(attachments);
  for (const attachment of entries) {
    if (typeof attachment?.length === "number") bytes += attachment.length;
    else if (typeof attachment?.data === "string") bytes += Buffer.byteLength(attachment.data, "utf8");
  }
  return { count: entries.length, bytes };
};

const createDocumentAccumulator = (id, leaves, isActive) => ({
  id,
  type: null,
  leafRevisionCount: leaves.length,
  fetchedRevisionBodies: 0,
  missingRevisionBodies: 0,
  activeLeafRevisions: 0,
  deletedLeafRevisions: 0,
  maxRevisionGeneration: 0,
  maxRevisionHistoryDepth: 0,
  maxRevisionHistoryBytes: 0,
  totalRevisionHistoryBytes: 0,
  largestRevisionPayloadBytes: 0,
  totalLeafPayloadBytes: 0,
  attachmentCount: 0,
  attachmentBytes: 0,
  embeddedMediaCount: 0,
  embeddedMediaBytes: 0,
  activeDocument: isActive,
  firstSeenFeedRow: null,
  lastSeenFeedRow: null,
  _seenRevisions: new Set(),
});

const addRevisionBody = (accumulator, document) => {
  const rev = typeof document?._rev === "string" ? document._rev : "";
  if (rev && accumulator._seenRevisions.has(rev)) return;
  if (rev) accumulator._seenRevisions.add(rev);
  accumulator.fetchedRevisionBodies += 1;
  if (document._deleted) accumulator.deletedLeafRevisions += 1;
  else accumulator.activeLeafRevisions += 1;
  const type = typeof document.type === "string"
    ? document.type
    : typeof document.docType === "string" ? document.docType : "untyped";
  accumulator.type ??= type;
  const payloadBytes = serializedBytes(document);
  const revisionBytes = serializedBytes(document._revisions) ?? 0;
  const historyDepth = Array.isArray(document._revisions?.ids)
    ? document._revisions.ids.length
    : 0;
  const generation = revisionGeneration(rev) ?? 0;
  const attachment = getAttachmentStats(document);
  const embedded = getEmbeddedMediaStats(document);
  if (payloadBytes !== null) {
    accumulator.totalLeafPayloadBytes += payloadBytes;
    accumulator.largestRevisionPayloadBytes = Math.max(accumulator.largestRevisionPayloadBytes, payloadBytes);
  }
  accumulator.maxRevisionGeneration = Math.max(accumulator.maxRevisionGeneration, generation);
  accumulator.maxRevisionHistoryDepth = Math.max(accumulator.maxRevisionHistoryDepth, historyDepth);
  accumulator.maxRevisionHistoryBytes = Math.max(accumulator.maxRevisionHistoryBytes, revisionBytes);
  accumulator.totalRevisionHistoryBytes += revisionBytes;
  accumulator.attachmentCount += attachment.count;
  accumulator.attachmentBytes += attachment.bytes;
  accumulator.embeddedMediaCount += embedded.count;
  accumulator.embeddedMediaBytes += embedded.bytes;
};

const idReference = (id, includeDocumentIds) => includeDocumentIds
  ? { documentId: id }
  : { documentIdHash: createHash("sha256").update(id).digest("hex").slice(0, 16) };

const presentDocument = (document, includeDocumentIds) => {
  const { id, _seenRevisions, ...summary } = document;
  return { ...idReference(id, includeDocumentIds), ...summary };
};

const sortedTop = (values, key, count, includeDocumentIds) => values
  .slice()
  .sort((left, right) => right[key] - left[key])
  .slice(0, count)
  .map((document) => presentDocument(document, includeDocumentIds));

const groupTailWindow = (window, summaries, includeDocumentIds) => {
  const grouped = new Map();
  for (const entry of window) {
    const group = grouped.get(entry.id) ?? {
      id: entry.id,
      requestedRevisions: 0,
      firstFeedRow: entry.feedRowIndex,
      lastFeedRow: entry.feedRowIndex,
      firstSequence: entry.sequence,
      lastSequence: entry.sequence,
    };
    group.requestedRevisions += 1;
    group.lastFeedRow = entry.feedRowIndex;
    group.lastSequence = entry.sequence;
    grouped.set(entry.id, group);
  }
  const enriched = [...grouped.values()].map((entry) => ({
    ...entry,
    ...(summaries.get(entry.id) ?? {}),
  }));
  return enriched
    .sort((left, right) => (right.totalLeafPayloadBytes ?? 0) - (left.totalLeafPayloadBytes ?? 0))
    .slice(0, 20)
    .map((document) => presentDocument(document, includeDocumentIds));
};

export const createInspectorReport = ({
  database,
  databaseInfo,
  changes,
  activeRevisionsById,
  summaries,
  requestedTailCount,
  topCount,
  includeDocumentIds,
  missingBodies,
  bulkGetCalls,
  elapsedMs,
}) => {
  const leafRevisions = [...changes.latestLeafRevisionsById.values()].reduce((sum, revisions) => sum + revisions.length, 0);
  const leafCounts = { active: 0, deleted: 0, unknown: 0 };
  const typeTotals = new Map();
  for (const document of summaries.values()) {
    leafCounts.active += document.activeLeafRevisions;
    leafCounts.deleted += document.deletedLeafRevisions;
    leafCounts.unknown += Math.max(0, document.leafRevisionCount - document.fetchedRevisionBodies);
    const type = document.type ?? "untyped";
    const total = typeTotals.get(type) ?? { documents: 0, leafRevisions: 0, activeLeafRevisions: 0, deletedLeafRevisions: 0, payloadBytes: 0 };
    total.documents += 1;
    total.leafRevisions += document.leafRevisionCount;
    total.activeLeafRevisions += document.activeLeafRevisions;
    total.deletedLeafRevisions += document.deletedLeafRevisions;
    total.payloadBytes += document.totalLeafPayloadBytes;
    typeTotals.set(type, total);
  }
  const sortedDocuments = [...summaries.values()];
  const tailRevisionCountById = new Map();
  for (const entry of changes.lastRevisionWindow) {
    tailRevisionCountById.set(entry.id, (tailRevisionCountById.get(entry.id) ?? 0) + 1);
  }
  const tailSummaries = new Map();
  for (const id of tailRevisionCountById.keys()) {
    const summary = summaries.get(id);
    if (summary) tailSummaries.set(id, { ...summary, requestedRevisions: tailRevisionCountById.get(id) });
  }
  const tailStart = changes.lastRevisionWindow[0] ?? null;
  const tailEnd = changes.lastRevisionWindow.at(-1) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    database,
    readOnly: true,
    credentialsPrinted: false,
    documentIdsIncluded: includeDocumentIds,
    elapsedMs,
    server: {
      documentCount: databaseInfo.doc_count ?? null,
      updateSequence: databaseInfo.update_seq ?? null,
      compactRunning: databaseInfo.compact_running ?? null,
    },
    changesFeed: {
      startSequence: "0",
      lastSequence: changes.lastSequence,
      feedRows: changes.feedRowCount,
      uniqueDocumentIds: changes.latestLeafRevisionsById.size,
      activeDocumentIds: activeRevisionsById.size,
      deletedDocumentIds: Math.max(0, changes.latestLeafRevisionsById.size - activeRevisionsById.size),
      currentLeafRevisions: leafRevisions,
      uniqueRevisionIdentitiesSeenInSequenceOrder: changes.uniqueRevisionCount,
      revisionsMissingFromBulkGet: missingBodies,
      uniqueRevisionIdentityWindow: {
        requestedCount: requestedTailCount,
        availableCount: changes.lastRevisionWindow.length,
        feedRowStartIndex: tailStart?.feedRowIndex ?? null,
        feedRowEndIndex: tailEnd?.feedRowIndex ?? null,
        sequenceStart: tailStart?.sequence ?? null,
        sequenceEnd: tailEnd?.sequence ?? null,
        explanation: "Last N unique (document ID, leaf revision) identities encountered while paging `_changes?style=all_docs` from sequence 0; this is distinct from feed rows and opaque CouchDB sequence values.",
        topDocumentsByPayload: groupTailWindow(changes.lastRevisionWindow, tailSummaries, includeDocumentIds),
      },
    },
    payloads: {
      leafCounts,
      bulkGetRequests: bulkGetCalls,
      types: Object.fromEntries([...typeTotals.entries()].sort(([left], [right]) => left.localeCompare(right))),
      largestSerializedRevisionBodies: sortedTop(sortedDocuments, "largestRevisionPayloadBytes", topCount, includeDocumentIds),
      largestTotalPayloadByDocument: sortedTop(sortedDocuments, "totalLeafPayloadBytes", topCount, includeDocumentIds),
      mostRevisionComplexDocuments: sortedTop(sortedDocuments, "leafRevisionCount", topCount, includeDocumentIds),
      largestRevisionHistoryMetadata: sortedTop(sortedDocuments, "maxRevisionHistoryBytes", topCount, includeDocumentIds),
      largestAttachmentTotals: sortedTop(sortedDocuments, "attachmentBytes", topCount, includeDocumentIds),
      largestEmbeddedMediaTotals: sortedTop(sortedDocuments, "embeddedMediaBytes", topCount, includeDocumentIds),
      sizeDefinition: "Serialized JSON bytes include the returned document and `_revisions` metadata. Attachment stubs are included in that size; their declared binary bytes are reported separately. Embedded media strings remain part of the JSON size and are also counted separately when their field or data URI identifies them.",
    },
  };
};

const buildRequestChunks = (revisionsById, chunkSize) => {
  const requests = [];
  for (const [id, revisions] of revisionsById) {
    for (const rev of revisions) requests.push({ id, rev });
  }
  return chunksOf(requests, chunkSize);
};

const inspectDatabase = async (args, environment) => {
  const host = normalizeHost(environment.COUCHDB_HOST);
  const user = environment.COUCHDB_USER;
  const password = environment.COUCHDB_PASSWORD;
  if (!user || !password) throw new Error("COUCHDB_USER and COUCHDB_PASSWORD must be configured locally.");
  const request = createReadOnlyClient({ host, user, password, database: args.database });
  const startedAt = Date.now();
  const databaseInfo = await request("");

  const activeRevisionsById = new Map();
  let lastActiveId = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = { include_docs: false, limit: args.pageSize };
    if (lastActiveId !== null) {
      query.startkey = JSON.stringify(lastActiveId);
      query.skip = 1;
    }
    const response = await request("_all_docs", { query });
    const rows = response.rows ?? [];
    for (const row of rows) {
      if (row.id && !EXCLUDED_DOCUMENT_IDS.has(row.id)) activeRevisionsById.set(row.id, row.value?.rev ?? null);
    }
    if (rows.length < args.pageSize) break;
    const nextId = rows.at(-1)?.id;
    if (!nextId || nextId === lastActiveId) throw new Error("The `_all_docs` paging cursor did not advance.");
    lastActiveId = nextId;
    if (page === MAX_PAGES - 1) throw new Error("The `_all_docs` page safety limit was reached.");
  }

  const changes = createChangeFeedState(args.tailRevisions);
  let since = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await request("_changes", {
      query: { since, limit: args.pageSize, style: "all_docs", include_docs: false },
    });
    const rows = response.results ?? [];
    acceptChangeFeedPage(changes, rows);
    if (!rows.length) {
      changes.lastSequence = sequenceLabel(response.last_seq) ?? changes.lastSequence;
      break;
    }
    const nextSince = rows.at(-1)?.seq;
    if (nextSince === undefined || JSON.stringify(nextSince) === JSON.stringify(since)) {
      throw new Error("The `_changes` paging cursor did not advance.");
    }
    since = nextSince;
    if (page === MAX_PAGES - 1) throw new Error("The `_changes` page safety limit was reached.");
  }

  const revisionRequests = buildRequestChunks(changes.latestLeafRevisionsById, args.bulkGetSize);
  const summaries = new Map();
  for (const [id, leaves] of changes.latestLeafRevisionsById) {
    const accumulator = createDocumentAccumulator(id, leaves, activeRevisionsById.has(id));
    accumulator.firstSeenFeedRow = changes.firstFeedRowById.get(id) ?? null;
    accumulator.lastSeenFeedRow = changes.lastFeedRowById.get(id) ?? null;
    summaries.set(id, accumulator);
  }

  let missingBodies = 0;
  let completedBulkGetRequests = 0;
  await mapLimit(revisionRequests, args.concurrency, async (docs) => {
    const response = await request("_bulk_get", {
      method: "POST",
      query: { revs: true },
      body: { docs },
    });
    completedBulkGetRequests += 1;
    for (const group of response.results ?? []) {
      const id = group.id;
      const accumulator = summaries.get(id);
      if (!accumulator) continue;
      for (const item of group.docs ?? []) {
        if (!item?.ok) {
          missingBodies += 1;
          accumulator.missingRevisionBodies += 1;
          continue;
        }
        addRevisionBody(accumulator, item.ok);
      }
    }
  });

  const finishedAt = Date.now();
  return createInspectorReport({
    database: args.database,
    databaseInfo,
    changes,
    activeRevisionsById,
    summaries,
    requestedTailCount: args.tailRevisions,
    topCount: args.top,
    includeDocumentIds: args.includeDocumentIds,
    missingBodies,
    bulkGetCalls: completedBulkGetRequests,
    elapsedMs: finishedAt - startedAt,
  });
};

const main = async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${getUsage()}\n`);
      return;
    }
    const report = await inspectDatabase(args, process.env);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Inspection failed."}\n\n${getUsage()}\n`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
