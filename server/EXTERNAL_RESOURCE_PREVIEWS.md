# External resource previews

Preview resolution separates retrieval decisions from UI rendering:

```text
source/resource
  → provider strategy
  → secure network retrieval
  → source descriptor
  → client renderer selection
  → renderer
```

## Server responsibilities

`externalResourceProviders.js` recognizes known providers and returns a candidate URL plus a small retrieval strategy. Strategies include `get` for native Google Docs, Sheets, and Slides PDF exports, `head-then-get` for hosted share files, `metadata-probe` for unknown/direct HTTPS resources, and `none` for YouTube IDs. The Google export strategy declares its expected PDF MIME type and a useful failure reason.

`externalResourceNetwork.js` owns public URL validation, all-address DNS resolution, blocked hostname and IP checks, safe HTTP agents, request timeouts, redirect-by-redirect validation, bounded metadata reads, and response draining. Provider adapters do not create network agents or weaken these checks.

`externalResourceService.js` orchestrates retrieval and metadata caching, mints expiring target-bound proxy tokens for files, and streams only bounded file responses. It returns a source descriptor with `originalUrl`, `provider`, `sourceKind` (`file`, `web`, `youtube`, or `unavailable`), upstream title/filename/MIME metadata, a safe `previewUrl`, and an optional reason. Webpages are never proxied. The proxy validates every redirect and rejects HTML, invalid ranges, oversized bodies, and expired or invalid tokens.

The older `mediaType`, `previewType`, `canPreview`, and `requiresProxy` response properties remain temporarily for API compatibility. Client code ignores them; `sourceKind` and resolved file metadata are the runtime contract. Remove the compatibility fields after external consumers have migrated.

## Client responsibilities

`client/src/components/ContentPreview/contentPreview.ts` contains the sole preview renderer selector. It maps resolved source kind, actual MIME type, filename, provider, and media ID to `image`, `audio`, `video`, `pdf`, `docx`, `text`, `youtube`, `web`, or `unsupported`. MIME and filename metadata take precedence over a generic webpage classification. DOC, XLS, XLSX, PPT, and PPTX remain unsupported.

`ContentPreviewDialog` consumes the resulting descriptor and renders by its `renderer`. It owns bounded loading, slow-loading, and failure states. DOCX files render through `docx-preview`; PDF and webpage sources use an iframe, with webpages sandboxed.

Resources and Service Plans use `createChurchResourcePreview` for ChurchResource metadata. Signed source URLs are supplied by the owning caller while renderer selection remains shared. Song audio uses `createSongAudioPreview`. Service Plan persistence continues to store the existing resource reference and resource ID.

## Security invariants

- Only HTTP and HTTPS URLs without embedded credentials are accepted, on supported ports.
- DNS is resolved using `{ all: true, verbatim: true }`; all returned addresses must be public. The safe lookup callback provides the resolved address family to Node's HTTP agent.
- Every redirect target receives the same URL and DNS/IP validation as the initial source.
- Provider requests omit user credentials and cookies.
- Proxy tokens are signed, bound to the exact target, and expire.
- Proxy responses enforce byte, range, request-time, redirect-count, and rate limits. HTML and script responses are never proxied.
- The client renderer selector is the only source of truth for WorshipSync preview capability. Secure retrieval reports source facts and does not choose a UI renderer.
