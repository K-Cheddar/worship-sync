# Credits conflict replication benchmark

**Date:** November 27, 2026  
**Runtime:** Chromium 156, PouchDB 9.0.0, IndexedDB, CouchDB 3.5.3 on loopback

The disposable fixture models one credits document with 175 live leaves and 1,000-generation histories. Each leaf keeps its own recent 750 revisions and shares the earlier 250-revision ancestry. It reproduces the reported leaf count and history depth, but it is synthetic. The church's saved benchmark fixture was not available for this run.

The benchmark starts a new incognito browser profile and empty IndexedDB for each measurement. It measures peak `performance.memory.usedJSHeapSize` every 25 ms, the PouchDB metadata JSON codecs, full replication duration, and stored revision-tree size. After replication, it compares every local leaf's document body, revision ID, and complete `_revisions` path with CouchDB `open_revs=all&revs=true`. It also compares the winning document and verifies that a second replication writes no documents and leaves the sequence unchanged.

| Run | Peak heap | Replication | JSON parsing | JSON serialization | Tree nodes | Tree JSON bytes | Live leaves |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All leaves unresolved | 1,532.5 MiB | 49.4 s | 0.0 s | 27.3 s | 131,500 | 7,890,542 | 175 |
| Losers accepted and tombstoned | 1,596.5 MiB | 48.2 s | 0.0 s | 26.5 s | 131,923 | 7,918,548 | 1 plus 174 tombstones |
| Resolved document, writes capped at 8 revisions | 503.1 MiB | 57.4 s | 3.5 s | 29.4 s | 131,923 | 7,918,548 | 1 plus 174 tombstones |
| Unresolved document, writes capped at 8 revisions | 1,019.7 MiB | 62.7 s | 3.8 s | 33.6 s | 131,500 | 7,890,542 | 175 |
| Interrupted bounded run, then resumed | 489.1 MiB | 62.3 s | 3.6 s | 30.7 s | 131,500 | 7,890,542 | 175 |

Winner acceptance preserved the application content but did not lower peak memory. The new tombstones increased the local tree from 131,500 to 131,923 nodes. The 8-revision write experiment lowered the sampled peak by about one third for unresolved leaves and by about two thirds after winner acceptance. It increased replication time by roughly 19–27 percent against the corresponding baseline. The interrupted run resumed and verified every original leaf, body, and history, and its checkpoint advanced only after the replication completed.

The result supports keeping any bounded-write change as an experiment until it is measured against the exact saved church fixture and the target Android device. No normal change-feed batch option or production PouchDB code was changed.

Because normal conflict resolution does not reduce peak memory in this reproduction, a production conflict-cleanup utility would not address the measured memory problem. No cleanup utility was added.

Run the isolated experiment against a disposable local CouchDB with:

```powershell
$env:BENCH_COUCH_URL = "http://127.0.0.1:15984"
$env:BENCH_COUCH_PASSWORD = "<local disposable CouchDB password>"
node scripts/experiments/credits-replication.mjs
```

To replay an exact fixture, pass a local JSON array exported from `open_revs=all&revs=true` as the first argument. Keep that file and any exact document IDs local because they may contain church content.

The low-end Android initial pull remains unverified. This benchmark does not establish production readiness or resolve the tablet memory issue.
