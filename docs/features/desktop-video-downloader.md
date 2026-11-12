# Feature Contract: Desktop video downloader

**Contract status:** Confirmed expanded workflow implemented and packaged for Windows x64; live YouTube and first-run app verification remain unverified in this environment.

**Approval source:** Desktop Video Downloader request, October 29, 2026; linked local videos, external download storage and progress request, November 5, 2026.

**Last reviewed:** November 11, 2026.

## Purpose and operator workflow

An operator can add an authorized online video to the Media Library from the
Electron app, choose whether it stays in WorshipSync-managed storage or is
saved and linked from another folder, and independently choose whether to
upload a cloud copy. Operators can also link existing local videos without
copying them. Downloads and any necessary stream merge run on the operator's
computer.

## Expected behavior

- The desktop Add Media menu offers Download Video. The browser does not.
- A URL is inspected before download. The dialog shows title, thumbnail,
  duration, editable media name and available video resolutions. It defaults
  to 1080p when available, and offers lower resolutions and best available
  only when those selections can be fulfilled.
- “Save outside WorshipSync” and “Upload to WorshipSync cloud” are independent,
  initially-off checkboxes. With neither selected the video uses managed local
  storage; external saving links the destination file instead of creating a
  managed copy; cloud upload preserves the selected local mode. Both options
  can be selected together. Cloud upload keeps the existing permission,
  authentication and quota checks. Closing the dialog after starting does not
  stop the job.
- These two selections and the last external folder are remembered on this
  computer. If that folder is no longer available, the operator can choose a
  replacement without losing the other selections. Preferences are not shared
  through church data.
- Existing transfer activity shows the job, its stage and measurable progress,
  with cancellation, retry after failure and an action to view the result.
  Completion follows all required import and upload operations.
- A successful download becomes a permanent local Media Library video, with
  its name and duration preserved. An external save is finalized and linked
  before it appears as a completed item. Retry must not duplicate a completed
  file or record. Incomplete or cancelled downloads must not appear as finished
  media items.
- Existing local-video imports offer “Add files” and
  “Link local video”. A linked item keeps its Media Library identity, metadata and
  thumbnail when its file is unavailable, offers “Relink file”, and may use a
  valid cloud copy for playback. Relinking updates the existing item; a changed
  file invalidates stale cloud playback metadata and thumbnails.
- Deleting a linked item removes only WorshipSync's local reference and
  application-owned metadata. It never deletes or changes the external file.

## Behavioral boundaries

- Phase 1 downloads one video, including audio, to a browser-compatible MP4.
  Prefer H.264/AAC and use FFmpeg for merging or remuxing where needed. Explain
  when a suitable MP4 cannot be made without transcoding; do not transcode.
- Do not download playlists, extract audio, bypass DRM or protected content,
  or extract authenticated cookies. Preserve the existing song MP3 workflow.
- Downloads must not use the server or the temporary playback media cache.
  Existing media, uploads, presentation behavior and menu options stay intact.
- Reject unsafe URLs and prevent requests to local or private networks,
  including redirects. Bound resource use, secure IPC and subprocess inputs,
  and clean up partial files on failure or cancellation.

## Implementation references and current observations

- `client/src/containers/Media/MediaSourceAddMenu.tsx` owns the Add Media menu.
- `client/src/containers/Media/MediaUploadInput.tsx` owns the existing upload
  batch, Media Library callbacks, Mux upload, cancellation and retry cleanup.
- `client/src/containers/Media/localMediaImport.ts` creates local media records;
  `client/src/utils/localVideoFileAssets.ts` stores their local metadata and
  thumbnail. `client/electron/localAssetStore.ts` stores either a managed copy
  or a device-local linked-file reference. Absolute paths and file identities
  stay in the native asset index.
- `client/src/context/transferContext.tsx` and `transferModel.ts` provide
  shared activity and actions. The upload input currently publishes the media
  aggregate to the existing Electron taskbar progress API.
- `client/electron/mediaCache.ts` is a separate, temporary playback cache.
  Its HTTP client cannot automatically constrain requests made by a yt-dlp or
  FFmpeg subprocess.
- `client/electron-builder.config.js` runs the pinned Windows tool preparation
  hook before packaging; `extraResources` keeps the binaries outside ASAR.

## Technical design notes

## Phase 1 implementation

The Electron main process owns yt-dlp, FFmpeg, job files, metadata inspection,
progress and cancellation. Phase 1 accepts one public YouTube video URL. A
per-job loopback proxy allows only YouTube, Google video and thumbnail hosts;
it validates every request and pins DNS to a public address for each HTTP
request or TLS tunnel. The URL validator is an additional input boundary, not
the subprocess network boundary.

The quality list includes only compatible H.264 MP4 and AAC/M4A streams. The
download selector prefers these streams, uses FFmpeg for stream merging or
remuxing, and checks the finished file with ffprobe. It reports a clear error
if the file is not H.264/AAC MP4; it does not transcode.

Completed files use `LocalAssetStore.importFile` in managed mode. External
finalization verifies the completed MP4, safely creates a user-owned file in
the selected folder, then registers it as linked; a failed Media Library write
leaves the external file intact for retry. Optional cloud storage reuses the
existing Mux upload-intent, quota, permission and registration workflow while
streaming the validated local asset from disk. Jobs use the existing media
transfer activity and taskbar aggregation.

Linked playback resolves through the existing `worshipsync-media:` protocol.
The main process validates a registered asset and opens a file handle before
serving ranges, so renderer requests cannot select arbitrary filesystem paths.
Managed deletion keeps its existing reference-aware cleanup; linked deletion
removes only the device-local registration. Linked file hashes and filesystem
identity checks detect changed, replaced, missing and disconnected files.
Relinking uses the native file picker and retains the stable Media Library
item ID. A separate native linked reference stages replacement validation; the
original remains registered during validation. A durable library checkpoint
precedes native adoption under the original asset ID, preserving saved service
and slide playback references. Retry completes that checkpoint before cleanup.
Both local modes use the existing thumbnail and playback surfaces.
Linked cloud uploads require the captured library document and native content
hash to agree before uploading. Relink and download cloud registration share
the existing media-operation claim. A cloud-registration retry cannot recreate
a local item that was deleted after its initial import.

Download progress includes bytes, speed and ETA where yt-dlp provides reliable
values. Separate audio/video streams are shown separately with an indeterminate
overall bar when a combined percentage would jump backward. Cloud upload of a
linked video streams from its native file handle rather than loading the full
video into renderer memory.

Windows x64 development and packaging prepare yt-dlp 2026.10.26, Deno 2.9.8,
and FFmpeg 8.1.2 Essentials from pinned URLs and SHA-256 values in
`client/scripts/prepare-video-tools.mjs`. Preparation occurs at Electron dev
startup and before packaging, never when an operator starts a download. The
downloaded archives are verified before extraction. yt-dlp is explicitly
configured to use the packaged Deno runtime for YouTube JavaScript challenge
solving; its standalone package includes yt-dlp-ejs. License files and notices
are included beside the binaries. yt-dlp's Windows standalone build carries
GPLv3+ bundled code; the selected static FFmpeg build is GPLv3. Release owners
must keep the matching source/build materials available as required by those
licenses. Update a tool by reviewing a new upstream release, checksum, source
and license set, then changing the pins in the preparation script.

The browser and unsupported desktop platforms hide the option. Phase 1 is
currently limited to public YouTube URLs and Windows x64; macOS and Linux
packaging remain unchanged and do not expose the downloader.

Inspection accepts YouTube watch, short, Shorts, live, and embed links that
identify one valid video ID. It replaces them with the canonical
`https://www.youtube.com/watch?v=...` URL, dropping playlist and tracking
parameters before storing the inspection and starting or retrying the job.
Playlist-only URLs are rejected. Inspection failures are categorized by stage
and type; native diagnostics are bounded and redact URLs, video IDs, secret
fields, and common user-profile paths before application logging.

The inspected source thumbnail is validated and passed through the existing
local video import path. It is resized and encoded by the shared thumbnail
helper and saved in the existing `imageThumbnails` IndexedDB store using the
permanent video asset ID. Downloaded-video thumbnail work runs in the existing
serialized video-thumbnail queue after the video record is saved, so it cannot
hold up import. If the source thumbnail is absent or invalid, the queue uses
the existing representative video-frame capture. A thumbnail failure leaves
the imported video usable. The queued thumbnail write shares an IndexedDB
transaction with a check for the owning video record, so a delete that wins
the race cannot leave a late same-ID thumbnail behind. Deleting the video
continues to delete its same-ID thumbnail record.

## Previous baseline validation recorded October 29, 2026

- `npm run type-check`, a strict standalone Electron TypeScript check, ESLint,
  and 10 focused Jest suites (82 tests) passed.
- `electron-vite build` succeeded. `electron-builder --win --config
  electron-builder.config.js --publish never` produced a Windows x64 NSIS
  installer and an unpacked app. The unpacked resources contained yt-dlp,
  FFmpeg, ffprobe and their license notices outside ASAR.
- The native service inspected, downloaded, merged separate H.264/AAC streams
  for Blender Foundation's CC-BY-3.0 Sintel open movie, validated the MP4 with
  ffprobe, and imported it into a temporary permanent-asset store. The sample
  source and license are documented at [Sintel's official sharing page](https://durian.blender.org/sharing/).
- The packaged app was built and its resource layout checked; its first-run
  UI and the optional cloud upload were not exercised.

## Reliability update validation recorded November 4, 2026

- Focused downloader, URL-security, native dependency, error, import,
  thumbnail, dialog, manager, IPC, proxy, and cloud-share tests passed (13
  suites, 98 tests).
- Client TypeScript, ESLint, and `electron-vite build` passed after the final
  reliability changes. The renderer build reports the existing CSS parser
  warning for the test-only `bg-[url(javascript:alert(1))]` utility class.
- Native diagnostics for the clean `S9EUEdnJQDA` URL and `hujbT5BXyrl` both
  stopped at the initial YouTube API-page request with `RemoteDisconnected`
  after retries. Neither reached metadata extraction or the JavaScript
  challenge step. The diagnostic environment reported no JavaScript runtime,
  confirming a compatibility gap but not proving that it caused either
  video's observed failure or explaining a difference between them.
- Windows packaging was attempted through `electron:build:win`, but pinned
  tool preparation stopped with `fetch failed` before Electron Builder ran.
  The Deno-enabled Windows resource layout and live YouTube downloads remain
  unverified in this environment.

## Linked-video and storage workflow validation recorded November 5, 2026

- Managed/linked asset storage, secure file-handle streaming, external-file
  finalization and retry, preference persistence, native IPC authorization,
  linked cloud upload, renderer metadata, downloader choices, local availability,
  progress parsing, Media, DisplayBox, DisplayEditor, MonitorDisplayBox and HLS
  playback passed 24 Jest suites (306 tests).
- Client TypeScript, ESLint, renderer build and `electron-vite build` passed.
  Builds retain the existing CSS parser warning for the test-only
  `bg-[url(javascript:alert(1))]` class; the renderer build also reports its
  existing large-chunk warning.
- A Windows x64 NSIS installer and unpacked app were produced in a temporary
  verification output folder and inspected. The regular combined
  `electron:build:win` command hit an esbuild access error during its renderer
  rebuild; the separate Electron build passed, then Electron Builder completed
  using the installed Electron runtime as a local distribution after the
  default directory rename was denied. Generated package output was removed
  after verification. The package contained yt-dlp, Deno, FFmpeg, ffprobe and
  their notices outside ASAR. All four packaged tools launched and reported
  their pinned versions. Packaged FFmpeg and ffprobe encoded and inspected a
  local H.264/AAC MP4 smoke fixture.
- The new workflow's first-run UI, cloud upload against Mux and live public
  YouTube downloads were not exercised in the packaged app. The prior live
  YouTube diagnostics stopped at the initial source request with
  `RemoteDisconnected`; that external-network failure does not establish a
  downloader code failure.

## Linked-video reliability guarantees (November 11, 2026)

- Failed replacement validation preserves the original registry entry, library
  item, cloud copy and thumbnail. Conditional item writes preserve unrelated
  edits and reconcile uncertain acknowledgments before cleanup.
- Replaced references are retired only after authoritative persisted reference
  checks. Cleanup checkpoints are saved with the replacement and expose Retry
  cleanup in Activity, including after reopening Media Library.
- Each external job binds an opaque native directory selection when it starts;
  retry retains that folder. A disconnected destination requires restoring the
  original folder and retrying; it never falls back to a newer default.
- The dialog displays the device-local folder, with a compact expandable full
  path and an unavailable state. Only authorized controller IPC can read it;
  paths never enter shared church data.
- Final MP4 publication must be atomic and must not overwrite existing files,
  including on filesystems without hard-link support.
