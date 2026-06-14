import type PouchDB from "pouchdb-browser";
import { globalBroadcastRef } from "../../context/controllerInfo";
import { globalHostId } from "../../context/globalInfo";
import {
  LEGACY_TEAMS_POUCH_DOC_ID,
  TEAMS_DRAFTS_DOC_ID,
  TEAMS_FAILURES_DOC_ID,
  TEAMS_META_DOC_ID,
  teamsDataDocId,
} from "./teamsConstants";
import type {
  FailedAssignments,
  TeamsData,
  TeamsDataKey,
  TeamsDataPouchDoc,
  TeamsDraftsPouchDoc,
  TeamsFailuresPouchDoc,
  TeamsMetaPouchDoc,
  TeamsPouchDoc,
  TeamsScheduleDrafts,
} from "./types";

export const isTeamsPouchDoc = (doc: unknown): doc is TeamsPouchDoc =>
  typeof doc === "object" &&
  doc !== null &&
  "_id" in doc &&
  ((doc as { _id?: string })._id === LEGACY_TEAMS_POUCH_DOC_ID ||
    Boolean((doc as { _id?: string })._id?.startsWith("teams:")));

export const isPouchNotFoundError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status?: number }).status === 404;

const broadcastTeamsDoc = (doc: TeamsPouchDoc) => {
  globalBroadcastRef?.postMessage({
    type: "update",
    data: {
      docs: doc,
      hostId: globalHostId,
    },
  });
};

const persistPouchDoc = async <TDoc extends TeamsPouchDoc>(
  db: PouchDB.Database,
  nextDoc: Omit<TDoc, "_rev" | "updatedAt"> & { updatedAt?: string },
): Promise<TDoc> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let currentDoc: TeamsPouchDoc | null = null;
    try {
      currentDoc = await db.get<TeamsPouchDoc>(nextDoc._id);
    } catch (error) {
      if (!isPouchNotFoundError(error)) throw error;
    }

    const docWithRev = {
      ...nextDoc,
      ...(currentDoc?._rev ? { _rev: currentDoc._rev } : {}),
      updatedAt: new Date().toISOString(),
    } as TDoc;

    try {
      const result = await db.put(docWithRev);
      const savedDoc = { ...docWithRev, _rev: result.rev };
      broadcastTeamsDoc(savedDoc);
      return savedDoc;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error as { status?: number }).status === 409 &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not persist teams cache.");
};

export const persistTeamsMetaDoc = (
  db: PouchDB.Database,
  snapshot: Omit<TeamsMetaPouchDoc, "_id" | "_rev" | "docType" | "updatedAt">,
) =>
  persistPouchDoc<TeamsMetaPouchDoc>(db, {
    _id: TEAMS_META_DOC_ID,
    docType: "teams-meta",
    ...snapshot,
  });

export const persistTeamsDataDoc = <K extends TeamsDataKey>(
  db: PouchDB.Database,
  churchId: string,
  key: K,
  items: TeamsData[K],
) =>
  persistPouchDoc<TeamsDataPouchDoc<K>>(db, {
    _id: teamsDataDocId(key),
    docType: "teams-data",
    churchId,
    key,
    items,
  });

export const persistTeamsDraftsDoc = (
  db: PouchDB.Database,
  churchId: string,
  scheduleDrafts: TeamsScheduleDrafts,
) =>
  persistPouchDoc<TeamsDraftsPouchDoc>(db, {
    _id: TEAMS_DRAFTS_DOC_ID,
    docType: "teams-drafts",
    churchId,
    scheduleDrafts,
  });

export const persistTeamsFailuresDoc = (
  db: PouchDB.Database,
  churchId: string,
  failedAssignments: FailedAssignments,
) =>
  persistPouchDoc<TeamsFailuresPouchDoc>(db, {
    _id: TEAMS_FAILURES_DOC_ID,
    docType: "teams-failed-assignments",
    churchId,
    failedAssignments,
  });

export const loadTeamsPouchDocs = async (db: PouchDB.Database) => {
  const result = await db.allDocs<TeamsPouchDoc>({
    include_docs: true,
    startkey: "teams:",
    endkey: "teams:\uffff",
  });
  const docs = result.rows.map((row) => row.doc).filter(isTeamsPouchDoc);
  try {
    const legacyDoc = await db.get<TeamsPouchDoc>(LEGACY_TEAMS_POUCH_DOC_ID);
    if (isTeamsPouchDoc(legacyDoc)) docs.push(legacyDoc);
  } catch (error) {
    if (!isPouchNotFoundError(error)) throw error;
  }
  return docs;
};

export const isNewerTeamsDoc = (
  lastAppliedAt: string | undefined,
  nextUpdatedAt: string | undefined,
) => !lastAppliedAt || !nextUpdatedAt || nextUpdatedAt >= lastAppliedAt;
