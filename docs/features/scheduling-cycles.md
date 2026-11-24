# Scheduling Cycles Contract

**Contract status:** Confirmed product intent and response-deadline policy

**Approval source:** Product-owner request, “WorshipSync — Phase 2: Scheduling Cycles and Automation Settings,” supplied 2026-11-23.

**Last reviewed:** 2026-11-23

## Purpose

A scheduling cycle coordinates the existing availability and team-schedule workflows for one church, team scope, and service period. It gives administrators a durable, reviewable timeline for future scheduling automation while preserving the current manual workflow.

## Operator workflow

Church administrators configure monthly church-wide defaults in the existing Teams and Services settings area. A team leader may inherit those defaults, customize the team’s timing, or disable cycle planning for a team they manage. A chronological preview shows the target period, calculated local dates and times, future planned actions, and the manual publication step. The existing Teams schedule workspace may show a compact summary for its selected period.

Saving settings or viewing a preview does not send messages, create forms or recipients, run Auto-fill, create or change schedules, or publish assignments. Existing churches remain on their manual scheduling workflow until a later supported phase explicitly enables automation.

## Expected behavior

- Scheduling is monthly in this first phase. The data model leaves room for additional period types without changing the identity of existing monthly cycles.
- Church administrators own church-wide defaults. Only an appropriately authorized manager for a specific team can change that team’s override.
- Team settings resolve to inherited church defaults, a team-specific customization, or disabled cycle planning. Existing teams default to inheritance; church automation defaults are opt-in and do not enable message delivery.
- A cycle snapshots its effective settings, church timezone, configuration revision, period, and planned actions. Later settings changes affect future cycles only. An existing cycle’s timeline is not silently recalculated.
- A cycle has a stable identity derived from church, scheduling scope, and period. Repeated or concurrent ensure operations reuse one durable Firestore record.
- Cycle state and individual planned-action state are separate. Planned actions are traceable and can later be executed by a short-lived scheduled processor, but this phase does not claim actions have been queued for delivery or completed.
- Publication remains manual. No automatic notification or schedule mutation is part of this phase.
- The server is authoritative for validation, timezone conversion, authorization, persistence, and configuration revisions. Browser Firestore access remains denied by the existing rules.
- If cycle settings or preview data cannot load, the ordinary Teams scheduling workflow remains available.

## Timing policy

The initial request is planned 14 calendar days before preparation, the nonresponder follow-up 3 calendar days after the request, and the leader summary 3 calendar days after the follow-up. The preparation day is configurable in the preceding month. The volunteer response deadline is independently configurable from 1–14 calendar days before preparation, defaults to three days, and is not the leader-summary date. Validation ensures the request, follow-up, and summary occur before the response deadline, leaving volunteers time to respond and leaders time to prepare.

The local execution-time default is 9:00 AM in the church timezone. Relative offsets use local calendar-day arithmetic. A configured preparation day that is absent from a month clamps to that month’s final day. The planner must produce deterministic local dates and UTC instants and must not use the browser or server timezone.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Existing church with no new configuration | Manual scheduling continues; automation is opt-in. | Current schedule workflow and team schedules are independent of this contract. | Confirmed by current request. |
| Team without an override | Effective settings inherit church defaults. | Revisioned team settings resolve to the latest church defaults. | Implemented. |
| Team manager changes an override | Server verifies team-scoped edit authority and church ownership. | Existing `requireTeamsEditForTeamSession` authorization helper guards team settings writes. | Implemented. |
| Church defaults change | Future cycles use new settings; existing cycle snapshots remain unchanged. | Cycle ensure snapshots the effective settings and revision; deterministic existing cycle IDs are reused without recalculation. | Implemented. |
| Preview is opened or recalculated | It has no operational side effects. | Preview calls the planner directly and does not invoke forms, notification, or schedule mutation handlers. | Implemented. |
| Response deadline | Configurable from 1–14 calendar days before preparation; defaults to three days and remains distinct from the leader-summary date. | The planner validates the timing sequence and snapshots the configured value. | Implemented; default confirmed by product owner on 2026-11-24. |
| DST transition at configured local execution time | Conversion is deterministic in the church timezone and reports an invalid local time rather than silently using another timezone. | Existing occurrence helpers define church-local service dates and have explicit gap/fold handling. | Confirm exact planner policy in implementation tests. |

## Product decisions

- **Question/problem:** How should the response deadline preserve time for leaders to prepare?
- **Approved behavior:** Make the deadline configurable; use three calendar days before preparation by default.
- **Why:** Churches can select a response window that fits their preparation needs while retaining a sensible default.
- **Approval source/date:** Product owner confirmation on 2026-11-24.
- **Affected workflow/contract:** Scheduling Cycles settings and timeline preview.

## Implementation references

- Entry point: Existing Teams and Services settings and the Teams schedule workspace.
- Implementation: `server/schedulingCycles.js`, `server/schedulingCycleHandlers.js`, `client/src/pages/Teams/components/SchedulingAutomationPanel.tsx`.
- Tests: `server/schedulingCycles.test.js`, `server/schedulingCycles.firestore.test.js`, `server/teamsApi.test.js`, and `client/src/pages/Teams/components/SchedulingAutomationPanel.test.tsx`.

## Technical design notes

- Reuse `teamSchedules`, `teamIntakeForms` with purpose `team_availability`, personalized `teamIntakeRecipients`, notification intent/batch infrastructure, church service timezone, and existing schedule-period utilities. This phase only previews and references those capabilities.
- Store church defaults and team overrides as revisioned server-owned settings. Store cycles and planned actions with deterministic IDs in dedicated Firestore collections and create them transactionally.
- Keep cycle reads church-scoped and period-targeted. The future processor's due-action query uses the `teamSchedulingActions` composite index in `firestore.indexes.json`; deploy index changes with `npm run firebase:update-indexes` before adding that processor. Keep browser rules closed.
- The future Heroku Scheduler command should invoke a short-lived processor against durable cycles/actions and tolerate missed or duplicate invocations. This phase adds no worker, scheduler configuration, or delivery side effect.
