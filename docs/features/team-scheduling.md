# Team Scheduling Contract

**Contract status:** Confirmed product intent

**Approval source:** Product-owner request, “WorshipSync Scheduling Foundation, Phase 1,” supplied for this audit on 2026-10-12.

**Last reviewed:** 2026-10-12

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

Phase 3B (product-owner request, 2026-10-12): administrators and church-wide Teams editors retain schedule messaging access. Current editors of the persisted schedule's Team may inspect its message history, review and explicitly send individual SMS, and prepare/resolve replacement invitations. Read-only or unrelated-Team access does not grant these actions. Authorization is repeated immediately before dispatch; an old approval is not a permission grant. Combined occurrence identity does not combine Team permissions. Scoped operators cannot manage messaging for legacy schedules with inconsistent assignment position ownership; administrators can review those records. Existing identities, email sending, personalized responses, manual confirmation, consent and uncertain-send safeguards remain intact. This phase changes neither publication nor bulk/background sending. See the [endpoint audit and next-step plan](../team-schedule-messaging-phase-3b.md).

Phase 3C implementation status (product-owner request, 2026-10-12): a published schedule can be reviewed for an initial grouped SMS without first sending email. The persisted schedule's current Team controls access; each roster member has one stable initial identity and one message containing their current primary assignments and one schedule response link. Scoped review masks full phone numbers and response tokens. Draft schedules are blocked, while legacy schedules without publication metadata remain Published. Publishing still never sends; `sentAt` retains its existing send-history meaning. Recipient selection and personalized batch review are implemented, but bulk dispatch remains disabled pending safe continuation and restart recovery. This status is implementation progress, not an end-to-end sending capability. See the [Phase 3C handoff](../team-schedule-messaging-phase-3c.md).

Timezone recovery behavior (product-owner request, 2026-10-13): saved plans and availability forms remain available during a timezone load failure. Operators can review forms and plans, and make form wording changes that preserve saved occurrences. Date-based scheduling and coverage changes wait for a valid church timezone. A transient error retains only the last confirmed timezone for that same church; an unconfigured UTC display value is not a timezone setting.

The Phase 2 product-owner request (2026-10-12) finalizes two occurrence rules:

- **D1 — Daylight-saving transitions:** Omit a recurring occurrence when its configured church-local wall time falls in the spring-forward gap. Do not move it. During fall-back, use the earlier instant for an ambiguous local time. Client generation and server validation use the same rules. Preserve historical records created under earlier behavior.
- **D2 — Countdown override:** `overrideDateTimeISO` temporarily adjusts a live countdown. It does not change the scheduled occurrence, identity, start time, service date, team assignments, availability, or service-plan association. Permanent changes use the service definition fields. Timer and live-service controls retain their existing override behavior.

These decisions were explicitly approved in the Phase 2 request; the [decision log](../team-scheduling-foundation-phase-1.md#decision-log) records the authorization and implementation boundary.

## Implementation references

These references locate current code, not additional product requirements.

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

