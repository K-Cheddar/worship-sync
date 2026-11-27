# Credits revision replication benchmark

**Date:** November 27, 2026  
**Runtime:** Chromium 156, PouchDB 9.0.0, fresh IndexedDB targets, local HTTP fixture handler

## Exact fixture and safety

One authenticated GET retrieved the authorized `open_revs=all&revs=true` response for the credits document. The fixture is saved outside the repository at `%LOCALAPPDATA%\Temp\worshipsync-credits-eliathah-open-revs.json`. The production connection was closed immediately afterward. The benchmark used only that local file, fresh disposable browser IndexedDB databases, and a request-intercepted local CouchDB-style endpoint. It made no production replication or checkpoint request and did not write to the source document.

The fixture contains 175 live leaf revisions, no deleted leaves, and revision histories up to 1,000 generations. The saved response is 5,291,607 bytes. Exact document IDs and bodies are kept out of this document and the repository.

Each run checked all 175 stored leaf bodies, revision IDs and full revision paths, the winning revision, and the post-run sequence. A warm pull wrote zero documents and did not advance the sequence. The harness bundles the production `revisionReplication.ts` writer and measures sampled `performance.memory.usedJSHeapSize`, whole pull duration, PouchDB metadata JSON serialization, and target bulk-write transaction counts. Each local fixture strategy uses a fresh Chromium process. Heap sampling ran every 25 ms; it can miss brief peaks.

## Exact fixture results

| Strategy | Peak sampled heap | Initial pull | Local bulk-write transactions | Metadata JSON serialization | Correctness |
| --- | ---: | ---: | ---: | ---: | --- |
| Unmodified (`limit 0`) | 1,164.7 MiB | 34.23 s | 1 | 20.50 s | Pass |
| Bounded at 1 revision | 397.0 MiB | 36.12 s | 175 | 19.06 s | Pass |
| Bounded at 2 revisions | 396.9 MiB | 36.54 s | 88 | 19.93 s | Pass |
| Bounded at 4 revisions | 314.2 MiB | 37.04 s | 44 | 20.63 s | Pass |
| Bounded at 8 revisions | 394.4 MiB | 36.59 s | 22 | 20.47 s | Pass |
| Bounded at 4, interrupted then resumed | 320.1 MiB | 36.42 s | 44 | 20.21 s | Pass; all 175 leaves verified after resume |

The earlier standalone investigation reported a 23.293-second pull and 11.367 seconds in metadata serialization. This integrated harness measured 34.23 seconds and 20.50 seconds for its unmodified baseline. Treat the rows above as the comparable before/after set; the earlier timing came from a separate run and harness context.

The 4-revision limit was selected as a balance: it had the lowest peak in this isolated matrix and used half as many IndexedDB transactions as limit 2. The 1-, 2-, and 8-revision runs also fell below 400 MiB in this matrix, though repeated same-code limit-4 runs, including interruption, ranged up to 425 MiB. The measured pull took 1.9 to 2.8 seconds longer with bounded writes than the unmodified run; serialized metadata time was similar. These measurements vary between runs and are not a memory guarantee for all machines or complete application startup.

## Ordinary and mixed workloads

The ordinary fixture contained 150 unique documents with five-revision histories. The unmodified run measured 5.48 MiB, 39.1 ms, and one write transaction. The limit-4 run measured 5.80 MiB, 34.1 ms, and one write transaction. The difference is within the noise of this short run; the ordinary documents were not split.

The mixed workload combined the exact conflict group and 150 ordinary documents. Unmodified measured 1,659.8 MiB, 31.16 seconds, and two write transactions. Limit 4 measured 439.1 MiB, 37.39 seconds, and 46 transactions (44 bounded writes plus two ordinary writes). An interrupted/resumed limit-4 run measured 489.1 MiB. All 325 leaves and ordinary documents passed verification, and the warm pull wrote nothing. The mixed result is close to the upper end of the 400 to 500 MiB target; full application startup may consume additional memory.

Ordinary batches still require a metadata-only pass to estimate revision complexity. This pass inspects IDs, revision IDs, document type and `_revisions.ids.length`; it does not stringify or walk document bodies, attachments, or trees. In the ordinary fixture, total duration did not increase and no additional transaction was issued. The measured codec serialization time was 1.3 ms unmodified and 0.6 ms with the selective writer, within the noise of a short run. The metadata-only scan and production diagnostics overhead were not independently timed; the scan is linear in the incoming batch size, while ordinary batches are not written to local diagnostic history or sent to Sentry. The production five-second heap sampler reuses the existing startup sampler.

## Selected processing policy

Only content initial pulls use the new processor. Existing content `batch_size: 150`, `batches_limit: 15`, Bible `1000 x 25`, and live-sync settings remain unchanged.

A revision group is bounded when it has at least 8 distinct incoming leaf revisions **and** the sum of their revision-history depths is at least 8,000. The history estimate is the sum of incoming `_revisions.ids.length` values (or `_rev` generations when ancestry metadata is unavailable); it is a workload heuristic, not a count of unique tree nodes. Bounded groups are written sequentially in chunks of four. Other documents remain in the original bulk write. Winning-revision selection, tombstones, attachments, losing leaves and history are passed through unchanged. A retryable write failure or cancellation rejects the bulk write so PouchDB cannot checkpoint while writes are incomplete. Permission-denied rows are returned to PouchDB after all chunks finish, preserving its existing denied-event handling.

`client/src/utils/revisionReplication.test.ts` covers ordinary fast-path behavior, threshold selection, PouchDB's `new_edits: false` result semantics, tombstones, attachments, failed writes, denied rows and cancellation. The interrupted/resumed fixture run verifies all 175 leaves and confirms a zero-write warm pull.

## Diagnostic example

Production Sentry events use generic messages and sanitized numeric or categorical batch context. IDs and document bodies are excluded. Church and device identifiers are SHA-256 hashed before inclusion; the existing app initializes Sentry with `sendDefaultPii: true`, so no user or URL is added by this reporting code.

```json
{
  "message": "WorshipSync detected an expensive initial content replication batch",
  "level": "warning",
  "runtime": {
    "applicationVersion": "2.41.2",
    "browser": "<browser user agent>",
    "platform": "<platform>",
    "availableDeviceMemoryGiB": 4,
    "churchIdentifierHash": "<sha256 prefix>",
    "deviceIdentifierHash": "<sha256 prefix>"
  },
  "replication_batch": {
    "databaseCategory": "content",
    "replicationKind": "initial-pull",
    "pendingChangeRows": 8,
    "uniqueDocumentCount": 1,
    "totalIncomingLeafRevisions": 175,
    "maxLeafCountPerDocument": 175,
    "maxRevisionHistoryDepth": 1000,
    "estimatedMetadataComplexity": 146986,
    "boundedWriteProcessingActivated": true,
    "writeTransactionCount": 44,
    "boundedWriteTransactionCount": 44,
    "maxWriteTransactionSize": 4,
    "highestSampledHeapMb": 314.2,
    "outcome": "writes-complete"
  }
}
```

Actual failures use an error-level message; performance and suspected-interruption events use warning level. Per scope and issue, events have a 15-minute cooldown and the module limits reporting to five events per session. Routine batches produce no Sentry event. The snapshot's `likelyContributors` list contains document IDs and is available only in explicitly enabled local diagnostics; it is not persisted or sent to Sentry.

An explicitly enabled local snapshot includes the detail needed to correlate a complex workload. The document ID below is a placeholder; the real value stays in the local tab's memory:

```json
{
  "expensiveReplicationBatches": [{
    "databaseCategory": "content",
    "replicationKind": "initial-pull",
    "batchNumber": 7,
    "uniqueDocumentCount": 1,
    "totalIncomingLeafRevisions": 175,
    "maxLeafCountPerDocument": 175,
    "maxRevisionHistoryDepth": 1000,
    "estimatedMetadataComplexity": 146986,
    "likelyContributors": [{
      "documentId": "<local-only document ID>",
      "documentType": "credits",
      "incomingLeafRevisionCount": 175,
      "maxRevisionHistoryDepth": 1000,
      "estimatedMetadataComplexity": 146986
    }],
    "boundedWriteProcessingActivated": true,
    "writeTransactionCount": 44,
    "boundedWriteTransactionCount": 44,
    "maxWriteTransactionSize": 4,
    "outcome": "complete"
  }],
  "boundedRevisionWriteStatistics": {
    "batches": 1,
    "transactions": 44,
    "revisionWrites": 175,
    "maxTransactionsPerBatch": 44
  },
  "recoveredInterruptedReplicationBatches": []
}
```

Local diagnostic entries are limited to the newest 15 entries, at most 16 KiB of UTF-16 localStorage data, and a 14-day retention. Only potentially expensive batches are stored. A five-minute stale threshold and a two-minute active-tab lease avoid treating a live second tab as a crash. Recovery is labelled `suspected-interruption`, not a confirmed crash.

## Replaying the local fixture

From the repository root, the exact fixture can be benchmarked without contacting CouchDB:

```powershell
$env:BENCH_LOCAL_FIXTURE = "1"
$env:BENCH_WRITE_LIMITS = "0,1,2,4,8"
node scripts/experiments/credits-replication.mjs `
  "$env:LOCALAPPDATA\Temp\worshipsync-credits-eliathah-open-revs.json"
```

The harness intercepts all browser requests and uses new in-memory targets per run. To test workloads individually, set `BENCH_WORKLOAD` to `ordinary` or `mixed`, and use `BENCH_WRITE_LIMITS` for the desired limits. Keep the fixture outside Git and do not print or upload it.

## Fresh desktop and tablet staging runbook

Use a staging database copied with revision history intact, including the credits conflict group. Point the client only at the staging CouchDB endpoint and sign in with a staging test account. Do not run PouchDB replication against production; its checkpoints are writes.

### Desktop

1. Use a dedicated Windows user profile or fresh desktop test installation with no local WorshipSync edits. In PowerShell, from `client`, point the local Electron app to the staging endpoint and launch it:

   ```powershell
   $env:VITE_COUCHDB_HOST = "<staging CouchDB base URL>"
   npm.cmd run electron
   ```

2. Open DevTools (`Ctrl+Shift+I`), select Console, and enable detailed full-startup diagnostics before the fresh startup:

   ```js
   sessionStorage.setItem("worshipsync.startup-diagnostics.mode", "normal");
   location.reload();
   ```

3. Sign into the staging test account, wait for content and Bible sync plus application startup to finish, then export the snapshot:

   ```js
   copy(JSON.stringify(window.__worshipSyncStartupDiagnostics.snapshot(), null, 2));
   ```

   Check `recentEvents` for the `startup` / `application.ready` event, `activeReplications` for both databases settling to zero, and `expensiveReplicationBatches` for successful checkpoint outcomes. Record `heap.peakUsedMb`, browser/build, fixture state, and wall-clock duration. The five-second samples are approximate and may miss short peaks.

4. Repeat once with a separate fresh profile to confirm the result. If full startup fails before you can isolate the content pull, use a third fresh profile with `replication-only`, which skips Bible, cache hydration, and live sync. Return the test profile to regular behavior with `sessionStorage.setItem("worshipsync.startup-diagnostics.mode", "off"); location.reload();`.

### Low-end Android tablet

After the desktop staging run passes, deploy the same commit to the staging app. On the tablet, use a dedicated staging test account and a fresh app/browser profile with no unsynced local edits. Confirm the staging endpoint before signing in. Run a fresh sync and leave WorshipSync in the foreground until content and Bible synchronization finish; repeat after a cold app restart to check warm-start stability.

For a Chrome-based staging app, connect the tablet to a desktop with USB debugging enabled and open `chrome://inspect/#devices`. Inspect the staging tab, run the same `normal` session-storage command in its Console, and export the startup snapshot from the inspected tab. For an installed app with no inspectable Chrome tab, record Android app version, available device memory, completion/crash status, and Android system memory/ANR logs; enable the diagnostic mode through that app's WebView DevTools if available.

Pass criteria: both fresh syncs complete without the process being killed or restarted; the initial content pull and Bible sync settle; the credits document's incoming leaf revisions are written in groups of at most four and preserve all 175 fixture leaves; the subsequent warm startup does not rewrite those completed leaves. A tablet crash, incomplete sync, lost revision, or write failure is a fail. Keep detailed snapshot exports local because contributor document IDs are included.

## Remaining acceptance work

The fixture replay is isolated and does not include the full desktop application, its Bible pull, application cache, or other startup consumers. The mixed fixture also remained above the target. The desktop and Android staging runbook above remains to be completed; tablet completion without crashing is still the acceptance criterion.
