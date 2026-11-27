# PouchDB startup memory investigation

> Status note, November 27, 2026. Selective bounded writes for expensive content initial-pull revision groups and batch-level diagnostics are now implemented. Exact credits fixture replays passed correctness checks; four-revision runs sampled 314–425 MiB, including interrupted/resumed runs. The implementation keeps the original feed batch settings. Full desktop startup and low-end Android staging acceptance remain outstanding; results and instructions are in [credits replication benchmark](credits-replication-benchmark.md).

**Scope:** investigation and implementation on branch `in-progress`. PouchDB and replication option values are unchanged. The content initial-pull target writer now selectively bounds complex revision groups. Startup diagnostics are opt-in and default to off; the revision inspector is read-only.

## Findings so far

### Confirmed implementation and hot path

- `client/package-lock.json` resolves `pouchdb-browser` to **9.0.0**. The client opens the local database through PouchDB's **IndexedDB** adapter (`api.type()` returns `idb`) and pulls from an HTTP(S) PouchDB remote with `remoteDb.replicate.to(localDb, ...)`.
- The profiled functions map to `safeJsonStringify` at `client/node_modules/pouchdb-browser/lib/index.js:4709` and `safeJsonParse` at `:4697`. `encodeMetadata` (`:4735`) writes the PouchDB metadata object, including the revision tree and winning revision, to `document-store`; `decodeMetadata` (`:4745`) reads it back. This confirms the CPU hotspot is metadata serialization/parsing. It does **not** prove that these strings alone account for the heap peak.
- The remote pull requests `_changes` pages with `limit: batch_size` (`:10127`, `:10189`). In this installed version, `batch_size` counts **changes-feed rows**. Each row can contain several leaf revisions. `batches_limit` gates `batches.length` (`:10131`), which is the queued-batch array; it is not a strict cap on all pending rows, active batches, document bodies, or bytes. A single feed row in the inspected database expands to 175 revision bodies. The API prose describes the product as a maximum number of in-memory docs ([PouchDB replication options](https://pouchdb.com/api.html)); the installed 9.0.0 implementation and this database's multi-leaf rows show why that product is not a strict body or memory limit here.
- Remote revision retrieval is `getDocs` (`:9304`), using `_bulk_get`; the replication path calls `getDiffs`, `getBatchDocs`, `writeDocs`, and `finishBatch` (`:9793`, `:9843`, `:9892`, `:9916`). The local checkpoint is emitted only after `target.bulkDocs` succeeds (`:9843-9914`).
- IndexedDB writes enter `idbBulkDocs` (`:4931`). `processDocs` groups revisions by ID and applies same-ID revisions sequentially (`:4578`); each `updateDoc` merges the incoming tree (`:4508`). `merge` calls `stem` (`:1316`), which flattens and rebuilds paths; the source comments that the extra stemming map work is memory-heavy when revisions are actually removed. The default local revision limit is 1,000 (`:4582`).
- `fetchExistingDocs` (`:5027`) issues a metadata lookup for each incoming document record. With multiple incoming leaves for one ID, repeated lookups and sequential tree merges are concrete work to measure. On a genuinely empty local database, those lookups need not decode existing metadata, so repeated decoding is not established as the cause of a fresh-profile spike.
- The local IndexedDB changes-feed implementation is at `:6245`. In the normal app, the item-cache subscriber starts with `allDocs({ include_docs: true, update_seq: true })` and then follows a local changes feed. Replication-only mode skips that whole subscriber and cache hydration. It also suppresses unrelated app managers, the Bible database, post-pull cache draining, cleanup scheduling, and live sync, while preserving sign-in, database permissions, the complete content pull, and PouchDB checkpoints.
- No automatic compaction or tombstone cleanup was found in this initial-pull path. The diagnostic mode does not call compaction or cleanup.

### Read-only Eliathah scan

The inspector was run against the configured remote database using `COUCHDB_HOST`, `COUCHDB_USER`, and `COUCHDB_PASSWORD` from the repository's `.env`. It used page size 100, `_bulk_get` chunks of 100 and concurrency 2. It only read database/feed metadata and revision bodies for byte measurement; the script's only POST endpoint is `_bulk_get`. It emitted no bodies or exact document IDs.

Observed in that scan:

- CouchDB reported 4,186 documents including the excluded `media` document. After excluding `media`, there were 4,185 active IDs, 2,266 deleted IDs, and 6,451 unique IDs.
- `_changes?style=all_docs` returned 6,452 feed rows for those 6,451 IDs. It exposed 8,630 current leaf revisions, and all 8,630 requested leaf bodies were returned. This matches the supplied revision totals and shows that feed rows, unique IDs, and leaf revisions are different counts.
- To include the reported stall counts at 8,273 to 8,281 of 8,630 revisions, the corrected inspector was run with a 400-identity tail. It spanned zero-based feed rows 6257-6451 in that scan. Sequence values are opaque CouchDB tokens; do not divide or compare them as revision counts. Feed row positions and order can shift between scans, so use them only with that scan's `lastSequence` and the app's actual batch snapshot.
- The strongest data-shape candidate was one `credits` document (privacy-safe ID hash `c8155a941506177b`) with **175 current leaf revisions in one feed row** (row 6274 in the 400-window scan). Its leaf bodies totalled about 5.29 MB, its largest leaf body was about 35.9 KB, and its revision-history metadata reached 35,022 bytes per leaf at the 1,000-entry history cap. It can expand one `batch_size` row into 175 bodies and repeatedly merge a deep same-document tree.
- Another tail document of type `itemListDetails` had 17 leaves (about 615 KB total); a song and preferences document also had multiple leaves. An untyped document had 62 leaves (about 2.05 MB total), earlier in the feed.
- The largest single returned revision body was an `allItems` revision at about 491 KB; the next largest was a song revision at about 453 KB. The `allItems` document had 18 leaves and about 4.82 MB across them. These are notable data points, but no single body is remotely close to 1 GB.
- The report's largest attachment and embedded-media totals were both zero; attachments and embedded media are not leading outliers in this scan.

The large conflict cluster and deep histories are **confirmed inputs**, not a confirmed explanation for the browser heap peak. About 5 MB of serialized history alone cannot explain a >1 GB heap. Repeated tree work, queued batch bodies, and adapter temporary objects could amplify it. The isolated synthetic benchmark is reported separately; it does not replace a fresh-profile run using the saved church fixture on the target Android device.

### Ranked explanations

1. **High-leaf, deep revision trees in a single document (strongest candidate; not causal proof).** The 175-leaf `credits` row is inside the final feed region and each leaf carries up to 1,000 history entries. PouchDB merges same-ID leaves sequentially. A batch row can therefore produce far more bodies and tree work than the row count suggests.
2. **Repeated revision-tree serialization and local merge work (confirmed hot functions; amplification unmeasured).** The profiled JSON functions encode/decode metadata; the `bulkDocs` path merges each same-ID leaf and encodes metadata for storage. The isolated benchmark measures metadata codec time and tree size, but it does not identify a peak operation in the full app.
3. **Large ordinary bodies (real but insufficient alone).** The biggest observed leaf bodies were roughly 0.49 MB and 0.45 MB. Many song revisions together could make a queued batch substantial, but the inspector does not prove they were live together at the stall.
4. **Application cache and other consumers (still open).** Prior cache diagnostics showed about 1.77 seconds total cache work. The opt-in `replication-only` mode can isolate the initial content pull, but no fresh-profile comparison on the saved church fixture has been completed.
5. **Adapter-wide response retention or attachment processing (still open).** The scan did not show a single huge body. A targeted Chrome Performance trace may help identify response retention or attachment work. The new snapshot records batch-level remote response, IndexedDB write, processing, and sampled-heap timings; it does not instrument every PouchDB operation or serialize payload sizes. No PouchDB fork or dependency change is justified by the available evidence.

### Upstream version check

The installed browser package is 9.0.0, and the official PouchDB releases page currently labels 9.0.0 as latest. That release already highlights IndexedDB stability and performance improvements. No newer compatible upstream fix was identified, so the dependency remains unchanged: [Apache PouchDB releases](https://github.com/apache/pouchdb/releases).

## Read-only inspector

From the repository root in PowerShell:

```powershell
node --env-file=.env scripts/inspect-couchdb-revisions.mjs `
  --database Eliathah `
  --page-size 100 `
  --bulk-get-size 100 `
  --concurrency 2 `
  --tail-revisions 400 `
  --top 15
```

By default, document IDs are SHA-256 prefixes. The report contains aggregate types, active/deleted leaf counts, body and revision-history sizes, attachment/embedded-media estimates, and the tail identity window. It does not include document bodies. Add `--include-document-ids` only when exact IDs are needed for local correlation; keep that output local because IDs may contain church content. To save the hashed report outside the repository, append `> "$env:TEMP\worshipsync-pouchdb-report.json"`.

The script pages the full feed and measures current leaf bodies, with request chunks and concurrency capped by argument validation. It can take longer for a larger database. It does not call `_purge`, `_compact`, `_bulk_docs`, `put`, or `delete`.

## Fresh-profile startup diagnostics

Use a new browser profile with an empty IndexedDB for a fresh-sync measurement against staging. Do not reset a profile containing local edits or pending changes. For a full startup measurement, set the diagnostic mode in that tab's DevTools Console and reload:

```js
sessionStorage.setItem("worshipsync.startup-diagnostics.mode", "normal");
location.reload();
```

Diagnostics are opt-in and scoped to that browser tab. Production Sentry reporting of significant replication batches works independently of detailed mode. The supported snapshot is available at `window.__worshipSyncStartupDiagnostics.snapshot()`. To export it in Chrome or Edge DevTools, run:

```js
copy(JSON.stringify(window.__worshipSyncStartupDiagnostics.snapshot(), null, 2));
```

The snapshot includes expensive replication batches, likely document contributors, bounded-write statistics, processing and write timings, five-second heap samples, long-task totals, and recovered suspected interruptions. Contributor document IDs appear only in this local detailed snapshot; keep the exported file private. Heap sampling can miss brief peaks, and `performance.memory` is browser-specific. If unsupported, heap fields are `null` and the remaining workload timings are still collected.

Use `replication-only` in a separate fresh profile to isolate the complete content pull from the Bible database, item cache, and live sync:

```js
sessionStorage.setItem("worshipsync.startup-diagnostics.mode", "replication-only");
location.reload();
```

If startup is interrupted, reload the same profile and church, then inspect `recoveredInterruptedReplicationBatches` in the snapshot. A pending record becomes `suspected-interruption` after five minutes without a live two-minute session lease; the page rechecks automatically. It is a suspected interruption, not proof of a browser crash. Switching accounts or churches cancels this tab's unfinished entries and clears the old scope's history when no other tab is active; another active tab's history is preserved.

The initial content pull continues to use `batch_size: 150` and `batches_limit: 15`, and Bible uses `1000` and `25`. These settings do not change with diagnostic mode. Existing live-sync settings are unchanged. To return the test tab to normal startup, set the key to `off` (or remove it) and reload:

```js
sessionStorage.setItem("worshipsync.startup-diagnostics.mode", "off");
location.reload();
```

Compare runs only when the browser/build, dataset, and profile conditions match. Development builds, DevTools recording, and heap sampling affect timing and memory. The exact saved-fixture benchmark and its limitations are in [credits replication benchmark](credits-replication-benchmark.md). Keep the fixture local and run fresh desktop and Android validation through staging; never run a PouchDB replication benchmark against production because it can write checkpoints.

## Changes and verification

- Startup diagnostics are opt-in, session-scoped, and default to `off`. Expensive-batch summaries are stored only for candidate batches; local history is capped at 15 entries, 16 KiB, and 14 days.
- The production initial-pull settings remain content `150 by 15` and Bible `1000 by 25`; live-sync settings are unchanged.
- `scripts/inspect-couchdb-revisions.mjs` hashes document IDs by default and uses read-only GET plus `_bulk_get` requests.
- Complex content initial-pull revision groups use four-revision sequential writes when there are at least 8 incoming leaves and their estimated history complexity is at least 8,000. Ordinary documents retain bulk writes. Winning revisions, losing revisions, tombstones, attachments and revision histories are preserved.
- No automatic conflict cleanup, tombstone purge, or history-limit change was made. The selected strategy passed the isolated exact-fixture correctness and resume checks; full desktop and low-end Android staging validation are still required.

Focused tests, type checks, lint, and build results are recorded in the implementation handoff. They do not replace the required low-end Android fresh-sync verification.
