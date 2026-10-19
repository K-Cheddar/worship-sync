# Unified scheduling workspace: Phase 1

## Goal

Establish an independently testable workspace read model and extract stable period logic while retaining the existing editor. Authorization: product-owner request, 2026-10-19.

## Existing architecture

`TeamsSchedulesPage` supplies authorized page data, timezone, selected schedule and draft callbacks to `ScheduleTab`. `useTeamsPageState` owns bootstrap summaries, detail hydration and local draft persistence. `teamSchedulePeriod` owns Team requirements and occurrence generation; shared occurrence utilities own identity and compatibility matching. `schedulePeriodUtils` owns persisted schedule matching. `useRangeSelection` owns transient range selection.

## Before behavior

`ScheduleTab` derives Upcoming, maintains explicit range selection, generates Team occurrences and selects one saved document or virtual period for editing. The overlap picker offers alternate documents. Assignment and equipment writes target that selected document.

## After behavior

The same live path delegates period derivation to `useScheduleWorkspacePeriod`. `resolveScheduleWorkspace` provides a separate, pure projection for future integration. It does not replace the grid's source, fetch data, persist documents or combine assignment maps.

## Product Decision Check

Applicable contract: [Team Scheduling](features/team-scheduling.md). The current request authorizes the read-only model, extraction, preservation of saved keys/overrides and explicit ambiguity. It explicitly defers owner-aware mutations and grid integration. No product behavior changes are introduced; no new permissions, notification, publication, migration or index behavior.

## Behavior intentionally unchanged

Upcoming follows loaded data until an explicit selection; changing Team resets Upcoming. Preset, custom and previous/next navigation remain immediate. Saved-document browsing, overlap selection, drafts, existing reconciliation, assignment/equipment saves, undo/redo, auto-fill and communication retain their existing paths. No persistence is added by opening a period.

## Acceptance criteria

- Reuse canonical identity, Team period and ownership matching utilities.
- Preserve every in-range saved occurrence of the selected church/Team, including custom and unsafe legacy rows, regardless of current service requirements or saved document bounds.
- Show only uncovered Team occurrences as virtual; unsafe counterparts are ambiguous and review-only.
- Keep saved staffing snapshots separate from current generated service details.
- Expose hydration explicitly without substituting empty maps.
- Keep legacy document selection out of the extracted period hook.

## Proposed implementation

Extract Team/range generation and its existing lifecycle verbatim into a small hook. Keep the explicit-selection marker separate from programmatic selection because existing restore/history flows distinguish them. Build a pure resolver around `buildTeamSchedulePeriod`, `resolveOccurrenceIdentity`, `matchOccurrencesByIdentity` and `findScheduleOccurrenceOwnershipConflicts`.

## Read-model contract

`resolveScheduleWorkspace({ churchId, teamId, range, timeZone, services, positions, schedules })` returns:

- `rows`: chronologically ordered projections. `identity` is the shared resolved logical identity, or null for an unsafe legacy row. `occurrence` retains the saved object and staffing override when persisted. `generatedOccurrence` optionally supplies current service details separately.
- `status`: `saved`, `virtual`, or `ambiguous`. Ambiguous generated counterparts remain review-only alongside their original saved rows; duplicate rows are never silently collapsed.
- `owner`: null for generated rows, otherwise the actual schedule ID and saved occurrence ID. Its discriminated hydration state exposes the original full schedule only when `isHydratedSchedule` succeeds; otherwise `schedule` is null. Consumers must render unknown/loading staffing until hydrated, never empty cells.
- `reviewScheduleIds`: every implicated saved schedule for an unsafe mapping.
- `requiredHydrationScheduleIds`: distinct, sorted IDs of relevant unhydrated owners/review schedules. This includes owners with no safely reconciled current service definition.

The resolver scopes by church and Team, not document date overlap: ownership follows saved occurrences. Range inclusion uses the established church-local occurrence date helper. Undatable legacy rows are retained for review when their document bounds do not exclude the range. No synthetic persisted schedule or merged staffing map exists.

Server summaries retain occurrences (`summarizeTeamSchedule`), while removing heavy maps. Legacy documents with no occurrence list cannot establish occurrence ownership from bounds alone; they remain a future legacy-document review concern, not an inferred owner.

## Affected surfaces

Production entry is `TeamsSchedulesPage` through the Teams page context and timezone gate. The new hook has no providers or network dependencies. The pure resolver is intentionally not wired to rendering or mutations. Browser and Electron use the same scheduling component; display outputs and server APIs are unchanged. `TeamsAndServices.test.tsx` exercises the real scheduling component with mocked authorized API data; hook tests control dates and data refreshes directly.

## Hydration boundary

`useTeamsPageState.hydrateSchedules(scheduleIds)` already fetches multiple owners with `Promise.allSettled`, shares a completed/in-flight ID set with selected-schedule hydration, merges successful details (including related schedules), releases failed IDs for retry and ignores results after unmount/church change. `mergeHydratedSchedules` retains list order and updates the full-record cache. The new model returns unique IDs and excludes already full records, avoiding fetching every overlapping document or refetching full bootstrap data.

Next phase should pass the model's unique pending IDs once per stable church/Team/range scope, show loading/error per owner, and require an explicit retry after failures rather than running a tight error/refetch effect. The API sends one request per pending ID and can include related schedules in each response; very large ranges may warrant bounded batches. The existing helper does not deduplicate repeated IDs inside one call; this model already does. Do not change that helper or introduce hydration effects in Phase 1.

## Future extraction boundaries

1. **Assignment/equipment mutations:** `ensureActiveSchedule`, `commitAssignment`, `enqueueAssignmentSave`, `saveLatestScheduleCellEdit`, `queueEquipmentCellSave` and position-slot save dependencies form one mutation boundary. Carry church ID, owner schedule ID, saved occurrence ID and cell key through every draft, queued save, retry and response. Resolve the owner before optimistic updates. Preserve the existing worker and slot-dependency semantics rather than passing a synthetic schedule into them.
2. **Undo/redo and auto-fill:** reuse `useScheduleUndoStack` and existing pure auto-fill utilities. `recordAssignmentChange`/`applyUndoEntry` need owner-qualified entries and per-owner batches. Auto-fill must wait for relevant cross-Team conflict records as well as workspace owners. Do not auto-fill from summaries or attempt multi-owner rollback using the current single-document draft.
3. **Communication:** `useScheduleNotificationHistory`, `ScheduleMessagesPanel` and send/publication handlers remain schedule-specific. A workspace must explicitly choose the persisted schedule for publication, message history, links and sending; range membership does not grant permission or combine send history.
4. **Presentation:** the range toolbar/overlap picker and `ScheduleBoardView`/`ScheduleGridCell` are existing seams. After owner-aware writes are tested, supply row models and narrow cell callbacks, then replace the single-document grid projection. Avoid an interface containing the entire `ScheduleTab` state. Keep `ScheduleOverlapPicker` until that path supports review and editing safely.

**Precise next step:** introduce an owner-qualified cell target and route one primary-assignment edit through the existing draft/save queue using its row's persisted schedule and saved occurrence ID. First hydrate all required owners and cross-Team conflict data; block ambiguous/loading rows. Add a two-owner integration test proving edits, retries and stale completions touch only their captured owner. Then extend the same boundary to equipment, undo/redo and auto-fill before wiring the unified grid.

## Risks / edge cases

The grid still edits one document; the resolver is infrastructure only. Conflicts deliberately retain duplicate saved rows and a blocked generated counterpart. Identity ambiguity follows the existing shared utilities, including grouping/membership changes and legacy name/instant matches. Saved snapshots may differ from current service details; callers must not overwrite them merely to render a row. Summary hydration can reveal extra slots but cannot be treated as a new empty schedule before arrival. Existing single-document reconciliation is unchanged.

## Questions requiring user input

None for Phase 1. Owner-aware persistence and unified presentation remain explicitly deferred.

## Verification

Required: resolver regression tests, period hook navigation/data-refresh/Team-change tests, existing team-period/range/ownership utility suites, scheduling selection/edit integration suite, page-state hydration suite, client TypeScript and focused ESLint with zero warnings. Run under Node 24.12.0. No browser smoke test against production data: there is no UI redesign, and existing reconciliation may write to saved documents.

## Code review

### Findings

Critical: None. High: None. Medium: None. Low: None remaining after correction of the test fixture and an encoding-only cleanup mistake.

### Product authorization status

Authorized by the current Phase 1 request and the Team Scheduling contract. The behavior-preserving extraction and read-only contract do not activate new operator behavior.

### Open questions / assumptions

Inputs use authorized page data and a valid configured church timezone. Summaries retain saved occurrence lists as in the production API. Legacy records lacking an occurrence list cannot safely acquire inferred ownership.

### Verification gaps

Review scope: workflow review of the extracted period lifecycle and new pure read contract, not branch-wide production readiness. Production context: Pass. `TeamsSchedulesPage` still mounts the same `ScheduleTab` with the same authorized data, timezone and mutation callbacks. Existing `TeamsAndServices` tests use the actual component; no new provider is needed. The model is not yet connected to a rendered grid or a writer.

| Invariant | Concrete transition | Code inspected | Controlled test evidence |
| --- | --- | --- | --- |
| Navigation stays immediate and explicit selection survives refresh | Upcoming -> next month/custom -> refreshed arrays -> different Team | `useScheduleWorkspacePeriod`, `useRangeSelection`, selector call sites | Hook tests for immediate navigation and Team/data refresh |
| Unknown staffing never becomes empty staffing | Summary owner -> full detail | `isHydratedSchedule`, resolver owner union, `hydrateSchedules` and `mergeHydratedSchedules` | Resolver summary/full test; existing page-state suite |
| Existing persisted keys and overrides survive projection | Combined generated occurrence -> saved legacy key with different staffing count | Shared matching, Team period generation, resolver saved row | Combined/legacy/override resolver tests |
| Conflicts do not choose a winning owner | Two saved owners or duplicate keys in one owner -> current generated occurrence | Ownership utility, shared matcher, resolver ambiguity propagation | Parameterized duplicate and grouped legacy conflict tests |
| Current saves remain on their existing path | Open period -> select saved document -> edit cell | `TeamsSchedulesPage`, `ScheduleTab` selection, `ensureActiveSchedule`, mutation call sites | Existing selection/edit integration tests in `TeamsAndServices` |

### Pattern / learning opportunities

Keep canonical identity in the shared matcher and use the model's unique hydration IDs. No new policy or framework is needed.

### Final readiness

Ready for the stated Phase 1 scope after the verification results below. Unified multi-owner editing remains a later phase.

- Cross-boundary review performed: Yes (page composition, summary hydration, saved keys, unchanged write paths).
- Sibling-pattern search performed: Yes (range selection, Team-period builder, existing ownership/reuse utilities and plan hydration).
- Legacy/persisted-state compatibility reviewed: Yes.
- Identity-switch test reviewed or added: Yes (Team changes and existing page-state tests).
- Unmount/lifetime test reviewed or added: Not applicable to new logic; no new asynchronous work, listeners or timers. Existing hydration behavior is inspected and unchanged.
- Contract round trip traced: Yes (server summary retains occurrences; hydrated owner exposes original full schedule; persistence untouched).
- Validate/use security boundary reviewed: Not applicable to new pure read logic; authorization remains at existing page/API boundaries.
- Retry-state authority reviewed: Yes (existing failed hydration IDs are released; no new retry behavior introduced).
- Owner-retirement handoff reviewed: Not applicable; no owner transfer or resource retirement.
- External side-effect adoption/compensation reviewed: Not applicable; no new external side effects.
- Authorization/data-projection reviewed: Yes (church/Team scoping and unchanged authorized entry data).
- Production entry point, runtime context, and test composition compared: Yes.

## Verification results

Node: `v24.12.0` (task-local PATH; system Node selection unchanged).

- Focused Jest: **7 suites, 254 tests passed** on the final source (146.04 seconds), including 13 resolver tests and 3 period-hook tests.
- Command: `npm.cmd test --prefix client -- --runInBand src/pages/Teams/schedule/scheduleWorkspaceModel.test.ts src/pages/Teams/schedule/useScheduleWorkspacePeriod.test.tsx src/pages/Teams/schedule/teamSchedulePeriod.test.ts src/pages/Teams/schedule/schedulePeriodUtils.test.ts src/pages/Teams/rangeSelection.test.ts src/pages/Teams/TeamsAndServices.test.tsx src/pages/Teams/hooks/useTeamsPageState.test.tsx`.
- Client TypeScript: `npm.cmd run type-check --prefix client` passed. The earlier fixture errors were corrected; concurrent unrelated workspace errors were gone on the final run.
- Focused ESLint: `node node_modules/eslint/bin/eslint.js src/pages/Teams/schedule/ScheduleTab.tsx src/pages/Teams/schedule/useScheduleWorkspacePeriod.ts src/pages/Teams/schedule/useScheduleWorkspacePeriod.test.tsx src/pages/Teams/schedule/scheduleWorkspaceModel.ts src/pages/Teams/schedule/scheduleWorkspaceModel.test.ts --max-warnings 0` from `client/` passed with zero warnings.
- Diff whitespace checks passed; new files have no BOM or trailing whitespace.
- `ScheduleTab.tsx`: **7,803 -> 7,740 lines** (63 fewer). Extracted period hook: 91 lines; pure read model: 128 lines.

Full repository tests and interactive browser smoke were not run; no runtime UI or persistence behavior was intentionally changed. Concurrent volunteer/MySchedule edits in the shared working tree were left untouched and are outside this review scope.
