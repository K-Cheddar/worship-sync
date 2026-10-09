import type PouchDB from "pouchdb-browser";
import type { DBControllerMediaRouteFoldersDoc, MediaRouteKey } from "../types";
import {
  getControllerMediaRouteFoldersDocId,
  isControllerMediaRouteFoldersDocId,
  MEDIA_ROUTE_FOLDERS_POUCH_ID,
} from "../types";
import { migrateLegacyMediaRouteFolders } from "./mediaRouteKey";
import { getMediaRouteFolderRepairs } from "./mediaFolderMutations";
import { globalBroadcastRef } from "../context/controllerInfo";
import { globalHostId } from "../context/globalInfo";

type PouchError = { status?: number | string; name?: string };
const notFound = (error: unknown) => {
  const value = error as PouchError;
  return value?.status === 404 || value?.status === "404" || value?.name === "not_found";
};
const conflict = (error: unknown) => {
  const value = error as PouchError;
  return value?.status === 409 || value?.status === "409" || value?.name === "conflict";
};
const now = () => new Date().toISOString();

export function broadcastControllerMediaRouteFoldersUpdate(
  docs: DBControllerMediaRouteFoldersDoc[],
  publishIfCurrent: () => boolean,
) {
  if (docs.length && publishIfCurrent() && globalBroadcastRef) {
    globalBroadcastRef.postMessage({ type: "update", data: { docs, hostId: globalHostId } });
  }
}

async function getOptional(db: PouchDB.Database, id: string): Promise<Record<string, unknown> | null> {
  try {
    return await db.get(id) as unknown as Record<string, unknown>;
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
}

/** Load a profile's map, lazily seeding it once from the legacy shared snapshot. */
export async function loadOrCreateControllerMediaRouteFolders(
  db: PouchDB.Database,
  controllerProfileId: string,
): Promise<DBControllerMediaRouteFoldersDoc> {
  const id = getControllerMediaRouteFoldersDocId(controllerProfileId);
  const existing = await getOptional(db, id);
  if (existing) return normalizeScopedDoc(existing, controllerProfileId);

  const legacy = await getOptional(db, MEDIA_ROUTE_FOLDERS_POUCH_ID);
  const seed = migrateLegacyMediaRouteFolders(
    (legacy?.mediaRouteFolders ?? {}) as Partial<Record<string, string | null>>,
  );
  const timestamp = now();
  try {
    await db.put({
      _id: id,
      controllerProfileId,
      mediaRouteFolders: seed,
      createdAt: timestamp,
      updatedAt: timestamp,
      docType: "mediaRouteFolders",
    });
  } catch (error) {
    if (!conflict(error)) throw error;
    // Another tab/device seeded this profile first. Its document owns the result.
  }
  const createdOrRaced = await db.get(id) as unknown as Record<string, unknown>;
  return normalizeScopedDoc(createdOrRaced, controllerProfileId);
}

function normalizeScopedDoc(
  doc: Record<string, unknown>,
  controllerProfileId: string,
): DBControllerMediaRouteFoldersDoc {
  return {
    ...doc,
    _id: getControllerMediaRouteFoldersDocId(controllerProfileId),
    controllerProfileId,
    mediaRouteFolders: migrateLegacyMediaRouteFolders(
      (doc.mediaRouteFolders ?? {}) as Partial<Record<string, string | null>>,
    ),
    docType: "mediaRouteFolders",
  } as DBControllerMediaRouteFoldersDoc;
}

/** Merge one route against the latest revision, retrying Couch conflicts. */
export async function patchControllerMediaRouteFolder(
  db: PouchDB.Database,
  controllerProfileId: string,
  key: MediaRouteKey,
  folderId: string | null,
): Promise<DBControllerMediaRouteFoldersDoc> {
  const id = getControllerMediaRouteFoldersDocId(controllerProfileId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await loadOrCreateControllerMediaRouteFolders(db, controllerProfileId);
    const next = {
      ...current,
      mediaRouteFolders: { ...current.mediaRouteFolders, [key]: folderId },
      updatedAt: now(),
      docType: "mediaRouteFolders" as const,
    };
    try {
      const result = await db.put(next);
      return { ...next, _rev: result.rev };
    } catch (error) {
      if (!conflict(error) || attempt === 4) throw error;
    }
  }
  throw new Error(`Could not update ${id} after repeated conflicts`);
}

/** Repair only existing controller docs and the legacy migration source. */
export async function repairPersistedMediaRouteFolders(
  db: PouchDB.Database,
  deletedFolderIds: Set<string>,
  fallbackFolderId: string,
): Promise<DBControllerMediaRouteFoldersDoc[]> {
  const result = await db.allDocs({ include_docs: true });
  const changed: DBControllerMediaRouteFoldersDoc[] = [];
  for (const row of result.rows) {
    const raw = row.doc as unknown as Record<string, unknown> | undefined;
    if (!raw || typeof raw._id !== "string") continue;
    if (raw._id !== MEDIA_ROUTE_FOLDERS_POUCH_ID && !isControllerMediaRouteFoldersDocId(raw._id)) continue;
    const routes = migrateLegacyMediaRouteFolders(
      (raw.mediaRouteFolders ?? {}) as Partial<Record<string, string | null>>,
    );
    const repairs = getMediaRouteFolderRepairs(routes, deletedFolderIds, fallbackFolderId);
    if (Object.keys(repairs).length === 0) continue;
    const next = {
      ...raw,
      mediaRouteFolders: { ...routes, ...repairs },
      updatedAt: now(),
      docType: "mediaRouteFolders",
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const put = await db.put(next);
        if (isControllerMediaRouteFoldersDocId(raw._id)) {
          changed.push({ ...next, _rev: put.rev } as DBControllerMediaRouteFoldersDoc);
        }
        break;
      } catch (error) {
        if (!conflict(error) || attempt === 4) throw error;
        const latest = await getOptional(db, raw._id);
        if (!latest) break;
        const latestRoutes = migrateLegacyMediaRouteFolders(
          (latest.mediaRouteFolders ?? {}) as Partial<Record<string, string | null>>,
        );
        const latestRepairs = getMediaRouteFolderRepairs(
          latestRoutes,
          deletedFolderIds,
          fallbackFolderId,
        );
        if (!Object.keys(latestRepairs).length) break;
        Object.assign(next, latest, {
          mediaRouteFolders: { ...latestRoutes, ...latestRepairs },
          updatedAt: now(),
          docType: "mediaRouteFolders",
        });
      }
    }
  }
  return changed;
}
