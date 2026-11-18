import type PouchDB from "pouchdb-browser";
import { MOBILE_TEST_DOCUMENT_PREFIX } from "./remote";

export const LOCAL_PERSISTENCE_TEST_ID = "mobile-poc:local-persistence-check";
const REGISTERED_TEST_IDS_KEY = "worshipsync-mobile-poc-created-test-ids";
const DELETED_TEST_IDS_KEY = "worshipsync-mobile-poc-deleted-test-ids";

const readIdList = (key: string): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const rememberId = (key: string, id: string) => {
  const ids = [...new Set([...readIdList(key), id])].slice(-200);
  localStorage.setItem(key, JSON.stringify(ids));
};

export const assertRegisteredTestDocument = (id: string) => {
  if (!readIdList(REGISTERED_TEST_IDS_KEY).includes(id)) {
    throw new Error("Outbound replication is limited to mobile POC test documents created on this device.");
  }
};

export const isRegisteredDeletedTestDocument = (id: string) => readIdList(DELETED_TEST_IDS_KEY).includes(id);

const assertPocDocument = (document: { _id: string; type?: string; tenant?: string }, id: string) => {
  if (document._id !== id || document.type !== "worshipsync-mobile-poc-test" || document.tenant !== "demo") {
    throw new Error("This ID is not a demo-tenant mobile POC test document.");
  }
};

export const createRemoteTestDocument = async (db: PouchDB.Database) => {
  const id = `${MOBILE_TEST_DOCUMENT_PREFIX}${crypto.randomUUID()}`;
  await db.put({
    _id: id,
    type: "worshipsync-mobile-poc-test",
    tenant: "demo",
    deviceCreatedAt: new Date().toISOString(),
    mobileText: "Created locally on Android.",
    desktopText: "",
    editNumber: 0,
  });
  rememberId(REGISTERED_TEST_IDS_KEY, id);
  return id;
};

export const reviseRemoteTestDocument = async (
  db: PouchDB.Database,
  id: string,
  editor: "mobile" | "desktop",
) => {
  if (!id.startsWith(MOBILE_TEST_DOCUMENT_PREFIX)) throw new Error("Only mobile POC test documents can be edited here.");
  const current = await db.get<PouchDB.Core.ExistingDocument<{ mobileText?: string; desktopText?: string; editNumber?: number }>>(id);
  assertPocDocument(current, id);
  const updated = {
    ...current,
    editNumber: (current.editNumber ?? 0) + 1,
    ...(editor === "mobile" ? { mobileText: `Mobile edit ${Date.now()}` } : { desktopText: `Desktop edit ${Date.now()}` }),
  };
  await db.put(updated);
  return updated;
};

export const inspectRemoteTestDocumentConflicts = async (db: PouchDB.Database, id: string) => {
  if (!id.startsWith(MOBILE_TEST_DOCUMENT_PREFIX)) throw new Error("Only mobile POC test documents can be inspected here.");
  const document = await db.get<PouchDB.Core.ExistingDocument<{ mobileText?: string; desktopText?: string }>>(id, { conflicts: true });
  assertPocDocument(document, id);
  return {
    id,
    winningRevision: document._rev,
    conflicts: (document as typeof document & { _conflicts?: string[] })._conflicts ?? [],
    mobileText: document.mobileText ?? "",
    desktopText: document.desktopText ?? "",
  };
};

export const deleteRemoteTestDocumentLocally = async (db: PouchDB.Database, id: string) => {
  assertRegisteredTestDocument(id);
  const document = await db.get(id);
  assertPocDocument(document as PouchDB.Core.ExistingDocument<{ type?: string; tenant?: string }>, id);
  const result = await db.remove(document);
  rememberId(DELETED_TEST_IDS_KEY, id);
  return result;
};

export const saveLocalPersistenceSample = async (db: PouchDB.Database) => {
  let current: PouchDB.Core.ExistingDocument<{ saveNumber?: number }> | undefined;
  try {
    current = await db.get(LOCAL_PERSISTENCE_TEST_ID) as PouchDB.Core.ExistingDocument<{ saveNumber?: number }>;
  } catch (error) {
    if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error;
  }
  const document = {
    ...(current ?? {}),
    _id: LOCAL_PERSISTENCE_TEST_ID,
    type: "worshipsync-mobile-poc-local-check",
    tenant: "demo",
    saveNumber: (current?.saveNumber ?? 0) + 1,
    savedAt: new Date().toISOString(),
  };
  await db.put(document);
  return db.get(LOCAL_PERSISTENCE_TEST_ID);
};
