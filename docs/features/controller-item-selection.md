# Presentation Controller item selection

Confirmed intent: user request, October 26, 2026.

## Purpose and operator workflow
Selecting an outline item activates its current cached document in Redux. The existing slide editor and slide grid render at `/controller` or `/aux-controller/:profileId`, keeping their instances across item switches.

## Product decisions
- Individual item URLs are no longer supported. Legacy item URLs redirect to their own workspace root without decoding or reconstructing selection.
- Cached mouse/touch, arrow-key and continuous-scroll selection is synchronous, performs no document reads, and never turns item loading on. Actual library/settings sections retain navigation.
- `_id` identifies the document; `listId` identifies its outline occurrence. Reselecting and switching occurrences preserve unsaved document content and unresolved conflicts.
- Shift, Ctrl/Cmd, long press and selection-only actions do not activate an item. Library Add and read-only View details retain their established behavior. Explicit item creation/open actions select the actual occurrence in Redux.
- Initial entry restores only an established occurrence after outline/cache initialization. Missing or temporarily unavailable selection does not choose a replacement. Church resets and auxiliary controller scopes retain isolation.
- The Current Service Workspace Displays preview follows the church-wide active Presentation outline. If that outline is missing or invalid, it falls back to the persisted Presentation selection and then another Presentation outline. Aux previews follow their own persisted selection and never borrow a Presentation outline. The read-only preview refreshes after initial remote replication completes.
- Standard mutation-owner middleware, autosave revisions/conflicts and undo policy remain authoritative. Cached selection never replaces the cache with outline snapshots.
- Media preparation follows the active Redux document, including local video input, without changing display transmission or introducing media caches.
- Thumbnail rendering and virtualization are outside this change.

Approval source for these decisions: the October 26, 2026 request to remove item routing and make presentation selection instant. Adjacent contracts: [content viewing](controller-content-viewing.md), [song conflicts](song-audio-conflicts.md), [countdowns](service-countdowns.md).

The Current Service Workspace preview behavior above is confirmed by the November 2, 2026 request to follow the active Presentation outline while preserving independent Aux selections.

## Verification references
`Controller.workspace.test.tsx` composes real Controller, outline rows, Redux store and workspace routes, mocking output/preview renderers and unrelated sections. `Item.test.tsx` covers cache activation, initialization and stale reads. Continuous scrolling, toolbar/media, creation and auxiliary route tests cover affected callers. `store.test.ts` exercises owned pending writes and cache-first rapid switching.
