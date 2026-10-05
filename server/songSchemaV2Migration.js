import { isDeepStrictEqual } from "node:util";
import {
  getSongV2ArrangementDocId,
  getSongV2ArrangementIdPrefix,
  getSongV2RootDocId,
  getSongV2SlideDocId,
  hydrateSongFromV2DocumentsForMigration,
  serializeSongToV2Documents,
} from "../client/src/utils/songV2Codec.ts";
import { normalizeSongForV2Hydration } from "../client/src/utils/songNormalization.ts";

export const SONG_MIGRATION_BATCH_SIZE = 50;
const ARRANGEMENT_PREFIX = "song-v2:arrangement:";
const SLIDE_PREFIX = "song-v2:slide:";
const AUDIT_FIELDS = new Set(["_rev", "createdAt", "createdBy", "updatedAt", "updatedBy"]);

const encoded = (value) => encodeURIComponent(value);
const isMissing = (error) => error?.response?.status === 404 || error?.status === 404;
const statusOf = (error) => error?.response?.status || error?.status;
const stripPhysicalFields = (doc) => Object.fromEntries(
  Object.entries(doc).filter(([key]) => !AUDIT_FIELDS.has(key)),
);
const sameAuthoredContent = (left, right) => isDeepStrictEqual(
  stripPhysicalFields(left), stripPhysicalFields(right),
);

const songContentForVerification = (song) => {
  const normalized = normalizeSongForV2Hydration(song);
  const root = {
    _id: normalized._id,
    type: "song",
    name: normalized.name,
    selectedArrangement: normalized.selectedArrangement,
    slides: [],
    arrangements: (normalized.arrangements || []).map((arrangement) => ({
      id: arrangement.id,
      name: arrangement.name,
      formattedLyrics: arrangement.formattedLyrics,
      songOrder: arrangement.songOrder,
      ...(arrangement.monitorLayout !== undefined ? { monitorLayout: arrangement.monitorLayout } : {}),
      slides: (arrangement.slides || []).map((slide) => {
        const { _id, _rev, createdAt, createdBy, updatedAt, updatedBy, ...authored } = slide;
        return authored;
      }),
    })),
  };
  for (const key of ["shouldSkipTitle", "background", "shouldSendTo", "songMetadata", "songLinks", "songAudio"]) {
    if (normalized[key] !== undefined) root[key] = normalized[key];
  }
  return root;
};

const readOptionalDoc = async (client, url) => {
  try {
    const response = await client.get(url);
    return response.data;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const pageAllDocs = async (client, dbUrl) => {
  const relevant = [];
  const pageSize = 500;
  let lastId;
  while (true) {
    const paging = lastId === undefined
      ? ""
      : `&startkey=${encoded(JSON.stringify(lastId))}&skip=1`;
    const response = await client.get(`${dbUrl}/_all_docs?include_docs=true&limit=${pageSize}${paging}`);
    const rows = response.data?.rows || [];
    for (const row of rows) {
      const doc = row.doc;
      if (doc && (doc.type === "song" || doc.docType === "song-v2-root" ||
        doc.docType === "song-v2-arrangement" || doc.docType === "song-v2-slide")) {
        relevant.push(doc);
      }
    }
    if (rows.length < pageSize) break;
    lastId = rows.at(-1)?.id;
    if (typeof lastId !== "string") throw new Error("CouchDB returned an invalid _all_docs page.");
  }
  return relevant;
};

const listByPrefix = async (client, dbUrl, prefix) => {
  const response = await client.get(
    `${dbUrl}/_all_docs?include_docs=true&startkey=${encoded(JSON.stringify(prefix))}&endkey=${encoded(JSON.stringify(`${prefix}\uffff`))}`,
  );
  return (response.data?.rows || [])
    .map((row) => row.doc)
    .filter((doc) => doc && doc._id?.startsWith(prefix));
};

const getSongChildren = async (client, dbUrl, songId) => {
  const arrangementPrefix = getSongV2ArrangementIdPrefix(songId);
  const slidePrefix = `${SLIDE_PREFIX}${encoded(songId)}:`;
  const [arrangements, slides] = await Promise.all([
    listByPrefix(client, dbUrl, arrangementPrefix),
    listByPrefix(client, dbUrl, slidePrefix),
  ]);
  return { arrangements, slides };
};

const loadActiveSong = async (client, dbUrl, songId) => {
  const root = await client.get(`${dbUrl}/${encoded(getSongV2RootDocId(songId))}`).then((response) => response.data);
  const arrangementDocuments = [];
  for (const arrangementId of root.arrangementIds || []) {
    const id = getSongV2ArrangementDocId(songId, arrangementId);
    arrangementDocuments.push((await client.get(`${dbUrl}/${encoded(id)}`)).data);
  }
  const slideDocuments = [];
  for (const arrangement of arrangementDocuments) {
    for (const slideId of arrangement.slideIds || []) {
      const id = getSongV2SlideDocId(songId, arrangement.arrangementId, slideId);
      slideDocuments.push((await client.get(`${dbUrl}/${encoded(id)}`)).data);
    }
  }
  return {
    root,
    arrangements: arrangementDocuments,
    slides: slideDocuments,
    hydrated: hydrateSongFromV2DocumentsForMigration(root, arrangementDocuments, slideDocuments),
  };
};

const validateLegacySong = (song) => {
  if (!song || song.type !== "song" || typeof song._id !== "string" || !song._id.trim()) {
    throw Object.assign(new Error("Legacy song has no valid logical song ID."), { code: "blocked_invalid_ids" });
  }
  if (typeof song._rev !== "string" || !song._rev) {
    throw Object.assign(new Error("Legacy song has no source revision to protect activation."), { code: "blocked_invalid_ids" });
  }
  if (song.arrangements !== undefined && !Array.isArray(song.arrangements)) {
    throw Object.assign(new Error("Legacy arrangements must be an array."), { code: "blocked_invalid_ids" });
  }
  const arrangements = song.arrangements || [];
  for (const arrangement of arrangements) {
    if (typeof arrangement?.id !== "string" || !arrangement.id.trim()) {
      throw Object.assign(new Error("Legacy song contains an arrangement with a missing ID."), { code: "blocked_invalid_ids" });
    }
  }
  if (!arrangements.length && (song.slides || []).length && !song._id.trim()) {
    throw Object.assign(new Error("Legacy root slides cannot be normalized without a song ID."), { code: "blocked_invalid_ids" });
  }
  const selected = song.selectedArrangement ?? 0;
  if (!Number.isFinite(selected) || !Number.isInteger(selected)) {
    throw Object.assign(new Error("Legacy selectedArrangement cannot be normalized safely."), { code: "blocked_invalid_ids" });
  }
  for (const arrangement of arrangements) {
    if (arrangement.slides !== undefined && !Array.isArray(arrangement.slides)) {
      throw Object.assign(new Error(`Arrangement ${arrangement.id} slides must be an array.`), { code: "blocked_invalid_ids" });
    }
    for (const slide of arrangement.slides || []) {
      if (typeof slide?.id !== "string" || !slide.id.trim()) {
        throw Object.assign(new Error(`Arrangement ${arrangement.id} contains a slide with a missing ID.`), { code: "blocked_invalid_ids" });
      }
    }
  }
  for (const slide of song.slides || []) {
    if (typeof slide?.id !== "string" || !slide.id.trim()) {
      throw Object.assign(new Error("Legacy root slides contain a slide with a missing ID."), { code: "blocked_invalid_ids" });
    }
  }
  let docs;
  try {
    docs = serializeSongToV2Documents(song);
  } catch (error) {
    throw Object.assign(new Error(error?.message || "Legacy song cannot be serialized to schema v2."), { code: "blocked_invalid_ids" });
  }
  const ids = [docs.root, ...docs.arrangements, ...docs.slides].map((doc) => doc._id);
  if (new Set(ids).size !== ids.length || docs.root._id !== getSongV2RootDocId(song._id) ||
    docs.slides.some((doc) => doc._id !== getSongV2SlideDocId(song._id, doc.arrangementId, doc.id))) {
    throw Object.assign(new Error("Song v2 document IDs are not deterministic and collision-free."), { code: "blocked_invalid_ids" });
  }
  return docs;
};

const verifyChildren = async (client, dbUrl, docs) => {
  const actual = [];
  for (const doc of [...docs.slides, ...docs.arrangements]) {
    const response = await client.get(`${dbUrl}/${encoded(doc._id)}`);
    if (!sameAuthoredContent(response.data, doc)) throw new Error(`Child verification mismatch for ${doc._id}.`);
    actual.push(response.data);
  }
  return actual;
};

const writeBounded = async (client, dbUrl, docs, batchSize, songReport) => {
  const writeBatch = async (batch) => {
    try {
      const response = await client.post(`${dbUrl}/_bulk_docs`, { docs: batch });
      const results = response.data || [];
      const oversized = results.filter((result) => result.status === 413 || result.error === "too_large");
      const otherFailures = results.filter((result) => result.error && !(result.status === 413 || result.error === "too_large"));
      if (otherFailures.length) throw new Error(`CouchDB rejected ${otherFailures.length} child document write(s).`);
      if (oversized.length) {
        const oversizedIds = new Set(oversized.map((result) => result.id));
        const oversizedDocs = batch.filter((doc) => oversizedIds.has(doc._id));
        if (oversizedDocs.length === batch.length) throw Object.assign(new Error("CouchDB rejected oversized child documents."), { response: { status: 413 } });
        await writeBatch(oversizedDocs);
      }
      for (const doc of batch) {
        if (oversized.some((result) => result.id === doc._id)) continue;
        if (!doc._deleted) {
          const kind = doc._id.startsWith(SLIDE_PREFIX) ? "slides" : "arrangements";
          songReport[doc._rev ? "childrenUpdated" : "childrenCreated"][kind] += 1;
        } else songReport.childrenDeleted += 1;
      }
    } catch (error) {
      if (error?.code === "blocked_oversized_document") throw error;
      if (statusOf(error) !== 413) throw error;
      if (batch.length === 1) {
        const doc = batch[0];
        throw Object.assign(new Error(`CouchDB rejected one ${doc._id.startsWith(SLIDE_PREFIX) ? "slide" : "arrangement"} document with HTTP 413 (${doc._id}).`), { code: "blocked_oversized_document" });
      }
      const midpoint = Math.ceil(batch.length / 2);
      await writeBatch(batch.slice(0, midpoint));
      await writeBatch(batch.slice(midpoint));
    }
  };

  for (let index = 0; index < docs.length; index += batchSize) {
    await writeBatch(docs.slice(index, index + batchSize));
  }
};

const makeSongReport = (songId, name) => ({
  songId,
  name: name || "",
  sourceRevision: null,
  status: "failed",
  arrangementCount: 0,
  slideCount: 0,
  existingV2Children: 0,
  childrenCreated: { slides: 0, arrangements: 0 },
  childrenUpdated: { slides: 0, arrangements: 0 },
  childrenDeleted: 0,
  verificationResult: "not_run",
  activationResult: "not_run",
  failures: [],
});

const preflightV2Root = async (client, dbUrl, songId) => {
  try {
    return { valid: true, active: await loadActiveSong(client, dbUrl, songId) };
  } catch (error) {
    return { valid: false, error };
  }
};

const assertLegacyRevisionUnchanged = async (client, dbUrl, songId, sourceRevision) => {
  const current = await client.get(`${dbUrl}/${encoded(songId)}`).then((response) => response.data);
  if (current._rev !== sourceRevision) {
    throw Object.assign(new Error("Legacy song changed during migration; v2 root was not published."), { code: "source_changed" });
  }
};

const assertRootAbsent = async (client, dbUrl, songId) => {
  const root = await readOptionalDoc(client, `${dbUrl}/${encoded(getSongV2RootDocId(songId))}`);
  if (!root) return;
  const active = await preflightV2Root(client, dbUrl, songId);
  if (active.valid) {
    throw Object.assign(new Error("A v2 root became active during preparation; no more child changes were made."), { code: "already_v2" });
  }
  throw new Error(`A v2 root appeared during preparation but is invalid; refusing to overwrite it: ${active.error.message}`);
};

export async function migrateSongToV2({ client, database, legacySong, dryRun = false, batchSize = SONG_MIGRATION_BATCH_SIZE }) {
  const report = makeSongReport(legacySong?._id, legacySong?.name);
  const dbUrl = `/${encoded(database)}`;
  const songId = legacySong?._id;
  try {
    if (typeof songId !== "string" || !songId) throw new Error("Song ID is required.");
    report.sourceRevision = legacySong._rev || null;
    const rootId = getSongV2RootDocId(songId);
    const existingRoot = await readOptionalDoc(client, `${dbUrl}/${encoded(rootId)}`);
    if (existingRoot) {
      const active = await preflightV2Root(client, dbUrl, songId);
      if (!active.valid) {
        report.status = "verification_failed";
        report.activationResult = "existing_root_invalid";
        throw new Error(`Existing v2 root is invalid; refusing to rebuild from legacy data: ${active.error.message}`);
      }
      report.name = active.active.hydrated.name || "";
      report.arrangementCount = active.active.arrangements.length;
      report.slideCount = active.active.slides.length;
      report.existingV2Children = active.active.arrangements.length + active.active.slides.length;
      report.status = "already_v2";
      report.activationResult = "already_active";
      report.verificationResult = "passed";
      return report;
    }

    const expected = validateLegacySong(legacySong);
    report.name = expected.root.name || "";
    report.arrangementCount = expected.arrangements.length;
    report.slideCount = expected.slides.length;

    const children = await getSongChildren(client, dbUrl, songId);
    report.existingV2Children = children.arrangements.length + children.slides.length;
    const expectedIds = new Set([...expected.arrangements, ...expected.slides].map((doc) => doc._id));
    const currentById = new Map([...children.arrangements, ...children.slides].map((doc) => [doc._id, doc]));
    for (const doc of [...expected.slides, ...expected.arrangements]) {
      const current = currentById.get(doc._id);
      const validIdentity = doc.docType === "song-v2-slide"
        ? current?.docType === "song-v2-slide" && current.songId === songId && current.arrangementId === doc.arrangementId && current.id === doc.id
        : current?.docType === "song-v2-arrangement" && current.songId === songId && current.arrangementId === doc.arrangementId;
      if (current && !validIdentity) throw Object.assign(new Error(`Deterministic child ID ${doc._id} belongs to a different document identity.`), { code: "blocked_invalid_ids" });
    }
    for (const doc of [...children.arrangements, ...children.slides]) {
      if (doc.songId !== songId) throw Object.assign(new Error(`Preparation child ${doc._id} has a mismatched song ID.`), { code: "blocked_invalid_ids" });
    }
    if (children.arrangements.some((doc) => doc.docType !== "song-v2-arrangement") ||
      children.slides.some((doc) => doc.docType !== "song-v2-slide")) {
      throw Object.assign(new Error("Preparation child IDs contain documents with an invalid Song v2 type."), { code: "blocked_invalid_ids" });
    }
    const staleDocs = [...children.arrangements, ...children.slides]
      .filter((doc) => !expectedIds.has(doc._id))
      .map((doc) => ({ _id: doc._id, _rev: doc._rev, _deleted: true }));
    const writeDocsFor = (docs) => docs.flatMap((doc) => {
      const current = currentById.get(doc._id);
      if (current && sameAuthoredContent(current, doc)) return [];
      return [{ ...doc, ...(current?._rev ? { _rev: current._rev } : {}) }];
    });
    const slideWrites = writeDocsFor(expected.slides);
    const arrangementWrites = writeDocsFor(expected.arrangements);
    report.childrenCreated = { slides: 0, arrangements: 0 };
    report.childrenUpdated = { slides: 0, arrangements: 0 };
    report.childrenDeleted = 0;
    const estimate = {
      slides: slideWrites.length,
      arrangements: arrangementWrites.length,
      staleChildren: staleDocs.length,
    };
    if (dryRun) {
      report.status = "dry_run_ready";
      report.activationResult = "not_published_dry_run";
      report.verificationResult = "not_run_dry_run";
      report.expectedWrites = estimate;
      return report;
    }

    await writeBounded(client, dbUrl, slideWrites, batchSize, report);
    await writeBounded(client, dbUrl, arrangementWrites, batchSize, report);
    await verifyChildren(client, dbUrl, expected);
    report.verificationResult = "children_passed";

    try {
      await assertLegacyRevisionUnchanged(client, dbUrl, songId, legacySong._rev);
      await assertRootAbsent(client, dbUrl, songId);
    } catch (error) {
      if (error?.code === "source_changed") {
        report.status = "source_changed";
        report.activationResult = "not_published_source_changed";
      }
      if (error?.code === "already_v2") {
        report.status = "already_v2";
        report.activationResult = "activated_concurrently";
        report.verificationResult = "passed";
        return report;
      }
      throw error;
    }

    await writeBounded(client, dbUrl, staleDocs, batchSize, report);
    await verifyChildren(client, dbUrl, expected);
    report.verificationResult = "children_passed";
    try {
      await assertLegacyRevisionUnchanged(client, dbUrl, songId, legacySong._rev);
      await assertRootAbsent(client, dbUrl, songId);
    } catch (error) {
      if (error?.code === "source_changed") {
        report.status = "source_changed";
        report.activationResult = "not_published_source_changed";
      }
      if (error?.code === "already_v2") {
        report.status = "already_v2";
        report.activationResult = "activated_concurrently";
        report.verificationResult = "passed";
        return report;
      }
      throw error;
    }

    await client.put(`${dbUrl}/${encoded(rootId)}`, expected.root);
    report.activationResult = "published";
    const active = await loadActiveSong(client, dbUrl, songId);
    if (!isDeepStrictEqual(songContentForVerification(active.hydrated), songContentForVerification(legacySong))) {
      report.status = "verification_failed";
      throw new Error("Active v2 song did not match the serialized legacy song after root publication.");
    }
    report.verificationResult = "passed";
    report.status = "migrated";
  } catch (error) {
    if (error?.code && report.status === "failed") report.status = error.code;
    report.failures.push(error?.message || "Unknown Song v2 migration failure.");
    if (report.verificationResult === "not_run") report.verificationResult = "failed";
    if (report.activationResult === "not_run") report.activationResult = "not_published";
  }
  return report;
}

export async function migrateSongDatabaseToV2({ client, database, songId, dryRun = false, batchSize = SONG_MIGRATION_BATCH_SIZE }) {
  const dbUrl = `/${encoded(database)}`;
  let legacyDocs;
  let roots;
  if (songId) {
    const legacy = await readOptionalDoc(client, `${dbUrl}/${encoded(songId)}`);
    const root = await readOptionalDoc(client, `${dbUrl}/${encoded(getSongV2RootDocId(songId))}`);
    if (!legacy && !root) throw new Error(`Song ${songId} was not found as a legacy song or v2 song.`);
    if (legacy && legacy.type !== "song" && !root) throw new Error(`Document ${songId} exists but is not a legacy song.`);
    legacyDocs = legacy?.type === "song" ? [legacy] : [];
    roots = root ? [root] : [];
  } else {
    const all = await pageAllDocs(client, dbUrl);
    legacyDocs = all.filter((doc) => doc.type === "song");
    roots = all.filter((doc) => doc.docType === "song-v2-root");
  }

  const legacyById = new Map(legacyDocs.map((song) => [song._id, song]));
  const rootSongIds = new Set(roots.map((root) => root.songId).filter((id) => typeof id === "string"));
  const logicalSongIds = new Set([...legacyById.keys(), ...rootSongIds]);
  const reports = [];
  for (const id of logicalSongIds) {
    const legacy = legacyById.get(id);
    if (!legacy) {
      const report = makeSongReport(id, "");
      const active = await preflightV2Root(client, dbUrl, id);
      report.status = active.valid ? "already_v2" : "verification_failed";
      report.activationResult = active.valid ? "already_active" : "existing_root_invalid";
      report.verificationResult = active.valid ? "passed" : "failed";
      if (!active.valid) report.failures.push(`Existing v2 root is invalid: ${active.error.message}`);
      else {
        report.name = active.active.hydrated.name || "";
        report.arrangementCount = active.active.arrangements.length;
        report.slideCount = active.active.slides.length;
        report.existingV2Children = active.active.arrangements.length + active.active.slides.length;
      }
      reports.push(report);
    } else {
      reports.push(await migrateSongToV2({ client, database, legacySong: legacy, dryRun, batchSize }));
    }
  }
  const migratedCount = reports.filter((entry) => entry.status === "migrated").length;
  const alreadyV2Count = reports.filter((entry) => entry.status === "already_v2").length;
  const blockedCount = reports.filter((entry) => entry.status.startsWith("blocked_")).length;
  const failedCount = reports.length - migratedCount - alreadyV2Count - blockedCount - (dryRun ? reports.filter((entry) => entry.status === "dry_run_ready").length : 0);
  return {
    database,
    legacySongCount: legacyDocs.length,
    alreadyV2Count,
    migratedCount,
    blockedCount,
    failedCount,
    dryRun,
    complete: reports.length > 0 && reports.every((entry) => ["migrated", "already_v2", "dry_run_ready"].includes(entry.status)),
    songs: reports,
  };
}
