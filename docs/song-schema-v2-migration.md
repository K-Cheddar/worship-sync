# Song schema v2 migration

Song v2 stores each logical song as a root, arrangement documents, and slide documents. The root `song-v2:root:<songId>` activates v2 for that song. A content database can contain v1-only songs and v2 songs at the same time. Legacy song documents remain in place and this migration never deletes them.

## Before migration

1. Deploy the v2-capable release.
2. Refresh or close every controller and shared workstation so old clients are no longer editing songs.
3. Pause song edits and imports.
4. Allow outstanding saves and replication to drain.

This is an operational maintenance window. The migration does not add a minimum-client-version gate and does not prevent an older client from writing v1 data.

## Dry run

Inspect a content database key before making changes:

```text
npm run migrate:songs-v2:dry-run -- --database=demo
```

Inspect one song first:

```text
npm run migrate:songs-v2:dry-run -- --database=demo --song=<logical-song-id>
```

`--database` accepts a content database key or full `worship-sync-*` name. It does not accept a Firestore church document ID. `--all` reads each Firestore church's `contentDatabaseKey`, skips and reports missing or invalid keys, and deduplicates canonical CouchDB names. `--song` requires `--database` and cannot be combined with `--all`.

Dry-run reads and serializes songs, validates identities, inspects roots and children, and estimates child writes and removals. It performs no writes. A non-zero exit means at least one target could not be safely prepared or inspected.

A ready single-song result looks like this:

```json
{
  "database": "worship-sync-demo",
  "legacySongCount": 1,
  "alreadyV2Count": 0,
  "migratedCount": 0,
  "blockedCount": 0,
  "failedCount": 0,
  "dryRun": true,
  "complete": true,
  "songs": [
    {
      "songId": "song-123",
      "name": "Come, Thou Fount",
      "sourceRevision": "8-abc123",
      "status": "dry_run_ready",
      "arrangementCount": 2,
      "slideCount": 14,
      "existingV2Children": 0,
      "expectedWrites": { "slides": 14, "arrangements": 2, "staleChildren": 0 },
      "verificationResult": "not_run_dry_run",
      "activationResult": "not_published_dry_run",
      "failures": []
    }
  ]
}
```

## Real migration

After reviewing the dry-run report and during the maintenance window, run:

```text
npm run migrate:songs-v2 -- --database=demo
```

Or validate one song in a test/demo database:

```text
npm run migrate:songs-v2 -- --database=demo --song=<logical-song-id>
```

For every database selected from Firebase Admin, use `--all` instead of `--database`.

**This implementation phase does not run the real migration against any database.** Do not use these commands on a real church until the v2-capable release is deployed and the maintenance window is ready.

## Report acceptance

Each song reports one status:

- `dry_run_ready`: serialization and identity checks passed; no writes were made.
- `migrated`: children and full hydrated output verified, then the root was published last.
- `already_v2`: a root already existed and its referenced song was valid; stale v1 was not copied over it.
- `blocked_invalid_ids`: malformed or colliding song identities need repair.
- `blocked_oversized_document`: one slide or arrangement document exceeded CouchDB's request limit.
- `source_changed`: the legacy revision changed before activation; no root was published.
- `verification_failed`: an existing v2 song was invalid, child verification failed, or final active output did not match.
- `failed`: another required read or write failed. Prepared children may remain as inactive documents.

Treat blocked, source-changed, verification-failed, or failed songs as requiring attention. A non-zero exit means the migration is incomplete. Rerunning is safe while a root is absent: the current legacy song remains authoritative, matching children are reused, changed children are reconciled, and obsolete preparation children for that song are removed. A later successful run can then publish the root.

## Rollback posture

The legacy song document is retained and never changed or deleted. Before a v2 root is published, v1 remains authoritative and partial v2 children are inactive. Once a root is published, that song is v2-authoritative; use a v2-capable release for recovery. Do not delete legacy song documents as part of this rollout.
