# Church resources

ChurchResource files use the private Cloudflare R2 bucket configured by:

```text
R2_BUCKET=worshipsync-audio
R2_RESOURCES_BUCKET=worshipsync-resources
```

`R2_BUCKET` is the existing SongAudio bucket. `R2_RESOURCES_BUCKET` is the
ChurchResource bucket and must be configured separately. Do not point
`R2_RESOURCES_BUCKET` at `worshipsync-audio` or omit it: ChurchResource
storage fails closed with a 503 rather than falling back to the SongAudio
bucket. Both buckets reuse the existing R2 account, endpoint, and credentials.
Neither bucket should have public access, a Development URL, or a public
custom domain enabled.

## Browser upload CORS

The resources bucket needs a private browser CORS rule for the deployed
WorshipSync origin(s) and local development origin(s). Allow:

- `PUT`
- `GET` (for transient signed previews/downloads)
- `HEAD` (if used by a deployment check)

Allow the request headers used by signed uploads, including `Content-Type` and
`Content-Length`, and expose normal response headers as needed by the browser.
The Electron fallback posts the file through the authenticated server and does
not depend on R2 CORS.

## Lifecycle rule

Add an R2 lifecycle rule for the resources bucket:

```text
prefix: pending/churches/
expire after: 1 day
```

Do not expire `churches/`; those are permanent ChurchResource objects. The
completion endpoint promotes a pending object to `churches/.../original` and
deletes the pending object immediately, while the lifecycle rule recovers
objects abandoned by interrupted uploads.
