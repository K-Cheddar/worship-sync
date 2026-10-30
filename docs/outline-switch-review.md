# Outline-switch workflow review

## Findings
- Critical: None.
- High, corrected: Unowned `hasPendingUpdate` flags let A's dirty content veto B's load. The shared arrays remained editable under B. Outgoing save detection recognized only `selectItemList`, missing scope and registry-driven reselection. The root reducer now retires content/binding atomically for every actual database/document transition; the existing field writers capture the outgoing snapshot and concrete database.
- Medium, corrected: Empty overlay initialization returned without resetting initial IDs, pending state, or initialization. It now fully initializes empty membership and retains history.
- Medium, corrected during adversarial review: Retained failed drafts require a retry on reopening, including when the other outline is also dirty. Exact successful acknowledgments must remove older retained snapshots, and Bible orphan cleanup must consider retained unsaved references. The existing save lanes are reused; no new retry or queue framework was added.
- Low: None outstanding.

## Product authorization status
Authorized by the current seven outline-switch requirements and `docs/features/controller-startup-and-saves.md`. Same-owner drafts survive refresh; a different concrete database or document starts a new loading boundary. Scope changes use the existing scope resolver. The same document remains the same draft owner if only its registry metadata changes. Undo cannot cross outline owners. Pending field saves continue; retired UI/publication is suppressed. No persisted schema, authorization, display composition, or IPC changes.

## Open questions / assumptions
None blocking. Retained drafts live for the controller session, consistent with existing Redux drafts; this is not a new persistent offline job system. Genuine write failures remain pending and are logged. Reopening a retained draft schedules its retry through the existing field listener.

## Verification gaps
Review scope: **workflow review** of outline selection, hydration, drafts, field persistence, and completion. **Entire outline-switch change set inspected**, including new files, consumers, sibling selection paths, and the actual committing helper. No truncated comparison is treated as complete. Concurrent TimerControls and SlideEditor edits are outside this change and were left untouched. This is not a production-readiness review of the whole branch.

Production-context verification: **Pass**. `Controller`, `AuxControllerBody`, and `OverlayControllerContent` call the shared lifecycle; `ActiveControllerProvider` dispatches scope changes; Outlines dispatches explicit selection, bootstrap, removal, and remote registry updates. The integration harness uses the real subscribed React/Redux hooks, root reducer, listeners, lifecycle, field persistence helper, and overlay-list parent. PouchDB methods are controlled asynchronous operations with revision conflicts. Provider context supplies the same concrete DB to the lifecycle and global listener boundary. Unrelated bootstrap/media/network work is controlled. The overlay editor visual is reduced to an accessible input but uses the actual `useOverlayDraft` hook and parent persistence callback; production editor disabled behavior was inspected. Existing bootstrap integration additionally mounts the actual ControllerInfoProvider.

| Invariant | Production entry / authoritative owner | Consumer and writer | Boundary / adversarial sequence | Executed evidence | Result |
| --- | --- | --- | --- | --- | --- |
| B never displays A's outline content | Selection reducers -> root owner boundary; concrete DB and document | Lifecycle -> itemList/overlays/binding; field listeners -> persistServiceListField | Hold A's item put, overlay put, or both -> select B -> edit B -> hold B -> finish A -> inspect both documents and B flags/publication | `outlineSwitch.integration.test.tsx`, parameterized “loads B while A's %s save is held...” cases; atomic subscription assertion in failed B-read case | Pass |
| Same owner retains local intent | Current content owner and pending field arrays | Lifecycle refresh and remote updater | Dirty B -> registry refresh and remote detail event; separately hold refresh read -> edit B -> return old response | “preserves B drafts during registry refresh and remote update”; “keeps B edits made while a same-outline refresh read is pending” | Pass |
| Empty means initialized empty | overlaysSlice, independent history | Outline loader -> initiateOverlayList | Dirty A -> B empty items, empty overlays, or both; initialize empty overlays directly from stale bookkeeping | Three empty-list integration cases; `overlaysSlice.test.ts` empty initialization/history case | Pass |
| Selection path does not change save ownership | Registry scope/selection resolver | Both store field listeners and concrete DB capture | Dirty A -> scope change or remote reselection -> hold A -> show B -> finish A | Two “flushes outgoing drafts on %s...” cases; all registry reducer suites inspected/executed | Pass |
| Stale reads cannot replace a new owner | Concrete DB key + transition generation + effect lifetime | Lifecycle and remote overlay hydration | A -> B -> A with held B read and A writes; A -> B -> A before React rerender with old A read; same-ID new DB then old read | Three rapid-return/read cases and same-ID delayed-read case; existing lifecycle remote overlay read cases | Pass |
| Late completion cannot acknowledge or publish another owner | Captured owner + exact saved array | Field helper -> acknowledge reducers -> broadcast | Hold original DB's same-ID writes -> activate another DB -> edit -> settle old writes; separately unmount after entered puts | Same-ID save/flags case; unmount case; existing `store.test.ts` superseded/DB-owner cases; helper conflict tests | Pass |
| Recovery preserves the latest draft and its references | Pending arrays in existing slices, exact acknowledgment | Reopen autosave; Bible cleanup canRun | Fail A items/order/both -> show B -> optionally edit B -> reopen A -> retry both original documents; hold older A -> edit returned A -> save -> revisit; failed outgoing Bible reference -> cleanup opportunity | Six parameterized retry cases; retained-older-draft case; `store.test.ts` success/failure Bible cleanup cases | Pass |
| Retired overlay editor is unavailable while its accepted draft completes correctly | Selected overlay owner and original editor DB | Overlays parent -> useOverlayDraft -> persistExistingOverlayDoc | Mount editor after selection switch; fail B load; change DB with same overlay ID; accept draft before DB switch and let debounce finish | Three UI ownership cases using real draft hook; existing overlay selection/draft suites | Pass |

Fail-before evidence: before production edits, the first 12 controlled integration cases produced **10 failures and 2 passes**. Failures showed A's rows under B, incomplete empty initialization, missed scope/remote outgoing saves, and same-ID DB confusion. The same cases pass after correction. Additional recovery tests exposed intermediate implementation gaps and were fixed before the final run; no existing expectation was weakened. The empty-overlay test was strengthened to enforce the requested initialization contract.

Final focused execution: **276 tests passed in 12 suites**, including **27 new outline-switch integration cases**. From `client/`:

```text
node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath
  src/pages/Controller/outlineSwitch.integration.test.tsx
  src/pages/Controller/useControllerPageLifecycle.test.tsx
  src/context/controllerBootstrap.integration.test.tsx
  src/store/itemListSlice.test.ts
  src/store/itemListsSlice.test.ts
  src/store/overlaysSlice.test.ts
  src/store/overlaySlice.test.ts
  src/store/store.test.ts
  src/utils/persistServiceListField.test.ts
  src/utils/overlayRemoteSync.test.ts
  src/containers/Overlays/Overlays.selection.test.tsx
  src/hooks/useOverlayDraft.test.tsx
```

All named tests were inspected and executed. Full client `npm.cmd run lint:check --prefix client` and focused ESLint on all eleven changed TypeScript source/test files passed. `npm.cmd run build --prefix client` passed, including PWA output; approved ancestor-directory access was required by esbuild. Existing bundle-size/fixture-URL warnings remain. `git diff --check` passed. `npm.cmd run type-check --prefix client` also passed.

Optional checks not run: real CouchDB/multi-device/browser/Electron smoke, Electron packaging, exhaustive client/server suites. No live deployment is claimed.

## Independent adversarial pass
Pass A derived ownership invariants before the patch's tests: a selection must never relabel another owner's editable arrays, old writes must finish on their own document, only exact persisted intent may be acknowledged, and loading/empty/failure cannot borrow dirty state from the previous owner. Pass B traced the concrete reducer/listener/read/put/acknowledgment/publication sequence against those invariants. It additionally challenged rapid return after failure, removal of retained snapshots after newer saves, orphan cleanup, and the selected overlay editor. Review re-opened the persisted-mutation and reliable-state guidance and applied React lifecycle/state-performance guidance. The constant-size owner check stays synchronous; ordinary debouncing and independent field concurrency remain intact.

`persistServiceListField.ts` was traced through its concrete-DB WeakMap, document/field lane, entered-put settlement, supersession checks, latest-revision read, and bounded 409 retry. It was intentionally left unchanged. Runtime-only ownership changes cannot trigger a registry write: the registry listener compares only fields actually persisted. Retiring content is not recorded as removal of Bible references from the new outline.

## Pattern / learning opportunities
Regression enforcement now crosses selection -> loaded content -> writer -> acknowledgment rather than inferring ownership from the current selection or an awaited helper. No new generic repository policy is needed.

## Final readiness
**Ready** for this workflow scope. All required implementation and verification are complete; no blocking finding or required follow-up remains.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; explicit selection, scope, initialization, registry fallback/removal, editor selection, and cleanup consumers.
- Legacy/persisted-state compatibility reviewed: Yes; runtime fields are optional and stored document shapes are unchanged.
- Identity-switch test reviewed or added: Yes; outline, scope, same-ID concrete DB, and batched A/B/A.
- Unmount/lifetime test reviewed or added: Yes; entered writes finish and retired publication is suppressed.
- Contract round trip traced: Yes; embedded items, overlay IDs, binding, and registry persisted fields remain compatible.
- Validate/use security boundary reviewed: Yes; loaded-result use and acknowledgment revalidate owner/generation/snapshot. Permissions are unchanged.
- Retry-state authority reviewed: Yes; retained latest pending arrays feed the existing save lanes.
- Owner-retirement handoff reviewed: Yes; durable work continues on its original DB while UI/publication retires.
- External side-effect adoption/compensation reviewed: Not applicable; no external resources are created or compensating deletes added.
- Authorization/data-projection reviewed: Not applicable to new projections; no permission-dependent API or serialized response changes.
- Production entry point, runtime context, and test composition compared: Yes, as described above.
