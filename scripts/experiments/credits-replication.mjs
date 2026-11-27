// Run manually against an expendable loopback CouchDB. No application imports this file.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { build } from "esbuild";

const origin = new URL(process.env.BENCH_COUCH_URL || "http://127.0.0.1:15984");
assert.equal(origin.hostname, "127.0.0.1");
assert.equal(origin.pathname, "/");
const password = process.env.BENCH_COUCH_PASSWORD;
assert.ok(password, "Set BENCH_COUCH_PASSWORD for the disposable loopback server.");
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
const docs = process.argv[2]
  ? JSON.parse(await readFile(process.argv[2], "utf8")).map(row => row.ok ?? row)
  : syntheticFixture();
const id = docs[0]._id;
assert.ok(docs.every(doc => doc._id === id && doc._revisions && !doc._deleted));
const docPath = "/" + encodeURIComponent(id);

// Time the installed adapter's metadata codecs (including its stack-safe fallback).
// Only this in-memory benchmark bundle is instrumented.
const requireClient = createRequire(new URL("../../client/package.json", import.meta.url));
const entry = requireClient.resolve("pouchdb-browser/lib/index.js");
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
const bundle = (await build({ stdin: { contents: source, resolveDir: dirname(entry) },
  bundle: true, write: false, platform: "browser", globalName: "PouchDB", define: {global: "globalThis"} })).outputFiles[0].text;

// Outside the measured interval, compare all leaf application bodies and ancestry with CouchDB.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
async function measure(browser, label, writeLimit = 0, interruptOnce = false) {
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: auth } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin.origin
    ? route.continue() : route.abort());
  try {
    const page = await context.newPage();
    await page.goto(origin.href);
    await page.addScriptTag({ content: bundle });
    const result = await page.evaluate(async ({ databaseUrl, writeLimit, interruptOnce, id }) => {
      const target = new PouchDB("fresh");
      const remote = new PouchDB(databaseUrl);
      const options = { batch_size: 150, batches_limit: 15, selector: { _id: { $ne: "media" } } };
      const pull = () => remote.replicate.to(target, options);
      let failNext = interruptOnce;
      if (writeLimit) {
        const bulkDocs = target.bulkDocs.bind(target);
        target.bulkDocs = async (batch, opts) => {
          if (batch.new_edits !== false || batch.docs.length <= writeLimit) return bulkDocs(batch, opts);
          const results = [];
          for (let i = 0; i < batch.docs.length; i += writeLimit) {
            const rows = await bulkDocs({ ...batch, docs: batch.docs.slice(i, i + writeLimit) }, opts);
            results.push(...rows);
            if (rows.some(row => row.error)) throw Error("chunk contained a failed revision");
            if (failNext) { failNext = false; throw Error("injected after first committed chunk"); }
          }
          return results;
        };
      }
      const metrics = { peakMiB: 0, safeJsonParse: 0, safeJsonStringify: 0 };
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
      const winner = await target.get(id);
      const open = indexedDB.open("_pouch_fresh");
      const readResult = req => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const raw = await readResult(open);
      const tx = raw.transaction(["document-store", "by-sequence"]);
      const [metadata, records] = await Promise.all([
        readResult(tx.objectStore("document-store").get(id)), readResult(tx.objectStore("by-sequence").getAll()),
      ]);
      const tree = JSON.parse(metadata.data).rev_tree;
      const treeBytes = new Blob([JSON.stringify(tree)]).size;
      const stack = tree.map(root => ({ node: root.ids, pos: root.pos, parent: null }));
      const paths = {};
      let nodes = 0;
      while (stack.length) {
        const current = stack.pop();
        nodes++;
        const [rev, , children] = current.node;
        if (children.length === 0) {
          const ids = [];
          for (let item = current; item && ids.length < 1000; item = item.parent) ids.push(item.node[0]);
          paths[current.pos + "-" + rev] = { start: current.pos, ids };
        }
        children.forEach(node => stack.push({ node, pos: current.pos + 1, parent: current }));
      }
      raw.close();
      const leaves = records.map(({ _doc_id_rev, ...body }) => {
        const rev = _doc_id_rev.slice(id.length + 2);
        return { ...body, _id: id, _rev: rev, _revisions: paths[rev] };
      });
      return { ...metrics, durationMs, warmMs, nodes, treeBytes, winner, leaves,
        docsWritten: run.docs_written, failures: run.doc_write_failures, warmWrites: warm.docs_written,
        lastSeq: run.last_seq, warmSeq: warm.last_seq, adapter: target.type() };
    }, { databaseUrl, writeLimit, interruptOnce, id });
    const expected = (await request(docPath + "?open_revs=all&revs=true")).map(row => row.ok);
    const sorted = values => values.map(canonical).sort((a, b) => a._rev.localeCompare(b._rev));
    assert.deepEqual(sorted(result.leaves), sorted(expected));
    assert.deepEqual(result.winner, await request(docPath));
    assert.equal(result.adapter, "idb");
    assert.equal(result.failures, 0);
    assert.equal(result.warmWrites, 0);
    assert.deepEqual(result.lastSeq, result.warmSeq);
    assert.deepEqual(result.lastSeq, (await request("")).update_seq);
    const { leaves, winner, lastSeq, warmSeq, ...stats } = result;
    console.log(JSON.stringify({ label, ...stats, leaves: leaves.length,
      tombstones: leaves.filter(doc => doc._deleted).length, allBodiesAndPathsVerified: true }));
    return stats;
  } finally { await context.close(); }
}

async function seed() {
  for (let i = 0; i < docs.length; i += 10) {
    const rows = await request("/_bulk_docs", "POST", { new_edits: false, docs: docs.slice(i, i + 10) });
    assert.ok(!rows.some(row => row.error));
  }
}

// Only destroy a database successfully created by this invocation.
await request("", "PUT");
let browser;
try {
  console.log(JSON.stringify({ fixture: process.argv[2] ? "local-export" : "synthetic", sourceLeaves: docs.length }));
  await seed();
  browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
  console.log("Chromium", browser.version());
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
} finally {
  try { await browser?.close(); } finally { await request("", "DELETE"); }
}
