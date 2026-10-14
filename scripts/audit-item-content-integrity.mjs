// Offline only. No credentials, network clients, repair operations, or writes.
// Manifest: { churches: [{ churchId, contentDatabaseKey, exportPath }] }.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { toWorshipSyncContentDbName } from "../server/couchContentDatabase.js";

const list = value => Array.isArray(value) ? value : [];
const normalized = value => typeof value === "string"
  ? value.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim() : "";
const hash = value => createHash("sha256").update(value).digest("hex");
const substantial = text => text.length >= 80 && new Set(text.split(" ")).size >= 12;
const contentText = slides => list(slides)
  .filter(slide => !["Title", "Blank"].includes(slide?.type))
  .flatMap(slide => list(slide?.boxes).map(box => normalized(box?.words))
    .concat(normalized(slide?.formattedTextDisplayInfo?.text)))
  .filter(Boolean).join(" ");
const nestedIds = doc => {
  const ids = new Set();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "id" && typeof child === "string" && child) ids.add(child);
      else visit(child);
    }
  };
  visit(doc.arrangements); visit(doc.slides); visit(doc.formattedSections);
  return ids;
};
export function exportedDocuments(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows.flatMap(row => row.doc ? [row.doc] : []);
  if (Array.isArray(value?.docs)) return value.docs;
  if (typeof value?._id === "string") return [value];
  throw new Error("Expected document array, {docs}, Couch _all_docs {rows}, or one document");
}

/** Pure analysis. Findings are review candidates, never proof of provenance. */
export function auditDocuments(documents, scope = {}) {
  const findings = [];
  const add = (severity, code, documentIds, evidence, recommendation) =>
    findings.push({ severity, code, documentIds, evidence, recommendation });
  const live = documents.filter(doc => doc && !doc._deleted && typeof doc._id === "string");
  const byId = new Map(live.map(doc => [doc._id, doc]));
  const items = live.filter(doc => ["song", "free", "bible", "timer"].includes(doc.type));
  const contentItems = items.filter(doc => ["song", "free"].includes(doc.type) && doc.docType !== "song-v2-root");
  const review = "Compare original exports, revision bodies, and operator intent before any repair.";
  const identities = new Map(), fingerprints = new Map(), titles = new Map();
  const summaries = new Map();
  const index = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const doc of live) {
    if (doc.docType === "item" && !["song", "free", "bible", "timer", "heading"].includes(doc.type)) {
      add("high", "invalid-item-type", [doc._id], { type: doc.type ?? null }, review);
    }
  }
  for (const doc of contentItems) {
    const ids = nestedIds(doc);
    for (const id of ids) index(identities, id, doc._id);
    const units = doc.type === "song"
      ? list(doc.arrangements).flatMap(arr => [
        normalized(list(arr.formattedLyrics).map(section => section?.words || "").join(" ")) || contentText(arr.slides),
        ...list(arr.formattedLyrics).map(section => normalized(section?.words)),
        ...list(arr.slides).map(slide => contentText([slide])),
      ])
      : [normalized(list(doc.formattedSections).map(section => section?.words || "").join(" ")),
        contentText(doc.slides), ...list(doc.slides).map(slide => contentText([slide]))];
    const substantialUnits = new Set(units.filter(substantial).map(hash));
    for (const fingerprint of substantialUnits) index(fingerprints, fingerprint, doc._id);
    summaries.set(doc._id, { ids, substantialUnits });
    const title = normalized(doc.name);
    if (title) index(titles, title, doc._id);
    const missing = ["name", "slides", "arrangements", "selectedArrangement", "shouldSendTo"]
      .filter(field => doc[field] === undefined);
    if (missing.length) add("medium", "legacy-missing-fields", [doc._id], { missing }, review);
    if (!doc.name || !Array.isArray(doc.slides) || !Array.isArray(doc.arrangements)) {
      add("high", "invalid-item-shape", [doc._id], { type: doc.type }, review);
    }
    if (!doc._id.startsWith("song-") && normalized(doc._id) !== normalized(doc.name)) {
      add("low", "legacy-id-title-divergence", [doc._id], {}, "A stable ID may legitimately retain an old title after a rename; inspect history rather than renaming it.");
    }
    if (doc.docType && doc.docType !== "item") {
      add("medium", "unexpected-item-docType", [doc._id], { docType: doc.docType }, review);
    }
    if (doc.type === "free") {
      const sections = normalized(list(doc.formattedSections).map(section => section?.words || "").join(" "));
      // Body box 1 is the source used by getFormattedSections, unlike overlays.
      const slides = normalized(list(doc.slides).map(slide => slide?.boxes?.[1]?.words || "").join(" "));
      if (!doc.formattedSections) add("medium", "custom-missing-sections", [doc._id], {}, review);
      if (sections && slides && sections !== slides) {
        add("high", "custom-section-slide-disagreement", [doc._id], {
          sectionFingerprint: hash(sections), slideFingerprint: hash(slides),
          sectionCharacters: sections.length, slideCharacters: slides.length,
        }, "Check text/layout overflow and rich-text representation before treating this candidate as corruption.");
      }
    }
  }

  // Candidate pairs come from shared IDs or substantive exact content, not
  // quadratic fuzzy lyric comparisons. Never compare IDs across databases.
  const pairs = new Map();
  for (const map of [identities, fingerprints]) {
    for (const owners of map.values()) {
      const ids = [...owners].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        pairs.set(JSON.stringify([ids[i], ids[j]]), [ids[i], ids[j]]);
      }
    }
  }
  for (const [a, b] of pairs.values()) {
    const left = summaries.get(a), right = summaries.get(b);
    const sharedIds = [...left.ids].filter(id => right.ids.has(id));
    const sharedContent = [...left.substantialUnits].filter(id => right.substantialUnits.has(id));
    const complete = sharedContent.length > 0 &&
      sharedContent.length === left.substantialUnits.size &&
      sharedContent.length === right.substantialUnits.size;
    const differentTitles = normalized(byId.get(a).name) !== normalized(byId.get(b).name);
    const severity = complete && differentTitles && sharedIds.length >= 3 ? "high" : "medium";
    add(severity, sharedContent.length ? "shared-substantial-content" : "shared-nested-identifiers",
      [a, b], { sharedIdCount: sharedIds.length, sharedIdFingerprints: sharedIds.map(hash),
        sharedContentFingerprints: sharedContent, completeSubstantialOverlap: complete,
        differentTitles, arrangementCounts: [list(byId.get(a).arrangements).length, list(byId.get(b).arrangements).length] },
      review + " Shared sections/medleys/copies are legitimate; overlap alone does not establish which title is wrong.");
  }
  for (const [title, ids] of titles) if (ids.size > 1) {
    add("medium", "near-identical-titles", [...ids], { normalizedTitleFingerprint: hash(title) }, review);
  }
  const allItems = byId.get("allItems");
  const indexed = new Set();
  const refs = (owner, references, library = false) => {
    for (const entry of list(references)) {
      if (!entry || typeof entry._id !== "string") {
        add("medium", "invalid-reference", [owner._id], {}, review); continue;
      }
      if (library) indexed.add(entry._id);
      const target = byId.get(entry._id);
      // Built-in service countdown is lazily materialized.
      if (!target && entry._id !== "service-time-countdown") {
        add("medium", "orphan-reference", [owner._id, entry._id], {}, "Verify export completeness and tombstones before removing a reference.");
      } else if (target && (entry.type !== target.type || (entry.name && entry.name !== target.name))) {
        add("medium", "reference-metadata-mismatch", [owner._id, entry._id],
          { referenceType: entry.type, documentType: target.type, nameDiffers: entry.name !== target.name },
          "Refresh index metadata only after validating the intended document identity.");
      }
    }
  };
  if (allItems) {
    if (!Array.isArray(allItems.items)) add("high", "invalid-library-index-shape", [allItems._id], {}, review);
    refs(allItems, allItems.items, true);
  }
  else add("medium", "missing-library-index", [], {}, "Supply the allItems export for index coverage.");
  for (const doc of items) if (allItems && ["song", "free"].includes(doc.type) && !indexed.has(doc._id)) {
    add("medium", "unindexed-item", [doc._id], {}, "Compare index and document replication snapshots; this finding does not establish content corruption.");
  }
  for (const doc of live) {
    if (doc !== allItems && Array.isArray(doc.items)) refs(doc, doc.items);
    if (Array.isArray(doc.itemLists)) {
      for (const entry of doc.itemLists) if (!entry || typeof entry._id !== "string" || !byId.has(entry._id)) {
        add("medium", "invalid-outline-registry-reference", [doc._id],
          { referencedId: entry?._id ?? null }, "Verify export completeness and controller scope before changing outlines.");
      }
    }
    const preview = doc.serviceOutline?.preview;
    if (preview) refs(doc, [...list(preview.lineItems), ...list(preview.outlineCandidates)]
      .flatMap(entry => entry?.matchedLibraryItem ? [entry.matchedLibraryItem] : []));
  }
  const unsupportedV2 = live.filter(doc => String(doc.docType || "").startsWith("song-v2")).length;
  const conflicts = live.filter(doc => list(doc._conflicts).length);
  for (const doc of conflicts) add("high", "replication-conflict-leaves", [doc._id],
    { conflictCount: doc._conflicts.length }, "Export all available leaf bodies; the winning revision alone is insufficient.");
  if (unsupportedV2) add("medium", "v2-content-not-hydrated", [], { documentCount: unsupportedV2 },
    "Hydrate V2 manifests and validate child ownership with in-progress-3 schema utilities before auditing V2 content.");
  const ranks = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => ranks[a.severity] - ranks[b.severity] || a.code.localeCompare(b.code));
  return {
    scope, documentCount: live.length, contentItemCount: contentItems.length,
    flaggedDocumentCount: new Set(findings.flatMap(finding => finding.documentIds).filter(id => byId.has(id))).size,
    candidateCount: findings.length,
    severityCounts: Object.fromEntries(Object.keys(ranks).map(rank => [rank, findings.filter(f => f.severity === rank).length])),
    limitations: ["Offline snapshot only; flagged counts are candidates, not confirmed affected counts.",
      "No semantic title inference; partial/fuzzy lyrics without reused IDs may be missed.",
      "Missing reference targets can reflect incomplete exports; historical revisions are not analyzed.",
      "Rich text markup and overflow may produce section/slide mismatch candidates."],
    findings,
  };
}

export async function auditManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.churches) || !manifest.churches.length) throw new Error("Manifest requires churches");
  const databases = new Map();
  for (const church of manifest.churches) {
    if (!church.churchId || !church.contentDatabaseKey || !church.exportPath) throw new Error("Each entry requires churchId, contentDatabaseKey, exportPath");
    const database = toWorshipSyncContentDbName(church.contentDatabaseKey);
    const exportPath = resolve(dirname(resolve(manifestPath)), church.exportPath);
    const previous = databases.get(database);
    if (previous && previous.exportPath !== exportPath) throw new Error("Shared database must reference one consistent export");
    if (previous) previous.churchIds.push(church.churchId);
    else databases.set(database, { database, churchIds: [church.churchId], exportPath });
  }
  const reports = [];
  for (const { database, churchIds, exportPath } of databases.values()) {
    const contents = await readFile(exportPath, "utf8");
    reports.push(auditDocuments(exportedDocuments(JSON.parse(contents)), {
      database, churchIds, exportSha256: hash(contents),
    }));
  }
  return { mode: "offline-read-only", reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/audit-item-content-integrity.mjs manifest.json");
    process.stdout.write(JSON.stringify(await auditManifest(process.argv[2]), null, 2) + "\n");
  } catch {
    // Do not echo parse errors: they can contain excerpts of private exports.
    process.stderr.write("Audit failed: check manifest, database keys, export paths, and JSON shape. No data was written.\n");
    process.exitCode = 1;
  }
}
