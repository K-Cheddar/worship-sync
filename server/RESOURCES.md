# Church resources

ChurchResource files use the private Cloudflare R2 bucket configured by:

```text
R2_BUCKET=worshipsync-audio
R2_RESOURCES_BUCKET=worshipsync-resources
```

`R2_BUCKET` is the existing SongAudio bucket. `R2_RESOURCES_BUCKET` is the
ChurchResource and chat-image bucket and must be configured separately. Do not point
`R2_RESOURCES_BUCKET` at `worshipsync-audio` or omit it: ChurchResource
storage fails closed with a 503 rather than falling back to the SongAudio
bucket. Both buckets reuse the existing R2 account, endpoint, and credentials.
Neither bucket should have public access, a Development URL, or a public
custom domain enabled.

Chat images use only `chat/` and `pending/chat/` in the Resources bucket. They
remain separate from the Firestore-backed ChurchResource listing and use
30-day image retention; see `CHAT.md` for chat cleanup and lifecycle setup.

## Browser upload CORS

The Resources bucket needs a private browser CORS rule for the deployed
WorshipSync origin(s) and local development origin(s). Allow:

- `PUT`
- `GET` (for transient signed previews/downloads)
- `HEAD` (if used by a deployment check)

Allow the request headers used by signed uploads, including `Content-Type` and
`Content-Length`, and expose normal response headers as needed by the browser.
Chat image uploads also use signed browser `PUT` requests to this bucket, so its
CORS rule must cover the chat origins and `Content-Type`. The Electron fallbacks
post files through the authenticated server and do not depend on R2 CORS.

## Lifecycle rule

Add an R2 lifecycle rule for the resources bucket:

```text
prefix: pending/churches/
expire after: 1 day
```

Also add `pending/chat/` with a 1-day expiry and `chat/` with a 30-day expiry.
Do not apply the chat rule to `churches/`.

Do not expire `churches/`; those are permanent ChurchResource objects. The
completion endpoint promotes a pending object to `churches/.../original` and
deletes the pending object immediately, while the lifecycle rule recovers
objects abandoned by interrupted uploads.
