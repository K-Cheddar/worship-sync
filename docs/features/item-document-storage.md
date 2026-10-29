# Item document storage

**Contract status:** Confirmed by the October 26, 2026 item-storage simplification request.

PouchDB owns persistent item content and metadata. Redux `allDocs` is the shared in-memory cache for songs, custom documents, saved timers, Bible documents and headings. Libraries, search, duplicate detection, Controller navigation and service-plan integration derive entries from those documents. Saved document metadata takes precedence over the historical `allItems` index.

One content-database subscription belongs to the shared application provider, independently of Controller mounting. Its initial `allDocs({ include_docs: true, update_seq: true })` snapshot supplies the changes-feed starting sequence. Local writes, replication and tombstones update the cache incrementally. A retired church, database or Redux session cannot publish a late snapshot, event or missing-document read into its successor. Retry resumes from the last delivered sequence. Local content remains available while the remote session or initial pull is pending.

Presentation outlines independently own order, occurrence `listId`s and intentional overrides. Refreshing the library never replaces an existing outline background. Newly inserted references use current cached metadata, including local image/video references. Active editor drafts, revision checks and explicit remote-conflict decisions remain intact. Overlay synchronization and song schema migrations are outside this change.

The next-service countdown remains generated from service-time state. It is not a saved timer-library entry. Controller startup does not delete Bible or heading documents immediately. After the item cache is hydrated and the initial remote content pull succeeds, one delayed, guarded reconciliation may reconsider older orphaned Bible documents from before this cleanup mechanism. Guest sessions and sessions without a successful initial pull remain ineligible. After a successful outline save removes a Bible reference, cleanup remains the primary trigger. Both paths require a complete, stable saved-outline inventory, the current database/cache session, completed initial replication, idle content replication, a live RTDB connection, and a recent complete active-instance snapshot confirming this is the only Controller for the content database. Local item writes, pending or in-flight outline item persistence (including outgoing-outline saves), native saved Service Plan pushes, Service Plan sync, and Bible document creation activity also block cleanup; their completion schedules another opportunity without a new outline edit. Recent orphan documents are retained through the one-hour grace period and get one delayed retry at the eligibility boundary. Timestamp-uncertain documents remain indefinitely. Cleanup aborts when the registry, any listed outline, cache session, or PouchDB snapshot is incomplete or changes during the check. Songs, custom documents and headings are never cleanup candidates. Normal explicit item deletion remains available.

PouchDB does not provide a transaction that can compare every outline and atomically tombstone an item. The final local update-sequence check and Bible document revision prevent known changes and stale deletions; they cannot prevent an uncoordinated remote writer from adding a reference after the check. A fresh connected active-instance snapshot blocks known competing Controllers. Automatic cleanup is therefore deferred while presence is stale, disconnected, incomplete, or shows another Controller; arbitrary remote writers that do not publish Controller presence remain a documented race boundary.

Only actual item documents update the live item cache. Untyped deletion tombstones remove matching cached items; tombstones for absent IDs and unrelated document updates preserve the cache reference and change version. The live feed still starts at the snapshot sequence and advances its resume sequence across ignored events. Missing-document reads validate their keyed `allDocs` snapshot with a changes query filtered to the requested IDs, so unrelated writes do not retry item lookups and an uncached deletion cannot let an older read resurrect content.

## Historical data

The persisted `allItems` document is neither deleted nor maintained. Bible and heading creation already saved individual documents; their cache no longer needs index registration. Index-only names cannot reconstruct lost song lyrics, custom slides or timer settings. A missing entry may also describe an intentionally deleted item, so it must not be recreated automatically.

Use the read-only audit on an exported Couch/Pouch `allDocs` response or document array:

```powershell
node scripts/audit-item-storage.mjs path/to/all-docs-export.json
```

The report identifies document-backed rows, missing/deleted references, recoverable heading metadata and generated countdowns. Review original backups before restoring any missing content. The audit never changes the export or a database, and is not part of application startup. This implementation was audited against repository creators, historical-format fixtures and real local PouchDB tests; no production church database was inspected.

## Product decisions

- **Source ownership:** Documents replace index metadata precedence and index-only library search. Authorization: current request, October 26, 2026.
- **Outline independence:** Existing occurrence overrides survive library changes; new occurrences use current document metadata. Authorization: current request, October 26, 2026.
- **Historical safety:** Leave the old index untouched; report missing content explicitly rather than infer a restoration. Authorization: current request's legacy-data and no-deletion requirements.
- **Automatic deletion and cache filtering:** Remove startup Bible/heading cleanup and ignore unrelated cache events while retaining explicit deletion and stale-read safety. Authorization: October 26, 2026 remaining item-cache review findings request. The October 29, 2026 current request authorizes guarded, post-save cleanup of older unreferenced Bible documents only; it does not restore the legacy `AllItems` dependency or heading cleanup.
- **Deferred Bible cleanup progress:** The October 29, 2026 follow-up authorizes one delayed per-session reconciliation after successful initial replication, activity-triggered retries, and a grace-period retry for recent orphaned Bible documents. It preserves all outline-inventory and presence gates and does not authorize heading cleanup or a new operator workflow.
- **In-flight outline save safety:** The October 29, 2026 follow-up authorizes cleanup to wait for all in-flight outline item persistence in the current database, including an outgoing-outline save after selection changes, and to recheck saved references after those writes settle.
- **Empty custom items:** The Presentation Controller may save a named custom item with no slides; text or media can be added later through the existing editor. The empty slide array uses the existing document and synchronization shape. Authorization: current request, October 27, 2026.

Regression coverage: `itemCacheSync.test.ts`, `itemCacheSync.pouch.test.ts`, `controllerInfo.test.tsx`, `useOutlineItemDocs.test.tsx`, `Item.test.tsx`, `store.test.ts`, `useServicePlanOutlinePush.test.tsx` and `scripts/audit-item-storage.test.mjs`.
