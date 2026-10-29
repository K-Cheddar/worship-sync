# Feature Contract: Desktop video downloader

**Contract status:** Phase 1 implemented; Windows x64 package and live native download verified.

**Approval source:** Phase 1 Desktop Video Downloader request, October 29, 2026.

**Last reviewed:** October 29, 2026.

## Purpose and operator workflow

An operator can add an authorized online video to the Media Library from the
Electron app, with an optional cloud upload for other controllers. The download
and any necessary stream merge run on the operator's computer.

## Expected behavior

- The desktop Add Media menu offers Download Video. The browser does not.
- A URL is inspected before download. The dialog shows title, thumbnail,
  duration, editable media name and available video resolutions. It defaults
  to 1080p when available, and offers lower resolutions and best available
  only when those selections can be fulfilled.
- The default destination is this computer; an optional cloud destination
  uses the existing upload, permission and quota workflows. Closing the dialog
  after starting does not stop the job.
- Existing transfer activity shows the job, its stage and measurable progress,
  with cancellation, retry after failure and an action to view the result.
  Completion follows all required import and upload operations.
- A successful download becomes a permanent local Media Library video, with
  its name and duration preserved. Retry must not duplicate a completed record.
  Incomplete or cancelled downloads must not appear as finished media items.

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
  thumbnail. `client/electron/localAssetStore.ts` copies and hashes native
  files into permanent managed storage.
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

Completed files go through `LocalAssetStore.importFile`, then the existing
local video metadata and thumbnail store. Optional cloud storage reuses the
existing Mux upload-intent, quota, permission and registration workflow while
streaming the managed download file from disk. Jobs use the existing media
transfer activity and taskbar aggregation.

Windows x64 development and packaging prepare yt-dlp 2026.10.26 and FFmpeg
8.1.2 Essentials from pinned URLs and SHA-256 values in
`client/scripts/prepare-video-tools.mjs`. Preparation occurs at Electron dev
startup and before packaging, never when an operator starts a download. The
downloaded archives are verified before extraction. License files and notices
are included beside the binaries. yt-dlp's Windows standalone build carries
GPLv3+ bundled code; the selected static FFmpeg build is GPLv3. Release owners
must keep the matching source/build materials available as required by those
licenses. Update a tool by reviewing a new upstream release, checksum, source
and license set, then changing the pins in the preparation script.

The browser and unsupported desktop platforms hide the option. Phase 1 is
currently limited to public YouTube URLs and Windows x64; macOS and Linux
packaging remain unchanged and do not expose the downloader.

## Validation recorded October 29, 2026

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
