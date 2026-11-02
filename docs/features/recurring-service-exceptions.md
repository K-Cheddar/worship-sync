# Recurring Service Exceptions — Phase 0 Follow-Up

**Status:** Phase 0 follow-up complete; exception implementation not started.

**Branch reviewed:** `in-progress-2` (`ee25552b`) against `master` (`c0118de1`).

## A. Current architecture

### Service definitions and virtual occurrences

`ServiceTime` in `client/src/types.ts` is stored in the church Realtime Database under `churches/{churchId}/data/services`. The store listener in `client/src/store/store.ts` applies service-time changes. A definition includes a recurrence type (`one_time`, `weekly`, `multi_weekly`, or `monthly`), local service time, timezone-related settings, and optional service-group membership. Temporary `overrideDateTimeISO` is a separate countdown/current-time override handled by `client/src/utils/serviceTimes.ts`; it is not the recurring schedule source.

`client/src/utils/teamScheduleOccurrences.ts` implements `generateScheduleOccurrences`. It generates candidates from the recurrence rule and requested local-date range, resolves wall-clock times with `serviceDateTimeInTimeZone` from `shared/teamScheduleOccurrences.ts`, merges same-date members of a service group, then sorts the results. These generated rows are virtual: generating an occurrence does not create a schedule or plan record. The same generator is called from team scheduling, service-plan editing, current-service resolution, and availability-form flows.

### Identity and persisted records

The shared helpers in `shared/teamScheduleOccurrences.ts` create logical IDs as `serviceId@YYYY-MM-DD` or `group:<groupId>@YYYY-MM-DD`. Today that date is both the recurrence date and actual scheduled date. `resolveOccurrenceIdentity` requires `serviceDate` to agree with the local date of `startsAt`, then derives and checks the logical ID from that date. A moved row therefore cannot keep its old ID by changing only `startsAt`. Exception rows need two dates: `originalServiceDate` for logical identity and `serviceDate` for the actual local date of `startsAt`. When `originalServiceDate` is absent, the current legacy rules must remain unchanged.

Service plans are stored separately in Firestore. `getServicePlanKey` uses `logicalOccurrenceId` when present, so a preserved original-date ID already provides a stable plan key. The public serving projection in `server/servicePlanPublic.js` currently matches schedule rows by exact `startsAt`, then falls back to the plan's local date plus overlapping service IDs. That fallback cannot associate a plan dated on the original recurrence date with a schedule row moved to another date. The public projection must add stable `planKey`/`logicalOccurrenceId` matching, retaining the existing timestamp/date fallback for legacy records. The plan document, content, and history need not be rewritten; the public projection can resolve and present the current actual date from the exception.

Team schedules persist occurrence snapshots as well as operational data. `buildTeamSchedulePeriod` indexes saved rows across the provided schedules and matches by logical identity. `mergeCurrentScheduleOccurrences` currently retains the saved snapshot for a match; `ScheduleTab` offers a separate explicit refresh action. Assignments, responses, microphones, IEMs, and additional-position slots are keyed by `occurrenceId`, so retaining the same key preserves those maps. Server-side ownership claims are keyed by church, team, and logical occurrence ID and are checked transactionally.

There are important period boundaries. Client `findReusablePeriodSchedule` only chooses schedules whose saved bounds cover or overlap the displayed period. Server `ensureTeamScheduleForPeriod` rejects rows outside the requested period and validates the actual target date against the current recurrence; a generated-period schedule cannot change its date range, services, or occurrence-ID set. The owner claim lookup spans periods, so the target-period ensure can find an existing owner and reject creating a duplicate, but it cannot currently route the target view to that out-of-range owner. The generic schedule update path replaces schedule maps from the submitted payload and synchronizes responses, so it is not a safe implicit exception-snapshot patch.

### Other consumers and synchronization

- `client/src/pages/Teams/managers/IntakeManager.tsx` and `client/src/pages/Teams/intakeAvailabilitySuggestion.ts` generate or persist availability occurrences. Forms save occurrence snapshots; responses are keyed by occurrence ID in `occurrenceAvailability`. Later schedule changes must not silently change the meaning of already collected responses.
- `client/src/utils/currentServiceResolution.ts` (`listCurrentServiceOccurrences`), the Current Service hooks/workspace, and `client/src/utils/serviceTimes.ts` resolve upcoming or active services from generated occurrences and service plans. Temporary countdown overrides remain independent.
- Member schedules and public Team schedules primarily read saved schedule snapshots. Current Service and plan projections also use occurrence dates/timestamps. Every active projection must show the resolved date while retaining the original logical ID; submitted availability, past responses, and sent notification history remain historical records.
- Service definitions currently use a direct RTDB listener in the client. `firebase.json` configures Firestore rules but no RTDB rules file. For exceptions, an authenticated server API and the existing Teams synchronization stream are the safer boundary than exposing a new client-writable RTDB branch.
- Portable data transfer is assembled by `readPortableDatasets` in `server/teamsAuthHandlers.js`; service definitions and schedules are included today. Exception records must be added to export, preview/restore, and retry-safe import so a church backup does not omit them.

### Existing code to reuse

Reuse `serviceDateTimeInTimeZone` and the shared identity helpers instead of implementing another recurrence engine. Reuse `generateScheduleOccurrences` as the default-candidate source, `matchOccurrencesByIdentity`/`preserveStoredOccurrenceIds` for safe reconciliation, `getServicePlanKey` for plan association, the existing authenticated Teams API conventions, schedule ownership checks, and the existing Teams update stream. Server-side `assertOccurrenceServiceGroup` checks recurrence membership and group composition at the actual date supplied today. Exception validation must check recurrence and group membership at `originalServiceDate`, then independently validate the requested target date/time in the church timezone. Calling the current validator with only the destination date would reject valid moves or identify the wrong combined-service members.

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

For a combined service, store the group ID and full member-ID snapshot. Its current shared identity makes it one logical occurrence; do not split it into separately moved members in this design. The server derives and verifies the source identity and recurrence membership at `originalServiceDate` from authoritative church data. Store the target as church-local date and wall-clock time, and resolve `startsAt` with the shared timezone helper. Reject invalid local times consistently with current occurrence generation. The member snapshot lets the application detect a group edit without guessing at a new identity.

Create, replace, and remove records through authenticated server endpoints. Use an RTDB transaction or equivalent compare-and-swap on the individual key with an expected revision so concurrent edits and stale clients cannot overwrite one another silently. Emit the existing authenticated Teams change event after a successful write. Do not enable direct client writes to this path. The initial API can be exercised by tests and internal callers without adding a user-facing exception editor in Phase 1. The specific edit permission is still a product decision; `requireServicesEdit` is the current recommendation because the exception affects every team and public projection.

### Resolution and identity

The exception targets exactly one original logical occurrence. Keep `logicalOccurrenceId` stable as `serviceId@originalServiceDate` or `group:<groupId>@originalServiceDate`; add `originalServiceDate` explicitly to the resolved occurrence. Keep `serviceDate` equal to the *actual* church-local date of `startsAt`. The shared resolver must verify that the ID encodes `originalServiceDate`, that the stored/derived `serviceDate` matches `startsAt` in the church timezone, and that service/group membership matches the source occurrence. Rows without `originalServiceDate` retain the existing identity path and validation exactly.

Resolution flow:

1. Generate default candidates with the existing recurrence generator.
2. Load exception records and validate each against the current service definition, recurrence on the original date, service/group membership, and timezone. Do not require the destination date itself to match the recurrence rule.
3. Resolve candidate exceptions using the shared time resolver; keep the original logical ID and set actual date/time from the exception.
4. Filter results by actual scheduled date, not original recurrence date, and deduplicate on logical occurrence ID.
5. For a requested range, also consider exceptions whose original date is outside the range but whose target date can fall inside it. A lookup only by original-date candidates misses moved-in occurrences. Start with a church-scoped exception read and in-memory filtering; add a target-date index only if observed volume requires it. Moved-out defaults are omitted from their old date range.
6. If a recurrence or group edit makes an exception invalid, retain the record as stale/inert and surface it for repair or removal. Do not silently delete it, retarget it, or convert it into a new service occurrence.

Without an exception, return the same fields, IDs, and ordering as the current generator. Removing an exception makes the default recurrence candidate visible again. Only recurring occurrences are in the initial exception scope; one-time service records continue using current behavior. If the current recurrence or stored group membership no longer describes the original occurrence, keep the exception inert and repairable; never retarget it to a similarly named or newly grouped service.

### Same-period rescheduling findings

| Existing record | Current behavior | Required Phase 3 handling |
|---|---|---|
| No saved schedule or plan | Generated occurrences are virtual; exception-aware generation is sufficient. | Resolve the original identity to the target date/time and filter by actual date. |
| Service Plan exists | `getServicePlanKey` already uses the logical ID, but the stored plan date/start and public timestamp/date matcher stay on the original date. | Keep the plan document and history unchanged; join by `planKey`/logical ID and project the resolved start/date in public and current-service views. Retain legacy timestamp/date matching for old plans. |
| Draft schedule exists | The saved occurrence snapshot retains its old date. `mergeCurrentScheduleOccurrences` returns the saved row for a match, and the current UI refresh is a separate explicit action. | Use the exception-aware generated row as the read projection while keeping the persisted occurrence key and maps. Do not require a schedule refresh to make the new date visible. |
| Published schedule exists | Publication and schedule-level public-link state live on the owner schedule; member and public views read saved rows. | Keep publication state and owner unchanged. Project the resolved date in member/public outputs and notify/reload through existing synchronization paths. |
| Assignments, responses, equipment, extra positions, or notes exist | Maps/history are keyed by `occurrenceId`; an ID change or broad schedule replacement can lose or misapply data. | Keep the same original logical ID and occurrence map key. A date move alone must not rewrite assignment, response, equipment, or notification history. |
| Multiple clients view/edit | The existing Teams event stream synchronizes service/schedule updates, and schedule writes have owner/revision checks. | Commit the exception by per-key revision, publish after commit, and have clients re-resolve. Do not send stale full-schedule payloads just to update a date snapshot. |

The same-period case is therefore not a simple resolved-row update when saved records exist. The current saved snapshot wins in the schedule merge and in several member/public projections. Reconcile the *read projection* to the resolved row while preserving persisted snapshots and map keys; no bulk snapshot migration is needed. The new resolver and all affected consumers must be tested before Phase 3 is enabled.

### Cross-period schedule ownership options

The schedule owner is the active schedule document that already holds the occurrence and its keyed data. `buildTeamSchedulePeriod` can match saved identities across the provided schedules, and server owner claims prevent a second active owner across periods. Period navigation and `ensureTeamScheduleForPeriod` still filter on the saved parent range, so the target-period view cannot currently select that old owner by itself.

| Option | Works with current architecture | Data, concurrency, duplicates, and moving back | Relative complexity / recommendation |
|---|---|---|---|
| **A — Keep the owner and update its saved occurrence snapshot** | Not through the existing period ensure. It rejects target dates outside the requested range and current recurrence; generated-period schedule metadata is immutable. A generic update can replace maps from a client snapshot. | Same ID can keep assignments, responses, equipment, additional positions, and publication state in the owner. A narrow transactional snapshot patch could handle races; a generic schedule update risks stale map replacement and response side effects. Existing owner claims prevent duplicates. Moving back updates the same row. | Medium/high. Avoid a new write path unless later product requirements need persisted snapshot dates. |
| **B — Transfer ownership to a schedule in the destination period** | Not supported by existing routes. The source generated-period schedule cannot drop an occurrence ID, and the target ensure refuses a source owner when no destination period schedule is selected. | Requires an atomic source/destination/owner-claim transaction and copying every occurrence-keyed map. Schedule-level Published state, public links, and notification history do not belong to one occurrence, so transferring them is ambiguous. Move-back needs the reverse transfer and the original owner decision. | Highest complexity and regression risk. Do not make transfer the default architecture. |
| **C — Keep the owner and resolve a read-only target-period projection** | Not end-to-end today, but existing owner claims, `buildTeamSchedulePeriod`, and the read-only `resolveScheduleWorkspace` model provide the relevant identity/owner projection patterns. Navigation, server validation, public/member views, and ensure must become exception-aware. | Persisted maps and owner stay untouched; stable `occurrenceId` keeps assignments, responses, equipment, notes, and publication link state addressable. Exception CAS plus the existing update stream handles concurrent viewers; the global owner claim still blocks duplicate ownership. Removing the exception returns the same owner to its original date. | Lowest persisted-write risk and the smallest supported direction. **Recommended for Phase 3; exact projection/navigation details can remain deferred until then.** |

Phase 1 persistence does not depend on choosing any of these schedule paths. Keep the final cross-period consumer design deferred until Phase 3; do not implement a transfer mechanism in Phase 1.

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
| Identity invariant in `shared/teamScheduleOccurrences.ts` (`resolveOccurrenceIdentity`) | Old logical date plus new `startsAt` is rejected or conflates identity with actual date. | Add `originalServiceDate` to resolved rows; derive the logical ID from it and validate actual `serviceDate` against `startsAt`. Keep the legacy path unchanged when the new field is absent. |
| Range generation in `generateScheduleOccurrences` and consumers that request a period | A November 14 occurrence moved to November 21 is missed when a caller only generates the target range; moved-out occurrence may still be shown in the original range. | Resolve against original candidates plus applicable moved-in exceptions, then filter/deduplicate by actual date. Add out-of-range and cross-year tests. |
| Saved schedule ownership in `findReusablePeriodSchedule`, `buildTeamSchedulePeriod`, and `ensureTeamScheduleForPeriod` | Target range may not select the out-of-range owner; blindly generating a second schedule can duplicate ownership; current ensure validates target date against recurrence/range. | Keep one owner. Prefer the read-only owner projection in Option C; make target range, ensure, and all public/member readers exception-aware before Phase 3. |
| Saved occurrence snapshots and operational maps | Current merge keeps the saved row, while a generic schedule update can replace full maps or sync/prune responses. | Resolve the current date in projections and keep `occurrenceId` stable. Do not write schedule snapshots as a side effect of an exception. |
| Combined service identity and grouping in `generateScheduleOccurrences`, `logicalOccurrenceIdForGroup`, and `preserveStoredOccurrenceIds` | Moving only one grouped service changes one shared assignment set into multiple occurrences or leaves incomplete membership. | Treat group as one exception with a membership snapshot. Reject independent member moves in the first release. |
| Service plan keys and public association | `getServicePlanKey` already honors `logicalOccurrenceId`, but the public matcher uses exact `startsAt` then date plus service IDs. A move changes both legacy match values. | Preserve the plan document/key; add `planKey`/logical-ID matching in the public projection and retain timestamp/date fallback for legacy rows. |
| Availability snapshots and `occurrenceAvailability` in IntakeManager/server form handlers | Existing volunteer answers could be displayed against a different date or erased when form options refresh. | Keep submitted occurrence snapshots/history immutable; update future availability generation deliberately and reconcile existing form references without deleting answers. |
| Current Service and countdown resolution | Current-service consumers may keep using the default date or accidentally treat a temporary countdown override as a schedule exception. | Route consumers through the same resolved occurrence list; leave `overrideDateTimeISO` logic independent. |
| Server validator `assertOccurrenceServiceGroup` and bulk plan/schedule checks | The current validator checks recurrence and group composition at the destination date, where a valid exception may not recur. | Validate recurrence and group membership at the original date, then validate target date/time separately. Keep authorization, church timezone, and revision checks on the server. |
| Concurrent edits and existing Teams synchronization | Two stale clients can overwrite one exception or other clients can keep showing old dates. | Per-key revision/CAS; emit update only after commit; refetch or patch via the existing authenticated Teams stream. |
| Church timezone and DST | A stored UTC instant can shift local service intent when zone rules change; a nonexistent wall time cannot map to a valid start. | Persist church-local target date/time and resolve with `serviceDateTimeInTimeZone`; reject invalid local times and test spring gaps/fall folds. |
| Public schedules, notifications, and historical records | Public/member rows may show stale dates; rebuilding sent notifications or responses can misrepresent what members saw. | Project the resolved actual date in current views; keep submitted responses, sent notification intents, schedule snapshots, and plan content/history unchanged. Date-change notices remain a separate explicit product action. |
| Recurrence/group definition changes after an exception | The exception may refer to a removed service, no-longer-recurring date, or changed group membership. | Retain an inert stale record with a reason/status; require an authorized explicit repair or removal. Never retarget based on name/date guesses. |
| Portable transfer in `readPortableDatasets` and `server/dataTransfer/schemas.js` | Export/import omits the new source of truth and loses exceptions on restore. | Add an additive portable dataset and schema, validated and retry-safe, with round-trip tests before enabling the feature. |

### Collision policy resolved by current invariants

Do not reject two unrelated services merely because their target local date and time are equal. Occurrence IDs are service/group plus original date, and existing generation permits distinct service identities at the same instant. Reject duplicate logical IDs, incompatible combined-service membership, competing active schedule owners, and genuinely unsafe assignment/operational conflicts using their existing checks. Same-person cross-team assignment conflicts remain governed by the existing confirmation policy. Do not merge unrelated occurrences automatically.

## Backward-compatibility guarantees

- No exception: exact current generated occurrence fields, IDs, service grouping, and ordering.
- Existing plans, schedules, Draft/Published states, assignments, responses, equipment, and notification history remain addressable and are not bulk-rewritten.
- A moved occurrence keeps its original logical identity and has one actual scheduled date; resolving it never creates a second logical occurrence.
- The original recurrence date is identity; the actual local date comes from the resolved start. `originalServiceDate` is additive; rows without it retain current validation and compatibility behavior.
- Client and server use the same church-local date/time interpretation and validate against authoritative service definitions.
- Removing an exception restores the recurrence-generated occurrence under the same owner and key; it does not rewrite existing schedule or plan history.
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
- `client/src/pages/Teams/schedule/teamSchedulePeriod.ts`, `scheduleDraftUtils.ts`, `schedulePeriodUtils.ts`, `scheduleWorkspaceModel.ts`, `ScheduleTab.tsx`, and schedule edit components — saved-owner reconciliation, the existing read-only owner projection pattern, and cross-period handling.
- `client/src/pages/Teams/managers/IntakeManager.tsx`, `client/src/pages/Teams/intakeAvailabilitySuggestion.ts`, and form API types — future availability choices and saved response compatibility.
- `client/src/utils/currentServiceResolution.ts`, `client/src/utils/serviceTimes.ts`, `client/src/hooks/useDisplayedUpcomingService.ts`, `client/src/pages/Controller/CurrentServiceWorkspace.tsx`, and related Current Service hooks/viewers — current/upcoming/public resolution, while preserving countdown override behavior.
- Server schedule/plan/public/notification projections in `server/servicePlanPublic.js`, `server/notificationIntents.js`, and `server/teamsAuthHandlers.js` — resolved date display and preservation of historical notifications.
- `client/src/context/globalInfo.tsx` only if the existing authenticated Teams stream is not sufficient to keep exception consumers synchronized.

The exact Phase 1 touch list should stay smaller than this full integration list; it is limited to persistence, API/types, sync, portable transfer, and their tests.

### Phase 1 — Exception persistence

**Permitted:** Add only the church-scoped exception record schema; authenticated list/upsert/remove API; authoritative source recurrence/group validation; target date/time and timezone validation; per-key CAS/revision; the existing synchronization event; portable export/restore; API types and focused persistence tests.

**Deferred:** Do not change recurrence output, schedule/plan/form/current-service consumers, UI, service definition behavior, or existing persisted schedule records. No migration and no automatic exception creation.

**Acceptance criteria:** Exception records survive without a plan or schedule; unauthorized, wrong-church, malformed, non-recurring-source, and stale-revision requests are rejected; concurrent updates cannot silently overwrite; removal only removes the exception record; portable export/restore round-trips records idempotently; ordinary generation and all runtime consumers remain unchanged.

**Required tests:** CRUD and church scoping; the approved permission boundary; source recurrence and original-date group membership; a valid target date/time in church timezone; revision conflict and concurrent update; invalid target date/timezone; missing/archived service rejection; one post-commit sync event; export/restore and retry idempotency; no change to generated output. Existing recurrence tests remain unchanged and pass.

**Potential regressions:** Incorrect permissions could grant team-only users church-wide scheduling power; path/schema mismatch could make backups incomplete; duplicate events could cause stale client views. Keep writes server-only, validate under the owning church, and publish one event after commit.

**Review/rollback:** Review persistence/API and portable transfer separately from any consumer. Since no consumer reads the records in this phase, the API/event wiring can be disabled while records are retained for a forward fix. Keep backup/restore support; do not delete exception data as rollback.

**Implementation gate:** The permission is not owner-approved in the current contract. Recommended minimum is the existing church-wide Services edit permission (`requireServicesEdit`), because an exception affects every team and public view. Confirm that permission before implementing or exposing the Phase 1 write endpoints; team-scoped schedule managers must not implicitly gain church-wide authority.

### Phase 2 — Exception-aware occurrence generation and identity

**Permitted:** Add an exception-aware wrapper around the shared default generator; add `originalServiceDate` to resolved exception rows; resolve target date/time with the existing shared timezone helper; make server validation use the same source-identity rules.

**Deferred:** Do not yet alter saved schedules, plans, availability forms, notifications, or UI. Do not alter the underlying recurrence definitions or legacy rows.

**Acceptance criteria:** No-exception output is byte-for-byte/equivalent in fields and IDs to current output; exceptions retain the original logical ID, use the actual `serviceDate`, move in/out of requested ranges including month/year edges, and removal restores the default; invalid/stale records cannot produce duplicates or guessed occurrences.

**Required tests:** Weekly, monthly, multi-weekly, and one-time unaffected; moved-in/out; source date outside requested range; cross-month/year; two unrelated services at the same date/time remain distinct; duplicate logical identity and group conflicts fail; stale/deleted service; DST gap/fold; timezone change semantics; client/server identity agreement.

**Potential regressions:** A changed resolver may reinterpret legacy rows; range lookups may be incomplete or duplicate candidates; group member changes may silently split identity. Keep legacy behavior when `originalServiceDate` is absent, deduplicate by logical ID, and reject stale group snapshots.

**Review/rollback:** Keep the resolver unused by normal consumers until Phase 3. Do not add a new gate solely for rollback. If a resolver is already used by any consumer, that consumer must continue resolving persisted exceptions until those exceptions are explicitly restored; do not switch it to default generation while moved records exist.

### Phase 3 — Saved schedules, plans, and other consumers

**Permitted:** Integrate the resolved occurrence with saved Draft/Published schedules, plan associations, public/member projections, availability choices, Current Service, and notification refresh. Use Option C: keep the saved owner and maps in place, and resolve the actual date in each read projection. Do not transfer owners or rewrite schedule/plan snapshots as a side effect of a date exception.

**Deferred:** No exception editor or broad recurrence redesign; no rewriting of historical notification or availability response records; no independent moves of members of a combined service.

**Acceptance criteria:** Existing owner remains unique across date ranges; moved-in rows appear once in the target range and disappear from the original range; populated assignments, responses, microphones, IEMs, additional positions, notes, publication links, and plan associations remain addressable by the same ID; Draft/Published and public/member projections show the actual date; moving back restores the original date without transfer; submitted responses and sent notification history remain intact.

**Required tests:** Same-period reschedule with no saved data, existing plan, Draft schedule, and Published schedule; stale snapshot projection with all operational maps intact; cross-period owner visible once and move-back; duplicate owner and group conflict; stable plan-key association plus legacy timestamp/date fallback; public/member projections; availability answer/history preservation; current-service lookup; multi-client event/refetch; notification history; concurrent edits.

**Potential regressions:** An owner outside the visible range may be hidden; stale saved dates may leak into member/public projections; old plan timestamps may fail association; a stale client could show the occurrence on both dates. Require stable-ID projection, original-date masking, global ownership checks, and no implicit answer/history mutation.

**Review/rollback:** Review each consumer family independently. If a defect appears, stop new exception writes but keep exception-aware reads active so existing rows do not revert, disappear, or duplicate. Restore one occurrence through the explicit restore operation; only after active exceptions are restored may the resolver be disabled. No transfer compensation is needed because this phase does not mutate schedule ownership or operational maps.

### Phase 4 — UI, end-to-end verification, and controlled rollout

**Permitted:** Add a reschedule/restore action on the service occurrence management surface, stale/conflict messaging, and audit-friendly confirmation; enable after Phase 3 coverage. Reuse an existing rollout gate if one exists; do not add bespoke flag infrastructure solely to make rollback possible.

**Deferred:** No bulk exception creation and no change to recurring service definitions as a shortcut.

**Acceptance criteria:** The approved role can move or restore one occurrence; a combined occurrence is presented as a unit; genuine identity/ownership conflicts are explicit while unrelated same-time services remain valid; stale records are repairable; the recurrence rule and future occurrences are unchanged; all consumers show one actual date.

**Required tests:** UI authorization and validation, API end-to-end move/restore, group behavior, conflict handling, cross-period populated schedule, export/restore, timezone/DST, countdown independence, and regression suites across scheduling, plans, forms, current service, public/member views, and notifications.

**Potential regressions:** Users may mistake a one-time exception for a recurrence edit, or may move the wrong grouped service. Show original and target dates and make restore explicit; preserve server-side validation.

**Review/rollback:** Rollback disables new create/update actions, but leaves exception reads and individual restore active. Keep the reader until every active exception has been restored; removing an exception is the supported way to put that occurrence back. Persisted rows are not deleted as a feature-wide rollback.

## F. Outstanding decisions

1. **Phase 1 authorization — blocking:** Confirm which existing role can create/update/remove a church-wide exception. Recommend the existing Services edit permission. Team-scoped schedule managers should not gain church-wide authority by implication.
2. **Combined services — confirm before Phase 4:** The current shared identity and assignments treat a combined occurrence as one unit. Recommend preserving that behavior; moving one member independently needs a separate product/data design.
3. **Target-time editing — confirm before Phase 4:** The stored target date/time is local to the church. Recommend keeping the source occurrence's local wall-clock time for the initial move flow; allow time edits only with an explicit product requirement. Phase 1 persistence can store/validate the target time without exposing a time editor.
4. **Timezone changes — confirm before Phase 4:** Recommend resolving the stored church-local target time with the church's current timezone, consistent with recurrence generation; reject nonexistent local times. This keeps wall-clock intent if zone rules change.

Cross-period ownership is not a Phase 1 decision. Option C is the recommended Phase 3 direction based on existing owner claims and read projections; the detailed navigation/publication handling can be decided with those consumers. Destination-time collisions are resolved by current identity and assignment invariants: unrelated services may share a time; duplicate IDs, group/owner conflicts, and actual assignment conflicts follow their existing checks.

## Phase 0 baseline and status

Existing occurrence tests cover weekly, monthly, multi-weekly, one-time, stable IDs, date ranges, combined groups, group membership changes, DST gaps/folds, and local timezone handling. Existing plan-key/occurrence, schedule reconciliation/period, current-service, service-time/countdown, availability, and ownership suites cover current consumers. The legacy resolver test confirms that without `originalServiceDate`, a saved date that disagrees with the local date of `startsAt` is rejected. Follow-up added a focused snapshot-retention test and a public plan date-fallback characterization test; neither adds exception runtime behavior.

**Follow-up verification (November 2, 2026):**

- Client: Jest `--runInBand` ran 11 focused occurrence, plan-key, schedule, availability, and current-service suites: **269 passed**. This selection did not reproduce the earlier reported 341-test selection, whose exact commands were not recorded; treat that count as historical, not freshly verified. The added `schedulePeriodUtils` snapshot test passed within this batch (**48 tests** in that suite). `TeamsPlansPage.test.tsx`, `TeamsAndServices.test.tsx`, and `MySchedule.test.tsx` were retried together with `--runInBand`; no summary appeared after about two minutes, so the run was stopped. Serial execution did not make them reliably complete. The prior standalone My Schedule attempt was also incomplete. They remain uncounted.
- Server: `node --import tsx --test` ran `teamsApi`, team availability workflow, current-service workspace, public service plan, schedule responses, and schedule occurrence ownership: **371 total, 367 passed, 2 failed, 2 skipped**. The added `servicePlanPublic` characterization test passed within its suite (**27 passed**). The two failures are the same existing intake-SMS cases in `teamsApi.test.js` (expected HTTP 200, got 409); they are outside this feature. The current worktree has unrelated uncommitted server changes, including `server/teamsApi.test.js`, so this is not a clean committed-branch baseline. The earlier reported 356/353/2/1 result remains historical.
- Direct comparisons of the committed shared identity, client schedule-period, server schedule-validation, and public-plan source files found no differences between `in-progress-2` (`ee25552b`) and `master` (`c0118de1`). This was a risk-scoped comparison, not a whole-branch audit. Uncommitted user work in the shared worktree was preserved.

## Exact proposed Phase 1 scope and readiness

Implement only the independent exception persistence boundary: church-scoped RTDB records keyed by canonical logical occurrence ID; authenticated list/upsert/remove APIs; server validation against the source recurrence date, group membership, target local date/time, and church timezone; expected-revision CAS; the existing Teams synchronization notification after commit; API types; and portable export/restore. Keep the exact touch list to exception persistence/handler routes, existing event wiring if sufficient, portable dataset/schema, types, and focused tests.

**Acceptance:** Records can exist without a plan or schedule; source occurrence/group identity is authoritative; permission, church scope, malformed values, invalid local times, and stale revisions fail safely; simultaneous updates cannot overwrite silently; one event follows a committed change; export/restore round-trips idempotently; removal deletes only the exception; recurrence generation and schedule/plan records remain untouched.

**Explicitly out of scope:** No occurrence generation changes, consumer/UI changes, schedule snapshot or owner mutation, plan rewrite, migration, or exception runtime activation.

**Phase 1 readiness: Not Ready until the write permission is confirmed.** That policy is a direct API authorization requirement, not a dependency on Phase 3 ownership or reconciliation. Smallest action: approve the existing church-wide Services edit permission (`requireServicesEdit`) for the exception API, or name another existing church-wide role. Once confirmed, Phase 1 can proceed independently of cross-period ownership, same-period projection, collision handling, and public plan association; those remain Phase 3/4 work.
