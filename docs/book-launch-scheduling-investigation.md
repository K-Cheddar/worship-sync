# Book Launch scheduling regression

## Goal
Restore one-time service creation and November schedule editing on `in-progress` with a narrow fix and reproducible evidence.

## Existing architecture
`ServiceManager` passes DateTimePicker's datetime-local value to `buildServiceTimeUpdate`, then dispatches `serviceTimesSlice.addService`. `store.ts` merges the action in an RTDB transaction, preserving dateTimeISO. `authService.readChurchServiceTimes` reads that collection without converting dates. Browser occurrence generation and server ensure validation independently call `new Date(dateTimeISO)`. Ensure reads the configured church timezone server-side; the client receives it through ChurchServiceTimeZoneProvider. Assignment saves call ensure before their targeted server mutation.

## Before behavior
A timezone-less stored value is interpreted in each runtime's host timezone. A New York browser submits 21:30Z for 16:30; a UTC server computes 11:30 New York from the same stored string. Full-period reconciliation fails before existing-row assignment saves reach their endpoint.

## After behavior
Interpret legacy datetime-local service definitions in the authoritative church timezone on both sides. Persist new picker input as an explicit instant and format it back in the church timezone for editing. Identify the rejected service with limited diagnostic fields and retry guidance. Existing persisted assignment targets can use their targeted mutation without depending on unrelated reconciliation; new targets still require ensure.

## Product Decision Check
The current request and `features/team-scheduling.md` authorize restoring one-time creation, additive reconciliation, timezone consistency, existing-row editing, and strict ownership. No new data model, migration, automatic publication, or sending is authorized or planned.

## Behavior intentionally unchanged
Keep absolute ISO instants, recurrence rules, strict new-occurrence validation, schedule ownership, all operational maps, publication metadata, and notification history. Preserve unrelated working-tree changes.

## Acceptance criteria
Reproduce the exact supplied ID/start/date mismatch; compare an existing absolute one-time service. Exercise picker/create action, actual Redux middleware transaction callback, pending versus committed persistence, independent reload readers in different timezones, ensure and subsequent assignments. Verify failed reconciliation does not block persisted targets and still blocks new targets.

## Proposed implementation
Use existing shared timezone conversion for legacy local strings and a small inverse formatter for picker values. Keep the transaction and API schemas. Limit the persisted-row exception to assignment targets verified against saved occurrence identity; retain server commit-time checks.

## Affected surfaces
Teams Service setup, the sibling controller service creation form, browser schedule generation, server validation, and targeted assignment saving. No display rendering, IPC, external messaging, or credential changes. Tests mock RTDB transport but execute its production updater and use an isolated real auth/Teams handler composition.

## Risks / edge cases
Legacy local values near midnight, DST gaps/folds, existing absolute instants, pending creation, stale rows, duplicate ownership, timezone load failure, and late responses. Existing RTDB/Firestore cross-store generation guards remain.

## Questions requiring user input
None.

## Verification
Required: failing-before/passing-after reproduction; real create/store-to-ensure boundary; UI creation/edit formatting; independent client reload; persisted versus unreconciled assignment tests; ownership and preservation suites; client lint, types, and strict build. No production documents are mutated. Production's stored record itself has not been read: the raw value is established by reproducing the actual picker/create/persistence path, not by claiming access to production RTDB.

## Initial evidence
UTC `node --import tsx --test --test-name-pattern='Book Launch datetime' server/teamsApi.test.js` failed with HTTP 400 and the exact reported recurrence message before the fix. For service `1k6gq4vjthg7r1g7qg4g`, the test persisted `2026-11-07T16:30`, computed server local time `11:30:00`, and submitted `2026-11-07T21:30:00.000Z`, service date `2026-11-07`. The same request's existing absolute one-time service computed and submitted 10:00 correctly.

## Root cause and actual boundary trace

This is a datetime representation/interpretation discrepancy, not a dropped recurrence field or a race required to reproduce the failure. The relevant recurrence/create/persistence code on local `master` (`c0118de14`) and `in-progress` (`ac0e3f1dd`) had the same behavior; their unrelated Planning Center and SSE differences do not change this trace.

1. The real `DateTimePicker` emits `2026-11-07T16:30`, documented as datetime-local without an offset.
2. Before the fix, `ServiceManager` copied it directly into its draft. `buildServiceTimeUpdate` emitted `reccurence: "one_time"` and the unchanged `dateTimeISO`.
3. `serviceTimesSlice.addService` placed that definition in optimistic Redux state. There was no recurrence transformation.
4. `store.ts.applyServiceTimesAction` merged that same payload with the latest RTDB services inside `runTransaction`, using `applyLocally: false`. Its JSON cleaning changes undefined values to null, not date strings. Redux then reconciles from the committed snapshot.
5. `authService.readChurchServiceTimes` reads `churches/:churchId/data/services` authoritatively; it does not attach an offset or convert dates.
6. Browser `buildTeamSchedulePeriod` calls `generateScheduleOccurrences`. Before the fix its one-time branch used `new Date(dateTimeISO)`, interpreting offset-less strings in the browser's host timezone.
7. `ensureTeamScheduleForPeriod` reads the configured church timezone and persisted service definitions. It does not trust the request's timezone as authority.
8. `assertOccurrenceServiceGroup` passes the persisted primary service to `assertServiceOccurrence`.
9. That validator's `getServiceOccurrenceTime` also used `new Date(dateTimeISO)`, this time in the server host timezone. Formatting that already-wrong instant in New York cannot recover the intended wall time.

| Tested service | Persisted definition | Submitted instant | UTC server's old New York time | Fixed server time |
| --- | --- | --- | --- | --- |
| `1k6gq4vjthg7r1g7qg4g`, one_time | `2026-11-07T16:30` | `2026-11-07T21:30:00.000Z` | 11:30 | 16:30 |
| Existing one_time on the same date | `2026-11-07T15:00:00.000Z` | `2026-11-07T15:00:00.000Z` | 10:00 | 10:00 |

Both service dates are `2026-11-07`. The new editor persists `2026-11-07T21:30:00.000Z`; old minute-format local values are resolved through the existing shared church-timezone wall-clock resolver. Absolute instants retain their meaning. New York's November 7 offset is correctly applied as UTC−05:00.

A separate pending-write case also exists: optimistic Redux can contain the new service before the authoritative read can see it. Tests pause the actual transaction updater to demonstrate that ensure must reject this uncommitted target, then succeeds after commit. The new error identifies the missing ID and tells the operator to wait for saving and refresh/retry. This pending state does not explain the reproducible committed legacy-local mismatch.

## Why existing assignment edits stopped

Adding a service changes `serviceDefinitionSignature` and invalidates the period reconciliation key. Primary assignment, shadow, and swap saves awaited `ensureActiveSchedule` before calling their targeted mutation endpoint. Any invalid occurrence in the full submitted period therefore prevented the existing-row mutation from running.

Those three targeted assignment paths can now proceed only when every requested row is already present in the saved church/team schedule with unchanged occurrence identity and scheduled details, and the current period has no known ambiguity or ownership conflict. Virtual/new rows still require ensure. Server authorization, active schedule/row/slot/member validation, transactional writes, and ownership generation/reconciliation checks are unchanged. No server recurrence or ownership assertion was removed.

## Changed files

Production implementation:

- [shared/teamScheduleOccurrences.ts](../shared/teamScheduleOccurrences.ts): shared legacy-local resolver and picker formatter.
- [client/src/utils/teamScheduleOccurrences.ts](../client/src/utils/teamScheduleOccurrences.ts): generation uses the resolver.
- [client/src/pages/Teams/managers/ServiceManager.tsx](../client/src/pages/Teams/managers/ServiceManager.tsx): normalize new input; display persisted instants in church local time; require the church timezone.
- [client/src/containers/ServiceTimes/ServiceTimesForm.tsx](../client/src/containers/ServiceTimes/ServiceTimesForm.tsx): correct the sibling controller creation path.
- [client/src/containers/ServiceTimes/utils.ts](../client/src/containers/ServiceTimes/utils.ts): format legacy one-time definitions consistently.
- [client/src/pages/Teams/teamsUtils.ts](../client/src/pages/Teams/teamsUtils.ts): use the same interpretation for service-day/group eligibility.
- [client/src/pages/Teams/schedule/teamSchedulePeriod.ts](../client/src/pages/Teams/schedule/teamSchedulePeriod.ts): use the same interpretation when finding the initial period.
- [client/src/pages/Teams/schedule/ScheduleTab.tsx](../client/src/pages/Teams/schedule/ScheduleTab.tsx): isolate existing assignment targets from unrelated reconciliation and expose the server's actionable error with Retry.
- [server/teamsAuthHandlers.js](../server/teamsAuthHandlers.js): consistent one-time validation, a service-specific error, and restricted diagnostic fields.

Regression coverage:

- [ServiceManager.schedule.integration.test.tsx](../client/src/pages/Teams/managers/ServiceManager.schedule.integration.test.tsx) and [server companion](../server/fixtures/serviceCreateScheduleBoundary.js): actual picker → builder → Redux slice → production RTDB transaction callback → committed JSON → independent processes → authoritative reader → real auth/ensure/assignment handlers. The RTDB transport and server datastore are simulated; the production updater, period generation, validation, authorization, and mutations execute.
- [ServiceManager.test.tsx](../client/src/pages/Teams/managers/ServiceManager.test.tsx): reload/edit absolute dates without shifting them.
- [ServiceTimesForm.test.tsx](../client/src/containers/ServiceTimes/ServiceTimesForm.test.tsx): sibling creation and missing-timezone protection.
- [TeamsAndServices.test.tsx](../client/src/pages/Teams/TeamsAndServices.test.tsx): reconciliation failure permits persisted targets and blocks virtual targets.
- [teamScheduleOccurrences.test.ts](../client/src/utils/teamScheduleOccurrences.test.ts): local/absolute parity, midnight, DST gap/fold, invalid input.
- [server/teamsApi.test.js](../server/teamsApi.test.js): exact reported ID, instant, date, recurrence, stored value, and computed times.

Documentation: this investigation, [team-scheduling contract](features/team-scheduling.md), and [release fragment](../release-notes/2026-11-03-one-time-service-scheduling.json). `store.ts`, `serviceTimesSlice.ts`, and `authService.js` were traced and intentionally need no edits. Pre-existing local changes outside this list were not modified.

The production change is approximately 100 added lines across the existing boundaries. The shared resolver replaces divergent parsing; the assignment exception is local to existing target selection. No new persistence layer, background job, queue, API, data migration, or retry state machine was added. Most added volume is the requested boundary tests and evidence.

## Verification results

All commands ran from the repository root, with `npm.cmd` on Windows.

| Executed check | Result |
| --- | --- |
| Before-fix UTC Book Launch reproduction, named above | Failed with the exact reported HTTP 400, as required to establish the regression |
| `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/utils/teamScheduleOccurrences.test.ts src/pages/Teams/schedule/teamSchedulePeriod.test.ts src/pages/Teams/teamsUtils.test.ts src/pages/Teams/managers/ServiceManager.test.tsx src/store/serviceTimesSlice.test.ts src/store/store.test.ts` | 266 passed |
| `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx src/pages/Teams/managers/ServiceManager.schedule.integration.test.tsx` | 127 passed |
| `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/containers/ServiceTimes/ServiceTimes.test.tsx src/containers/ServiceTimes/utils.test.ts src/containers/ServiceTimes/ServiceTimesList.test.tsx src/utils/serviceTimes.test.ts` | 45 passed |
| New `ServiceTimesForm.test.tsx` | 2 passed |
| `src/context/churchServiceTimeZone.test.tsx` | 25 passed |
| Final integration/period/form reruns after corrections | Passed; latest boundary companion rerun passed in both UTC and America/Los_Angeles |
| `TZ=UTC node --import tsx --test --test-name-pattern='Book Launch\|period\|occurrence\|schedule.*ownership\|recurr\|time zone' server/teamsApi.test.js server/teamScheduleOccurrenceOwnershipTransaction.test.js` | 47 passed |
| `node --import tsx --test server/teamScheduleOccurrenceOwnershipTransaction.test.js` | All 18 passed |
| Full two-file server run: `node --import tsx --test server/teamsApi.test.js server/teamScheduleOccurrenceOwnershipTransaction.test.js` | 320 passed, 2 skipped, 2 unrelated SMS failures |
| The two failing SMS tests against an isolated copy of the unchanged HEAD handler | Both fail identically with 409 instead of 200; temporary comparison files removed |
| `npm.cmd run lint:check --prefix client` | Passed |
| `npm.cmd run type-check --prefix client` | Passed |
| `npm.cmd run build:strict --prefix client`, with Sentry upload disabled | Passed, including production assets and PWA build; sandbox initially denied esbuild ancestor access, rerun with filesystem access succeeded |
| `node --check server/teamsAuthHandlers.js`, `node --check server/fixtures/serviceCreateScheduleBoundary.js`, `git diff --check` | Passed |

The two unrelated failures are `individual intake SMS records one shared notification attempt and blocks duplicate accepted sends` and `individual intake SMS records provider failure and blocks missing consent, disabled messaging, revoked requests, and closed forms`. Their assertions were not changed. No claim is made that the entire server suite is green.

## Final workflow review

### Findings
Critical: None. High: None. Medium: None. Low: None in the requested change set. The two existing SMS test failures remain outside this fix.

### Product authorization status
Authorized by the current request and the confirmed Team Scheduling contract: consistent church-timezone creation/validation, preserving operational data, actionable errors, and existing-row editing while retaining strict validation for new rows.

### Open questions / assumptions
No unresolved implementation decision. Legacy compatibility covers the picker’s documented minute-format wall time and ISO instants with `Z` or an explicit offset. The production RTDB record itself was not queried.

### Verification gaps
Required local workflow checks: none outstanding. Production-context verification: **Pass for faithful composition**. `App.tsx` supplies Redux, GlobalInfo, and ChurchServiceTimeZoneProvider to both editors; client creation uses service-management write capability. The server requires CSRF and edit access for the persisted Team and uses its configured church timezone. The boundary test deliberately supplies a conflicting request timezone to verify server authority.

| Invariant | Boundary/adversarial sequence | Executed evidence | Result |
| --- | --- | --- | --- |
| Committed service means the same instant across clients | Real picker save paused → optimistic ensure rejected → commit → independent UTC/Los_Angeles reloads and assignment | ServiceManager schedule integration and server companion | Pass |
| Identify the actual failing service | Book Launch is valid, existing same-date service submits the wrong instant | Companion diagnostic assertions name existing-one-time, not Book Launch | Pass |
| Reconciliation preserves data and exclusive ownership | Populated published schedule → add Book Launch → ensure/reload → edit assignments | Companion checks ID, creation/publication/send metadata, both equipment maps, actual notification delivery history, and two owner claims; ownership transaction suite | Pass |
| Existing rows remain editable; new targets stay strict | Reject ensure → assign existing persisted row versus virtual row | TeamsAndServices parameterized regression; companion rejects unknown row | Pass |
| Existing lifecycle/race protections remain | Period switch during ensure; pending virtual assignment after period switch; competing service writes and ownership transactions | Full TeamsAndServices, store, and ownership transaction files executed | Pass |

Comparison coverage: **Entire requested change set inspected**; pre-existing user changes excluded. Review scope: **workflow review**, not a release-wide production-readiness claim. Tests listed above were executed, not merely inspected. Optional confidence gaps: no live production RTDB read, real Firebase network/emulator run, manual cross-device browser exercise, or deployment was performed. The boundary tests simulate transport/storage and execute the real application logic.

### Pattern / learning opportunities
The regression test now enforces the documented datetime-local boundary and verifies its round trip through actual creation/persistence logic, rather than relying on manually authored absolute server fixtures alone.

### Final readiness
Ready for the requested local fix scope.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; both creation paths, formatting, grouping, and initial schedule-period selection inspected.
- Legacy/persisted-state compatibility reviewed: Yes.
- Identity-switch test reviewed: Yes; existing executed store/Teams coverage retained.
- Unmount/lifetime test reviewed: Yes; existing virtual-schedule and shadow recovery coverage retained; integration unmounts the editor before independent reads.
- Contract round trip traced: Yes.
- Validate/use security boundary reviewed: Yes; existing server guards and commit-time validation retained.
- Retry-state authority reviewed: Yes; pending creation is rejected, committed data is reused, and new rows still require ensure.
- Owner-retirement handoff reviewed: Not applicable; no new long-lived operation owner was introduced.
- External side-effect adoption/compensation reviewed: Not applicable; this fix does not send or create external resources.
- Authorization/data-projection reviewed: Yes; no authorization or public projection changes.
- Production entry point, runtime context, and test composition compared: Yes.

## Remaining risks
The test harness does not establish real Firebase network timing or deployed data contents. The production diagnostic identifies the actual rejected service if its stored shape differs from the reproduced picker output. Existing cross-store service-definition-change conflicts still return 409 and require retry. Clients should reload after rollout; historical schedules do not need to be deleted, regenerated, or migrated.

## Remaining-reader review follow-up

### Goal
Close the three follow-up findings for legacy local one-time countdowns, combined-service controller timing, and service-plan date lookup.

### Existing architecture
All three consumers already receive a church timezone, but four parsing sites still use host-local Date parsing. Reuse `oneTimeServiceInstant`; no new resolver or state is needed. `getOneTimeServiceOccurrence` has no current production caller (only its declaration and tests were found).

### Before behavior
Legacy local definitions can finish early or late, combined group members disagree on their starts, and a midnight plan lookup can scan the previous day.

### After behavior
These readers resolve the same church-local instant as schedule generation and server validation.

### Product Decision Check
Authorized by the current review-fix request, the prior one-time scheduling request, and the Service countdowns contract. Preserve explicit countdown overrides, authoritative representative occurrence timestamps, occurrence pinning, and all persisted shapes. No unresolved product decision.

### Behavior intentionally unchanged
Absolute timestamps, recurring services, synchronized clock usage, grace periods, override precedence, plan identity, stream transparency, UI composition, and persistence remain unchanged.

### Acceptance criteria
Demonstrate failing UTC regressions before the fix; pass those tests under UTC and Los Angeles; verify upcoming/recent boundaries, combined members, authoritative representative timestamps, midnight lookup, and rendered paired-display countdowns.

### Proposed implementation
Replace the four remaining time/date parsing sites in the three reported files with the existing shared resolver and retain their current null behavior.

### Affected surfaces
`useDisplayedUpcomingService` and `TimerDisplay` on controller/workstation/projector/monitor/stream; CurrentServiceWorkspace timing; an exported currently unused service-plan lookup. App's timezone provider remains authoritative. No persistence, network, IPC, or presentation-layer edits.

### Risks / edge cases
Host timezone differs from church; midnight crossing; exact service start; invalid/missing date; explicit override; combined representative metadata differs from its saved occurrence. Existing memoization, bounded formatter caches, subscriptions, and timer scheduling remain.

### Questions requiring user input
None.

### Verification
Required: new failure-derived unit regressions and real provider/TimerDisplay coverage, relevant hook/controller and DisplayWindow core/timer suites, lint, types, and strict build. Live browser/Electron devices are optional additional confidence checks.

### Follow-up implementation and review result

All three findings are fixed on `in-progress`, based on `0f3b11de`:

- `client/src/utils/serviceTimes.ts`: both upcoming and most-recent one-time targets use `oneTimeServiceInstant(value, timeZone)`. Exact-start classification and override precedence are unchanged.
- `client/src/pages/Controller/currentServiceTiming.ts`: non-representative combined members use the same resolver. The representative still uses the persisted occurrence instant, even when its current definition differs.
- `client/src/pages/Services/servicePlanOccurrences.ts`: resolve the instant before choosing the church-local lookup date. The existing export is retained; the caller scan found no production usage.

The production patch changes four parsing sites across three files. No new helper, state, subscription, timer interval, cache, write, or API was introduced. Existing shared resolver caches bound repeated wall-time conversion; recurrence resolution remains behind the existing memo/boundary scheduling in `useDisplayedUpcomingService`. The separate host-parsed administrative sort key was inspected and excluded: it computes list order, not a countdown target or plan lookup date, and its API has no timezone parameter.

All three new raw-local regressions failed before the fix under `TZ=UTC`; the absolute-timestamp cases passed. After the fix:

| Check executed | Result |
| --- | --- |
| `TZ=UTC npm.cmd test --prefix client -- --runInBand --runTestsByPath src/utils/serviceTimes.test.ts src/pages/Controller/currentServiceTiming.test.ts src/pages/Services/servicePlanOccurrences.test.ts --testNamePattern='church timezone for one-time\|legacy group members\|legacy midnight'` before implementation | Three expected regression failures; two absolute cases passed |
| Complete `serviceTimes.test.ts`, `currentServiceTiming.test.ts`, `servicePlanOccurrences.test.ts`, and `pairedDisplayCountdown.integration.test.tsx`, under both `TZ=UTC` and `TZ=America/Los_Angeles` | 63 passed in each timezone |
| Those four files plus `src/pages/Teams/servicePeriodRange.test.ts`, under UTC | 67 passed |
| `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/hooks/useDisplayedUpcomingService.test.ts src/hooks/useNextServiceCountdownText.test.ts src/pages/Controller/useCurrentServiceOccurrence.test.tsx src/components/DisplayWindow/__tests__/DisplayWindow.corePaths.test.tsx src/components/DisplayWindow/__tests__/DisplayWindowTimersAndText.test.tsx src/containers/ServiceTimes/ServiceTimesList.test.tsx src/containers/ServiceTimes/TimeAdjuster.test.tsx` | 124 passed |
| `npm.cmd run type-check --prefix client` | Passed |
| `npm.cmd run build:strict --prefix client` with Sentry upload disabled | Passed, including full client lint, production bundle, and PWA build |
| `git diff --check` | Passed |

Review findings: Critical/High/Medium/Low — none remaining within these reported reader paths. Product authorization: current review-fix request and updated Service countdowns contract. Entire follow-up diff inspected; scope is workflow/fix verification, not a release-wide production-readiness review.

| Invariant | Production context and adversarial case | Executed evidence | Result |
| --- | --- | --- | --- |
| Legacy data means the same countdown instant across hosts | `App` timezone provider → `useAvailableServiceTimes` → `useDisplayedUpcomingService` → `TimerDisplay`; human/workstation Redux versus paired-display RTDB read; synchronized clock offset | New real-provider integration cases render one hour on controller, workstation, monitor, projector, and stream for local and absolute representations, in both host timezones | Pass |
| Explicit timing authority is retained | Representative metadata differs from its saved start; another grouped member has a local definition; a future override supersedes a local scheduled target | New grouped-member and override regressions plus existing controller timing tests | Pass |
| Midnight lookup stays on the church day | `2026-11-07T00:30` in New York, host UTC; temporary override points to a different day | New service-plan regression resolves `midnight@2026-11-07` at `05:30Z` | Pass |

Identity, lifetime, persistence, retry ownership, and authorization were reviewed: this follow-up introduces no mutations or asynchronous owners, and the existing provider credentials, ownership checks, subscriptions, memoization, and lifecycle tests remain intact. Presentation/overlay/media/IPC code is unchanged; core display and timer consumers were exercised. This closes the earlier reader-coverage gap without changing schedule storage or assignments.

Required verification gaps: none for this local fix. Optional confidence gaps: no manual browser/Electron device run or production datastore read; integration transport remains mocked. Final readiness: **Ready** for the reported reader fixes. Known follow-ups: none within this scope.
