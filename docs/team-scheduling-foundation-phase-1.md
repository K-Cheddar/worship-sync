# WorshipSync Scheduling Foundation — Phase 1 Audit

**Status:** Phase 1 audit and contract definition complete; no scheduling implementation changes made.

**Primary target:** worship-sync-2, branch in-progress-2.

**Comparison target:** worship-sync, branch in-progress. No branch merge was performed.

**Approved behavior:** [Team Scheduling Contract](features/team-scheduling.md), approved by the product-owner prompt supplied on 2026-10-12.

## Executive summary

WorshipSync already has useful building blocks: automatic recurrence generation, service-group merging, church-timezone context on in-progress-2, saved occurrence snapshots, team position requirements, schedule documents that retain assignments and equipment, availability references, service-plan lookups, permission checks, public/member readers, and a deliberate send endpoint. Those pieces should be strengthened and connected, not replaced with an iCalendar implementation or a new scheduling product.

The main inconsistency is that an occurrence has no single durable identity and owner across all boundaries. Normal occurrence IDs include the current start instant; the team editor filters services before grouping while server validation expects the whole group; generated schedule reuse requires all current occurrences to already be present; and compatibility matching can treat a different service as the same occurrence based on name and time. Reconciliation also has code that deliberately keeps the first colliding value. Publication status does not exist for team schedules, and member/public readers have no Draft gate.

The source inspection confirms the previously reported issues. Existing tests enforce several behaviors that conflict with the approved contract; those expectations must be replaced when implementation is authorized.

## Scope and working-tree notes

The audit traced service definitions through occurrence generation, team period construction, schedule selection and first-edit persistence, assignment/equipment/response maps, availability, service plans, server validation and persistence, member/public views, and explicit notification delivery.

At the start of this work, both target branches were clean. During the audit, a separate team-availability change appeared in the primary checkout: server/teamsAuthHandlers.js is modified and server/teamIntakeRecipientConcurrency.test.js is untracked. Those changes concern availability-form recipient scope/locking, not the scheduling foundation. They were left untouched and excluded from the branch comparison. Separate availability-related client edits also appeared in the comparison checkout and are recorded in the branch comparison section. Because the modified handler is shared with the schedule API, the server suite will be run against the current working tree and the result will be identified as such.

The audit is read-only with respect to production behavior, persistence schemas, and existing schedule documents. The only changes in this phase are the contract, this report, and the feature-registry link.

## Current architecture map

### 1. Service definitions and recurrence

- Client service definitions are loaded into the Teams/Services surface. On in-progress-2, ChurchServiceTimeZoneProvider obtains the church timezone; TeamsPageContext passes it to the team views.
- client/src/utils/teamScheduleOccurrences.ts owns generateScheduleOccurrences, serviceDateTimeInTimeZone, and mergeGroupedOccurrences. It expands recurring/one-time service definitions, creates serviceDate metadata, generates normal IDs from service ID plus the current ISO start, and merges serviceGroupId members by church-local date. A grouped occurrence uses group ID plus local date, earliest start, joined names, all service IDs, and merged position requirements.
- client/src/pages/Teams/schedule/teamSchedulePeriod.ts builds a period for selected teams. It first computes relevant services, filters the church service list to those services, then calls the shared generator. It also assembles requirements for the selected teams.
- client/src/pages/Services/servicePlanOccurrences.ts passes all church services into the shared generator before selecting the requested service, which allows it to merge a group that the team schedule may have filtered out. getOneTimeServiceOccurrence derives its query date from overrideDateTimeISO when present.
- client/src/utils/servicePlanKeys.ts uses its own service-ID/date or group-ID/date plan-key format. It does not use the schedule occurrence ID as a shared persisted key.

### 2. Schedule selection and first save

- client/src/pages/Teams/schedule/ScheduleTab.tsx builds a virtual period, finds a saved schedule with findReusablePeriodSchedule, and presents overlap choices where necessary.
- The view remains virtual until an edit path invokes ensureActiveSchedule. That sends the generated period and the client’s serviceTimeZone to ensureTeamScheduleForPeriod. Assignment, microphone, and other edit paths use that schedule before saving.
- The server validates payloads against active church service definitions, reconstructs group requirements, and stores a generated-period document. Its deterministic document ID hashes church, team, and requested date bounds.
- Existing schedules are candidate matches only when coversCurrentOccurrences says they cover the current generated occurrences. If the canonical document ID already exists but is incomplete, ensure returns 409 instead of adding the missing occurrence.
- Schedule summaries and full records are loaded through teams bootstrap/API paths. A schedule stores occurrence records plus maps keyed by occurrence ID (and position/cell key).

### 3. Assignment and reconciliation data

- teamSchedules documents contain church/team identity, date bounds, service IDs, occurrences, assignments, guests, responses, microphoneAssignments, iemAssignments, additionalPositionSlots, optional position slots, sentAt, public-link token/hash, and archive/audit fields. There is no team-schedule publication status.
- Assignment cells can hold a primary member and shadow members; guests are schedule-scoped. Responses are nested by occurrence ID and cell key. Equipment and extra-slot maps also reference occurrence IDs.
- client/src/pages/Teams/schedule/scheduleDraftUtils.ts maps old rows to new rows using service/date, service order, and fallback replacements. Multiple source rows can map to one target; the current merge keeps the earliest source cell on collisions. Occurrence-level equipment rows also keep the first value.
- ScheduleTab refresh paths rekey assignment/equipment rows after service edits. Responses are not remapped in the same client helper path; server response synchronization prunes responses whose assignment cell no longer exists. This makes a changed identity/grouping a data-safety boundary, not just a rendering change.
- Team roster, teams, positions, qualifications, and per-service position requirements provide the staffing model. Existing permissions remain in the server authorization layer and are outside the proposed product changes.

### 4. Availability and service plans

- client/src/pages/Teams/intakeAvailabilitySuggestion.ts can resolve stored availability occurrence references or generate from availabilityServices. It then compares them with generated team-period occurrences and group coverage. These keys can drift when a service is rescheduled or group membership changes.
- Availability forms are persisted separately in teamIntakeForms and retain service or occurrence references. They are not a canonical occurrence owner.
- Service plans are persisted separately with service/group/date relationships and a planKey. Service-plan publication metadata is distinct from team-schedule publication. A group/service ID change can therefore affect plan resolution independently of a saved team schedule.
- server/teamsAuthHandlers.js resolves plans for member schedule entries through getServicePlanKeyForOccurrence. It relies on stored occurrence/plan relationships rather than a shared occurrence registry.

### 5. Visibility, public links, and notifications

- getMyTeamAssignments in server/teamsAuthHandlers.js finds a member’s active schedule assignments and returns the relevant roster entries. It skips archived schedules but has no Draft/Published status check.
- ensureTeamSchedulePublicLinkToken can mint a public token. getTeamScheduleByToken checks token and archive state; getPublicTeamSchedule returns a sanitized schedule snapshot without a publication-state check.
- Client TeamSchedule and TeamScheduleSummary API types include sentAt but no publication status or publishedAt value.
- Schedule send is an explicit handler that calls notifyScheduleAssignments and then writes sentAt/history. Assignment updates may produce notification-event intents/previews, but they do not call the delivery function. Publishing controls do not exist for team schedules today.
- Service-plan publication is a separate workflow and does not establish team-schedule visibility.

## Branch comparison

- in-progress-2 adds ChurchServiceTimeZoneProvider, timezone-aware occurrence construction, and church-local serviceDate fields across more schedule/member paths. The in-progress comparison branch lacks that provider and the serviceDate field, and its occurrence construction relies on local/system time behavior.
- Both branches still filter services for the selected team before group merging, use period-bounds for generated schedule IDs, and have name/time semantic compatibility matching. The primary branch’s timezone work narrows a real discrepancy but does not make the server timezone authoritative because ensure still trusts the request body.
- No merge was made. The comparison checkout also has a modified client/src/pages/Teams/availabilityRecipientSelection.ts and an untracked client/src/pages/Teams/availabilityNotificationHistory.ts. These availability-related edits appeared after the initial clean status, were left untouched, and are excluded from the scheduling branch comparison. The primary checkout’s separate availability-form edits are recorded above and were not included in the comparison.

## Persistence and legacy compatibility inventory

- **Service definitions and groups:** active service rows have stable service IDs, recurrence/date/time fields, optional serviceGroupId, positionRequirements, and archive state. The client consumes church service-time data; server ensure reads it through readChurchServiceTimes. Service-group membership is the current combined-occurrence source.
- **Occurrence records:** there is no separate durable occurrence collection. The generator creates IDs and metadata; team schedule documents embed occurrence snapshots including occurrenceId, serviceId/serviceIds, groupId, startsAt, serviceDate, name, and requirements. Assignment and equipment maps use those embedded occurrence IDs as keys.
- **Generated, custom, and legacy schedules:** records are stored in teamSchedules. Generated rows use source=generated-period and a generatedPeriodKey hashed from church/team/date bounds; custom and older rows may not carry that source/key. Period bounds are selection hints, not a unique owner per logical occurrence.
- **Operational maps:** assignments are nested by occurrence and position-slot key; guest assignments are schedule-scoped; responses are nested by occurrence and cell; microphones, IEMs, optional/additional position slots also refer to occurrence IDs. sentAt and notification-event/ledger records track prior sends and deduplication. The public schedule token is stored with a hash; response flows also use scoped tokens. These references make an ID rewrite a multi-reader compatibility change.
- **Availability:** team intake forms are persisted separately in teamIntakeForms. Forms can retain service lists and occurrence references with service ID, occurrence ID, startsAt, and serviceDate; they do not own the schedule occurrence.
- **Service plans:** plan rows live separately and use planKey with service ID or service group plus service-local date, with plan publication and public share/token metadata. Service-plan published is not team-schedule published.
- **Visibility metadata:** team schedules currently have no status/publishedAt field. sentAt is notification history and must not be reused as publication status. Existing public links and member reads must remain visible when the future status field is absent.
- **Record-level limits:** no live church Firestore records were queried, and no schedule migration was run. The report therefore cannot count existing duplicate owners or verify the contents of a particular October schedule. A later implementation must inventory those records and preserve populated October schedules before changing identity/ownership.

## Verified findings

Severity reflects user impact and data risk under the approved contract. “Confirmed” means the mechanism is present in the inspected code. A described concurrency interleaving is a structural risk; it was not stress-reproduced against production Firestore.


### P1 — Combined-service periods can be rejected by the server (confirmed)

**Path:** teamSchedulePeriod.ts buildTeamSchedulePeriod → ScheduleTab ensureActiveSchedule → server ensureTeamScheduleForPeriod → assertOccurrenceServiceGroup.

**Mechanism:** The client filters service definitions to the selected team’s relevant service IDs before grouping. If a combined group has one service requiring Team A and another requiring Team B, a Team A-only editor sends a plain occurrence with one service ID. Server validation scans every active church service in the configured group and expects the canonical combined service list. It rejects the client payload with 400. The team-period tests “filters unrelated group services before grouping team occurrences” and “does not pull an unrelated same-date group member into the team occurrence” currently assert the client behavior that triggers the boundary mismatch. A test building the union across multiple selected teams does not cover the one-team editor → server boundary.

**Impact:** Editors can fail to open or first-save a combined service schedule. Assignment requirements and service membership differ by which component generated the request.

**Minimal fix:** Generate canonical occurrences from all active church services first, then filter only requirements/columns for the selected team. Keep full group service IDs in the ensure payload; derive team-specific staffing requirements separately. Add an integration-style test passing the actual client builder output into the actual server ensure handler.

**Compatibility risk:** A saved team-only occurrence for a currently combined group may be a legacy partial record. Read it with an explicit compatibility path; do not silently rewrite it or its assignments.

### P1 — Adding a service to an existing period returns 409 instead of reconciling (confirmed)

**Path:** server ensureTeamScheduleForPeriod, generatedPeriodKeyFor, coversCurrentOccurrences, reuseExisting.

**Mechanism:** The document ID is based on church, team, and period dates, so it remains the same when service definitions add another occurrence inside that period. Existing schedule selection first looks for a schedule covering every current occurrence. If the canonical document exists but lacks the newly added occurrence, reuseExisting returns 409. There is no additive merge of occurrence rows or map keys. The test “generated period rejects incomplete canonical reuse without overwriting any saved map” verifies the 409, which protects current data but contradicts the approved automatic-inclusion behavior.

**Impact:** An editor cannot use the applicable saved schedule after adding an ad-hoc service, even though it contains assignments that must be retained.

**Minimal fix:** Reconcile the new canonical occurrence into the selected owner schedule transactionally. Preserve existing assignment, response, guest, and equipment maps. If more than one legacy schedule is a plausible owner, ask the editor rather than picking one.

**Compatibility risk:** October populated schedules and existing custom/legacy documents must remain intact. The generated-period document ID can remain a period lookup key, but it cannot alone prove occurrence ownership.

### P1 — Normal occurrence identity changes when its time changes (confirmed)

**Path:** teamScheduleOccurrences.ts occurrenceIdFor/toOccurrence; assignments, responses, equipment maps; ScheduleTab refresh/rekey path.

**Mechanism:** A standalone occurrence ID includes the current startsAt timestamp. Editing service time therefore changes the ID even if service ID and logical service date stay the same. Group IDs use group ID/date, so grouped and ungrouped forms also have different key shapes. Schedule maps are keyed by occurrence ID; refresh paths must manually rekey data, and response maps are not included in the same client remap. The current key does not independently preserve the identity required by the contract.

**Impact:** A routine time adjustment can strand assignments, responses, or equipment in a saved document or make old member/availability references unresolvable.

**Minimal fix:** Choose a persisted canonical occurrence ID that survives time changes (or persist an equivalent original recurrence identity). Add one explicit legacy resolver and transactionally rekey all operational maps with conflict detection.

**Compatibility risk:** Do not rename populated IDs in place without covering older readers, public tokens, availability references, service-plan links, and historical records. Preserve existing October schedule data and support a transition/read path.

### P1 — Regrouping silently drops conflicting assignments and equipment (confirmed)

**Path:** scheduleDraftUtils.ts buildRemappedAssignments, rekeyAssignmentsByServiceDate, and rekeyScheduleOccurrenceRowsByServiceDate; ScheduleTab refresh paths; server syncScheduleResponsesToAssignments.

**Mechanism:** Several source occurrences may map to one grouped target. buildRemappedAssignments keeps the first source value in each cell; the test “lets the earliest service win a contested cell on merge” explicitly expects the other value to disappear. Occurrence-level equipment/extra-slot rows also keep the first. Responses are not rekeyed with the assignment helper, and server synchronization prunes responses for missing cells.

**Impact:** Grouping services can silently remove one assignment cell (including a guest-as-assignee), drop an occurrence-level microphone, IEM, or extra-slot row, or leave a response that the server later prunes. Guest records are schedule-scoped, but their assignment references can be lost with a colliding cell.

**Minimal fix:** Make remapping return both unambiguous values and a conflict report containing every original value and source occurrence. Save the unambiguous portion only after the operator resolves collisions; preserve conflict values until resolution. Reconcile guest assignment references, responses, microphone, IEM, and extra-position maps with the assignment rows in one transaction.

**Compatibility risk:** Existing stored IDs may already reflect previous lossy merges. Do not fabricate values; surface only conflicts still present in saved data and preserve the existing schedule snapshot.

### P1 — Draft and Published visibility is not implemented (confirmed)

**Path:** TeamSchedule/TeamScheduleSummary API types; getMyTeamAssignments; ensureTeamSchedulePublicLinkToken/getTeamScheduleByToken/getPublicTeamSchedule.

**Mechanism:** Team schedules have no publication field. Member reads include assignments from every non-archived schedule. Public reads require a token but do not check a schedule publication state; an editor can mint a token for a saved schedule. The current “sanitized public snapshot” test covers field sanitization, not draft visibility.

**Impact:** The required private Draft lifecycle cannot be enforced. Once a saved schedule or public link is exposed, member/public visibility is not controlled by a publish/unpublish action.

**Minimal fix:** Add a whole-document status with Draft and Published transitions, gate every member/public server reader, and keep editors’ own reads unrestricted. Treat missing status as Published. Publish/unpublish must not call notification delivery. Keep notification sending behind the explicit send endpoint.

**Compatibility risk:** Default all legacy documents without status to Published, including populated schedules and previously shared links. A rollback must leave those documents readable and must not change their assignments or sentAt/history.

### P1 — Schedule ownership is keyed to period bounds, not team-occurrence (confirmed design gap)

**Path:** generatedPeriodKeyFor/ensureTeamScheduleForPeriod and createTeamSchedule/updateTeamSchedule.

**Mechanism:** Deterministic generated IDs serialize concurrent ensures for the same team and exact date range. Different ranges have different IDs even when they overlap on a logical occurrence. Candidate lookup occurs before the create transaction, and the transaction creates only its range-derived document; there is no durable unique claim for each team-occurrence pair. Generic custom schedule create/update paths also lack an ownership record keyed by logical occurrence. The existing concurrency test covers the same canonical period ID, not different bounds racing for one occurrence.

**Impact:** Two active schedules can become competing owners of the same team occurrence, causing duplicate assignment edits or divergent public/member views.

**Minimal fix:** Establish transactional ownership claims keyed by church, team, and canonical occurrence ID. Create, edit, archive, and legacy resolution must update those claims atomically with schedule documents. Return an ambiguity response when legacy records already claim the same occurrence.

**Compatibility risk:** Existing overlaps and duplicate schedules are explicitly not to be silently merged or deleted. First inventory claims and let an operator resolve true duplicates; different teams remain independent owners.


### P1 — Server trusts the ensure request’s timezone (confirmed)

**Path:** ScheduleTab ensureActiveSchedule sends serviceTimeZone; server ensureTeamScheduleForPeriod reads req.body.timeZone and uses it for local-date validation, service occurrence validation, and canonical serviceDate. The endpoint does not read the church’s configured serviceTimeZone. Member assignment reads do load the church setting.

**Mechanism:** A stale or altered client can submit a different valid timezone. The server then validates the instant and stores serviceDate according to that client value.

**Impact:** Two authorized editors can generate different recurrence dates or identities for the same service, violating the church-timezone contract.

**Minimal fix:** Resolve timezone from the church record on the server and use it for generation/validation. Reject or ignore a mismatched request value. Keep the client value as a display hint only.

**Compatibility risk:** Existing documents may contain serviceDate values calculated in the operator timezone. Preserve their original instant and use an explicit legacy resolver; do not silently shift the time.

### P1 — Same-name/same-time fallback can adopt a different service (confirmed)

**Path:** client schedulePeriodUtils.ts and server coversCurrentOccurrences.

**Mechanism:** After exact occurrence ID matching, compatibility checks match unmatched rows by lowercased service name and start instant, without requiring the same service ID or group membership. Tests “reuses equivalent occurrences after service IDs change” on the client and “generated ensure reuses semantically equivalent occurrences after service IDs change” on the server encode this fallback. Two distinct services can share a name and time.

**Impact:** A schedule can be reused for the wrong service identity, carrying assignments to a different service. That also defeats explicit operator resolution when occurrence ownership is ambiguous.

**Minimal fix:** Remove name/time matching as an ownership rule. Use canonical identity and an explicit, reviewable legacy mapping. A same-name/time occurrence with a different ID must remain distinct until an operator resolves the old record.

**Compatibility risk:** Removing the fallback may surface older records as unresolved. Do not bulk remap based on names; preserve data and make the mapping explicit.

### P2 — Spring-forward gap generation and validation disagree (confirmed)

**Path:** client serviceDateTimeInTimeZone versus server assertOccurrenceServiceGroup/getServiceOccurrenceTime.

**Mechanism:** The client resolves a nonexistent wall time by moving it forward to the first valid same-date time; a client test expects this behavior for New York 2026-03-08 02:30. Server validation compares the resulting local wall time with the configured service time and rejects the shifted value. Fall-back folds currently choose the earlier instant client-side, consistent with RFC 5545’s interpretation of an ambiguous local recurrence.

**Impact:** A recurrence can appear in the client and be rejected on first save. DST behavior may also vary by which code path expanded it.

**Minimal fix:** First resolve the open product decision in the contract. Then make client and server use one tested policy and shared examples. RFC 5545 says invalid recurrence instances are ignored and an ambiguous local time refers to its first occurrence; the current move-forward gap rule is a different product choice.

**Compatibility risk:** Changing gap policy can add or remove future schedule occurrences. Do not reinterpret populated dates without an explicit compatibility rule.

### P2 — Availability and service plans do not share one occurrence key (confirmed divergence; full impact needs boundary tests)

**Path:** intakeAvailabilitySuggestion.ts; servicePlanOccurrences.ts/servicePlanKeys.ts; teamScheduleOccurrences.ts; server getServicePlanKeyForOccurrence.

**Mechanism:** Team schedules store schedule occurrence IDs; availability may persist occurrence references or service lists; plans use service/group/date keys. The service-plan generator builds full groups, while the team-period builder filters before grouping. Service plans are resolved using stored dates/plan keys rather than the schedule occurrence ID. These distinct representations disagree when group membership or service IDs change, and availability can use the team-filtered shape.

**Impact:** A volunteer availability entry or service plan may no longer line up with a rescheduled/regrouped team occurrence. The scope is a confirmed identity divergence; each end-user failure needs a cross-boundary regression test.

**Minimal fix:** Make these feature-specific indexes resolve through the authoritative occurrence identity and provide an explicit compatibility lookup for existing references. Do not make all feature data physically share one document.

**Compatibility risk:** Existing plan keys and form references may be used by public links or response flows. Preserve old keys until every reader can resolve the canonical occurrence.

### P2 — One-time override is used to choose a plan date but not its generated time (confirmed)

**Path:** ServiceTime.overrideDateTimeISO; servicePlanOccurrences.ts getOneTimeServiceOccurrence; generateScheduleOccurrences.

**Mechanism:** getOneTimeServiceOccurrence uses overrideDateTimeISO to choose the date range, while shared one-time generation reads dateTimeISO. A same-day override can return the original start instant; a different-day override can query a date on which the generator finds no occurrence. Team schedule generation uses the same base definition.

**Impact:** The one-time service timer/UI and schedule/plan occurrence can refer to different dates or times. Whether this is a defect depends on the unresolved meaning of the override.

**Minimal fix:** Resolve whether overrideDateTimeISO changes the scheduled occurrence or only a live countdown. Then make service plans and schedules follow that single meaning and add same-day/different-day tests.

**Compatibility risk:** Existing overrides may be temporary countdown adjustments. Do not reinterpret saved overrides as schedule changes without product approval.

## Established patterns and reusable code

- RFC 5545 recurrence identity offers a useful model: RECURRENCE-ID identifies the original scheduled instance even when the actual instance is moved. This is relevant to stable identity; it does not require adopting full iCalendar import/export. RFC rules also define timezone-aware recurrence and specify behavior for ambiguous/nonexistent local times. See [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html).
- WorshipSync’s existing recurrence subset is small and custom: weekly, multiple weekdays, nth weekday monthly, and one-time services. The client package declares date-fns v4; date-fns’ timezone guidance uses its separate @date-fns/tz package. No recurrence library is needed for the current rule set, and a timezone helper would not decide identity or DST product semantics. See [date-fns timezone documentation](https://github.com/date-fns/date-fns/blob/main/pkgs/core/docs/timeZones.md).
- Planning Center’s Services API models plans, service types, team positions, and person/team position assignments as separate concepts. WorshipSync already has comparable services, requirements, positions, and assignments; reuse those domain boundaries rather than cloning another application. See [Planning Center Plan](https://api.planningcenteronline.com/docs/apps/services/versions/2018-08-01/vertices/plan) and [Person Team Position Assignment](https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01/vertices/person_team_position_assignment).
- Existing reusable pieces include service recurrence generation, team-specific requirement calculation, saved occurrence snapshots, member/public name sanitization, explicit send/deduplication, team permission checks, and API/in-memory handler test harnesses.

## Decision log

### D1 — Nonexistent local recurrence time

- **Question:** When a recurring service’s configured local time does not exist during a spring-forward transition, should the occurrence be skipped per RFC recurrence behavior, moved forward to the first valid time, or follow another rule?
- **Why it matters:** It changes whether a schedule row exists and which instant server validation accepts.
- **Current evidence:** Client moves forward; server rejects that shifted instant.
- **Status:** Requires product-owner decision before Phase 2 defines shared behavior.

### D2 — One-time service override meaning

- **Question:** Does overrideDateTimeISO change the logical scheduled service occurrence for team schedules and service plans, or only adjust the live countdown temporarily?
- **Why it matters:** The current service-plan helper can query the override date while occurrence generation reads the base date.
- **Current evidence:** The type describes it as taking precedence over dateTimeISO and clearing when time passes; Team/Plan occurrence generation does not consistently apply it.
- **Status:** Requires product-owner decision before Phase 2 changes occurrence generation.

No other product decision is needed to document conflict handling: the approved contract says to apply unambiguous changes and ask the operator when values cannot safely coexist.

## Phased implementation plan

### Phase 2 — Establish authoritative occurrences and server authority

**Scope:** Define the canonical occurrence identity and legacy resolver; generate complete combined groups before team filtering; make the server derive church timezone and service/group occurrence facts; settle D1/D2 first.

**Likely files:** teamScheduleOccurrences.ts, teamSchedulePeriod.ts, ScheduleTab.tsx, servicePlanOccurrences.ts, servicePlanKeys.ts, intakeAvailabilitySuggestion.ts, relevant API types, server/teamsAuthHandlers.js, church timezone context, focused client/server tests.

**Behavior change:** All client/server paths resolve the same service membership, group, local date, and timezone. Service-time edits keep logical identity.

**Acceptance:** Actual client-built grouped payloads pass server ensure; different-team requirements remain scoped; modified client timezone cannot change server occurrence dates; DST and override cases have the approved result; availability and plan lookups resolve the same occurrence.

**Compatibility/rollback:** Use read-through legacy identity resolution before writing new keys. Keep existing occurrence snapshots, plan keys, and availability references readable. Do not migrate or rename historical rows in bulk as part of this phase.

### Phase 3 — Reconciliation and unique ownership

**Scope:** Add additive ad-hoc occurrence inclusion, transactional team-occurrence ownership, and conflict-aware rekeying for assignments, guests, responses, microphones, IEMs, and extra slots.

**Likely files:** server schedule create/ensure/update/archive handlers, scheduleDraftUtils.ts, ScheduleTab.tsx, team schedule API types, ownership/persistence helpers, server transaction tests.

**Behavior change:** One active owner exists per team-occurrence; an added service joins an applicable schedule without replacing populated maps; collision values remain visible until operator resolution.

**Acceptance:** Different period bounds racing for the same team-occurrence produce one owner; different teams can own the same occurrence; adding a one-time service retains all prior data; conflicts are returned without dropped source values; legacy duplicate candidates produce an ambiguity response.

**Compatibility/rollback:** Do not silently delete or merge legacy schedules. Reconcile ownership in bounded, reviewable operations; keep reads compatible if an ownership claim is absent.

### Phase 4 — Schedule publication and visibility

**Scope:** Add whole-document Draft/Published state and explicit publish/unpublish handlers. Gate every server member/public schedule reader. Keep explicit send separate.

**Likely files:** server/teamsAuthHandlers.js, client API types, ScheduleTab.tsx, member/public schedule pages, bootstrap projections, focused server/client tests.

**Behavior change:** First edit creates a private Draft; Published schedules are visible and editable; unpublish hides them while retaining data. Publish and assignment edits never deliver messages. Send Draft is blocked.

**Acceptance:** Missing legacy status reads as Published; Draft is blocked at member and public server boundaries; editor views remain available; publish/unpublish preserves assignments/responses/equipment/history; notification provider is invoked only by explicit send.

**Compatibility/rollback:** Existing public URLs and member visibility remain valid because missing status defaults to Published. Roll back readers before removing the additive status field; do not delete tokens or notification history.

### Phase 5 — Close legacy gaps and simplify

**Scope:** Resolve ambiguous legacy schedule owners with operators, complete coverage across availability and plan readers, and remove obsolete identity fallbacks after all callers use the canonical resolver.

**Simplifications enabled:** Remove client/server name-and-time matching from coversCurrentOccurrences; remove team-before-group filtering in buildTeamSchedulePeriod; retire service-order/replacement rekey fallbacks only after canonical identity and explicit legacy mappings cover their use cases; keep servicePlanKeys as a plan index if useful, but make it resolve through canonical occurrence identity.

**Acceptance:** Regression matrix passes across client builder, server handlers, member/public readers, availability, and service plans. No unresolved data is silently rekeyed or discarded.

**Compatibility/rollback:** Retain legacy readers until telemetry/data review shows they are no longer needed. Do not infer deletion eligibility from date-range overlap.

## Regression baseline and coverage

### Current tests to review, not preserve unquestioningly

- client/src/pages/Teams/schedule/teamSchedulePeriod.test.ts: “filters unrelated group services before grouping team occurrences” and “does not pull an unrelated same-date group member into the team occurrence” conflict with the server’s full-group validator and approved shared occurrence.
- client/src/pages/Teams/schedule/scheduleDraftUtils.test.ts: “lets the earliest service win a contested cell on merge” protects silent data loss.
- client/src/pages/Teams/schedule/schedulePeriodUtils.test.ts: “reuses equivalent occurrences after service IDs change” protects name/time ownership fallback.
- server/teamsApi.test.js: “generated period rejects incomplete canonical reuse without overwriting any saved map” protects a 409 instead of automatic inclusion; “generated ensure reuses semantically equivalent occurrences after service IDs change” protects identity substitution; the generated-ensure timezone case accepts the supplied timezone.
- client/src/utils/teamScheduleOccurrences.test.ts: spring-forward gap test currently expects move-forward behavior. Keep the test only if that behavior is approved and server supports it.

### Proposed cross-boundary regressions

1. Build a team period from real grouped services for one selected team, then submit that exact payload through the actual server ensure handler. Assert canonical group membership and team-specific requirements.
2. Open a virtual schedule without edits and assert no record. Add a member or microphone assignment and assert one Draft owner is persisted.
3. Add a one-time service to a populated period; assert occurrence is included and all assignment/response/guest/equipment maps remain intact. Repeat for a Published owner and assert the new occurrence is visible without a send.
4. Reuse a populated legacy schedule with missing publication metadata; preserve assignments and treat it as Published.
5. Race ensures with different period bounds for one team-occurrence; assert one owner. Repeat with a different team and assert it may own the same occurrence.
6. Use two same-name, same-time services with different IDs; assert neither schedule ownership nor assignments cross between them absent an explicit mapping.
7. Reschedule an occurrence and regroup/ungroup several services with conflicting member, guest, mic, IEM, extra-slot, and response values; assert stable identity and either full preservation or an explicit conflict containing every original value.
8. Configure a church timezone different from the browser and send a mismatched timezone to the server. Cover DST fold, DST gap, and a date crossing UTC midnight.
9. Assert missing status is Published; Draft data is denied by both member and public endpoints; publish/unpublish preserves records and does not call messaging.
10. Assert assignment edits and publishing cause no SMS/email delivery; explicit send only targets selected/relevant entries and uses the existing deduplication rules.
11. Resolve one occurrence from schedule, availability, and service-plan surfaces after service time change and group membership change; assert each refers to the same logical occurrence.

The server ensure suite currently tests hand-constructed payloads rather than the actual client builder output. Existing public schedule tests cover sanitization, not draft gating. Member schedule tests cover assignment scoping/plan attachment, not schedule publication status. Existing coverage does not prove the new contract.

## Verification record

No production code, schema, persisted document, or existing test file was changed for this audit. The new documentation is the contract, this report, and the feature-registry cross-link. Focused test results follow.


### Execution results

- Client: 6 focused suites passed, 160 tests passed. Suites: teamScheduleOccurrences, teamSchedulePeriod, schedulePeriodUtils, scheduleDraftUtils, intakeAvailabilitySuggestion, and servicePlanOccurrences.
- Server: server/teamsApi.test.js ran 228 tests; 227 passed and 1 failed. The failing test is “service plan endpoints: create, read, update, delete, permission gating, and SSE” at server/teamsApi.test.js:8040. It throws “Cannot read properties of undefined (reading '0')” while asserting workstationSnapshot.servingTeams[0].members. An isolated rerun of that test reproduced the same failure. It is a service-plan snapshot assertion, not a generated team-schedule assertion. The current checkout includes the concurrent availability-form edit described above; its diff does not touch service-plan snapshot assembly, but a clean-branch baseline was not established, so the failure is reported without assigning a cause.
- The repository declares Node 24, while this environment reports Node 22.23.1. The client suites passed under this runtime; the server result should be repeated under the declared runtime before treating the remaining failure as a stable baseline.
- No tests were added or existing tests changed in Phase 1. The cross-boundary regressions above are proposals, not passing tests. The server suite has a known failing case in the current working tree and must not be described as green.
