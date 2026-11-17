# Outline conflict safety and session isolation

## Goal
Preserve compatible edits while reviewing competing outline revisions, and keep unsaved drafts within their authorized account session.

## Existing architecture
PouchDB owns saved outlines. `persistServiceListField` reads revision graphs only when conflicts exist, merges against a common ancestor, validates the graph and retires reviewed leaves after a write. `outlineSync` reconciles occurrence fields and order. Redux retains unresolved drafts by database through Controller teardown. The existing outline-list registry review supplies the comparable per-conflict choice UI.

## Before behavior
An item conflict replaces the partial branch merge with the winner's entire list. Whole-version buttons do not preview discarded rows. Full RESET saves and immediately rehydrates the draft map; old async outline completions only check database identity.

## After behavior
Reliable two-branch reviews offer choices for conflicting row fields, deletions and order, preserving independent changes. Unreliable reconciliation requires a whole-version preview showing discarded/replaced rows. Reviewed graphs and saved content are checked before branch retirement. Full RESET clears retained conflicts, pending choices and undo history, and invalidates late outline completions.

## Product Decision Check
The current request explicitly authorizes row-level preservation/review, explicit whole-version fallback and full-reset isolation. `docs/features/item-document-storage.md` confirms independent outline ownership and stale-session protection. These decisions are recorded there. No unresolved product choice is required.

## Behavior intentionally unchanged
Compatible automatic merges, Controller navigation/profile draft retention, same-session database recreation, load/retry/registry recovery, read-only behavior and the ordinary one-read save path. No display output, Song v2, service-plan or media changes.

## Acceptance criteria
Independent insertions/edits/removals survive either row-conflict choice; delete/edit and reorder conflicts require explicit decisions; preview and committed rows agree; stale/new graphs never retire unreviewed leaves; metadata survives safe merges. RESET cannot rehydrate or undo another session's drafts, while persisted conflict branches remain reviewable.

## Proposed implementation
Extend the existing reconciler with optional explicit row-field/order choices and conflict descriptions. Attach common-ancestor review inputs only when branch identity and document fields are reliable. Reuse shared Button controls in an inline, scrollable review with exact resulting outline. Clear the module map before full reduction and guard outline async work with a full-reset generation.

## Affected surfaces
Controller `ServiceItems` -> Redux/listener -> local PouchDB -> replication. The actual Controller lifecycle supplies revision errors through `recordOutlineConflict`; GlobalInfo supplies write access. Browser/Electron share this code. Tests use the real reducer/listeners, isolated IndexedDB PouchDB replicas and faithful Controller/GlobalInfo contexts; unrelated media/display children may be mocked.

## Risks / edge cases
Missing/compacted ancestor bodies, more than two branches, ambiguous replacements, non-item field conflicts, edits during review, new revisions before/after put, partial retirement, same database across logout, delayed failures and undo/redo after RESET.

## Questions requiring user input
None.

## Verification
Focused reconciler, field persistence, real replication, reducer/store and ServiceItems review tests; affected lifecycle, registry and controller regression suites; client TypeScript, strict lint and production build. Add controlled stale-graph and reset races, preserve actual disconnected edit conditions, and inspect normal-path request counts. Final workflow review records evidence below.

## Final workflow review

### Findings
Critical: None. High: None. Medium: None. Low: None remaining in the reviewed scope.

During implementation, review found and corrected two related races: newer edits after a reviewed selection needed a separate ordinary autosave, and a selection rendered against an older graph needed its own graph binding at Redux dispatch. A failed selection also keeps the actual editable draft until acknowledgment; the pending preview is stored separately.

### Product authorization status
Authorized by the October 28, 2026 request: preserve independent edits with either conflicting-field choice, require explicit delete/edit and reorder decisions, show whole-version consequences when reconciliation is unreliable, verify graph/content before retirement, and clear locally retained drafts/decisions on full RESET. The affected item-storage contract records these decisions. Persisted document shapes, authorization, server APIs and presentation-output behavior are unchanged.

### Open questions / assumptions
None requiring a product decision. Row review is deliberately limited to two saved branches with readable common history, stable identities and compatible outline details, with a draft that can be rebased reliably. Additional conflicting branches, missing history, ambiguous replacements, competing document details or an additional conflicting unsaved draft use the explicitly authorized whole-version preview. A missing leaf body blocks saving rather than silently accounting for unseen content.

### Verification gaps
Required gaps: None. Production-context verification: **Pass for this workflow review**. Inspected the Controller lifecycle's load/event -> revision inspection -> `recordOutlineConflict` path, `ServiceItems`' GlobalInfo access guard and Redux action, the actual store listener/reducer, captured database ownership and GlobalInfo's human sign-in/logout/guest RESET entry points. The ServiceItems integration test keeps the real review control and uses the production ControllerInfo/GlobalInfo context shape, including full GlobalInfo access with ControllerInfo view access; the real store tests cover selection/debounce/acknowledgment and reset transitions. PouchDB tests use isolated actual IndexedDB replicas. No live church data or credentials were used.

| Invariant | Controlled scenario | Code evidence | Executed test evidence | Result |
| --- | --- | --- | --- | --- |
| Compatible content survives either choice | Disconnected A/B change Welcome differently; B adds Closing and a background; A edits Scripture and removes Prayer; replicate, choose either Welcome | `reconcileOutlineItems`, `outlineRevisionItemReview`, `resolveServiceListRevisionConflict` | `outlineConflictSafety.pouch.test.ts`: both operator choices, metadata/overlays/bindings, replicated final content | Pass |
| Preview and decision remain bound | Change draft or graph after rendering; deliver original action; independently reject a result missing Closing or incomplete field choices | `resolveOutlineConflict` snapshot checks and commit recomputation | `itemListSlice.test.ts`: stale draft/graph cases; Pouch safety test: incomplete choices/dropped row | Pass |
| Branches retire only after verified content | Third replica arrives before commit or after put; a put stores a body different from the preview; one reviewed body is missing | `sameRevisionGraph`, `retireReviewedBranches` body/history checks | Pouch safety tests: validation/commit race, wrong acknowledged body, post-put branch, unavailable reviewed version | Pass |
| New work and failed choices retain drafts | Edit during debounce or held put acknowledgment; then complete reviewed write and ordinary autosave; separately fail a selected choice | Pending `items`/`draftItems`, `markItemListPersisted`, explicit follow-up autosave | `store.test.ts`: debounce/write interleavings; `itemListSlice.test.ts`: editable draft survives failed save; review UI pending preview | Pass |
| Account RESET cannot restore private drafts | Cache two databases and pending decisions; RESET; reopen same handles; undo/redo; settle old read/write after sign-in | Clear map before reduction/rehydration; reset generation; captured database | `store.test.ts`: full account reset, church isolation, late same-handle read/write; Pouch safety: session ending after put | Pass |
| Navigation retains authorized work | Leave/reopen Controller, switch profiles, recreate named handle; acknowledge an earlier save after teardown | Existing database-key cache and soft reset; retained conflict acknowledgment | Existing and updated `store.test.ts` navigation/profile/recreated-handle/late acknowledgment cases | Pass |
| Operator sees consequences and viewers cannot write | Choose each row field, deletion, reorder or whole version; inspect result and discarded rows; render as view-only | Inline `OutlineRevisionReview`, shared Buttons, GlobalInfo access check | `OutlineRevisionReview.test.tsx` and `ServiceItems.test.tsx` interaction tests | Pass |

Executed final client tests: **315 passed across 16 suites**:

- `src/utils/outlineSync.test.ts`
- `src/utils/persistServiceListField.test.ts`
- `src/utils/outlineCrossDeviceSync.pouch.test.ts`
- `src/utils/outlineConflictSafety.pouch.test.ts`
- `src/utils/registryRecovery.pouch.test.ts`
- `src/utils/persistItemListsRegistry.test.ts`
- `src/utils/itemListsRegistryQueue.test.ts`
- `src/store/itemListSlice.test.ts`
- `src/store/store.test.ts`
- `src/store/itemListsSlice.test.ts`
- `src/containers/ServiceItems/ServiceItems.test.tsx`
- `src/containers/ServiceItems/OutlineRevisionReview.test.tsx`
- `src/pages/Controller/useControllerPageLifecycle.test.tsx`
- `src/containers/Toolbar/ToolbarElements/Outlines.test.tsx`
- `src/containers/Toolbar/ToolbarElements/Outlines.recovery.test.tsx`
- `src/context/controllerInfo.test.tsx`

Invocation: `npm.cmd test --prefix client -- --runInBand --runTestsByPath` followed by the paths above. Logs: `../outline-conflict-regression-final.log`.

Also passed: `npm.cmd run type-check --prefix client`, `npm.cmd run lint:check --prefix client`, `npm.cmd run build --prefix client`, and `git diff --check`. The build required sandbox escalation for esbuild parent-directory access; Sentry uploads were disabled. Production assets and the PWA service worker built successfully, with existing bundle-size/dynamic-import warnings and an existing unresolved fixture URL warning. Logs: `../outline-conflict-types-final.log`, `../outline-conflict-lint-final.log`, `../outline-conflict-build-final.log`.

Performance: existing tests still assert one read/one write for ordinary baseline-aware saves and the existing cross-device read counts. Normal loads still request leaf metadata only. Common-ancestor reads and extra graph/content validation occur only for detected conflicts. Review derivation and local choice updates live inside the conflict-only UI; no new subscriptions, polling, storage or normal-save writes were added. Later edits require a separate save only when they arrive after an explicit reviewed selection.

Optional confidence checks not run: full repository suites/CI and live authenticated browser/Electron manual testing. This is a focused workflow review, not a claim of branch-wide production readiness.

### Simplicity / scope reassessment
The data-loss root cause was the explicit replacement of a partial merge with the winner's full items array. Removed that fallback and extended the existing reconciler rather than adding a generic merge framework. The change exceeds the localized-fix line-count warning because the request also requires an operator review/preview, explicit fallback consequences, stale-selection validation and session isolation. The inline UI reuses the registry's shared Button pattern; the only added state is transient choices and existing pending-resolution snapshots. No new manager, persistent draft system, migration, server behavior or presentation-output code was introduced.

### Pattern / learning opportunities
Existing mutation-safety and stateful-review skills already cover these invariants. Added focused regression coverage and an authorized contract update; no new repository-wide policy is needed.

### Final readiness
**Ready** for the stated workflow-review scope.

- **Cross-boundary review performed:** Yes.
- **Sibling-pattern search performed:** Yes; ordinary outline save, overlay-order writer, registry review, Controller load/events and auth RESET entry points.
- **Legacy/persisted-state compatibility reviewed:** Yes; no persisted shape change; unavailable history uses explicit fallback.
- **Identity-switch test reviewed or added:** Yes; same outline ID across databases and accounts, same-handle late completions.
- **Unmount/lifetime test reviewed or added:** Yes; Controller teardown/reopening and late acknowledgment.
- **Contract round trip traced:** Yes; reviewed inputs/choices -> pending snapshot -> validated saved body -> acknowledgment/replication.
- **Validate/use security boundary reviewed:** Yes; reviewed graph, row result and session are checked before writes/retirement; server authorization is unchanged.
- **Retry-state authority reviewed:** Yes; original editable draft survives failure, stale reviews must be refreshed, committed content remains durable when retirement is interrupted.
- **Owner-retirement handoff reviewed:** Yes; store retains soft-navigation work; full RESET invalidates it.
- **External side-effect adoption/compensation reviewed:** Not applicable; no provider assets or external jobs are created/deleted.
- **Authorization/data-projection reviewed:** Yes; no new reader projection; existing GlobalInfo view-only guard excludes all write controls.
- **Production entry point, runtime context, and test composition compared:** Yes, as detailed above.

Known required follow-ups: None.
