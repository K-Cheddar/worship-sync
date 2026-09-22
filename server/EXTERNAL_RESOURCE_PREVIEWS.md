# External resource previews

`GET /api/resources/resolve?url=` requires an authenticated app session. It
returns a provider-neutral descriptor. Previewable images, audio, video, and
documents are served through `GET /api/resources/proxy?token=` using a
short-lived HMAC token; HTML is never proxied.

Production deployments must set `AUTH_EXTERNAL_RESOURCE_TOKEN_SECRET` to a
dedicated high-entropy secret. Development falls back to a domain-separated
derivation from `AUTH_SESSION_SECRET`. Metadata is cached in process for ten
minutes; proxy tokens expire after fifteen minutes and are minted per resolve.

The resolver only makes public HTTP(S) requests, validates every redirect and
DNS result, does not forward cookies or authorization, and applies bounded
streaming, range, timeout, and in-process rate limits. The rate limits and
metadata cache are process-local, so multi-instance deployments should add a
shared limiter/cache if external-resource traffic becomes a scaling concern.
