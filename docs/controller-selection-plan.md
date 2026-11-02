# Controller selection implementation plan

## Goal
Activate cached items immediately in Redux at each controller workspace root.

## Existing architecture
Item route effects load documents; continuous scrolling already activates Redux before navigating. setActiveItem passes through owner middleware which flushes deferred editors and restores pending autosaves. Persistence captures original database, document and baseline.

## Before behavior
Item URLs control activation, tool visibility, shortcuts and media context. Root shows no selection regardless of active Redux content.

## After behavior
Item renders at the workspace root across selections. Cache hits dispatch synchronously, with fallback reads only for misses. Actual sections remain navigable. Legacy URLs redirect without decoding their IDs.

## Product Decision Check
Authorized by the October 26, 2026 user request. Adjacent confirmed contracts: controller-content-viewing, song-audio-conflicts, service-countdowns. Library Add and read-only viewers keep existing selection-only behavior. No unresolved product choices.

## Behavior intentionally unchanged
Output transmission/renderers, thumbnails, arrangement preparation, timers, conflicts, undo policy, owner-aware persistence and church/controller scope.

## Acceptance criteria
Cached activation performs zero reads, no loading=true and no workspace navigation. Editor/grid remain mounted across switches. Occurrence IDs, multi-selection, keyboard and continuous navigation work. Pending edits retain their owner. Initialization restores only established selection. Media and tools follow Redux.

## Proposed implementation
Shared cache-first selection thunk through standard setActiveItem; Item becomes a Redux workspace view; a small session initializer captures only the established occurrence before cache readiness, isolated below the controller shell. Workspace predicate replaces item-route checks. Canva deferred View carries a local selection action.

## Affected surfaces
App controller entry routes and ControllerInfo/GlobalInfo/ActiveController providers; Redux and Pouch ownership; outline and continuous rail; item creation, Bible and Canva; toolbar/media. API, Electron IPC and output transmission unchanged. Tests use real store/provider compositions with expensive child renderers mocked.

## Risks / edge cases
Rapid A/B/A, repeated occurrences, delayed reads across sessions, initialization ordering, modifier selection, long press and deferred View after route unmount.

## Questions requiring user input
None.

## Verification
Focused selection, workspace, outline, keyboard, continuous scroll, autosave, creation, media, toolbar and auxiliary tests; TypeScript, lint and strict production build. Full diff/caller review. Do not claim thumbnail timing without profiling.
