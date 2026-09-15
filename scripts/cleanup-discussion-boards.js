import axios from "axios";
import dotenv from "dotenv";
import {
  BOARD_DB_NAME,
  getBoardPostRange,
} from "../server/boardService.js";
import {
  cleanupArchivedDiscussionBoards,
  DISCUSSION_BOARD_RETENTION_DAYS,
} from "../server/boardMaintenance.js";

dotenv.config();

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (flag) => {
  const entry = args.find((arg) => arg.startsWith(`${flag}=`));
  return entry ? entry.slice(flag.length + 1).trim() : "";
};

const printUsage = () => {
  console.log(`
Purge old archived WorshipSync discussion-board sessions and posts.

Usage:
  node scripts/cleanup-discussion-boards.js [--dry-run]

Options:
  --database=<database>  Limit cleanup to one WorshipSync database.
  --dry-run              Report eligible boards without deleting or updating.
  --limit=<number>       Maximum archived boards per pass (default: 100, max: 500).
  --batch-size=<number>  Maximum CouchDB deletion batch size (default: 100, max: 200).
  --help                 Show this help text.

Archived boards are retained for ${DISCUSSION_BOARD_RETENTION_DAYS} days. The
current board for every alias is always protected.
`);
};

if (hasFlag("--help")) {
  printUsage();
  process.exit(0);
}

const database = getArgValue("--database");
const dryRun = hasFlag("--dry-run");
const parsedLimit = Number.parseInt(getArgValue("--limit") || "100", 10);
const maxBoards = Number.isFinite(parsedLimit)
  ? Math.min(Math.max(parsedLimit, 1), 500)
  : 100;
const parsedBatchSize = Number.parseInt(
  getArgValue("--batch-size") || "100",
  10,
);
const deleteBatchSize = Number.isFinite(parsedBatchSize)
  ? Math.min(Math.max(parsedBatchSize, 1), 200)
  : 100;

const requiredEnv = ["COUCHDB_HOST", "COUCHDB_USER", "COUCHDB_PASSWORD"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const couchOrigin = process.env.COUCHDB_HOST.startsWith("http")
  ? process.env.COUCHDB_HOST
  : `https://${process.env.COUCHDB_HOST}`;
const dbClient = axios.create({
  baseURL: `${couchOrigin}/${BOARD_DB_NAME}`,
  auth: {
    username: process.env.COUCHDB_USER,
    password: process.env.COUCHDB_PASSWORD,
  },
  timeout: 30_000,
});

const fetchDocsByRange = async ({ startkey, endkey }) => {
  const response = await dbClient.get("/_all_docs", {
    params: {
      include_docs: true,
      startkey: JSON.stringify(startkey),
      endkey: JSON.stringify(endkey),
    },
  });
  return (response.data?.rows || [])
    .map((row) => row?.doc)
    .filter(Boolean);
};

const getDoc = async (docId) => {
  try {
    const response = await dbClient.get(`/${encodeURIComponent(docId)}`);
    return response.data;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
};

const listAliases = () =>
  fetchDocsByRange({ startkey: "alias:", endkey: "alias:\ufff0" });

const listBoards = () =>
  fetchDocsByRange({ startkey: "board:", endkey: "board:\ufff0" });

const listPosts = async (boardId) => {
  const range = getBoardPostRange(boardId);
  return fetchDocsByRange(range);
};

const deleteDocs = async (docs, { batchSize }) => {
  for (let index = 0; index < docs.length; index += batchSize) {
    const batch = docs.slice(index, index + batchSize);
    const response = await dbClient.post("/_bulk_docs", {
      docs: batch.map((doc) => ({ ...doc, _deleted: true })),
    });
    if (!Array.isArray(response.data)) {
      throw new Error("CouchDB returned an invalid bulk-delete response.");
    }
    const failures = response.data
      .map((result, resultIndex) => ({
        result,
        doc: batch[resultIndex],
      }))
      .filter(({ result }) => result?.error);
    if (failures.length > 0) {
      throw new Error(
        `CouchDB could not delete ${failures.length} document(s): ${failures
          .map(({ result, doc }) => `${doc?._id || "unknown"} (${result.error})`)
          .join(", ")}`,
      );
    }
  }
};

const updateAlias = async (aliasDoc) => {
  await dbClient.put(`/${encodeURIComponent(aliasDoc._id)}`, aliasDoc);
};

const run = async () => {
  console.log(
    `${dryRun ? "[dry run] " : ""}Scanning ${BOARD_DB_NAME} for archived ` +
      `boards older than ${DISCUSSION_BOARD_RETENTION_DAYS} days${
        database ? ` in ${database}` : ""
      }.`,
  );

  const report = await cleanupArchivedDiscussionBoards({
    listAliases,
    listBoards,
    listPosts,
    deleteDocs,
    updateAlias,
    getAlias: async (aliasId) => getDoc(`alias:${aliasId}`),
    getBoard: async (boardId) => getDoc(`board:${boardId}`),
    database,
    dryRun,
    maxBoards,
    deleteBatchSize,
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.failedBoards.length > 0 || report.failedAliasUpdates.length > 0) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error("Discussion-board cleanup failed:", error);
  process.exitCode = 1;
});
