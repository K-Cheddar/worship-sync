# Media folder deletion

## Purpose

Let a controller operator remove a Media folder and choose whether to remove its
contents or move those contents to the folder's parent. Folder deletions remain
visible in the existing Activity panel while they run.

## Confirmed product intent

The October 30, 2026 owner request, **“WorshipSync — Improve Folder Deletion
Queue and Cancellation,”** confirms these behaviors:

- Operators can submit more than one folder deletion without waiting for an
  earlier job. Accepted jobs run one at a time in request order.
- Activity tracks each accepted job. Closing or minimizing Activity does not
  stop or discard the work.
- A queued job can be cancelled before it starts. An active job can be cancelled
  only at a checkpoint where remaining work can stop without leaving media,
  folder, or reference data inconsistent. Cancellation never restores work
  already committed.
- A repeated request for the same folder is rejected with feedback. A
  parent/child request for distinct folders is accepted into the same FIFO
  queue; each job re-reads current library state when it starts so an earlier
  job can remove or rehome part of the later job's target safely.
- **Delete folder and contents** removes media in the folder tree, cleans up
  saved references and provider copies, and removes the folder tree.
- **Delete folder but keep contents** removes the selected folder and moves its
  direct media and child folders to the selected folder's parent.
- Failed work does not stop later queued jobs. Existing retry and cleanup
  recovery remains available in Activity.
- Accepting a deletion closes its confirmation dialog, but does not navigate
  away immediately. After deletion and folder persistence succeed, Media returns
  to the parent only if the operator is still viewing the deleted folder.
  Failed or cancelled work leaves the operator on the current route.
- Cancelling a queued retry restores the original partial or failed Activity
  status, progress, errors, and recovery actions, with a note that the retry did
  not start.
- Duplicate requests are identified by folder ID within the originating church
  and PouchDB database. The same folder ID in a different scope can be queued.

## Persistence and cancellation boundary

The authoritative per-item media document is read before deletion and its exact
revision is tombstoned before provider cleanup. Reference sweeps have rollback
support for conflicts and failures. Keep Contents updates saved route folders
and the shared library document through the existing media-library flush path.
Saved route repair must succeed before the folder is removed; a failed repair
leaves any completed repairs in place for a safe retry. Failed folder deletion
can be retried from Activity after navigating away within the same session.
Retries do not resume after logout or a church-session change.

Cancellation is honored for queued work and for active subtree deletion while
the job is still stopping uploads, before it starts the reference sweep for the
first media item. Once that sweep is about to begin, cancellation becomes
unavailable and the current job finishes its database and cloud-cleanup steps.
Keep Contents becomes non-cancellable immediately before its first saved-route
or media-library write. This boundary favors consistency over stopping work
mid-mutation.

## Shared controllers

The sequential queue belongs to one controller's Activity provider. Its folder
deduplication is scoped to the originating church and database. Other
controllers may submit work independently. Per-item revision checks ensure a
controller that finds an item already removed does not delete its provider copy
again; Cloudinary cleanup treats an already-missing asset as success and the
storage ledger removes ownership idempotently. Folder and library writes use
the existing PouchDB revision-aware merge paths.

## Implementation references

- `client/src/context/transferContext.tsx`
- `client/src/containers/Media/useMediaLibraryController.tsx`
- `client/src/containers/Media/MediaLibraryFolderModals.tsx`
- `client/src/utils/mediaOperationClaims.ts`
- `client/src/utils/mediaReferenceSweep.ts`
- `client/src/utils/flushMediaLibraryDoc.ts`
- `server/providerStorageService.js`
