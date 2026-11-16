import "dotenv/config";
import axios from "axios";

const [requestedTitle = "Better"] = process.argv.slice(2);
const databaseName = "worship-sync-demo";
const rootPrefix = "song-v2:root:";
const metadataKeys = new Set([
  "_id", "_rev", "_revisions", "_conflicts", "createdAt", "createdBy",
  "updatedAt", "updatedBy",
]);
const formattingKeys = new Set([
  "align", "alignment", "background", "bold", "color", "font", "fontFamily",
  "fontSize", "fontStyle", "italic", "letterSpacing", "lineHeight", "style",
  "textAlign", "underline", "width", "height",
]);

const { COUCHDB_HOST: host, COUCHDB_USER: username, COUCHDB_PASSWORD: password } = process.env;
if (!host || !username || !password) {
  throw new Error("CouchDB configuration is incomplete; no request was made.");
}

const baseUrl = `https://${host}/${databaseName}`;
const request = axios.create({
  baseURL: baseUrl,
  auth: { username, password },
  timeout: 20_000,
  validateStatus: status => status >= 200 && status < 300,
});

const getDocument = async (id, params = {}) => {
  const { data } = await request.get(`/${encodeURIComponent(id)}`, { params });
  return data;
};

const fullRevisions = doc => {
  const history = doc?._revisions;
  return history?.ids?.map((id, index) => `${history.start - index}-${id}`) ?? [];
};

const changedPaths = (before, after, path = "") => {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const paths = [];
    if (before.length !== after.length) paths.push(`${path}.length`);
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      paths.push(...changedPaths(before[index], after[index], `${path}[${index}]`));
    }
    return paths;
  }
  if (before && after && typeof before === "object" && typeof after === "object" &&
      !Array.isArray(before) && !Array.isArray(after)) {
    const paths = [];
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (metadataKeys.has(key)) continue;
      paths.push(...changedPaths(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return paths;
  }
  return [path || "document"];
};

const leafCategory = path => {
  const leaf = path.split(/[.\[\]]/).filter(Boolean).at(-1);
  if (leaf === "words" || leaf === "text") return "text";
  if (formattingKeys.has(leaf)) return "formatting";
  return "structure";
};

const conflictCategory = (ancestor, winner, branch) => {
  const paths = [
    ...changedPaths(ancestor, winner),
    ...changedPaths(ancestor, branch),
  ];
  const categories = [...new Set(paths.map(leafCategory))].sort();
  if (categories.length === 1 && categories[0] === "text") return "text-only";
  if (categories.length === 1 && categories[0] === "formatting") return "formatting-related";
  if (categories.includes("structure")) return "structural or mixed";
  if (categories.includes("text") && categories.includes("formatting")) return "mixed text and formatting";
  return "no content difference from common ancestor";
};

const classifyConflict = async (winner, competingRevision) => {
  let branch;
  try {
    branch = await getDocument(winner._id, { rev: competingRevision, revs: true });
  } catch {
    return {
      revision: competingRevision,
      category: "competing revision body unavailable",
      commonAncestor: null,
    };
  }

  const winnerHistory = fullRevisions(winner);
  const branchHistory = new Set(fullRevisions(branch));
  const commonAncestor = winnerHistory.find(revision => branchHistory.has(revision));
  if (!commonAncestor) {
    return { revision: competingRevision, category: "missing shared revision history", commonAncestor: null };
  }

  let ancestor;
  try {
    ancestor = await getDocument(winner._id, { rev: commonAncestor });
  } catch {
    return {
      revision: competingRevision,
      category: "shared revision history exists but ancestor body is unavailable",
      commonAncestor,
    };
  }

  return {
    revision: competingRevision,
    category: conflictCategory(ancestor, winner, branch),
    commonAncestor,
    winningChangedPaths: changedPaths(ancestor, winner),
    competingChangedPaths: changedPaths(ancestor, branch),
    competingUpdatedAt: branch.updatedAt ?? null,
    differentUpdatedBy: Boolean(branch.updatedBy && winner.updatedBy && branch.updatedBy !== winner.updatedBy),
  };
};

const contentIdsForRoot = async root => {
  const arrangements = new Set(root.arrangementIds ?? []);
  const ids = new Set([root._id]);
  for (const arrangementId of arrangements) {
    const arrangementIdValue = `song-v2:arrangement:${encodeURIComponent(root.songId)}:${encodeURIComponent(arrangementId)}`;
    ids.add(arrangementIdValue);
    try {
      const arrangement = await getDocument(arrangementIdValue, { conflicts: true, revs: true });
      for (const revision of arrangement._conflicts ?? []) {
        const branch = await getDocument(arrangementIdValue, { rev: revision, revs: true });
        for (const slideId of branch.slideIds ?? []) {
          ids.add(`song-v2:slide:${encodeURIComponent(root.songId)}:${encodeURIComponent(arrangementId)}:${encodeURIComponent(slideId)}`);
        }
      }
      for (const slideId of arrangement.slideIds ?? []) {
        ids.add(`song-v2:slide:${encodeURIComponent(root.songId)}:${encodeURIComponent(arrangementId)}:${encodeURIComponent(slideId)}`);
      }
    } catch {
      // Missing referenced documents remain visible in the final inventory.
    }
  }
  return [...ids];
};

try {
  const { data: rootRows } = await request.get("/_all_docs", {
    params: {
      include_docs: true,
      startkey: JSON.stringify(rootPrefix),
      endkey: JSON.stringify(`${rootPrefix}\ufff0`),
      limit: 20_000,
    },
  });
  const roots = rootRows.rows
    .map(row => row.doc)
    .filter(doc => doc?.docType === "song-v2-root" &&
      String(doc.name ?? "").localeCompare(requestedTitle, undefined, { sensitivity: "accent" }) === 0);

  const report = [];
  for (const baseRoot of roots) {
    const root = await getDocument(baseRoot._id, { conflicts: true, revs: true });
    const rootBranches = [root];
    for (const revision of root._conflicts ?? []) {
      rootBranches.push(await getDocument(root._id, { rev: revision, revs: true }));
    }

    const candidateIds = new Set([root._id]);
    for (const branch of rootBranches) {
      for (const id of await contentIdsForRoot(branch)) candidateIds.add(id);
    }

    const documents = [];
    for (const id of candidateIds) {
      let winner;
      try {
        winner = await getDocument(id, { conflicts: true, revs: true });
      } catch (error) {
        if (error?.response?.status === 404) continue;
        throw error;
      }
      const competing = winner._conflicts ?? [];
      if (!competing.length) continue;
      const revisions = [];
      for (const revision of competing) revisions.push(await classifyConflict(winner, revision));
      documents.push({
        documentId: winner._id,
        documentType: winner.docType ?? "unknown",
        winningRevision: winner._rev,
        competingRevisions: revisions,
      });
    }
    report.push({ songId: root.songId, title: root.name, documents });
  }

  process.stdout.write(`${JSON.stringify({ database: databaseName, requestedTitle, matches: report }, null, 2)}\n`);
} catch (error) {
  const status = error?.response?.status;
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : null;
  console.error(status
    ? `Song v2 conflict inspection failed with HTTP ${status}; credentials and response details were suppressed.`
    : `Song v2 conflict inspection failed${code ? ` (${code})` : ""}; credentials and response details were suppressed.`);
  process.exitCode = 1;
}
