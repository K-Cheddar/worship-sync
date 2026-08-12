# Team chat operations

Team chat stores one Firestore document per message in `chatMessages`. The server
keeps one Firestore listener per active church and chat day, then fans updates out
to authenticated clients over server-sent events. Browser and Electron clients do
not receive Firestore credentials.

Typing presence is separate from message history. The client sends a throttled
heartbeat through the authenticated server, which stores a short-lived entry under
`worshipsyncChatTyping` in Firebase Realtime Database. The server shares one typing
listener per active church and day. Typing stops after 2.5 seconds of inactivity,
and clients discard any stale heartbeat after 10 seconds, so a disconnected client
cannot leave someone shown as typing indefinitely. These heartbeats do not create
Firestore documents or Firestore reads. The server also rate limits typing requests
and opportunistically removes expired Realtime Database entries.

Photo attachments use the existing private R2 bucket. Firestore stores only
validated attachment metadata; object keys stay server-side and authenticated
clients receive short-lived read URLs. Browser clients upload directly through a
short-lived signed PUT URL. Packaged Electron clients use the authenticated API
proxy. The server decodes JPEG, PNG, and WebP inputs, rejects animated or
oversized images, strips metadata, and writes bounded full and thumbnail WebP
variants before creating the message.

## Required deployment setup

Deploy `firestore.indexes.json`. It includes the chat composite index, the
`expiresAt` TTL policy, index exemptions for unqueried chat payload fields, and the
existing desktop-auth TTL override:

```sh
firebase deploy --only firestore:indexes
```

TTL deletion is asynchronous, so application reads also enforce the 365-day
retention boundary. The first authenticated chat client for a church sets that
church's chat timezone in `chatSettings`; later clients use the stored value so
everyone rolls over to the same daily room.

Photo sharing uses the same R2 variables as song audio:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- optional `R2_ENDPOINT`

Configure two R2 object lifecycle rules so unattached files and expired chat
history are removed even if an application cleanup is interrupted:

- delete objects under `pending/chat/` after 1 day
- delete objects under `chat/` after 365 days

The R2 bucket also needs a browser CORS rule allowing the production app and
local development origins to send `PUT` requests with the `Content-Type` header.
This is the same direct-upload requirement used by browser song-audio uploads.

Optional limits are `CHAT_IMAGE_MAX_BYTES` (10 MB by default),
`CHAT_IMAGE_UPLOADS_PER_HOUR` (12 per actor), and
`CHAT_IMAGE_UPLOAD_BYTES_PER_DAY` (250 MB per church). The rate limits are
per server process; R2 lifecycle rules are the durable storage backstop.

## Firestore usage model

- Opening an active daily room starts a server listener for the latest 100 messages.
  Its initial snapshot is sent to clients as one batch rather than one event per
  message.
- Additional clients connected to the same server process reuse that listener and
  receive its cached snapshot without repeating the Firestore query.
- Sending a message normally performs one document write. Its deterministic document
  ID prevents duplicate writes after a timeout; only a retry reads the existing
  document. The live listener reads the changed document once per active server
  process.
- Editing, deleting, or reacting uses a transaction read and one write. The live
  listener then reads the changed document once per active server process.
- Loading history reads only the requested page, up to 100 documents. The client
  performs a 50-message fallback read only when the live snapshot is unavailable.
- Typing activity uses Realtime Database traffic only. A continuously active typist
  sends at most one heartbeat every four seconds plus one removal when typing stops.
- A photo message still creates one Firestore message document. Its image bytes and
  thumbnail are stored in R2, and each visible image performs an authenticated URL
  request plus an R2 object read. Images are lazy-loaded in the chat history.

If the server is scaled to multiple processes or instances, each instance with an
active client maintains its own Firestore listener. Track `chatMessages` reads and
writes in Cloud Monitoring before changing the live query limit or retention.
