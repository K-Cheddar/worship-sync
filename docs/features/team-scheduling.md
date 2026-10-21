# Team Scheduling Contract

**Contract status:** Confirmed product intent

**Approval source:** Product-owner request, “WorshipSync Scheduling Foundation, Phase 1,” supplied for this audit on 2026-10-12.

**Last reviewed:** 2026-10-15

**Phase 1 audit:** [Scheduling foundation audit](../team-scheduling-foundation-phase-1.md)

## Purpose

Team scheduling turns church service definitions into volunteer assignments that can be reviewed by editors, shared with the people serving, updated as service plans change, and used to collect availability. A person assigned to a combined service should be scheduled once for the shared occurrence, while each team sees its own staffing needs.

## Operator workflow

Recurring and one-time service definitions generate virtual occurrences automatically. Editors open a period, make an assignment or equipment change, and thereby persist a Draft schedule. A Draft can be edited privately. Editors deliberately publish it to make it visible to members, and may later unpublish it without losing schedule data. Sending is a separate action that notifies people about assignments or selected updates.

Availability and service plans refer to the same logical service occurrences used by schedules. Changes to service times or grouping must be reconciled against saved operational data, with an explicit operator choice when values conflict.

## Expected behavior

### Service occurrences

- Active recurring and one-time service definitions generate every applicable occurrence.
- The church’s configured timezone defines occurrence dates and wall-clock times, regardless of an operator’s device timezone.
- Service Plans and Availability Forms remain readable when the church timezone cannot be loaded. Saved schedules remain available during a transient refresh failure when this church's last confirmed timezone can safely be used. Creating or changing schedules, sending schedule messages that include service times, and creating or recalculating service-date coverage require a valid configured church timezone. No UTC, browser-timezone, or other-church fallback is allowed.
- A service occurrence retains its logical identity when its scheduled time changes.
- Services in a configured combined group share one scheduling occurrence and one assignment. Each team sees only the requirements for its own positions.
- Client generation, server validation, team schedules, availability, and service plans agree on occurrence identity, grouping, and service-local date.

### Schedule lifecycle

A schedule follows **Virtual → Draft ↔ Published**.

- **Virtual:** generated from service definitions; no schedule document exists.
- **Draft:** the first edit creates a saved, editable schedule that remains private from members.
- **Published:** visible to members and still editable.
- Editors can publish and unpublish deliberately. Publishing does not send SMS or email.
- Sending a Draft is disallowed. A deliberate Publish & Send action may be offered.
- Unpublishing preserves assignments, responses, equipment, and notification history.
- A saved schedule with no publication status is treated as Published so existing member visibility is preserved.
- Publication applies to the whole schedule document. There is no church-level mode, per-occurrence publication state, or approval workflow.

### Ownership and service inclusion

- At most one active schedule owns a given team and logical occurrence. Different teams may schedule the same occurrence.
- Concurrent schedule creation and edits must preserve unique ownership and avoid lost updates.
- Deleting a schedule releases only occurrence claims that still reference its exact church, team, and schedule ID. Deletion and concurrent generation preserve any replacement owner's claims, allowing the same period to be generated again. Deleting a team continues to preserve its schedules.
- Schedules with different occurrences may have overlapping date ranges.
- Reuse an applicable saved schedule where possible; do not make a duplicate merely because a period was opened from a different view.
- Adding an ad-hoc service automatically adds its occurrence to the applicable existing period schedule and preserves its assignments.
- An occurrence added to a Published schedule is visible as part of that Published schedule.
- Do not silently delete, replace, or merge legacy overlapping or duplicate schedules. Ask the operator to resolve genuine ownership ambiguity.

### Reconciliation and communication

- A service time change retains the logical occurrence and its assignments.
- Grouping and ungrouping preserve member, guest, microphone, IEM, extra-position, response, and notification data wherever the mapping is unambiguous.
- Apply unambiguous mappings automatically. Surface incompatible values for an explicit operator decision; never silently discard one.
- Archiving or removing a service does not destroy historical schedule records.
- Publishing controls visibility; sending controls notifications. Both are deliberate and separate.
- Assignment edits and publishing do not automatically send messages. Support sending relevant updates or selected services without needless resending.

### Forms and upcoming availability

- Forms has an authorized active-Team filter independent of its date-range filter. Administrators start at **All teams**; a manager of one active Team starts at that Team. A legacy form with an empty Team scope applies to all teams.
- Upcoming availability is calculated for each selected Team's future occurrences using the same church-timezone schedule generation, combined-service identity, saved occurrence overrides, requirements, and explicit position slots as Team Scheduling. Combined groups are projected to each Team's staffing-relevant service members before coverage is compared; saved occurrence overrides apply across the group while service membership remains team-specific. Past services do not count as missing.
- Existing open availability forms cover only their actual Team scope and the service dates they include. Coverage is accumulated across eligible forms, and volunteer responses do not affect coverage.
- A suggested draft includes only uncovered Team/date coverage and uses `purpose: "team_availability"`. Teams share a draft only when their missing logical occurrence sets match; different staffed members of one combined occurrence are unioned for the shared draft, while unrelated events on the same date stay separate. Teams with different missing occurrences receive separate drafts.
- Saved combined occurrences cover only their intersection with the form's known service list. Legacy forms without service lists retain their saved occurrence member. Closed or expired forms that cover future dates are grouped into one review suggestion per form, with affected Teams and dates. An existing form is suggested for update only when its scope and service-date additions are safe and no requests or responses have been issued; otherwise, uncovered dates use a separate draft.
- The Team selector does not change the selected date range. Team options and suggestions are limited to authorized active Teams, and a church or permission-scope change cannot retain a stale Team selection.

**Approval source:** Current product-owner request, 2026-10-15. This Forms behavior adds Team-level availability coverage and filtering without changing scheduling, form-link, response, SMS, or authorization contracts.

### Volunteer account identity and church membership

- Signed-in My Schedule resolves identity only from the authenticated account's roster link in the requested church. Names and email addresses are never used to find a roster record.
- An account may link to one roster member per church. When existing links are ambiguous, My Schedule asks the volunteer to have a church administrator correct them; it never selects the first match.
- Archived roster members do not expose My Schedule assignments and cannot use signed-in schedule responses or time-off changes. Existing schedule-specific response links remain available to eligible roster members and guests.
- Manual linking, self-claiming, invitation acceptance, unlinking, and church removal preserve the one-link rule under concurrent requests. A linked account is not reassigned implicitly; an authorized unlink or correction is required. If a roster-bound invitation conflicts with an existing link, invitation acceptance and church membership creation are rejected together. The volunteer must ask a church administrator to correct the links and then retry acceptance.
- Removing church membership also clears that account's roster link and link metadata in that church. It retains roster records, assignments, blockouts, other church data, and historical schedules, and does not delete the authentication account or match another person by email.

**Approval source:** Current product-owner request, 2026-10-19 (Phase 1A identity-integrity follow-up).

### Pending assignment responses

- A signed-in volunteer can accept all unanswered assignments across their upcoming published schedules and Teams in one action. Eligibility is derived from the authenticated account, its single active roster link, current primary assignments, and persisted future occurrence times.
- Bulk acceptance is pending-only at commit time. It preserves accepted and declined answers, including answers submitted concurrently from another device. A repeated request is safe; schedules commit independently and partial completion is reported for retry.
- Only changed schedules emit the existing schedule update and queue the coalesced response digest. This action does not send per-assignment email or SMS. Existing individual schedule-response links retain their explicit Accept/Decline behavior.
- Signed-in `Accept All Pending` and personal-link `Accept All Unanswered` use the same canonical operation, upcoming primary targets, commit-time publication/ownership checks, and preservation-oriented response helper. Unrelated response records and metadata are retained exactly. Discovery scans at most 100 schedules per request and processes at most 25 eligible schedule groups; both clients follow the returned cursor. Each personal schedule transaction revalidates the session's credential generation and current member authority. Revocation/replacement prevents later commits; already committed schedules survive and retries process remaining pending work only.

**Approval source:** Current product-owner request, 2026-10-20 (Volunteer Portal Phase 1B: Accept All Pending).
Shared identity parity and preservation clarified by the October 21, 2026 Shared Volunteer Bulk Response fix request.

## Core data invariants

1. Each logical occurrence has a canonical identity that survives start-time edits, its original recurrence date and current church-local date/start instant, service membership, and optional group identity.
2. Every schedule assignment, response, guest, equipment allocation, availability reference, and service-plan association resolves to that occurrence identity or to an explicit, reviewable legacy mapping.
3. Each team-occurrence pair has at most one active schedule owner. The same occurrence may have one owner per team.
4. Reconciliation either preserves every source value or reports a conflict for the operator; it never resolves a collision by dropping data.
5. Missing publication metadata means Published for legacy schedule documents.
6. Schedule visibility changes do not mutate assignments or notification history. Notification delivery happens only through an explicit send action.

## Important scenarios

| Scenario | Confirmed expected behavior |
| --- | --- |
| A team opens a period without editing | Occurrences are virtual; do not create a schedule document just by viewing. |
| First assignment or equipment edit | Persist a Draft schedule. |
| Add a one-time service to an existing period | Include it in the applicable schedule and preserve the existing assignments. |
| Change a service’s time | Keep the occurrence’s logical identity and assignments. |
| Two services become one combined occurrence | Preserve nonconflicting values and ask about conflicting assignments or equipment. |
| Existing duplicate schedule records | Preserve them and ask an operator to resolve ownership ambiguity. |
| Publish or unpublish | Change member visibility for the schedule; preserve its operational data; do not send a message. |
| Previously saved schedule has no status | Treat it as Published. |
| Member reader requests a Draft | The server does not expose it. |
| Send an assignment update | Send only after an explicit send action, with deduplication/relevant-update behavior. |

## Product decisions

Review-correction guarantees (product-owner request, 2026-10-15): schedule metadata edits preserve persisted fields outside the validated editable payload, including responses, public links, publication and sending history. Superseded shadow retries cannot restore removed assignments or overwrite newer choices. Imported occurrences acquire the same exclusive ownership protection as schedule creation; absent standalone group IDs compare as null while genuine group conflicts remain blocked. These corrections do not enable messaging or change publication behavior.

Repeatable scheduling verification (product-owner requests, 2026-10-20): browser tests always target built-in church `demo`; `E2E_DEMO_CHURCH_ID` is deprecated and only accepted when its value is `demo`. Before scheduling fixtures are provisioned or recovered, the saved authenticated server session must identify `demo` and have edit access to the reserved test-owned team. Smoke does not open Scheduling and blocks church-scoped mutations. A separate workflow suite exercises virtual viewing, first-edit Draft persistence, real reconciliation, deletion, and regeneration with exact ownership manifests and authoritative cleanup. Existing unowned demo records are preserved; neither suite enables publication or messaging. New generated schedules explicitly persist `published: false`; existing schedules retain their publication metadata. See [browser test configuration and cleanup](../testing/smoke-coverage.md).

Phase 3B (product-owner request, 2026-10-12): administrators and church-wide Teams editors retain schedule messaging access. Current editors of the persisted schedule's Team may inspect its message history, review and explicitly send individual SMS, and prepare/resolve replacement invitations. Read-only or unrelated-Team access does not grant these actions. Authorization is repeated immediately before dispatch; an old approval is not a permission grant. Combined occurrence identity does not combine Team permissions. Scoped operators cannot manage messaging for legacy schedules with inconsistent assignment position ownership; administrators can review those records. Existing identities, email sending, personalized responses, manual confirmation, consent and uncertain-send safeguards remain intact. This phase changes neither publication nor bulk/background sending. See the [endpoint audit and next-step plan](../team-schedule-messaging-phase-3b.md).

Phase 3C implementation status (product-owner request, 2026-10-12): a published schedule can be reviewed for an initial grouped SMS without first sending email. The persisted schedule's current Team controls access; each roster member has one stable initial identity and one message containing their current primary assignments and one schedule response link. Scoped review masks full phone numbers and response tokens. Draft schedules are blocked, while legacy schedules without publication metadata remain Published. Publishing still never sends; `sentAt` retains its existing send-history meaning. Recipient selection and personalized batch review are implemented, but bulk dispatch remains disabled pending safe continuation and restart recovery. This status is implementation progress, not an end-to-end sending capability. See the [Phase 3C handoff](../team-schedule-messaging-phase-3c.md).

Timezone recovery behavior (product-owner requests, 2026-10-13 and 2026-10-14): saved plans and availability forms remain available during a timezone load failure. Operators can review forms and plans, and make form wording changes that preserve saved occurrences. Date-based scheduling and coverage changes wait for a valid church timezone. A transient refresh failure retains the last confirmed timezone for that same church, keeps it ready for existing consumers, and retries quietly on the 60-second interval and connection recovery; it does not block the page or show a prominent warning. A prolonged reachability failure may show a compact non-blocking status. Without a confirmed timezone, date-based actions stay unavailable and retryable load failures show a compact error with Retry. A confirmed unconfigured church keeps the Service setup guidance. An unconfigured UTC display value is not a timezone setting, and no browser-timezone or other-church fallback is allowed. **Approval source for the refresh and error presentation:** current product-owner request, 2026-10-14.

The Phase 2 product-owner request (2026-10-12) finalizes two occurrence rules:

- **D1 — Daylight-saving transitions:** Omit a recurring occurrence when its configured church-local wall time falls in the spring-forward gap. Do not move it. During fall-back, use the earlier instant for an ambiguous local time. Client generation and server validation use the same rules. Preserve historical records created under earlier behavior.
- **D2 — Countdown override:** `overrideDateTimeISO` temporarily adjusts a live countdown. It does not change the scheduled occurrence, identity, start time, service date, team assignments, availability, or service-plan association. Permanent changes use the service definition fields. Timer and live-service controls retain their existing override behavior.

These decisions were explicitly approved in the Phase 2 request; the [decision log](../team-scheduling-foundation-phase-1.md#decision-log) records the authorization and implementation boundary.

## Implementation references

These references locate current code, not additional product requirements.

- Phase 3A safe schedule reuse, additive occurrence inclusion, ownership claims, and remaining Phase 3 / Phase 4 boundaries: [implementation record](../team-scheduling-foundation-phase-3a.md)

- Editor entry: client/src/pages/Teams/schedule/ScheduleTab.tsx
- Occurrence generation: client/src/utils/teamScheduleOccurrences.ts
- Period construction and schedule selection: client/src/pages/Teams/schedule/teamSchedulePeriod.ts and client/src/pages/Teams/schedule/schedulePeriodUtils.ts
- Assignment reconciliation: client/src/pages/Teams/schedule/scheduleDraftUtils.ts
- Availability suggestion: client/src/pages/Teams/intakeAvailabilitySuggestion.ts
- Service-plan occurrence lookup: client/src/pages/Services/servicePlanOccurrences.ts and client/src/utils/servicePlanKeys.ts
- Server validation, persistence, member/public reads, and explicit sending: server/teamsAuthHandlers.js
- Focused current tests: client/src/pages/Teams/schedule/, client/src/utils/teamScheduleOccurrences.test.ts, client/src/pages/Services/servicePlanOccurrences.test.ts, and server/teamsApi.test.js

## Technical design notes

The current schedule document is persisted in the teamSchedules collection. Its occurrence list is referenced by assignments, responses, guests, microphone and IEM allocations, and additional position slots. Availability forms and service plans keep their own occurrence references/keys. The Phase 1 report maps those relationships and the compatibility risks of changing them.



### Quick member creation from schedule cells

**Approval source:** Product-owner request, 2026-10-18.

- The normal primary-assignment picker offers Add new member alongside Add guest. Typed names prefill the compact form; first and last names are required, and mobile phone and email are optional.
- Quick creation assigns the selected team and position through the roster API's existing membership synchronization. Scheduling never reconstructs a whole-team settings update. Existing equipment flags survive omitted-field updates; explicit true/false still enable/disable them.
- Team-scoped candidate lookup exposes safe names/avatars only. Operators explicitly select an existing member or confirm that a matching name represents a different person. Selecting an existing person uses roster membership and team-profile APIs and preserves unrelated member data.
- If a creation response is lost or the server reports an uncertain failure, refresh the authorized roster before permitting another create; on-team matches also require an explicit existing/distinct-person decision.
- Creation and assignment are separate durable steps. A failed create preserves the draft; a failed assignment retains the saved member and retries using its ID. Church, team, period, schedule selection and slot changes invalidate old UI callbacks.
- Saving a phone number never records consent, sends a message, creates an account or issues an invitation. Administrators may separately record already-obtained consent using the existing consent modal, only after current server eligibility confirms consent is needed. STOP restrictions remain enforced.

Regression coverage: ScheduleAssignmentPicker.test.tsx, TeamsAndServices.test.tsx, server/teamsApi.test.js, and the scheduling quick-member browser suite.


Unified workspace Phase 1 (product-owner request, 2026-10-19): establish a pure Team/date-range read model across saved owners and generated occurrences, preserving saved occurrence keys, staffing overrides, custom services and unsafe legacy rows. Summary-only owners remain explicitly unhydrated, never empty staffing. This phase extracts stable period logic but preserves existing selection/editing, overlap review, publication, permissions and communication. Unified grid integration and owner-aware mutations are deferred. See the [Phase 1 implementation and integration boundaries](../unified-scheduling-workspace-phase-1.md).
