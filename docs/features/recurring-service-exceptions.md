# Recurring Service Exceptions — Phase 0 Architecture Review

**Status:** Phase 0 investigation complete; implementation not started.

**Branch reviewed:** `in-progress-2` (`f6020633`) against `master` (`c0118de1`).

## A. Current architecture

### Service definitions and virtual occurrences

`ServiceTime` in `client/src/types.ts` is stored in the church Realtime Database under `churches/{churchId}/data/services`. The store listener in `client/src/store/store.ts` applies service-time changes. A definition includes a recurrence type (`one_time`, `weekly`, `multi_weekly`, or `monthly`), local service time, timezone-related settings, and optional service-group membership. Temporary `overrideDateTimeISO` is a separate countdown/current-time override handled by `client/src/utils/serviceTimes.ts`; it is not the recurring schedule source.

`client/src/utils/teamScheduleOccurrences.ts` implements `generateScheduleOccurrences`. It generates candidates from the recurrence rule and requested local-date range, resolves wall-clock times with `serviceDateTimeInTimeZone` from `shared/teamScheduleOccurrences.ts`, merges same-date members of a service group, then sorts the results. These generated rows are virtual: generating an occurrence does not create a schedule or plan record. The same generator is called from team scheduling, service-plan editing, current-service resolution, and availability-form flows.

### Identity and persisted records

The shared helpers in `shared/teamScheduleOccurrences.ts` create logical IDs as `serviceId@YYYY-MM-DD` or `group:<groupId>@YYYY-MM-DD`. The date in that ID is the original recurrence date. `resolveOccurrenceIdentity` currently derives the service date from `serviceDate` or the occurrence ID and requires it to agree with the local date of `startsAt`; it also checks declared logical IDs against the actual service date. Consequently, retaining the old ID while simply changing `startsAt` is rejected or ambiguous. An exception needs two explicit dates: the original recurrence date for identity, and the actual scheduled date for display, range membership, and time resolution.

Service plans are stored separately in Firestore. `client/src/utils/servicePlanKeys.ts` uses the logical occurrence ID when present, and otherwise derives a key from the service and date. `client/src/pages/Services/servicePlanOccurrences.ts` uses the shared generator to populate plan choices. The public plan snapshot in `server/servicePlanPublic.js` uses stored plan content and `startsAt`. Existing plans must keep their key and remain linked to the same logical occurrence after it moves; their content and historical versions must not be rewritten as a side effect of resolving an exception.

Team schedules persist occurrence snapshots as well as operational data. `client/src/pages/Teams/schedule/teamSchedulePeriod.ts` (`buildTeamSchedulePeriod`) generates candidates, matches persisted identities across saved schedules, and retains saved IDs. `client/src/pages/Teams/schedule/ScheduleTab.tsx`, `scheduleDraftUtils.ts`, and `schedulePeriodUtils.ts` reconcile changed schedules and remap assignments. `TeamSchedule` stores assignments, responses, microphone and IEM assignments, and additional-position slots in maps keyed by `occurrenceId`; saved schedules also carry Draft/Published state. Reusing the logical ID is therefore essential to retaining these records. Server validation and persistence live in `server/teamsAuthHandlers.js`: `normalizeTeamScheduleOccurrences`, `validateTeamSchedulePayload`, `assertOccurrenceServiceGroup`, `ensureTeamScheduleForPeriod`, and the create/update schedule routes validate, normalize, and persist the schedule. The server checks ownership so one logical occurrence cannot be claimed by multiple team schedules.

### Other consumers and synchronization

- `client/src/pages/Teams/managers/IntakeManager.tsx` and `client/src/pages/Teams/intakeAvailabilitySuggestion.ts` generate or persist availability occurrences. Forms save occurrence snapshots; responses are keyed by occurrence ID in `occurrenceAvailability`. Later schedule changes must not silently change the meaning of already collected responses.
- `client/src/utils/currentServiceResolution.ts` (`listCurrentServiceOccurrences`), the Current Service hooks/workspace, and `client/src/utils/serviceTimes.ts` resolve upcoming or active services from generated occurrences and service plans. Temporary countdown overrides remain independent.
- Member schedules and public Team schedules primarily read saved schedule snapshots. Server plan association, schedule summaries, notification intents, and recipient-facing availability/history use occurrence IDs or dates. They must reflect the resolved date without manufacturing a second logical occurrence or rewriting delivery history.
- Service definitions currently use a direct RTDB listener in the client. `firebase.json` configures Firestore rules but no RTDB rules file. For exceptions, an authenticated server API and the existing Teams synchronization stream are the safer boundary than exposing a new client-writable RTDB branch.
- Portable data transfer is assembled by `readPortableDatasets` in `server/teamsAuthHandlers.js`; service definitions and schedules are included today. Exception records must be added to export, preview/restore, and retry-safe import so a church backup does not omit them.

### Existing code to reuse

Reuse `serviceDateTimeInTimeZone` and the shared identity helpers instead of implementing another recurrence engine. Reuse `generateScheduleOccurrences` as the default-candidate source, `matchOccurrencesByIdentity`/`preserveStoredOccurrenceIds` for safe reconciliation, `getServicePlanKey` for plan association, the existing authenticated Teams API conventions, schedule ownership checks, and the existing Teams update stream. Server-side `assertOccurrenceServiceGroup` already checks authoritative service membership and recurrence/time details for schedule and plan operations; it should be extended or called by the exception resolver rather than creating a page-specific validation path.

## B. Proposed architecture

### Persistence model

Add an additive sibling collection at `churches/{churchId}/data/serviceOccurrenceExceptions`, keyed by the canonical logical occurrence ID. Keep it independent of service definitions, plans, forms, and schedules so an exception exists even when no plan or team schedule exists.

Illustrative record (server-owned metadata omitted from client input):

```json
{
  "logicalOccurrenceId": "sabbath@2026-11-14",
  "originalServiceDate": "2026-11-14",
  "serviceId": "sabbath",
  "serviceIds": ["sabbath"],
  "scheduledServiceDate": "2026-11-21",
  "scheduledTime": "10:00",
  "revision": 1,
  "updatedAt": "...",
  "updatedByUid": "..."
}
```

For a combined service, store the group ID and the full member-ID snapshot, and treat the group occurrence as one unit. The server derives and verifies identity, current recurrence membership, timezone, and permission from authoritative church data. Keep the target as church-local date plus wall-clock time, then resolve `startsAt` through the shared timezone helper. That preserves the normal local-time intent across DST and timezone-rule changes; nonexistent local times should be rejected consistently with current occurrence generation. The snapshot lets the application identify a stale exception if the service or group is later edited.

Create, replace, and remove records through authenticated server endpoints. Use an RTDB transaction or equivalent compare-and-swap on the individual key with an expected revision so concurrent edits and stale clients cannot overwrite one another silently. Emit the existing authenticated Teams change event after a successful write. Do not enable direct client writes to this path. The initial API can be exercised by tests and internal callers without adding a user-facing exception editor in Phase 1.

### Resolution and identity

The exception targets exactly one original logical occurrence. Keep `logicalOccurrenceId` stable as `serviceId@originalServiceDate` or `group:<groupId>@originalServiceDate`; add `originalServiceDate` explicitly to the resolved occurrence. Keep `serviceDate` equal to the *actual* church-local date of `startsAt`. Thus legacy rows without `originalServiceDate` continue through the existing identity path, while exception-aware rows make the distinction explicit. The shared resolver should validate both: the logical ID must encode `originalServiceDate`, and `serviceDate` must match the resolved start in the church timezone.

Resolution flow:

1. Generate default candidates with the existing recurrence generator.
2. Load applicable exception records for the church and validate each against current service definition, original recurrence, service/group membership, and timezone.
3. Resolve candidate exceptions using the shared time resolver; keep the original logical ID and set actual date/time from the exception.
4. Filter results by actual scheduled date, not original recurrence date, and deduplicate on logical occurrence ID.
5. For a requested range, also look up exceptions whose original date is outside the range but whose target date can fall inside it. A bounded range query/index or fetching the small exception set for the requested service/date window is needed; a lookup only by original-date candidates would miss moved-in occurrences. Moved-out defaults are omitted from their old date range.
6. If a recurrence or group edit makes an exception invalid, retain the record as stale/inert and surface it for repair or removal. Do not silently delete it, retarget it, or convert it into a new service occurrence.

Without an exception, return the same fields, IDs, and ordering as the current generator. Removing an exception simply makes the default recurrence candidate visible again. Only recurring occurrences are in the initial exception scope; one-time service records continue using current behavior.

### Cross-period schedule ownership

Date-range resolution alone is insufficient for saved schedules. `buildTeamSchedulePeriod` finds owners across persisted schedules, and the server rejects or filters an occurrence when another schedule owns its logical ID. A move into another period must not create a duplicate or discard the original schedule's operational maps. Phase 3 must either transfer the full occurrence record between period schedules while preserving its ID and all keyed data, or make the existing owner visible and actionable from the target period. The recommended direction is an explicit owner-aware transfer with one authoritative ownership check/transaction, preserving assignments, responses, equipment, additional positions, notes, and publication state. Never copy only the occurrence snapshot or silently drop data.

## C. Alternatives considered

| Option | Assessment |
|---|---|
| Embed exceptions in each `ServiceTime` | Fewer storage locations, but a combined occurrence has no single service owner; edits to a service record can race with service-time updates; large recurring definitions grow indefinitely; and per-occurrence CAS/synchronization becomes awkward. It also mixes the immutable recurrence rule with occurrence overrides. |
| Store exceptions in plans or team schedules | Those records may not exist, may be team-specific, and can be Draft or deleted. Duplicating an exception across plans/schedules would create competing truth and would not support countdowns, availability, or public consumers consistently. |
| Store exceptions in Firestore | Would split recurrence inputs between Firestore and the existing RTDB service catalog and require extra reads/consistency handling. No current requirement justifies a second source of truth. |
| Separate RTDB exception collection behind server APIs (recommended) | Additive, church-scoped, independent of plans/schedules, naturally supports per-key transactions and group-level records, and keeps client writes behind existing authorization. The current shared identity and time utilities remain the sole resolution logic. |

## D. Confirmed risks and mitigations

| Risk and confirmed path | Failure mode | Smallest effective mitigation |
|---|---|---|
| Identity invariant in `shared/teamScheduleOccurrences.ts` (`resolveOccurrenceIdentity`) | Old logical date plus new `startsAt` is rejected or conflates identity with actual date. | Add explicit `originalServiceDate`; retain actual `serviceDate`; validate each against its own source. Keep legacy behavior for rows without the new field. |
| Range generation in `generateScheduleOccurrences` and consumers that request a period | A November 14 occurrence moved to November 21 is missed when a caller only generates the target range; moved-out occurrence may still be shown in the original range. | Resolve against original candidates plus applicable moved-in exceptions, then filter/deduplicate by actual date. Add out-of-range and cross-year tests. |
| Saved schedule ownership in `buildTeamSchedulePeriod`, `ScheduleTab`, and `ensureTeamScheduleForPeriod` | Target period may omit an occurrence already owned by another period; blindly generating it could duplicate ownership; current period validation can reject an occurrence moved outside its range. | Preserve one owner and route cross-period movement through owner-aware transfer/action; atomically retain all occurrence-keyed data. |
| Occurrence-keyed schedule data and reconciliation | Changing the ID loses assignments, responses, microphone/IEM assignments, or additional positions; unsafe reconciliation can drop ambiguous rows. | Keep logical ID stable and update only occurrence date/time; use reconciliation helpers and refuse ambiguous/membership-changing rewrites. |
| Combined service identity and grouping in `generateScheduleOccurrences`, `logicalOccurrenceIdForGroup`, and `preserveStoredOccurrenceIds` | Moving only one grouped service changes one shared assignment set into multiple occurrences or leaves incomplete membership. | Treat group as one exception with a membership snapshot. Reject independent member moves in the first release. |
| Service plan keys in `getServicePlanKey` and public plan snapshots | Date-derived keys can orphan a plan or create a duplicate after a move. | Key by preserved logical ID, keep existing plan content/history, and test reopening and public plan association after date resolution. |
| Availability snapshots and `occurrenceAvailability` in IntakeManager/server form handlers | Existing volunteer answers could be displayed against a different date or erased when form options refresh. | Keep submitted occurrence snapshots/history immutable; update future availability generation deliberately and reconcile existing form references without deleting answers. |
| Current Service and countdown resolution | Current-service consumers may keep using the default date or accidentally treat a temporary countdown override as a schedule exception. | Route consumers through the same resolved occurrence list; leave `overrideDateTimeISO` logic independent. |
| Server validator `assertOccurrenceServiceGroup` and bulk plan/schedule checks | A client-only exception could be spoofed, stale, or disagree with server membership/timezone validation. | Resolve and authorize on the server using current service data; share identity/time helpers and reject stale revisions. |
| Concurrent edits and existing Teams synchronization | Two stale clients can overwrite one exception or other clients can keep showing old dates. | Per-key revision/CAS; emit update only after commit; refetch or patch via the existing authenticated Teams stream. |
| Church timezone and DST | A stored UTC instant can shift local service intent when zone rules change; a nonexistent wall time cannot map to a valid start. | Persist church-local target date/time and resolve with `serviceDateTimeInTimeZone`; reject invalid local times and test spring gaps/fall folds. |
| Public schedules, notifications, and historical records | Recomputing old delivered notifications or rewriting history can misrepresent what members saw. | Use resolved actual dates for current/public schedule projections; preserve sent notification intents and historical snapshots, and only send date-change notices through the existing explicit notification flow. |
| Recurrence/group definition changes after an exception | The exception may refer to a removed service, no-longer-recurring date, or changed group membership. | Retain an inert stale record with a reason/status; require an authorized explicit repair or removal. Never retarget based on name/date guesses. |
| Portable transfer in `readPortableDatasets` and `server/dataTransfer/schemas.js` | Export/import omits the new source of truth and loses exceptions on restore. | Add an additive portable dataset and schema, validated and retry-safe, with round-trip tests before enabling the feature. |

These risks arise from current identity, range, ownership, and persistence behavior. Collision policy for two distinct occurrences targeting the same date/time and stale-exception UI wording are product behaviors not yet encoded by current code; they should be explicitly rejected/reviewed in the feature flow rather than silently merged.

## Backward-compatibility guarantees

- No exception: exact current generated occurrence fields, IDs, service grouping, and ordering.
- Existing plans, schedules, Draft/Published states, assignments, responses, equipment, and notification history remain addressable and are not bulk-rewritten.
- A moved occurrence keeps its original logical identity and has one actual scheduled date; resolving it never creates a second logical occurrence.
- Client and server use the same church-local date/time interpretation and validate against authoritative service definitions.
- Removing an exception restores the recurrence-generated occurrence without changing the recurrence definition.
- Temporary countdown overrides remain independent from permanent schedule exceptions.
- No migration is proposed. Existing records without `originalServiceDate` keep the existing resolver contract; only resolved exception rows use the added field.

## E. Affected code and implementation phases

### Likely affected files

- `shared/teamScheduleOccurrences.ts` and `client/src/utils/teamScheduleOccurrences.ts` — identity fields, shared validation/resolution, exception-aware generation and range filtering.
- `client/src/types.ts`, `client/src/api/authTypes.ts`, and `client/src/api/auth.ts` — exception and resolved-occurrence/API types.
- `server/teamsAuthHandlers.js` — authenticated exception list/upsert/remove, authoritative validation, schedule/plan integration, and portable export/restore.
- `server.js` and `server/teamsSse.js` — route and change-event wiring if the existing handler/stream does not already expose the needed hook.
- `server/dataTransfer/schemas.js` and related transfer handlers/tests — exception backup and restore.
- `client/src/utils/servicePlanKeys.ts`, `client/src/pages/Services/servicePlanOccurrences.ts`, `client/src/pages/Services/ServicePlanEditor.tsx` — plan association and editing choices.
- `client/src/pages/Teams/schedule/teamSchedulePeriod.ts`, `scheduleDraftUtils.ts`, `schedulePeriodUtils.ts`, `ScheduleTab.tsx`, and schedule edit components — saved-owner reconciliation and cross-period handling.
- `client/src/pages/Teams/managers/IntakeManager.tsx`, `client/src/pages/Teams/intakeAvailabilitySuggestion.ts`, and form API types — future availability choices and saved response compatibility.
- `client/src/utils/currentServiceResolution.ts`, `client/src/utils/serviceTimes.ts`, `client/src/hooks/useDisplayedUpcomingService.ts`, `client/src/pages/Controller/CurrentServiceWorkspace.tsx`, and related Current Service hooks/viewers — current/upcoming/public resolution, while preserving countdown override behavior.
- Server schedule/plan/public/notification projections in `server/servicePlanPublic.js`, `server/notificationIntents.js`, and `server/teamsAuthHandlers.js` — resolved date display and preservation of historical notifications.
- `client/src/context/globalInfo.tsx` only if the existing authenticated Teams stream is not sufficient to keep exception consumers synchronized.

The exact Phase 1 touch list should stay smaller than this full integration list; it is limited to persistence, API/types, sync, portable transfer, and their tests.

### Phase 1 — Exception persistence

**Permitted:** Add the church-scoped exception record schema; authenticated list/upsert/remove API using server-side service authorization, validation, and per-key CAS/revision; emit the existing synchronization event; include the dataset in portable export/restore; add focused API, authorization, conflict, stale-revision, and transfer tests. Add types needed by the API.

**Deferred:** Do not change recurrence output, schedule/plan/form/current-service consumers, UI, service definition behavior, or existing persisted schedule records. No migration and no automatic exception creation.

**Acceptance criteria:** Exception records survive without a plan or schedule; unauthorized/malformed/stale requests are rejected; concurrent updates cannot silently overwrite; removing a record restores no data by mutation (it only removes the exception record); export/restore round-trips records; ordinary service generation is unchanged.

**Required tests:** CRUD and church scoping; permissions; current-service/group membership validation; revision conflict and concurrent update; invalid target time/timezone; missing/deleted service rejection; export/restore and retry idempotency. Existing recurrence tests remain unchanged and pass.

**Potential regressions:** Incorrect permissions could grant team-only users church-wide scheduling power; path/schema mismatch could make backups incomplete; duplicate events could cause stale client views. Keep writes server-only, validate under the owning church, and publish one event after commit.

**Review/rollback:** Review persistence/API and portable transfer separately from any consumer. Roll back by disabling/removing the new API/event wiring while retaining records for a forward fix; do not delete persisted exception data as a rollback step. Since no consumer reads the records in this phase, runtime scheduling remains unchanged.

### Phase 2 — Exception-aware occurrence generation and identity

**Permitted:** Add an exception-aware wrapper around the shared default generator; add `originalServiceDate` to resolved exception rows; resolve target times with the existing shared timezone helper; make server validation use the same identity/date rules.

**Deferred:** Do not yet alter saved schedules, plans, availability forms, notifications, or UI. Do not alter the underlying recurrence definitions or legacy rows.

**Acceptance criteria:** No-exception output is byte-for-byte/equivalent in fields and IDs to current output; exceptions retain the original logical ID, use the actual `serviceDate`, move in/out of requested ranges including month/year edges, and removal restores the default; invalid/stale records cannot produce duplicates or guessed occurrences.

**Required tests:** Weekly, monthly, multi-weekly, one-time unaffected; moved-in/out, original date outside requested range, cross-month/year, duplicate destination, combined group, stale/deleted service, DST gap/fold, timezone change semantics, and client/server identity agreement.

**Potential regressions:** A changed resolver may reinterpret legacy rows; range lookups may be incomplete or duplicate candidates; group member changes may silently split identity. Keep legacy behavior when `originalServiceDate` is absent, deduplicate by logical ID, and reject stale group snapshots.

**Review/rollback:** Land resolver behind an explicit flag or server/client feature gate; compare generated outputs with exception reads disabled. Roll back by disabling resolution while retaining exception records and the backward-compatible identity field.

### Phase 3 — Saved schedules, plans, and other consumers

**Permitted:** Integrate resolved occurrences with saved Draft/Published schedules, ownership/reconciliation, plans, public/member schedule projections, availability generation, Current Service, and explicit notification flows. Implement owner-aware cross-period transfer preserving all occurrence-keyed operational records.

**Deferred:** No exception editor or broad recurrence redesign; no rewriting of historical notification or availability response records; no independent moves of members of a combined service.

**Acceptance criteria:** Existing owner remains unique; moving an occurrence with populated assignments, responses, microphones, IEMs, additional positions, notes, and plan associations retains the same logical ID and all data; moving into/out of a period produces one visible owner; Draft/Published state is handled explicitly; existing responses and sent notification history remain intact.

**Required tests:** Schedule reconciliation with populated operational maps; cross-period move and restore; competing occurrence and owner conflict; existing and legacy plan association; public/member snapshots; availability answer/history preservation; current-service lookup; notification history; retry/concurrency; group move.

**Potential regressions:** Owner transfer may partially move data; stale snapshots may duplicate IDs; availability answers may be shown against wrong dates; plan keys may change. Require transactional ownership validation, all-map preservation assertions, and no implicit answer/history mutation.

**Review/rollback:** Review each consumer family independently behind a church-scoped feature gate. Roll back consumer reads to default generation while retaining stored exceptions and new IDs/fields; do not undo or discard moved operational records. Any write-side owner transfer needs a tested compensating path before rollout.

### Phase 4 — UI, end-to-end verification, and controlled rollout

**Permitted:** Add a reschedule/restore action on the service occurrence management surface, stale/conflict messaging, and audit-friendly confirmation; enable a controlled rollout after Phase 3 coverage.

**Deferred:** No bulk exception creation and no change to recurring service definitions as a shortcut.

**Acceptance criteria:** Authorized service managers can move or restore one occurrence; unauthorized users cannot; a combined occurrence is presented as a unit; collisions, stale records, and cross-period ownership are explicit; the recurrence rule and future occurrences are unchanged; all consumers show one actual date.

**Required tests:** UI authorization and validation, API end-to-end move/restore, group behavior, conflict handling, cross-period populated schedule, export/restore, timezone/DST, countdown independence, and regression suites across scheduling, plans, forms, current service, public/member views, and notifications.

**Potential regressions:** Users may mistake a one-time exception for a recurrence edit, or may move the wrong grouped service. Show original and target dates and make restore explicit; preserve server-side validation.

**Review/rollback:** Release behind a per-church feature flag with audit logging and a documented disable procedure. Disabling the UI/resolver must leave exception records intact; restore behavior must be verified before broad enablement.

## F. Outstanding decisions

1. **Combined services:** Approve treating a grouped occurrence as indivisible in the first release (recommended). Moving one member independently changes the current shared assignment identity and needs a separate product/data design.
2. **Authorization:** Approve using the existing church-level Service Management edit permission (recommended), because one exception affects every team and public/member view using that occurrence. Team schedule managers alone should not change the church-wide service date.
3. **Cross-period schedule owner:** Approve an owner-aware transfer that preserves all occurrence data when a move crosses schedule periods (recommended), with explicit conflict resolution if the destination period already has a competing owner or incompatible occurrence. This is the main Phase 3 dependency.
4. **Destination collisions:** Approve rejecting a move that collides with another logical occurrence/group at the same destination time until an authorized user resolves it (recommended). Do not merge distinct identities automatically.
5. **Timezone semantics:** Approve preserving church-local wall-clock time on target date and on later timezone-rule changes (recommended), with invalid/nonexistent local times rejected. This matches existing recurrence generation.

## Phase 0 baseline and status

The occurrence test suite already covers weekly, monthly, multi-weekly, one-time, stable IDs across time changes, date ranges, combined groups, group membership changes, DST spring gaps/fall folds, and local timezone handling. Existing plan-key, plan occurrence, schedule reconciliation/period, current-service, service-time/countdown, availability suggestion, and My Schedule suites cover their respective consumers. Phase 0 adds one focused negative test in `client/src/utils/teamScheduleOccurrences.test.ts` confirming that the current resolver rejects a saved row whose declared service date disagrees with the local date of `startsAt`. This captures the exact invariant an exception-aware resolver must extend deliberately.

**Baseline run results:**

- Client focused Jest suites: **11 suites, 341 tests passed** across two completed batches (occurrence generation/identity, plan keys and occurrences, schedule reconciliation/periods, service-plan editing, availability suggestion, current-service resolution/workspace utilities, and countdown service-time behavior). A further batch containing `TeamsPlansPage.test.tsx`, `TeamsAndServices.test.tsx`, and `MySchedule.test.tsx` did not produce a summary after more than five minutes; it was stopped. `MySchedule.test.tsx` was also attempted alone and stopped after more than two minutes without a test summary. Those three suites are incomplete, not counted as passing or failing. The server suite includes My Schedule cases that passed, but does not replace those uncompleted client suites.
- Server focused Node test batch (`teamsApi`, availability workflow, current service workspace, public service plan, schedule responses, occurrence ownership): **356 tests, 353 passed, 2 failed, 1 skipped**. The two failures are existing `teamsApi.test.js` intake SMS cases: “individual intake SMS records one shared notification attempt and blocks duplicate accepted sends” (expected HTTP 200, got 409 at line 14434) and “individual intake SMS records provider failure and blocks missing consent, disabled messaging, revoked requests, and closed forms” (expected HTTP 200, got 409 at line 14661). They are outside the exception code paths; no production code was changed in this phase. They should be treated as baseline failures, not regressions from the added identity test.
- The relevant shared/client identity, generation, plan, and period files are identical between `master` and `in-progress-2`. `server/teamsAuthHandlers.js` contains unrelated branch changes; the `assertOccurrenceServiceGroup` recurrence/date validation used in this review has the same behavior on both branches. This is a targeted behavior comparison, not a claim that the entire server file is unchanged.

## Exact proposed Phase 1 scope

Implement only the independent exception persistence boundary: church-scoped RTDB records keyed by logical occurrence ID; authenticated list/upsert/remove endpoints with permission, authoritative recurrence/group/timezone validation, and revision/CAS; existing Teams synchronization notification; API types; and portable export/restore coverage. Add only persistence, authorization, concurrency, and transfer tests. Do not change occurrence generation or any runtime consumer in Phase 1. The next approval point should be the architecture and the five defaults above; no exception functionality has been implemented in this Phase 0 branch state.
