# Media library schema v2 migration

Schema v2 stores one `media-item:<id>` document per media item, `media-folders` for folders, and `media-library-meta` with `schemaVersion: 2`. The legacy `media` document is retained.

## Rollout order

1. Deploy the v2-capable client while all databases are still unmarked. It continues to read and write schema v1 during this stage.
2. Confirm the intended v2-capable release is deployed.
3. Enter a maintenance window. Before setting any database to schema v2, close or refresh every controller, auxiliary controller, overlay controller, shared workstation, and Electron/controller instance that could still be running an older client. Pause media imports and edits, then allow outstanding replication and saves to drain.
4. Run a dry report for a content database key: `npm run migrate:media-library-v2:dry-run -- --database=<content-database-key>`. `--database` accepts a key or full `worship-sync-*` name; it does not accept a Firestore church document ID. `--all` reads each Firestore church's `contentDatabaseKey`, skips and reports records with missing or invalid keys, and deduplicates normalized CouchDB names.
5. Run the migration: `npm run migrate:media-library-v2 -- --database=<content-database-key>`. For every church in Firebase Admin, use `--all` instead of `--database`.
6. Review the JSON report. Resume media work only when each target reports `verificationResult: "passed"`, `schemaVersionResult: "set_v2"` (or `already_v2` on a rerun), no failures, no blocked 413 state, and no skipped churches. If a single document still receives HTTP 413, the report marks that database blocked and leaves the schema marker unset.
7. Reopen controllers on the current v2-capable release. Initial replication completes before controller library loading, so the schema marker and the v2 item/folder documents are present in local PouchDB before the UI selects a format.

This maintenance window is required because once `media-library-meta.schemaVersion >= 2`, v2 clients ignore legacy `media` replication. An older v1 client that remains active after cutover can write only to the legacy aggregate; those edits do not become part of the authoritative v2 item documents. Do not resume media work until the v2 migration report has been reviewed and all controllers use the current v2-capable release. For the phone with a stranded oversized v1 local media revision, reset its local WorshipSync app state/PouchDB before allowing it to reconnect; do not let that revision replicate after migration.

The marker is written only after every bounded `_bulk_docs` batch succeeds (with 413 batches split down to one document), the exact item IDs and fields verify with no stale item documents, folders verify, and the legacy document revision remains unchanged during the migration. A partial run leaves schema v1 active; rerunning rebuilds each v2 item from the current legacy item, removes stale item documents, and preserves only current fields. Once the marker is v2, rerunning the migration does not copy the old aggregate back over newer item edits.

## Acceptance run

For a production-like check, start with a church containing at least 1,300 media entries, migrate it, and open Controller A and Controller B on refreshed v2-capable clients. Add a ten-page Canva deck on A and confirm ten `media-item:<id>` documents are written; B should receive ten item-level changes, and a newly opened Controller C should load all ten from its local prefix query. Inspect replication requests to confirm no write contains the full 1,300-entry list. Rename one existing item and confirm only its item document changes. Add separate media from A and B at the same time and confirm both IDs survive. Finally close and reopen a controller and confirm its full list and folder assignments reconstruct from local item and folder documents.

The automated repository and migration tests exercise the bounded batches, per-item writes, remote item updates/deletions, folder updates, legacy reads, and complete local prefix load. The multi-controller production run still needs to be performed against the target CouchDB deployment before enabling v2 there.

## Recovery and rollback

Before v2 is activated, the legacy `media` document remains authoritative and a failed migration can be rerun. The migration never deletes or shrinks it.

After v2 is activated, keep the v2 marker and use a v2-capable client build for rollback or forward recovery. Do not switch the marker back to v1: v2 writes are item documents and the retained legacy list is only the pre-migration snapshot. An older client could ignore newer v2 changes and rewrite the stale aggregate. Reverting to a client that only understands v1 requires a separately reviewed export/recovery plan; do not perform that as an automatic rollback.
