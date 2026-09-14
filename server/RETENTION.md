# Message and discussion-board retention

Retention is separate from visibility and session lifecycle. Restream reconnects,
session resets, and board rotations do not delete current or historical data as
part of those operations.

## Restream messages

New viewer messages and moderator replies in `restreamMessages` receive a
canonical millisecond `messageTimestamp` and an `expiresAt` Firestore timestamp
90 days after the best available message time. The write and migration paths
prefer provider `postedAt`, then receipt/creation/update time. Firestore TTL
deletion is asynchronous; the current-session read remains session-scoped and
bounded to 500 messages, ordered by the canonical field. RTDB fallback reads
use the same canonical timestamp for their per-session limit, filter expired
messages, and best-effort delete expired documents and index entries in bounded
batches.

The separate highlighted-items display path continues to read all highlighted
messages from the current session because it has no existing display cap;
changing that would alter which highlighted items can be presented and is
outside this retention change.

Previously stored messages without `messageTimestamp` or `expiresAt` are not
scanned on application startup. Run a bounded dry run first, then repeat with
`--start-after` when a database has more than one batch:

```sh
npm run backfill:restream-message-expiration:dry-run -- --database=<database>
npm run backfill:restream-message-expiration -- --database=<database>
```

The migration fills both fields using `postedAt`, then `receivedAt`, `createdAt`,
and `updatedAt`. Records without a usable timestamp are reported and left
unchanged rather than being assigned an invented date. `--all` is available
only as an explicit cross-database opt-in. Run the dry run and write pass before
deploying a build that relies on canonical ordering if uninterrupted legacy
message visibility is required.

## Discussion boards

Archived board sessions and their `post:<boardId>:*` documents are retained for
365 days. Rotation records `archivedAt`; legacy boards without that field use
`createdAt` as the documented fallback. Cleanup is an explicit bounded pass and
never runs on ordinary board requests:

```sh
npm run cleanup:discussion-boards:dry-run
npm run cleanup:discussion-boards -- --limit=100
```

The cleanup rechecks the board and alias before deletion, deletes posts before
the archived board document, and removes purged or missing IDs from
`alias.history`. Partial or repeated runs are safe because the next pass finds
remaining documents and stale history again. Current alias boards are always
protected.

## Temporary Restream records

New `restreamOauthStates` and `restreamConnectRequests` retain their existing
numeric `expiresAt` API field and also receive a Firestore-native `ttlExpireAt`
backstop. OAuth state is still deleted immediately after callback; connect
requests are logically expired when read. `restreamSessions` is current
integration/session metadata and is not treated as disposable history.

The TTL fields apply to new records. Existing temporary documents without
`ttlExpireAt` are not startup-scanned and may require a separate operational
cleanup if their physical removal is needed.

## Deployment

Deploy the Firestore TTL policies and indexes with the repository's existing
Firebase command:

```sh
firebase deploy --only firestore:indexes
```

Run the Restream backfill only after reviewing its dry-run report. The board
cleanup script requires `COUCHDB_HOST`, `COUCHDB_USER`, and `COUCHDB_PASSWORD`.
