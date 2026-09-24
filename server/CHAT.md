# Team chat operations

Team chat stores one Firestore document per message in `chatMessages`. The server
keeps one Firestore listener per active church and chat week, then fans updates out
to authenticated clients over server-sent events. Browser and Electron clients do
not receive Firestore credentials.

Typing presence is separate from message history. The client sends a throttled
heartbeat through the authenticated server, which stores a short-lived entry under
`worshipsyncChatTyping` in Firebase Realtime Database. The server shares one typing
listener per active church and week. Typing stops after 2.5 seconds of inactivity,
and clients discard any stale heartbeat after 10 seconds, so a disconnected client
cannot leave someone shown as typing indefinitely. These heartbeats do not create
Firestore documents or Firestore reads. The server also rate limits typing requests
and opportunistically removes expired Realtime Database entries.

Photo attachments use the private Resources R2 bucket, isolated from both
SongAudio and ordinary ChurchResource files by their own key prefixes. Firestore
stores validated attachment metadata including exact sizes and a 30-day
`expiresAt`; object keys stay server-side and authenticated clients receive
short-lived read URLs. Browser clients upload directly through a short-lived
signed PUT URL. Packaged Electron clients use the authenticated API proxy. The
server decodes JPEG, PNG, and WebP inputs, rejects animated or oversized images,
strips metadata, reserves R2 quota, and writes bounded full and thumbnail WebP
variants before committing the message. Images remain available until their
attachment expiration; the message itself keeps its existing 365-day retention.
Expired and missing legacy images render an `Image expired` placeholder, and the
server refuses to issue download URLs for them.

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
everyone rolls over to the same weekly room.

Photo sharing shares R2 credentials and endpoint with song audio, but uses the
separate Resources bucket:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_RESOURCES_BUCKET` (required for chat photos)
- optional `R2_ENDPOINT`

Keep `R2_BUCKET` assigned to the existing SongAudio bucket. Chat uploads and
downloads use `R2_RESOURCES_BUCKET` and never fall back to the SongAudio bucket.
Do not expose either bucket publicly.

Configure these R2 object lifecycle rules on the Resources bucket:

- delete objects under `pending/chat/` after 1 day
- delete objects under `pending/churches/` after 1 day
- delete objects under `chat/` after 30 days

The Resources bucket needs CORS allowing the production app and local
development origins, `PUT` and `GET`, and the `Content-Type` request header.
Browser chat uploads use direct signed PUTs; Electron uploads use the
authenticated server proxy. Do not move the chat CORS rule to the SongAudio
bucket.

Schedule `npm run cleanup:chat-images` to run daily with Firebase Admin, CouchDB,
and R2 credentials (including `R2_RESOURCES_BUCKET`). It retries attachment
deletions after message removal or image expiration and reconciles each church's
R2 usage from Resources, song-audio metadata, and active chat attachments. The
cleanup does not depend on a user opening chat. Run
`npm run cleanup:chat-images:dry-run` to check the number of due attachments
before the first scheduled run. Keep a single scheduler job; the command is
safe to retry.

Legacy demo chat images predate attachment expiration and remain unavailable
after switching the bucket. No objects are moved or deleted during deploy. If
you want to reclaim those old objects, manually inspect the demo church's
`chat/` and `pending/chat/` prefixes in the old SongAudio bucket and delete only
the confirmed demo chat objects. Never delete the whole bucket or song-audio
objects.

Optional limits are `CHAT_IMAGE_MAX_BYTES` (10 MB by default),
`CHAT_IMAGE_UPLOADS_PER_HOUR` (12 per actor), and
`CHAT_IMAGE_UPLOAD_BYTES_PER_DAY` (250 MB per church). The rate limits are
per server process; R2 lifecycle rules are the durable storage backstop.

## Firestore usage model

- Opening an active weekly room starts a server listener for the latest 100 messages.
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
