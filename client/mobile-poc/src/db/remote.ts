import PouchDB from "pouchdb-browser";
import type { NativeDbRole } from "./nativePouch";

export const DEMO_TENANT = "demo";
export const CONTENT_REMOTE_DB = `worship-sync-${DEMO_TENANT}`;
export const BOARD_REMOTE_DB = "worship-sync-boards";

export type RemoteConfig = { apiBaseUrl: string; couchDbUrl: string };

const buildConfig = import.meta.env ?? {};

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  apiBaseUrl: buildConfig.MOBILE_POC_API_BASE_URL || "",
  couchDbUrl: buildConfig.MOBILE_POC_COUCHDB_URL || "",
};

const normalizedBaseUrl = (value: string, label: string) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not contain credentials, a query string, or a fragment.`);
  }
  return url;
};

export const createApiEndpoint = (apiBaseUrl: string, path: string) => {
  const apiBase = normalizedBaseUrl(apiBaseUrl, "API base URL");
  return new URL(path.replace(/^\/+/, ""), apiBase.href.endsWith("/") ? apiBase : `${apiBase.href}/`);
};

export const establishCouchSession = async (apiBaseUrl: string) => {
  const authResponse = await fetch(createApiEndpoint(apiBaseUrl, "api/auth/me"), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!authResponse.ok) throw new Error(`WorshipSync sign-in check failed with HTTP ${authResponse.status}.`);
  const session = await authResponse.json() as { authenticated?: boolean; database?: string };
  if (!session.authenticated) throw new Error("Sign in to WorshipSync before connecting to CouchDB.");
  if (session.database !== DEMO_TENANT) {
    throw new Error(`CouchDB access is locked to the demo tenant; the signed-in session resolves to ${session.database || "no tenant"}.`);
  }
  const endpoint = createApiEndpoint(apiBaseUrl, "api/getDbSession");
  const response = await fetch(endpoint, { credentials: "include", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`CouchDB session request failed with HTTP ${response.status}. Check sign-in, CORS, and server availability.`);
  const body = await response.json() as { success?: boolean; message?: string };
  if (!body.success) throw new Error(body.message || "The server did not establish a CouchDB session.");
};

export const createRemoteDatabase = (
  role: NativeDbRole,
  couchDbUrl: string,
): PouchDB.Database => {
  const base = normalizedBaseUrl(couchDbUrl, "CouchDB base URL");
  const databaseName = role === "content" ? CONTENT_REMOTE_DB : BOARD_REMOTE_DB;
  const databaseUrl = new URL(encodeURIComponent(databaseName), `${base.href.replace(/\/+$/, "")}/`).href;
  return new PouchDB(databaseUrl, {
    fetch: (url, options: RequestInit = {}) => fetch(url, { ...options, credentials: "include" }),
  });
};

export const readOnlyReplicationOptions = (role: NativeDbRole) => ({
  live: true,
  retry: true,
  batch_size: role === "content" ? 150 : 100,
  batches_limit: role === "content" ? 15 : 10,
  ...(role === "content"
    ? { selector: { _id: { $ne: "media" } } }
    : { selector: { database: DEMO_TENANT } }),
});

export const outboundTestReplicationOptions = (ids: readonly string[]) => {
  const safeIds = assertSafeOutboundTestIds(ids);
  return { doc_ids: safeIds, retry: false };
};

export const MOBILE_TEST_DOCUMENT_PREFIX = "mobile-poc:test:";

export const assertSafeOutboundTestIds = (ids: readonly string[]) => {
  if (!ids.length) throw new Error("Select a mobile POC test document before enabling outbound replication.");
  if (new Set(ids).size !== ids.length) throw new Error("Outbound test document IDs must be unique.");
  if (ids.some((id) => !id.startsWith(MOBILE_TEST_DOCUMENT_PREFIX))) {
    throw new Error(`Outbound replication is restricted to IDs beginning with ${MOBILE_TEST_DOCUMENT_PREFIX}`);
  }
  return [...ids];
};

export const remoteDatabaseForRole = (role: NativeDbRole, couchDbUrl: string) =>
  createRemoteDatabase(role, couchDbUrl);
