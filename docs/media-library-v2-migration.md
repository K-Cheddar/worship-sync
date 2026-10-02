# Media library schema v2 migration

Schema v2 stores one `media-item:<id>` document per media item, `media-folders` for folders, and `media-library-meta` with `schemaVersion: 2`. The legacy `media` document is retained.

## Rollout order

1. Deploy the v2-capable client while all databases are still unmarked. It continues to read and write schema v1 during this stage.
2. Run a dry report for a church: `npm run migrate:media-library-v2:dry-run -- --database=<church-key>`.
3. Enter a maintenance window. Close every active controller, auxiliary, and overlay controller, wait for pending local media saves and replication to drain, and block older clients from reconnecting. Keep media edits/imports paused until migration finishes; this prevents an in-flight legacy save from racing the final schema marker.
4. Run the migration: `npm run migrate:media-library-v2 -- --database=<church-key>`. For every church in Firebase Admin, use `--all` instead of `--database`.
5. Review the JSON report. Resume media work only when each target reports `verificationResult: "passed"`, `schemaVersionResult: "set_v2"` (or `already_v2` on a rerun), and no failures.
6. Reopen refreshed v2-capable clients. Initial replication completes before controller library loading, so the schema marker and the v2 item/folder documents are present in local PouchDB before the UI selects a format.

The marker is written only after every bounded `_bulk_docs` batch succeeds, the exact item IDs and fields verify, folders verify, and the legacy document revision remains unchanged during the migration. A partial run leaves schema v1 active; rerunning safely updates deterministic IDs. Once the marker is v2, rerunning the migration does not copy the old aggregate back over newer item edits.

## Acceptance run

For a production-like check, start with a church containing at least 1,300 media entries, migrate it, and open Controller A and Controller B on refreshed v2-capable clients. Add a ten-page Canva deck on A and confirm ten `media-item:<id>` documents are written; B should receive ten item-level changes, and a newly opened Controller C should load all ten from its local prefix query. Inspect replication requests to confirm no write contains the full 1,300-entry list. Rename one existing item and confirm only its item document changes. Add separate media from A and B at the same time and confirm both IDs survive. Finally close and reopen a controller and confirm its full list and folder assignments reconstruct from local item and folder documents.

The automated repository and migration tests exercise the bounded batches, per-item writes, remote item updates/deletions, folder updates, legacy reads, and complete local prefix load. The multi-controller production run still needs to be performed against the target CouchDB deployment before enabling v2 there.

## Recovery and rollback

Before v2 is activated, the legacy `media` document remains authoritative and a failed migration can be rerun. The migration never deletes or shrinks it.

After v2 is activated, keep the v2 marker and use a v2-capable client build for rollback or forward recovery. Do not switch the marker back to v1: v2 writes are item documents and the retained legacy list is only the pre-migration snapshot. An older client could ignore newer v2 changes and rewrite the stale aggregate. Reverting to a client that only understands v1 requires a separately reviewed export/recovery plan; do not perform that as an automatic rollback.
