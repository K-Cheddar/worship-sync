import axios from "axios";

/**
 * Content libraries (songs, overlays, etc.) live in CouchDB as
 * `worship-sync-<contentDatabaseKey>`. Church create previously only wrote the
 * Firestore church doc, so new churches pointed at a missing remote DB and the
 * controller never finished initial replication.
 */

const CONTENT_DATABASE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,198}$/;

export const toWorshipSyncContentDbName = (contentDatabaseKey) => {
  const key = String(contentDatabaseKey || "").trim();
  if (!CONTENT_DATABASE_KEY_PATTERN.test(key)) {
    const error = new Error("Invalid content database key.");
    error.statusCode = 400;
    throw error;
  }
  return key.startsWith("worship-sync-") ? key : `worship-sync-${key}`;
};

const couchAuthHeader = ({ user, password }) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

/**
 * PUT the church content database. Idempotent: already-exists (412) is success.
 * @returns {Promise<{ dbName: string, created: boolean }>}
 */
export const ensureWorshipSyncContentDatabase = async (
  contentDatabaseKey,
  {
    host = process.env.COUCHDB_HOST,
    user = process.env.COUCHDB_USER,
    password = process.env.COUCHDB_PASSWORD,
    request = axios,
  } = {},
) => {
  const dbName = toWorshipSyncContentDbName(contentDatabaseKey);
  if (!host || !user || !password) {
    const error = new Error("CouchDB is not configured.");
    error.statusCode = 503;
    throw error;
  }

  const url = `https://${host}/${encodeURIComponent(dbName)}`;
  try {
    const response = await request({
      method: "PUT",
      url,
      headers: {
        Authorization: couchAuthHeader({ user, password }),
        "Content-Type": "application/json",
      },
      // Empty body is fine for CouchDB create-db.
      data: {},
      validateStatus: (status) =>
        status === 201 || status === 200 || status === 412,
    });
    return {
      dbName,
      created: response.status === 201 || response.status === 200,
    };
  } catch (error) {
    const status = error?.response?.status;
    if (status === 412) {
      return { dbName, created: false };
    }
    const wrapped = new Error(
      error?.response?.data?.reason ||
        error?.message ||
        "Could not create church content database.",
    );
    wrapped.statusCode = status || 502;
    wrapped.cause = error;
    throw wrapped;
  }
};
