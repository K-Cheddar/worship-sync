# Team chat operations

Team chat stores one Firestore document per message in `chatMessages`. The server
keeps one Firestore listener per active church and chat day, then fans updates out
to authenticated clients over server-sent events. Browser and Electron clients do
not receive Firestore credentials.

## Required deployment setup

Deploy the composite indexes in `firestore.indexes.json`, then enable Firestore TTL
for the `expiresAt` field on the `chatMessages` collection group:

```sh
firebase deploy --only firestore:indexes
gcloud firestore fields ttls update expiresAt --collection-group=chatMessages --enable-ttl
```

TTL deletion is asynchronous, so application reads also enforce the 365-day
retention boundary. The first authenticated chat client for a church sets that
church's chat timezone in `chatSettings`; later clients use the stored value so
everyone rolls over to the same daily room.

## Firestore usage model

- Opening an active daily room starts a server listener. Its initial snapshot reads
  the retained documents in that room, up to the live query limit.
- Additional clients connected to the same server process reuse that listener and
  do not each create a Firestore listener.
- Sending a message normally performs one document write. Its deterministic document
  ID prevents duplicate writes after a timeout; only a retry reads the existing
  document. The live listener reads the changed document once per active server
  process.
- Editing, deleting, or reacting uses a transaction read and one write. The live
  listener then reads the changed document once per active server process.
- Loading history reads only the requested page, up to 100 documents.

If the server is scaled to multiple processes or instances, each instance with an
active client maintains its own Firestore listener. Track `chatMessages` reads and
writes in Cloud Monitoring before changing the live query limit or retention.
