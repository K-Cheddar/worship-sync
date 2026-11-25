# Scheduling Cycles Contract

**Contract status:** Confirmed product intent; initial automatic availability email is implemented behind independent safety gates as of 2026-11-24. Emulator verification and controlled demo validation remain required.

**Approval source:** Product-owner request, “WorshipSync — Phase 2: Scheduling Cycles and Automation Settings,” supplied 2026-11-23.

**Last reviewed:** 2026-11-23

## Purpose

A scheduling cycle coordinates the existing availability and team-schedule workflows for one church, team scope, and service period. It gives administrators a durable, reviewable timeline for future scheduling automation while preserving the current manual workflow.

## Operator workflow

Church administrators configure monthly church-wide defaults in the existing Teams and Services settings area. A team leader may inherit those defaults, customize the team’s timing, or disable cycle planning for a team they manage. A chronological preview shows the target period, calculated local dates and times, future planned actions, and the manual publication step. The existing Teams schedule workspace may show a compact summary for its selected period.

Saving timing settings or viewing a preview does not activate processing. Four church controls remain independent: the automation master switch, automatic form creation, automatic email delivery, and automatic SMS delivery. The first three are revision-safe and audited; enabling email also requires explicit confirmation and the server environment gate. SMS stays disabled in this phase. Manual schedule and SMS workflows remain available.

## Expected behavior

- Scheduling is monthly in this first phase. The data model leaves room for additional period types without changing the identity of existing monthly cycles.
- Church administrators own church-wide defaults. Only an appropriately authorized manager for a specific team can change that team’s override.
- Team settings resolve to inherited church defaults, a team-specific customization, or disabled cycle planning. Existing teams default to inheritance; the church master switch remains opt-in. Form creation and email delivery have separate church-level controls, and a team override cannot bypass the master switch.
- A cycle snapshots its effective settings, church timezone, configuration revision, period, and planned actions. Later settings changes affect future cycles only. An existing cycle’s timeline is not silently recalculated.
- A cycle has a stable identity derived from church, scheduling scope, and period. Repeated or concurrent ensure operations reuse one durable Firestore record.
- Cycle state and individual action state are separate. A short-lived processor can claim due actions and record durable results. The availability request action creates or safely reuses a form and personalized recipients; a separate email action creates durable email intents and records provider acceptance. Form preparation can run without creating or dispatching email intents. Nonresponder reminders, leader summaries, automatic schedule preparation, and publication remain unsupported.
- Publication remains manual. Automatic SMS and future notification types remain disabled.
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

- Reuse `teamSchedules`, `teamIntakeForms` with purpose `team_availability`, personalized `teamIntakeRecipients`, `notificationIntents`, church service timezone, and existing schedule-period utilities. Automatic form creation and email delivery are separate durable actions. The email action uses the existing Resend wrapper and availability email template; manual SMS behavior is unchanged.
- Store church defaults and team overrides as revisioned server-owned settings. Store cycles and planned actions with deterministic IDs in dedicated Firestore collections and create them transactionally.
- Keep cycle reads church-scoped and period-targeted. The future processor's due-action query uses the `teamSchedulingActions` composite index in `firestore.indexes.json`; deploy index changes with `npm run firebase:update-indexes` before adding that processor. Keep browser rules closed.
- The processor's due-action query uses the `teamSchedulingActions` composite index in `firestore.indexes.json`; deploy index changes with `npm run firebase:update-indexes` before scheduled use. Keep browser rules closed.
- No Heroku Scheduler or worker is configured. Operators can run the short-lived CLI against scoped demo data; production delivery remains disabled until the environment and church gates are deliberately configured.

## Phase 3 activation and execution boundary

The Phase 3 request supplied on 2026-11-24 authorizes a short-lived processor for automatic availability form creation and initial email delivery. Timing configuration remains separate from four activation controls: church master automation, automatic form creation, automatic email delivery, and automatic SMS delivery. Existing churches and newly saved timing settings remain disabled. Only a church administrator can change the first three. Activation is revision-safe and audited; enabling a started period requires review of the selected timeline. The environment gate `SCHEDULING_AUTOMATION_EMAIL_ENABLED=true` and Resend configuration are also required before live email. Team overrides can disable their own scope but cannot bypass the master switch. Automatic SMS remains disabled.

The processor can ensure the next four monthly cycles, using deterministic cycle and action identifiers and transactional cycle creation. It snapshots settings and church timezone once and does not rewrite an existing timeline. Global discovery now continues through church and team pages using revision-checked cursors; each run examines at most 100 church settings, 50 teams per church, and 250 team scopes within an eight-minute budget. Existing cycles do not consume the cycle-creation budget. Scoped runs and dry runs do not write global cursor state. A malformed church or team configuration is recorded as a scoped skip so other scopes can continue.

Due actions are discovered independently from cycle discovery. Pending, retryable, and expired-claim records use separate indexed queries; a cycle-scoped command reads that cycle's deterministic action IDs. Claims use a unique token, owner, expiry, and attempt counter. The worker renews the five-minute claim lease while it runs, and finalization still checks the token and current lease. Form creation remains idempotent by cycle-based form identity, and retryable failures preserve their retry time, attempt count, and failure classification when the cycle is rediscovered.

Request timing uses one shared policy for processor dry runs and the settings preview. On-time execution, including a delay of up to 24 hours after the planned local execution instant, honors the saved response window even when it is shorter than seven days. A request more than 24 hours late is eligible only when the start of the date after the church-local deadline is at least seven calendar dates after the current church-local date. Otherwise it is held for leader review. The response window still expires at the first instant of the local date after the deadline date, including DST changes.

The first operation creates or reuses a dedicated `team_availability` form with only availability fields. It selects occurrences with the existing schedule-period and grouped-service helpers, compares date-scoped canonical identities, and holds ambiguous scope for review. Historical grouped membership is not inferred from current service configuration. A stable cycle-based form identity and shared church/team form-creation guard recover interrupted or concurrent creates; an exact manual form may be reused, while competing or ambiguous overlap is held for review. The transaction validates a winning form before reuse, including church/team/cycle/operation identity, period, deadline, occurrence scope, and active/archive state. Personalized recipients are materialized through the existing recipient/token helper; retries reuse valid credentials. Recipient eligibility is independent of email contact. Direct team membership, active member-side membership, and active position assignments share one current-scope check; archived members, teams, and positions are excluded. Reads target the selected team and referenced positions rather than loading the church roster, with bounded results and transactional rechecks.

The response deadline is a church-local calendar date, not an execution timestamp. A November 21 deadline remains open through November 21 and expires when November 22 begins in the church timezone. The processor does not expire forms; the existing form response validator remains authoritative. DST transitions use the first instant of the next local date, which may be 23 or 25 hours after the preceding local date began.

Dry run is read-only. For an eligible availability request it reports whether the scoped form would be created or reused, recipient and email eligibility estimates, missing contact, and preference/account exclusions. It does not create cycles, forms, recipients, tokens, intents, claims, or provider calls. `--execute` ensures cycles, claims due actions transactionally, and creates/reuses forms and recipients; it does not create email intents or call a provider. `--live` is available only when the server gate and Resend are configured; each delivery also rechecks church master/email state, team state, cycle, form, recipient, contact, and preference immediately before dispatch. Live processing can create the separate email action after form creation and pick it up within the same bounded run when capacity remains. Resend retains email idempotency keys for 24 hours and expects the same request payload on retries ([provider documentation](https://resend.com/changelog/idempotency-keys)); retryable provider 429 responses are retried at most three times within that window. A timeout or interrupted `sending` intent becomes uncertain and requires review; it is never blindly resent. Processor action claims stop after five interrupted or failed attempts, then disable the action for leader review.

The notification contract in [Availability request email and SMS](team-availability-sms.md#automatic-availability-email-phase-3c) defines the email intent lifecycle, privacy boundary, retry rules, and manual SMS compatibility. The processor does not yet dispatch nonresponder reminders or leader summaries. Those actions remain pending but disabled with an explicit waiting-for-delivery result. Response eligibility and form deadlines remain authoritative; the processor never closes a form early. No production email or SMS delivery has been activated and no Heroku Scheduler job or production index has been configured.

## Operations and deployment preparation

Run from the repository root:

```powershell
npm run process:scheduling-automation -- --dry-run
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01
npm run process:scheduling-automation -- --execute --cycle=SAVED_CYCLE_ID
```

The CLI accepts only the listed mode flags and `--church=`, `--team=`, `--period=`, `--cycle=`, and `--limit=` values. It rejects empty or duplicate values, unknown arguments, malformed identifiers, a team without a church, a period without church and team, and limits outside 1-100. A supplied filter is checked again inside the claim transaction.

`--execute` is a write mode: it can create cycle records, availability forms, and personalized recipients, but not email intents or provider sends. `--live` can dispatch email only with both delivery gates active and uses the same scoped CLI arguments. Example controlled commands:

```powershell
npm run process:scheduling-automation -- --dry-run --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01 --limit=10
npm run process:scheduling-automation -- --live --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01 --limit=10
```

The `--live` example requires `SCHEDULING_AUTOMATION_EMAIL_ENABLED=true`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL`, plus the church master and email controls. Use only controlled test addresses. `--limit` must be 1-100 and the default is 100. The processor stops between operations on SIGINT/SIGTERM and on its eight-minute time budget. Structured JSON output contains run/cycle/action identifiers and privacy-safe counts, not recipient tokens, URLs, or contact details.

`firestore.indexes.json` includes the active availability-form overlap query and the existing due-action and targeted recipient queries. Verify indexes with the Firestore emulator and intended environment before scheduling; this change does not deploy indexes. CI runs server tests under the Firestore emulator. For local verification, use the documented `emulators:exec` command in the Phase 3C handoff. Review the demo church's dry-run, form/recipient counts, delivery action, and provider acceptance result. No Heroku Scheduler job or production index deployment is included.

Emergency disable: use **Disable email delivery** first to stop new provider calls; use **Disable automation** to stop form and email actions across the church. The environment gate can also be turned off before the next invocation. A claimed operation rechecks gates before each provider call; uncertain in-flight provider outcomes stay held for review. To recover after interruption, inspect the action and intent states; do not edit claims or retry unknown outcomes by hand. For an end-to-end test, run the mocked-provider Firestore integration test in CI or a local emulator, using a position-assigned volunteer and a member without email. Confirm one scoped form, current recipient access, provider acceptance, no duplicate intent on a repeated run, and no SMS dispatch.

## Product decisions

- **Question/problem:** Should timing settings, cycle creation, or timeline viewing activate recurring actions?
- **Approved behavior:** No. Church-wide availability automation is a separate opt-in setting, existing churches default to disabled, and activation records a boundary timestamp. Team disable and church master disable are enforced independently from timing inheritance.
- **Why:** Routine configuration and preview must not authorize automatic operations or replay historical actions.
- **Approval source/date:** Product-owner Phase 3 request supplied 2026-11-24.
- **Affected workflow/contract:** Church scheduling settings, cycle discovery, and the short-lived automation processor.

- **Question/problem:** Should a church activation setting also enable form creation or email delivery?
- **Approved behavior:** Keep the church master switch, automatic form creation, automatic email, and automatic SMS as separate settings. Email requires a separate deliberate confirmation and the server environment gate; SMS remains disabled.
- **Why:** Churches can prepare forms without sending email, enable email for an existing relevant request, and stop one automation layer without silently activating another.
- **Approval source/date:** Product-owner Phase 3C request supplied 2026-11-24.
- **Affected workflow/contract:** Scheduling automation settings, availability request actions, and initial email delivery.

- **Question/problem:** What may the first processor execute while production delivery remains unapproved?
- **Approved behavior:** `--execute` may prepare cycles, forms, and recipients without email intents. `--live` may dispatch only the initial availability email after both server and church gates are enabled. Do not configure a scheduler or activate production delivery as part of this implementation.
- **Reason:** The Phase 3C request authorizes a complete, gated email path and mocked-provider integration while withholding production activation and unattended scheduling.
- **Approval source/date:** Product-owner Phase 3C request supplied 2026-11-24.
- **Affected workflow/contract:** Initial availability email and processor execution modes.
