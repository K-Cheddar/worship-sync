# External resource previews

External URLs enter the shared preview path through the Service Plan resource
normalizer. `ContentPreviewDialog` consumes only a normalized descriptor; it
does not contain provider-specific URL rules. Public URLs are resolved by
`server/externalResourceProviders.js` and `server/externalResourceService.js`:

```text
ServicePlanContentResource
  -> normalizeServicePlanResourceForPreview
  -> ContentPreviewDialog
  -> GET /api/resources/resolve?url=...
  -> provider candidate + metadata probe
  -> signed same-origin proxy for media/documents
  -> shared image/audio/video/document renderer
```

The resolver registry handles YouTube, Dropbox, Google Drive/Docs,
OneDrive, SharePoint, and Box before falling back to direct URL metadata
detection. Provider strategies only normalize public share links; they do not
forward credentials or decide previewability. HTTP metadata, Content-Disposition,
and URL extensions then determine the media type. HTML is classified as a web
page and is never proxied.

`GET /api/resources/resolve?url=` requires an authenticated app session. It
returns a provider-neutral descriptor. Previewable images, audio, video, and
documents are served through `GET /api/resources/proxy?token=` using a
short-lived, target-bound HMAC capability minted by that authenticated
request. The capability is necessary because media elements cannot attach the
workstation or bearer headers used by the resolver request; it is not an
unrestricted URL proxy. HTML remains external and is only attempted in the
sandboxed iframe preview path; the UI provides an external-open fallback when
embedding fails.

Production deployments must set `AUTH_EXTERNAL_RESOURCE_TOKEN_SECRET` to a
dedicated high-entropy secret. Development falls back to a domain-separated
derivation from `AUTH_SESSION_SECRET`. Metadata is cached in process for ten
minutes; proxy tokens expire after fifteen minutes and are minted per resolve.

The resolver only makes public HTTP(S) requests, validates every redirect and
DNS result, rejects credentials/private/link-local/metadata hosts, does not
forward cookies or authorization, and applies bounded streaming, range,
timeout, and in-process rate limits. Media is streamed without buffering the
whole response, and safe range headers are preserved for seeking. The rate
limits and metadata cache are process-local, so multi-instance deployments
should add a shared limiter/cache if external-resource traffic becomes a
scaling concern.

The app CSP intentionally does not add arbitrary provider domains to
`media-src`; media/document previews use the same-origin proxy. Existing
trusted media/CDN hosts remain explicitly documented in the Electron CSP.
Generic webpage framing is limited by the host's own embedding policy and
falls back to opening the original URL; arbitrary HTML is not proxied to
bypass `X-Frame-Options` or CSP.
