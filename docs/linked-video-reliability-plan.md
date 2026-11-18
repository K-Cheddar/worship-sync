# Linked video reliability implementation

## Goal
Preserve playable media through failed replacement, bind external saves to their chosen folder, and retire unreferenced cloud copies safely.

## Existing architecture
Electron owns trusted pickers, the local asset registry and download files. Media Library v2 owns shared item references. Transfer Activity owns long-lived retry actions. Existing download persistence reconciles uncertain writes and existing Mux cleanup checks persisted references before deletion.

## Before behavior
Relink overwrites the native reference before playback validation; failure can delete it. External save reads the latest folder preference. Changed content drops cloud metadata without cleanup. Unsupported hard links fall back to copying directly to a final MP4 name.

## After behavior
Validate a separate linked candidate without copying bytes or modifying the original. Persist a conditional field patch with a durable candidate-finalization checkpoint, then conditionally adopt the candidate under the original native asset ID. Reconcile uncertain outcomes and restore replacement-owned fields only when non-commit is confirmed. Retire the staged alias and old cloud asset only after authoritative reference checks. Bind an opaque native directory selection to each job. Display that selection locally. Publish only complete external files without replacing existing files.

## Product Decision Check
The current November 11 request authorizes all changes above and the labels Add files / Link local video. Applicable contract: desktop-video-downloader.md. Candidate validation uses a separate reference; native commit retains the original asset ID because saved service items and slide boxes embed it. Both the Media Library item ID and adopted asset ID remain stable. Paths remain device-local and are disclosed only to authorized controller windows for display.

## Behavior intentionally unchanged
Managed imports, linked source-file ownership, cloud permissions/quota, live display rendering, long-lived download manager, Activity retry/cancel/dismiss and download progress remain in place.

## Acceptance criteria
Failed validation/persistence preserves the original. Successful replacement preserves item identity and unrelated edits. Uncertain references prevent deletion. Cleanup can be retried. Folder changes affect future jobs only. Final filenames never contain an in-progress copy. Approved menu terminology and readable destination display are covered by tests.

## Proposed implementation
Extend existing native registry, IPC, conditional Media Library writer and reference-checked cleanup helpers. Keep recovery callbacks with Transfer Activity, capturing the original datastore and owner. Reduce redundant hashing only with identity and content checks retained.

## Affected surfaces
Media route and dialog, TransferProvider/DesktopVideoDownloadManager, Electron preload/authorized controller IPC, device-local registry/preferences, PouchDB v2 and existing church-scoped Mux deletion API. No display renderer changes.

## Risks / edge cases
Church changes, unmount, repeated actions, file replacement during validation, conflicts, lost write acknowledgements, shared cloud/local references, cleanup failure, cancellation during save, destination disconnection, unsupported hard links and large files.

## Questions requiring user input
None.

## Verification
Run modified native and renderer Jest suites plus related lifecycle/persistence/playback tests, renderer and Electron TypeScript checks, client lint, renderer and Electron builds. Measure external save with a large generated local file. Packaged Windows UI/live network checks depend on available runtime and network access; report any gap explicitly.
