// Run manually against an expendable loopback CouchDB, or use
// BENCH_LOCAL_FIXTURE=1 to serve a read-only local export over a CouchDB-style
// HTTP fixture into one disposable browser IndexedDB target.
// No application imports this file.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { build } from "esbuild";

const localFixtureMode = process.env.BENCH_LOCAL_FIXTURE === "1";
const origin = new URL(process.env.BENCH_COUCH_URL || "http://127.0.0.1:15984");
if (!localFixtureMode) {
  assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(origin.pathname, "/");
}
const password = process.env.BENCH_COUCH_PASSWORD || "";
if (!localFixtureMode) assert.ok(password, "Set BENCH_COUCH_PASSWORD for the disposable loopback server.");
const auth = "Basic " + Buffer.from(`benchmark:${password}`).toString("base64");
const database = "credits-benchmark-" + randomUUID();
let databaseUrl = new URL(database, origin).href;
const request = async (path, method = "GET", body) => {
  const response = await fetch(databaseUrl + path, {
    method, redirect: "error", headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `CouchDB ${method} failed (${response.status})`);
  return response.json();
};

// An optional local JSON array of open_revs=all&revs=true rows reproduces the exact tree.
// Otherwise use a deterministic synthetic fan-out with the reported leaf count and depth.
const hash = (value) => createHash("sha256").update(value).digest("hex");
function syntheticFixture() {
  return Array.from({ length: 175 }, (_, leaf) => {
    const ids = Array.from({ length: 1000 }, (_, depth) =>
      hash(`${depth < 750 ? leaf : "common"}/${depth}`).slice(0, 32));
    return { _id: "credits", _rev: "1000-" + ids[0], _revisions: { start: 1000, ids },
      docType: "credits", creditIds: ["one", "two", String(leaf)] };
  });
}
const fixtureDocs = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8")).map(row => row.ok ?? row)
  : syntheticFixture();
const ordinaryFixture = () => Array.from({ length: 150 }, (_, index) => {
  const ids = Array.from({ length: 5 }, (_, depth) => hash(`ordinary/${index}/${depth}`).slice(0, 32));
  return {
    _id: `ordinary-fixture-${index}`,
    _rev: `5-${ids[0]}`,
    _revisions: { start: 5, ids },
    docType: "song",
    title: `Ordinary fixture ${index}`,
  };
});
const workload = process.env.BENCH_WORKLOAD || "complex";
assert.ok(["complex", "ordinary", "mixed"].includes(workload), "BENCH_WORKLOAD must be complex, ordinary, or mixed.");
const writeLimits = (process.env.BENCH_WRITE_LIMITS || "0,1,2,4,8")
  .split(",")
  .map(value => Number(value.trim()));
assert.ok(writeLimits.length > 0 && writeLimits.every(value => Number.isSafeInteger(value) && value >= 0),
  "BENCH_WRITE_LIMITS must be a comma-separated list of nonnegative integers.");
const interruptWriteLimit = Number(process.env.BENCH_INTERRUPT_LIMIT || "4");
assert.ok(Number.isSafeInteger(interruptWriteLimit) && interruptWriteLimit > 0);
const docs = workload === "ordinary"
  ? ordinaryFixture()
  : workload === "mixed" ? [...fixtureDocs, ...ordinaryFixture()] : fixtureDocs;
const ids = [...new Set(docs.map(doc => doc._id))];
const id = workload === "ordinary" ? docs[0]._id : fixtureDocs[0]._id;
assert.ok(docs.length > 0 && docs.every(doc => doc._id && doc._revisions));
const docPath = "/" + encodeURIComponent(id);
const docsByIdRevision = new Map(docs.map(doc => [`${doc._id}::${doc._rev}`, doc]));
const chooseWinner = (revisions) => revisions.reduce((winner, doc) => {
  if (!winner) return doc;
  const generation = Number(doc._rev.split("-", 1)[0]);
  const winnerGeneration = Number(winner._rev.split("-", 1)[0]);
  if (Boolean(winner._deleted) !== Boolean(doc._deleted)) return winner._deleted ? doc : winner;
  if (generation !== winnerGeneration) return generation > winnerGeneration ? doc : winner;
  return doc._rev.slice(doc._rev.indexOf("-") + 1) > winner._rev.slice(winner._rev.indexOf("-") + 1) ? doc : winner;
}, null);
const revisionMetrics = docs.reduce((metrics, doc) => {
  metrics.leafRevisions += 1;
  metrics.maxHistoryDepth = Math.max(metrics.maxHistoryDepth, doc._revisions.ids.length);
  metrics.metadataComplexity += doc._revisions.ids.length;
  metrics.leavesPerDocument.set(doc._id, (metrics.leavesPerDocument.get(doc._id) ?? 0) + 1);
  return metrics;
}, { leafRevisions: 0, maxHistoryDepth: 0, metadataComplexity: 0, leavesPerDocument: new Map() });
const maxLeavesPerDocument = Math.max(...revisionMetrics.leavesPerDocument.values());

// Time the installed adapter's metadata codecs (including its stack-safe fallback).
// Only this in-memory benchmark bundle is instrumented.
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const clientDirectory = dirname(fileURLToPath(new URL("../../client/package.json", import.meta.url)));
const clientNodeModules = join(clientDirectory, "node_modules");
const entry = requireClient.resolve("pouchdb-browser/lib/index.js");
const resolveClientModules = {
  name: "resolve-client-modules",
  setup(build) {
    build.onLoad({ filter: /pouchdb-browser[\\/]lib[\\/]index\.js$/ }, () => ({
      contents: source,
      loader: "js",
      resolveDir: dirname(entry),
    }));
    build.onResolve({ filter: /.*/ }, args => {
      try {
        if (args.path.startsWith(".")) {
          return { path: resolve(args.resolveDir, args.path) };
        }
        if (args.path === "uuid") {
          return { path: join(clientNodeModules, "uuid", "dist", "esm-browser", "index.js") };
        }
        return { path: requireClient.resolve(args.path === "events" ? "events/" : args.path) };
      } catch {
        return null;
      }
    });
  },
};
let source = await readFile(entry, "utf8");
for (const codec of ["safeJsonParse", "safeJsonStringify"]) {
  const signature = "function " + codec + "(";
  assert.ok(source.includes(signature));
  source = source.replace(signature, `function ${codec}(value) {
    const start = performance.now();
    try { return original${codec}(value); }
    finally { window.measureCodec?.("${codec}", performance.now() - start); }
  }
  function original${codec}(`);
}
const bundle = (await build({ entryPoints: [entry], absWorkingDir: clientDirectory, bundle: true, write: false,
  platform: "browser", globalName: "PouchDB", define: {global: "globalThis"},
  plugins: [resolveClientModules] })).outputFiles[0].text;
const revisionEntry = fileURLToPath(new URL("../../client/src/utils/revisionReplication.ts", import.meta.url));
const revisionSource = await readFile(revisionEntry, "utf8");
const revisionBundle = (await build({ stdin: { contents: revisionSource, resolveDir: dirname(revisionEntry),
  sourcefile: "revisionReplication.ts", loader: "ts" }, bundle: true, write: false,
  platform: "browser", format: "iife", globalName: "RevisionReplication" })).outputFiles[0].text;

// Outside the measured interval, compare all leaf application bodies and ancestry with the fixture.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
async function measure(browser, label, writeLimit = 0, interruptOnce = false) {
  const context = await browser.newContext(localFixtureMode ? {} : { extraHTTPHeaders: { Authorization: auth } });
  if (!localFixtureMode) {
    await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin
      ? route.continue() : route.abort());
  } else {
    const checkpoints = new Map();
    const winner = chooseWinner(docs.filter(doc => doc._id === id));
    const changes = ids.map((documentId, index) => ({
      seq: index + 1,
      id: documentId,
      changes: docs.filter(doc => doc._id === documentId).map(doc => ({ rev: doc._rev })),
    }));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin.origin) return route.abort();
      if (url.pathname === "/") {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
      }
      const suffix = url.pathname.slice(url.pathname.indexOf(database) + database.length + 1);
      const method = route.request().method();
      const json = (body, status = 200) => route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
      if (!suffix || suffix === "/") {
        return json({ db_name: database, doc_count: ids.length, update_seq: ids.length, uuid: "local-fixture", compact_running: false });
      }
      if (suffix.startsWith("_changes")) {
        const since = Number(url.searchParams.get("since") || "0");
        const limit = Number(url.searchParams.get("limit") || String(changes.length));
        return json({
          results: changes.filter(change => change.seq > since).slice(0, limit),
          last_seq: ids.length,
          pending: 0,
        });
      }
      if (suffix === "_revs_diff" && method === "POST") {
        const requested = await route.request().postDataJSON();
        return json(Object.fromEntries(Object.entries(requested).map(([documentId, revs]) => [
          documentId,
          { missing: revs },
        ])));
      }
      if (suffix.startsWith("_bulk_get") && method === "POST") {
        const requested = await route.request().postDataJSON();
        return json({ results: requested.docs.map(request => ({
          id: request.id,
          docs: [{ ok: docsByIdRevision.get(`${request.id}::${request.rev}`) }],
        })) });
      }
      if (suffix.startsWith("_local/")) {
        const localId = decodeURIComponent(suffix.slice("_local/".length));
        if (method === "GET") {
          return checkpoints.has(localId)
            ? json(checkpoints.get(localId))
            : json({ error: "not_found", reason: "missing" }, 404);
        }
        if (method === "PUT") {
          const body = await route.request().postDataJSON();
          const stored = { ...body, _rev: `0-${checkpoints.size + 1}` };
          checkpoints.set(localId, stored);
          return json({ ok: true, id: body._id, rev: stored._rev }, 201);
        }
      }
      if (method === "GET") {
        const documentId = decodeURIComponent(suffix.split("?", 1)[0]);
        const sourceBody = documentId === id
          ? winner
          : docs.find(doc => doc._id === documentId);
        if (!sourceBody) return json({ error: "not_found", reason: "missing" }, 404);
        const body = { ...sourceBody };
        delete body._revisions;
        return json(body);
      }
      return json({ error: "not_found", reason: "unsupported local fixture request" }, 404);
    });
  }
  try {
    const page = await context.newPage();
    await page.goto(origin.href);
    await page.addScriptTag({ content: bundle });
    await page.addScriptTag({ content: revisionBundle });
    const result = await page.evaluate(async ({ databaseUrl, writeLimit, interruptOnce, id, ids }) => {
      const target = new PouchDB("fresh");
      const remote = new PouchDB(databaseUrl);
      const options = { batch_size: 150, batches_limit: 15, selector: { _id: { $ne: "media" } } };
      const pull = () => remote.replicate.to(target, options);
      let failNext = interruptOnce;
      const metrics = { peakMiB: 0, safeJsonParse: 0, safeJsonStringify: 0, writeTransactions: 0,
        maxWriteTransactionSize: 0, boundedTransactions: 0, boundedRevisionWrites: 0 };
      const bulkDocs = target.bulkDocs.bind(target);
      target.bulkDocs = async (...args) => {
        const rows = await bulkDocs(...args);
        metrics.writeTransactions += 1;
        const request = args[0];
        const documents = Array.isArray(request) ? request : request?.docs;
        metrics.maxWriteTransactionSize = Math.max(metrics.maxWriteTransactionSize,
          Array.isArray(documents) ? documents.length : 0);
        if (failNext) { failNext = false; throw Error("injected after first committed chunk"); }
        return rows;
      };
      const boundedWriter = writeLimit
        ? RevisionReplication.installBoundedRevisionWrites(target, {
          writeLimit,
          onTransaction: (_token, transaction) => {
            if (!transaction.bounded) return;
            metrics.boundedTransactions += 1;
            metrics.boundedRevisionWrites += transaction.documentCount;
          },
        })
        : null;
      const sample = () => {
        metrics.peakMiB = Math.max(metrics.peakMiB, performance.memory.usedJSHeapSize / 1048576);
      };
      window.measureCodec = (name, ms) => { metrics[name] += ms; sample(); };
      sample();
      const timer = setInterval(sample, 25);
      const start = performance.now();
      if (interruptOnce) {
        let failed = false;
        try { await pull(); } catch (err) {
          if (!String(err).includes("injected after first committed chunk")) throw err;
          failed = true;
        }
        if (!failed) throw Error("interruption did not occur");
      }
      const run = await pull();
      const durationMs = performance.now() - start;
      sample();
      clearInterval(timer);
      delete window.measureCodec;
      const warmStart = performance.now();
      const warm = await pull();
      const warmMs = performance.now() - warmStart;
      boundedWriter?.restore();
      const winner = await target.get(id);
      const winners = await Promise.all(ids.map(async docId => [docId, await target.get(docId)]));
      const sourceWinners = await Promise.all(ids.map(async docId => [docId, await remote.get(docId)]));
      const sourceInfo = await remote.info();
      const open = indexedDB.open("_pouch_fresh");
      const readResult = req => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const raw = await readResult(open);
      const tx = raw.transaction(["document-store", "by-sequence"]);
      const [documentMetadata, records] = await Promise.all([
        readResult(tx.objectStore("document-store").getAll()), readResult(tx.objectStore("by-sequence").getAll()),
      ]);
      const trees = new Map(documentMetadata.map(row => [row.id, JSON.parse(row.data).rev_tree]));
      const treeBytes = [...trees.values()].reduce((bytes, tree) => bytes + new Blob([JSON.stringify(tree)]).size, 0);
      const stack = [...trees.entries()].flatMap(([docId, tree]) => tree.map(root => ({ docId, node: root.ids, pos: root.pos, parent: null })));
      const paths = {};
      let nodes = 0;
      while (stack.length) {
        const current = stack.pop();
        nodes++;
        const [rev, , children] = current.node;
        if (children.length === 0) {
          const ids = [];
          for (let item = current; item && ids.length < 1000; item = item.parent) ids.push(item.node[0]);
          paths[`${current.docId}::${current.pos}-${rev}`] = { start: current.pos, ids };
        }
        children.forEach(node => stack.push({ docId: current.docId, node, pos: current.pos + 1, parent: current }));
      }
      raw.close();
      const leaves = records.map(({ _doc_id_rev, ...body }) => {
        const separator = _doc_id_rev.lastIndexOf("::");
        const docId = _doc_id_rev.slice(0, separator);
        const rev = _doc_id_rev.slice(separator + 2);
        return { ...body, _id: docId, _rev: rev, _revisions: paths[_doc_id_rev] };
      });
      return { ...metrics, durationMs, warmMs, nodes, treeBytes, winner, winners, sourceWinners, leaves,
        docsWritten: run.docs_written, failures: run.doc_write_failures, warmWrites: warm.docs_written,
        lastSeq: run.last_seq, warmSeq: warm.last_seq, sourceSeq: sourceInfo.update_seq, adapter: target.type() };
    }, { databaseUrl, writeLimit, interruptOnce, id, ids });
    const expected = localFixtureMode ? docs : (await request(docPath + "?open_revs=all&revs=true")).map(row => row.ok);
    const sorted = values => values.map(canonical).sort((a, b) => `${a._id}::${a._rev}`.localeCompare(`${b._id}::${b._rev}`));
    if (!isDeepStrictEqual(sorted(result.leaves), sorted(expected))) {
      throw new Error("Replicated leaf bodies or revision histories differ from the saved fixture.");
    }
    if (localFixtureMode) {
      if (!isDeepStrictEqual(result.winners, result.sourceWinners)) {
        throw new Error("Replicated winning revisions differ from the saved fixture winner selection.");
      }
    } else if (!isDeepStrictEqual(result.winner, await request(docPath))) {
      throw new Error("Replicated winning revision differs from the CouchDB source.");
    }
    assert.equal(result.adapter, "idb");
    assert.equal(result.failures, 0);
    assert.equal(result.warmWrites, 0);
    assert.deepEqual(result.lastSeq, result.warmSeq);
    assert.deepEqual(result.lastSeq, result.sourceSeq);
    const { leaves, winner, winners, sourceWinners, lastSeq, warmSeq, sourceSeq, ...stats } = result;
    console.log(JSON.stringify({ label, workload, ...stats, leaves: leaves.length,
      tombstones: leaves.filter(doc => doc._deleted).length, allBodiesAndPathsVerified: true }));
    return stats;
  } finally { await context.close(); }
}

async function seed() {
  if (localFixtureMode) return;
  for (let i = 0; i < docs.length; i += 10) {
    const rows = await request("/_bulk_docs", "POST", { new_edits: false, docs: docs.slice(i, i + 10) });
    assert.ok(!rows.some(row => row.error));
  }
}

let browser;
try {
  if (!localFixtureMode) await request("", "PUT");
  console.log(JSON.stringify({ fixture: process.argv[2] ? "local-export" : "synthetic", workload, sourceLeaves: docs.length,
    uniqueDocuments: ids.length, totalLeafRevisions: revisionMetrics.leafRevisions, maxLeavesPerDocument,
    maxRevisionHistoryDepth: revisionMetrics.maxHistoryDepth, estimatedMetadataComplexity: revisionMetrics.metadataComplexity,
    sourceConnected: !localFixtureMode }));
  await seed();
  browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
  console.log("Chromium", browser.version());
  if (localFixtureMode) {
    for (const writeLimit of writeLimits) {
      if (browser) {
        await browser.close();
        browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
      }
      await measure(browser, writeLimit ? `selective-write-limit-${writeLimit}` : "unmodified", writeLimit);
    }
    if (workload !== "ordinary") {
      if (browser) {
        await browser.close();
        browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
      }
      await measure(browser, `interrupted-resume-write-limit-${interruptWriteLimit}`, interruptWriteLimit, true);
    }
  } else {
    const baseline = await measure(browser, "unresolved");
    const { _conflicts, ...winner } = await request(docPath + "?conflicts=true");
    assert.equal(_conflicts.length + 1, docs.length);
    const writes = await request("/_bulk_docs", "POST", {
      docs: _conflicts.map(_rev => ({ _id: id, _rev, _deleted: true })),
    });
    assert.ok(writes.every(row => row.ok) && writes.length === _conflicts.length);
    assert.deepEqual(await request(docPath + "?conflicts=true"), winner);
    const resolved = await measure(browser, "resolved");
    if (resolved.peakMiB > baseline.peakMiB * 0.5) {
      await measure(browser, "resolved-write-limit-8", 8);
      const resolvedUrl = databaseUrl;
      databaseUrl = new URL("credits-benchmark-" + randomUUID(), origin).href;
      try {
        await request("", "PUT");
        try {
          await seed();
          await measure(browser, "unresolved-write-limit-8", 8);
          await measure(browser, "unresolved-interrupt-resume-8", 8, true);
        } finally { await request("", "DELETE"); }
      } finally { databaseUrl = resolvedUrl; }
    }
  }
} finally {
  try { await browser?.close(); } finally { if (!localFixtureMode) await request("", "DELETE"); }
}
