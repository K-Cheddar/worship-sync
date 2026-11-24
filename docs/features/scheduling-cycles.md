# Scheduling Cycles Contract

**Contract status:** Confirmed product intent; processor hardening implementation is partial as of 2026-11-24

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
- Cycle state and individual action state are separate. A short-lived processor can claim due actions and record durable results. Availability form creation is the first supported operation; notification delivery, automatic schedule preparation, and publication have separate gates or remain unsupported.
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

- Reuse `teamSchedules`, `teamIntakeForms` with purpose `team_availability`, personalized `teamIntakeRecipients`, notification intent/batch infrastructure, church service timezone, and existing schedule-period utilities. Phase 3 creates or reuses availability forms and their personalized recipient records through the shared intake validation and recipient preparation operations; it still does not dispatch notifications.
- Store church defaults and team overrides as revisioned server-owned settings. Store cycles and planned actions with deterministic IDs in dedicated Firestore collections and create them transactionally.
- Keep cycle reads church-scoped and period-targeted. The future processor's due-action query uses the `teamSchedulingActions` composite index in `firestore.indexes.json`; deploy index changes with `npm run firebase:update-indexes` before adding that processor. Keep browser rules closed.
- The processor's due-action query uses the `teamSchedulingActions` composite index in `firestore.indexes.json`; deploy index changes with `npm run firebase:update-indexes` before scheduled use. Keep browser rules closed.
- A future Heroku Scheduler command should invoke the short-lived processor against durable cycles/actions and tolerate missed or duplicate invocations. This milestone adds no worker or scheduler configuration.

## Phase 3 activation and execution boundary

The Phase 3 request supplied on 2026-11-24 authorizes a first short-lived processor for automatic availability form creation. Timing configuration remains separate from the church master switch. Existing churches and newly saved timing settings remain disabled. Only a church administrator can enable church-wide processing, and the activation screen names the selected team and period, shows that period's saved or preview timeline, and requires confirmation for an already-started period. Every activation records a timestamp; actions dated before that timestamp are held for leader review. Team overrides can disable their own scope but cannot bypass the church master switch.

The processor can ensure the next four monthly cycles, using deterministic cycle and action identifiers and transactional cycle creation. It snapshots settings and church timezone once and does not rewrite an existing timeline. Global discovery now continues through church and team pages using revision-checked cursors; each run examines at most 100 church settings, 50 teams per church, and 250 team scopes within an eight-minute budget. Existing cycles do not consume the cycle-creation budget. Scoped runs and dry runs do not write global cursor state. A malformed church or team configuration is recorded as a scoped skip so other scopes can continue.

Due actions are discovered independently from cycle discovery. Pending, retryable, and expired-claim records use separate indexed queries; a cycle-scoped command reads that cycle's deterministic action IDs. Claims use a unique token, owner, expiry, and attempt counter. The worker renews the five-minute claim lease while it runs, and finalization still checks the token and current lease. Form creation remains idempotent by cycle-based form identity, and retryable failures preserve their retry time, attempt count, and failure classification when the cycle is rediscovered.

Request timing uses one shared policy for processor dry runs and the settings preview. On-time execution, including a delay of up to 24 hours after the planned local execution instant, honors the saved response window even when it is shorter than seven days. A request more than 24 hours late is eligible only when the start of the date after the church-local deadline is at least seven calendar dates after the current church-local date. Otherwise it is held for leader review. The response window still expires at the first instant of the local date after the deadline date, including DST changes.

The first executable operation creates or reuses a dedicated `team_availability` form with only availability fields. It selects occurrences with the existing schedule-period and grouped-service helpers, compares canonical service/group identities rather than raw occurrence IDs, and refuses ambiguous overlap for leader review. A stable cycle-based form identity and form metadata recover an interrupted create. The create transaction validates any winning record before reuse, including church/team/cycle/operation identity, period, deadline, occurrence scope, and active/archive state. Personalized recipients are materialized through the existing recipient/token helper; retries reuse valid credentials. Recipient eligibility is independent of SMS consent. Production roster reads target the selected team's membership and active position assignments rather than loading the complete church roster; each source has a bounded result limit.

The response deadline is a church-local calendar date, not an execution timestamp. A November 21 deadline remains open through November 21 and expires when November 22 begins in the church timezone. The processor does not expire forms; the existing form response validator remains authoritative. DST transitions use the first instant of the next local date, which may be 23 or 25 hours after the preceding local date began.

Dry run is read-only. `--execute` ensures cycles, claims due actions transactionally, and creates/reuses forms and recipients; it does not call a messaging provider. Retryable failures use exponential backoff capped at one hour and stop after five total attempts. Expired claims can be reclaimed even if the cycle is outside the normal lookahead window or no new cycle was found. An operation that may have continued after lease loss relies on its stable operation identity before any persistent form/recipient side effect; action completion is fenced by the renewed claim.

Live notification delivery remains disabled by the server safety switch. `--live` is intentionally rejected. The processor does not yet dispatch initial availability requests, nonresponder reminders, or leader summaries. Due follow-up and summary actions remain pending but disabled with an explicit waiting-for-delivery result; they are not misclassified as terminal review-required failures. Response eligibility and form deadlines remain authoritative; the processor never closes a form early. Email/SMS provider readiness, channel preferences, STOP/START state, intent retry/reconciliation, and a separate church delivery activation control still need implementation before delivery can be enabled. No production delivery has been activated and no Heroku Scheduler job or production index has been configured.

## Operations and deployment preparation

Run from the repository root:

```powershell
npm run process:scheduling-automation -- --dry-run
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01
npm run process:scheduling-automation -- --execute --cycle=SAVED_CYCLE_ID
```

The CLI accepts only the listed mode flags and `--church=`, `--team=`, `--period=`, `--cycle=`, and `--limit=` values. It rejects empty or duplicate values, unknown arguments, malformed identifiers, a team without a church, a period without church and team, and limits outside 1-100. A supplied filter is checked again inside the claim transaction.

`--execute` is a write mode: it can create cycle records, availability forms, and personalized recipients. Use it only against a demo church. `--limit` must be 1-100 and the default is 100. The processor stops between operations on SIGINT/SIGTERM and on its eight-minute time budget. Structured JSON output contains run/cycle/action identifiers and counts, including expired claims recovered and actions waiting for delivery; it excludes recipient tokens and contact details.

Before a future scheduled deployment, deploy the indexes in `firestore.indexes.json` with `npm run firebase:update-indexes`. New indexes cover pending, retry, expired-claim, scoped team/action, team-position, and team-roster position queries. Verify the indexes in the Firestore emulator and intended environment before scheduling; this change does not deploy indexes. Verify Firebase Admin environment settings, compare dry-run output with the demo church's saved timeline, enable the master switch only after reviewing the selected cycle, then run one church-scoped `--execute`. Review cycle/action states and form/recipient counts in the returned JSON and Firestore records. Do not add the hourly Heroku Scheduler job until delivery, delivery reconciliation, manual/automatic form overlap protection, UI delivery controls, and emulator tests have been completed and reviewed. The intended later cadence remains hourly.

Emergency disable: use the church-level **Disable automation** control. This stops new cycle discovery and action claims on the next invocation; an already-claimed create may finish, but it remains idempotent and does not send a message. To recover after an interrupted run, inspect the action state and claim expiry, then invoke a church-scoped dry run followed by `--execute`; never edit action claims by hand. For a demo validation, use a separate church with one active team, one grouped service and one standalone service, a known church timezone, an accountless volunteer, and a signed-in volunteer. Confirm exact occurrence scope, deadline date, one request form, stable recipient identities after a retry, master/team disable behavior, and that no notification is dispatched.

## Product decisions

- **Question/problem:** Should timing settings, cycle creation, or timeline viewing activate recurring actions?
- **Approved behavior:** No. Church-wide availability automation is a separate opt-in setting, existing churches default to disabled, and activation records a boundary timestamp. Team disable and church master disable are enforced independently from timing inheritance.
- **Why:** Routine configuration and preview must not authorize automatic operations or replay historical actions.
- **Approval source/date:** Product-owner Phase 3 request supplied 2026-11-24.
- **Affected workflow/contract:** Church scheduling settings, cycle discovery, and the short-lived automation processor.

- **Question/problem:** What may the first processor execute while live notification delivery is unavailable?
- **Current implementation after processor hardening:** Dry-run timing, independent due/retry/expired-claim discovery, cursor-backed global pagination, fenced renewable claims, and canonical form reuse checks are implemented. `--execute` still creates/reuses cycles, forms, and recipients only. Due follow-up and summary actions wait in a disabled pending state. Live notification delivery, per-channel church/environment gates, reminders, leader summaries, and detailed delivery activity remain outstanding.
- **Reason:** The Phase 3B request authorizes implementation of safe delivery gates and automated notifications while explicitly withholding authorization to activate production delivery or configure Heroku Scheduler. This implementation has not completed those delivery capabilities, so the existing hard-disabled send guard remains. Do not bypass SMS registration, consent, provider-readiness, or uncertain-outcome safeguards. Production delivery remains off.
- **Source/date:** Phase 3 implementation review, 2026-11-24.
- **Affected workflow/contract:** Automatic availability collection and processor operations.
