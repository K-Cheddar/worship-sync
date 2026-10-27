# Item document storage

**Contract status:** Confirmed by the October 26, 2026 item-storage simplification request.

PouchDB owns persistent item content and metadata. Redux `allDocs` is the shared in-memory cache for songs, custom documents, saved timers, Bible documents and headings. Libraries, search, duplicate detection, Controller navigation and service-plan integration derive entries from those documents. Saved document metadata takes precedence over the historical `allItems` index.

One content-database subscription belongs to the shared application provider, independently of Controller mounting. Its initial `allDocs({ include_docs: true, update_seq: true })` snapshot supplies the changes-feed starting sequence. Local writes, replication and tombstones update the cache incrementally. A retired church, database or Redux session cannot publish a late snapshot, event or missing-document read into its successor. Retry resumes from the last delivered sequence. Local content remains available while the remote session or initial pull is pending.

Presentation outlines independently own order, occurrence `listId`s and intentional overrides. Refreshing the library never replaces an existing outline background. Newly inserted references use current cached metadata, including local image/video references. Active editor drafts, revision checks and explicit remote-conflict decisions remain intact. Overlay synchronization and song schema migrations are outside this change.

The next-service countdown remains generated from service-time state. It is not a saved timer-library entry. Controller startup never deletes Bible or heading documents because they appear unreferenced. Document creation and outline saves or replication can arrive separately; temporary absence of a reference is not permission to delete content. Normal explicit item deletion remains available.

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
- **Automatic deletion and cache filtering:** Remove startup Bible/heading cleanup and ignore unrelated cache events while retaining explicit deletion and stale-read safety. Authorization: October 26, 2026 remaining item-cache review findings request.
- **Empty custom items:** The Presentation Controller may save a named custom item with no slides; text or media can be added later through the existing editor. The empty slide array uses the existing document and synchronization shape. Authorization: current request, October 27, 2026.

Regression coverage: `itemCacheSync.test.ts`, `itemCacheSync.pouch.test.ts`, `controllerInfo.test.tsx`, `useOutlineItemDocs.test.tsx`, `Item.test.tsx`, `store.test.ts`, `useServicePlanOutlinePush.test.tsx` and `scripts/audit-item-storage.test.mjs`.
