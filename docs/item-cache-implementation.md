# Item document cache implementation

## Goal
PouchDB owns durable item documents; Redux `allDocs` is their single reactive cache.

## Existing architecture
`allItems` duplicates names/backgrounds and mixes UI search state with a persisted library index. Index repair middleware merges three document categories back into it. Controller, Services, and Resources independently refresh `allDocs`; Controller replication and broadcast events trigger full reads. Bible and heading creators already persist individual documents. The upcoming-service timer is intentionally generated from service times.

## Before behavior
Index metadata overrides documents; cache hydration depends on routes; remote updates can race refreshes. Saves update multiple stores and persist the index separately.

## After behavior
Shared database ownership starts one snapshot/sequence-based changes feed. Only item/heading documents enter the cache. Library metadata derives from cached documents. Local writes and replication use the same feed, including tombstones. Route navigation retains the shared cache and reads it before a missing-document fallback.

## Product Decision Check
Authorization: October 26, 2026 request to remove `allItems`, make documents authoritative, preserve independent outlines, and leave the historical index document untouched. Related contracts: item-library-search, controller-content-viewing, service-plan-import, song-audio-conflicts. This request supersedes indexed-title-only search and index metadata precedence. No product choice remains open. Metadata-only historical rows cannot reconstruct lost lyrics/slides; audit them explicitly without inventing content or resurrecting deleted documents.

## Behavior intentionally unchanged
Outline ordering, occurrence list IDs and overrides; active editor draft/conflict protections; overlays, song migrations, presentation output and stream transparency; generated next-service countdown.

## Acceptance criteria
No runtime allItems Redux/persistence/repair path; document-derived consumers; no snapshot/live gap or stale-owner publication; incremental deletes/changes; cached navigation; current service-plan metadata without overwriting outline overrides.

## Proposed implementation
Extend the existing allDocs slice with hydration/lifecycle and incremental changes. Subscribe at ControllerInfoProvider, shared by Controller, Services, Resources and guest routes. Retain only search/filter UI state in a UI slice. Remove duplicate cache writers and route refreshes. Retain cache-miss reads with database/session and snapshot-identity guards; publish only current results into allDocs. Retire the separate outline-prefetch document cache.

## Affected surfaces
Redux/store listeners, ControllerInfoProvider/database teardown, library/search/create/delete, media item creation, Bible/headings, continuous outline preview/navigation, saved-plan pushes and Planning URL imports. Browser and Electron use the same provider and local PouchDB API. Server auth/replication transport and display rendering are unchanged.

## Risks / edge cases
Snapshot/live interleaving, deletion followed by delayed reads, same IDs in different churches, unmount and teardown while loading, feed restart after errors, local echoes while editing, timer reconciliation, historical index-only rows, and scope changes during initial replication.

## Questions requiring user input
None.

## Verification
Focused cache lifecycle tests with controlled snapshots/changes and real PouchDB replication; document selector and consumer tests; active-edit/save conflict and owner tests; outline bridge, navigation/continuous preview and service-plan tests; TypeScript, changed-file lint and production build. Review production provider composition and complete diff. Record exact executed results in the handoff.
