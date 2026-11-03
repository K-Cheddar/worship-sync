# Service changes in Team Scheduling

> **Current workflow update (2026-11-03):** The comparison panel and the later new-service banner have both been removed. Safe, uniquely owned occurrences reconcile into the populated schedule and appear as ordinary schedule rows. The staffing summary derives visible occurrence, filled-position, and open-position totals from the existing workspace calculation. Ambiguous saved rows and operational data remain unchanged. See [the current Team Scheduling contract](features/team-scheduling.md#reconciliation-and-communication).

## Goal
Open an existing period after saving a service, retain its populated schedule, and include safe additions without manual review.

## Existing architecture
ServiceManager saves through the serviceTimes Redux/RTDB boundary. The workspace generates complete combined groups before projecting Team requirements. `findReusablePeriodSchedule` selects a saved owner; `ensureTeamScheduleForPeriod` validates authoritative service definitions and reconciles inside the existing transaction/serialization and occurrence-claim boundaries. ScheduleTab overlays pending cell edits on hydrated saved documents.

## Before behavior
An unmatched independent service does **not** set `ambiguous`. The shared matcher marks changed combined membership, overlapping date/service identities, invalid identities, duplicate logical keys, or a name/instant collision without a logical match as unsafe. Legacy timestamp keys match by service and church-local date; changing only time remains a match.

The existing November regression fixture reproduces saved `group:sabbath@date` rows containing Worship and Study, while the current test definitions omit `serviceGroupId` and therefore generate standalone rows. This sets `ambiguous`, excludes that populated schedule from reusable candidates, disables automatic ensure, and falls back to a virtual schedule. The review button then sets `viewingSavedSchedule`, which suppresses all generated additions. `mergeCurrentScheduleOccurrences` also suppresses every addition when any row is ambiguous. The targeted-assignment fast path blocks the entire period on any ambiguity.

This reproduces the reported condition with repository fixtures, not a read of the user's production records. An actual deployed definition/schedule snapshot was not provided, so its particular conflicting rows cannot be asserted.

## Prior interim behavior (superseded)
The initial service-change implementation kept a populated owner visible during review, showed saved and proposed affected rows, retained unrelated additions as previews, and allowed unchanged uniquely owned persisted rows to remain editable. Its comparison and saved-version review UI were later removed in favor of the current workflow below.

## Current approved behavior
The November 3 follow-up removes the comparison panel from normal scheduling. The client submits only current occurrences with a unique identity and no owner outside the selected schedule; the existing server ensure transaction still validates and claims them. This lets safe independent additions persist while ambiguous historical group rows, assignments, equipment, responses, publication and notification history remain untouched. Conflicting rows stay read-only until their identity is safe. A later November 3 simplification removed the new-service banner and its response metadata. Reconciled rows update the staffing summary through the same visible occurrence list and fill calculation used by the workspace.

A second failure-derived reproduction found calendar presets using the device date: at `2026-11-01T01:30Z`, This month selected November on a UTC host although New York was still October 31. The schedule hook now converts the reference instant to the configured church calendar date before using the existing calendar preset resolver. Generation and server recurrence rules remain shared and unchanged.

## Product Decision Check
The November 3 requests authorize safe inclusion and preservation, remove the comparison panel and new-service banner, and replace those notices with a derived staffing summary. No schema, publication, messaging, or destructive resolution is introduced. Ambiguous mappings are left unchanged; assignment writes to an unsafe row remain blocked until its identity is validated.

## Behavior intentionally unchanged
Identity heuristics, saved occurrence keys, server validation, transactions, claims, pending edits, historical/archived data, publication and notification history. Safe one-to-one time refresh continues through the existing Refresh schedule action.

## Current acceptance criteria
Independent and same-date additions preserve the saved ID, staffing and equipment; safe rows reconcile even beside historical group mismatches. Grouping and duplicate-ownership conflicts never rewrite staffing or create duplicate schedules. New rows cannot persist before authoritative validation. Reconciled rows appear in the schedule and update the staffing summary without a notification, dismissal action, or review workflow.

## Follow-up verification (November 3, 2026)

- Historical client verification before the summary simplification: `TeamsAndServices.test.tsx` and `schedulePeriodUtils.test.ts`: **187 passed**. This record predates removal of the banner-only assertions.
- Server selection for independent additions across the DST boundary, safe additions beside historical grouping differences, and standalone services colliding with saved combined schedules: **3 passed**.
- Client `lint:check`, `type-check`, and `build:strict`: **passed**. The strict build emits an existing CSS-parser warning from the `javascript:alert(1)` sanitizer fixture and the existing large-chunk advisory.
- `git diff --check` and release-note JSON parsing: **passed**.
- Production schedule data was not supplied; the missing-`serviceGroupId` cause is confirmed in the repository fixture only and must not be assumed to describe deployed church data.

## Initial implementation proposal (superseded)
Use the existing review candidate as the display fallback, while keeping mutation eligibility strict. Merge only safe preview additions even when other rows conflict. Derive per-row editing eligibility and comparison from the shared matcher; reuse native details, shared buttons and existing navigation. Gate success copy on an actual server update.

## Affected surfaces
TeamsAndServices schedule route, GlobalInfo/Toast/timezone providers, shared-service Redux data, hydrated Teams bootstrap/detail and API handlers. Browser and Electron share this route. No presentation, IPC, or public reader changes. Existing real-creation integration executes the RTDB updater and real server handlers with simulated transport/storage.

## Risks / edge cases
Summary-only schedules must hydrate; overlapping owners, legacy keys, pending assignment responses, service saves in progress, stale ensure results after period/church changes, no-op retries, midnight and DST must retain existing protection. Preview additions are not persisted ownership.

## Questions requiring user input
None.

## Verification
Required: failure-derived populated-grid/compare/return and scoped-edit integration tests; focused period/matcher tests; service-save boundary integration; server period/ownership and concurrency tests; client lint, types and strict build; complete diff and mutation-boundary review. Optional: manual browser/Electron and real Firebase/emulator checks; no production mutations.

## Initial implementation record (historical)

- `ScheduleTab.tsx`: retain a populated owner for display independently of reconciliation eligibility; scope persisted-row editing to its own identity and ownership; return from saved-version review without changing the current period; scope addition notifications to the active mounted period.
- `ScheduleServiceChanges.tsx`: inline comparison using the existing `resolveScheduleWorkspace` read model, native details, shared Button and existing navigation. ServiceTimes records receive their current RTDB church scope at this adapter because `toTeamService` omits `churchId`.
- `schedulePeriodUtils.ts`: preserve saved rows and append only safe unrelated preview rows during conflict; reject duplicate generated identities/map keys; share the existing populated-schedule predicate.
- `useScheduleWorkspacePeriod.ts`: church-calendar preset resolution.
- Regression tests: `TeamsAndServices.test.tsx`, `ScheduleServiceChanges.test.tsx`, `schedulePeriodUtils.test.ts`, `useScheduleWorkspacePeriod.test.tsx`, `server/teamsApi.test.js`.
- Documentation: this investigation, `features/team-scheduling.md`, and the service-change release fragment.

The original production change exceeded the repository's 50–100-line reassessment threshold because the request required a useful comparison and scoped mutation checks in addition to fixing selection. The existing workspace model, matcher, ownership transactions, schedule browser, preset resolver and shared controls were reused. Two vague warnings and their saved-only review actions were removed. No new persistence subsystem, resolution schema, migration, background job, queue, or modal was introduced. Comparison derived state; no notification-specific state remains in the current implementation.

## Initial implementation regression coverage (historical)

| Requested scenario | Executed evidence |
| --- | --- |
| Independent one-time addition after a populated month exists | Parameterized Teams UI reuse test; November server test; actual ServiceManager/RTDB/server boundary integration |
| Same date and same instant | Separate UI placements; November server test adds an independent service at the combined service's fall-back instant |
| Assignments and equipment retained | Populated UI fixtures; server asserts every operational map, publication/link/send metadata and creation time; boundary integration also asserts notification delivery history |
| Unrelated additions leave existing combined rows unchanged | November server test compares all persisted combined rows and legacy keys exactly |
| Genuine combined membership change | New grouping comparison UI regression; existing November server rejection and shared matcher tests remain unchanged |
| Time change with stable identity | New Refresh schedule UI test checks the outgoing legacy key, assignment/equipment/additional-slot maps; existing server legacy-time test and shared preservation tests |
| Overlapping ownership | New duplicate-ownership comparison UI test; complete ownership transaction file, including concurrent creation/import and claim release/replacement |
| Pending or failed service save | November server test rejects the unsaved definition without changing the document; real picker/RTDB integration pauses the commit, then reads committed data on independent clients; ServiceManager tests cover save recovery |
| Current versus saved version | Grouping UI test switches November → saved Q4 → November with the populated group and new preview retained |
| Existing-row editing during unrelated failure | Existing parameterized ensure-failure UI test plus new grouping/duplicate cases: unchanged Power Up persists through the targeted endpoint without ensure |
| Church timezone and DST | New preset tests fail before the fix and pass under UTC/Los Angeles; shared gap/fold tests; New York authoritative server test ignores a conflicting request timezone; actual service-creation boundary spawns both host timezones |

## Initial implementation verification (historical)

Commands use `npm.cmd` from the repository root. Logs are in the parent workspace directory, outside the change set.

- Before implementation, the new populated-grouping UI regression failed because the saved assigned row was absent. Before the preset fix, the new UTC month-boundary case failed (November instead of October).
- Complete `TeamsAndServices.test.tsx`: **130 passed** at the full-run checkpoint. Later additions/refinements were checked by the final focused selection, including both stale-client outcomes and the time-refresh test; the full client suite was not run.
- Final focused UI/preview selection: **16 passed**, using `keeps populated saved rows|compares duplicate ownership|uses the exact October|already-added rows|reconciliation failure permits|auto-reuses the populated|refreshes a changed service time|previews unrelated|duplicate generated|keeps schedule staffing|keeps the newly selected period|reconciles again when service timing` against `TeamsAndServices.test.tsx` and `schedulePeriodUtils.test.ts`. Standalone `ScheduleServiceChanges.test.tsx`: **1 passed**, including distinguishable service IDs for an identically named/time identity collision and immutable populated staffing.
- Complete `useScheduleWorkspacePeriod.test.tsx`, `teamSchedulePeriod.test.ts`, `scheduleWorkspaceModel.test.ts`, `schedulePeriodUtils.test.ts`, `scheduleDraftUtils.test.ts`, `teamScheduleOccurrences.test.ts`, `ServiceManager.schedule.integration.test.tsx` under UTC: **173 passed**.
- Timezone selection across creation integration, matcher/generation and Teams UI under Los Angeles: **14 passed**. The complete period hook file also passed all **5** cases under Los Angeles. The creation integration executes independent server processes in UTC and Los Angeles.
- Server focused pattern `period|occurrence|schedule.*ownership|recurr|time zone|November|Book Launch|generated ensure|Firestore ensures` against `teamsApi.test.js` and `teamScheduleOccurrenceOwnershipTransaction.test.js`: **51 passed**. Complete ownership transaction file separately: **18 passed**.
- Los Angeles server selection `November independent additions|Book Launch|legacy timestamp occurrence`: **3 passed**.
- Complete adjacent `rangeSelection.test.ts` and `ServiceManager.test.tsx`: **24 passed**.
- Client `lint:check`, `type-check`, and `build:strict` passed. The sandbox initially denied esbuild ancestor-directory traversal; the approved filesystem-access rerun passed with Sentry uploads disabled.
- An adjacent-test command initially used the nonexistent `rangeSelection.test.tsx` path; corrected to the actual `.test.ts` file. Two broad UI queries were scoped to their intended controls after the new comparison/status elements exposed their assumptions; the original behavior assertions are retained.

## Initial implementation workflow review (historical; superseded by the current workflow above)

### Findings

Critical: None. High: None. Medium: None. Low: existing grid whitespace/`tr` React warnings are emitted in UI tests; they predate these comparison controls and do not fail the checks.

### Product authorization status

Authorized by the current November 3 request and updated Team Scheduling contract: preserving the populated view, safe automatic additions, explicit conflict comparison, scoped editing, truthful notification counts, return navigation and configured church timezone. No authorization or public-data projection is expanded. Genuine ambiguous mappings are corrected explicitly in Service setup or existing saved-schedule management; this comparison does not copy assignments between identities.

### Open questions / assumptions

No unresolved product choice. Production records were not supplied/read; the exact user's stored membership is not asserted. The reproduced saved-group/standalone mismatch is an existing realistic repository fixture and the new regression reproduces its populated-view failure. Name/instant collisions without a logical match remain conservative review cases rather than implicit substitutions.

### Verification gaps

Production-context verification: **Pass for faithful composition**. The real Teams route consumes church-scoped shared-service Redux data, GlobalInfo and Toast, the configured timezone provider, hydrated bootstrap/detail data and edit capabilities. UI tests use that route with mocked transport/auth/timezone; the service adapter explicitly handles the production omission of `churchId`. The actual picker/Redux/RTDB-updater boundary test executes real server auth/ensure/assignment handlers against simulated storage. Server ensure rechecks service/position signatures and ownership inside the existing transaction/queue; targeted assignments retain server validation.

| Invariant | Production owner and adversarial sequence | Executed evidence | Result |
| --- | --- | --- | --- |
| Existing operational data survives additions | Persisted teamSchedules document; paused service save → ensure rejected → commit → ensure and retry | November populated/DST server test and real service-create boundary integration | Pass |
| Unsafe rows never imply safe mutation | Shared identities and occurrence claims; saved combined rows → standalone definitions; two schedules own the same row | Grouping and duplicate UI tests; unchanged server rejections; 18 ownership transaction tests | Pass |
| Safe local work remains visible and editable | ScheduleTab pending-cell overlays and targeted assignment endpoint; unrelated grouping/ownership failure → edit Power Up | New comparison UI tests and existing parameterized ensure-failure tests | Pass |
| Late results cannot navigate/announce into another active period | Church/schedule/period/mount guards; hold ensure → navigate to November → settle October | Existing late-ensure and pending-assignment UI cases; final focused run | Pass |
| A stale snapshot does not invent additions | Transaction owns missing-row count; stale client receives expanded schedule but count zero, with or without other updates | Both new stale-client UI outcomes and repeated server ensure | Pass |
| Church calendar is authoritative | Preset reference straddles local midnight/DST while host differs; server receives a conflicting request timezone | Failure-derived preset tests and populated DST server test under both hosts | Pass |

Required local verification gaps: none after the checks recorded above. Optional confidence gaps: no live browser/Electron, real Firebase emulator/network, CI-wide test run or deployed-data investigation. No production data was modified.

Comparison coverage: **Entire change set inspected**. Review scope: **workflow review**, not release-wide production-readiness certification. Tests listed above were actually executed; existing mutation/ownership tests were inspected as well as run. The only persistence-handler change adds response count metadata, leaving validation, immutable keys, transaction reads, claims and writes intact. Sibling paths examined: legacy timestamp matching, combined generation before Team projection, workspace indexing/name collisions, ServiceManager versus shared-service adapter, service-save boundary, manual time refresh, history navigation, pending cell publishing, and server Firestore/local-store ensure paths.

### Pattern / learning opportunities

The new route-level comparison test protects the production church-scope adapter, a composition mismatch pure read-model tests could not detect. The server count makes notification claims reflect a committed mutation rather than a stale client diff. Both belong in focused enforcement, not new repository policy.

### Initial implementation readiness assessment (historical)

Ready for this scheduling workflow change, subject to normal CI/merge review.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes.
- Legacy/persisted-state compatibility reviewed: Yes; legacy IDs, missing publication metadata and older ensure responses retained.
- Identity-switch test reviewed: Yes; executed late-period/quick-member/pending-cell cases in the complete Teams file.
- Unmount/lifetime test reviewed: Yes; existing virtual-assignment/shadow cases retained, and notification publication now checks mount ownership.
- Contract round trip traced: Yes; real picker → RTDB updater → independent read → ensure → targeted assignment.
- Validate/use security boundary reviewed: Yes; authoritative service signatures and exclusive claims unchanged.
- Retry-state authority reviewed: Yes; repeated ensure remains idempotent and count zero.
- Owner-retirement handoff reviewed: Not applicable; no new retained global action/runtime.
- External side-effect adoption/compensation reviewed: Not applicable; no messaging, upload, or external resource creation.
- Authorization/data-projection reviewed: Yes; no permission or public payload expansion beyond non-sensitive ensure response count.
- Production entry point, runtime context, and test composition compared: Yes.
