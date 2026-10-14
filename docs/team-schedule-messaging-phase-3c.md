# Phase 3C: Grouped schedule SMS review

**Branch:** `in-progress-2`  
**Status:** INCOMPLETE — recipient selection, message preparation and persisted review are implemented; bulk dispatch stays disabled.

Phase 3D supersedes this handoff's dispatch blocker and unresolved policy questions. Durable approval and the fenced web-dyno dispatcher are now implemented behind the same disabled readiness gate; see [Phase 3D](team-schedule-messaging-phase-3d.md) for current behavior and verification blockers.

## Before and after

Before this slice, **Send schedule** used the email endpoint, which updated `sentAt` and created individual assignment SMS drafts. There was no independent schedule-wide SMS review or identity.

The schedule action now offers Email (the existing flow) and SMS. SMS opens a mobile-friendly recipient drawer without sending email. It reads the persisted schedule and displays one row per assigned roster member, groups that member's primary assignments, checks consent and delivery history, and saves a personalized preview with a segment estimate. A saved review is explicitly marked as unable to send while dispatch safety is unfinished.

Draft schedules are blocked by the email action, SMS preparation and SMS preview validation. A missing `published` field remains legacy Published. Publishing does not send a message, and this slice does not redefine or update `sentAt` as publication metadata. Email still uses its existing send endpoint and historical records remain intact.

## Recipient and identity rules

- Group one message per roster member per persisted schedule, including all current primary assignments in that schedule. Repeated positions are shown with a count. Separate members sharing a phone number remain separate recipients.
- Guests, archived members, missing roster records and assignments outside the schedule Team are excluded with an explanation. SMS consent, opt-out and phone eligibility are checked on the server.
- First sends are selected by default. Definitive failures are eligible but unchecked; accepted, active, uncertain, handled, consent-ineligible and phone-ineligible rows cannot be selected.
- Search does not clear selection. Schedule, church, recipient or selection changes retire an old preview. Incomplete message history prevents recipient selection.
- Scoped Team managers see masked phone numbers and redacted personalized links. Consent-needed and missing-phone categories remain visible; opt-out status is hidden. Cross-Team, read-only and cross-church access is denied.
- The initial identity is `schedule_initial_notification|scheduleId|memberId|initial`, then hashed with the church ID for the intent document. It is stable across retries and unrelated schedule metadata changes. Legacy assignment-specific intents are not treated as proof that a grouped schedule message was sent.
- Definitive provider failures require a new deliberate review. Accepted sends are never eligible again under this identity. Active or unknown provider outcomes remain blocked.

An example for a volunteer serving in three positions might read:

> First Church: Your schedule is ready. You're serving: Morning worship · Sun, Oct 4 — Camera, Audio; Evening worship · Sun, Oct 11 — Keys; Youth service · Sun, Oct 18 — Audio (2). View all assignments and respond: [personal response link]. Reply STOP to opt out.

The production message uses the existing signed schedule response URL (not placeholder text), the church's service timezone, every assignment and one response link. The existing page presents the member's schedule assignments and accepts a schedule-wide response.

## Shared notification infrastructure

The new schedule adapter reuses the existing intent review, consent resolver, segment measurement, approval snapshot/version, shared batch review version, persisted notification batch collection, per-intent history and current-source validation. It does not introduce a provider or separate notification store. Recipient eligibility and schedule-specific message content remain in the Teams adapter.

Preparing or opening a review never calls the SMS provider. Direct individual-intent sends for this grouped type and generic batch dispatch both stop at a server-side readiness gate. The UI has no active confirmation action.

## Dispatch blocker and decisions

`SCHEDULE_BULK_DISPATCH_READY` is hard-coded `false`. The current shared executor processes a batch inside a request and has no fenced batch owner, durable progress cursor, independent continuation, or restart trigger. A timeout or process interruption could leave the UI unsure which messages completed. Enabling a synchronous loop would risk H12 timeouts and unsafe retries, so dispatch must wait for the planned execution/recovery work on the existing web dyno. No paid worker, scheduler, automatic send or real SMS was added.

Before dispatch is enabled, resolve or implement the approved execution direction with durable per-recipient progress, dispatcher fencing, provider deadlines, monotonic accepted/unknown handling, authorized discovery, restart recovery and safe process-capacity limits. Confirm how current permissions and the ten-minute review expiry apply to already-approved work. Verify representative Firestore concurrency and Heroku interruption behavior.

Future product decisions remain open and are deliberately out of scope: which assignment changes justify another SMS, whether removed volunteers receive an update, whether an accepted initial message can ever be resent, how mixed assignment responses are summarized, and reminder timing and eligibility. Automatic publishing/edit sends and scheduled reminders are not implemented.

## Verification record

Tests use fake providers and local memory or transaction-shaped storage. No real SMS, live Firestore contention, deployment or Heroku restart was exercised.

Commands actually run:

```powershell
node --import tsx --test --test-reporter=spec server/scheduleInitialSms.test.js server/notificationIntents.test.js server/notificationBatches.test.js server/smsMessaging.test.js server/smsConsent.test.js server/assignmentResponseToken.test.js
# 102 passed; 0 failed/skipped.

node --import tsx --test --test-reporter=dot server/teamsApi.test.js
# 240 passed; exit 0. The Phase 3C composed authorization/consent/privacy case was rerun after its final fixture changes: 1 passed.

npm.cmd test --prefix client -- --watchAll=false --runInBand --runTestsByPath src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx src/pages/Teams/schedule/ScheduleMessagesPanel.test.tsx src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx src/pages/Teams/components/AvailabilityBatchReview.test.tsx src/pages/Teams/pages/TeamsSchedulesPage.test.tsx src/pages/Teams/ScheduleResponsePublic.test.tsx
# 6 suites / 32 tests passed.

npm.cmd run type-check --prefix client
# Passed (tsc --noEmit).

npm.cmd run lint:check --prefix client
# Passed (zero warnings).

git diff --check
# Passed.
```

No full client test suite, live SMS/email, production Firestore contention, deployment or Heroku interruption test was performed.

## Files changed

- `server/scheduleInitialSms.js`, `server/teamsAuthHandlers.js`, `server/notificationIntents.js`, `authService.js`, `server.js`: grouped schedule source, consent/eligibility, persisted review APIs and server-side dispatch gate.
- `server/scheduleInitialSms.test.js`, `server/notificationIntents.test.js`, `server/teamsApi.test.js`: grouping, retry/idempotency, stale-source, authorization, privacy, publication and no-provider coverage.
- `client/src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.tsx`, its test, `ScheduleTab.tsx`, `ScheduleMessagesPanel.tsx`, `AvailabilityBatchReview.tsx`, `client/src/api/auth.ts`, `authTypes.ts`; `IntakeManager.tsx` retains a form-ID guard now that notification batches can also be schedule-backed.
- `docs/features/team-scheduling.md`, `docs/sms-foundation-architecture.md`, this handoff: current behavior, decision boundaries and dispatch readiness.

## Release note

No release-note fragment is added: the grouped schedule SMS workflow cannot send yet, so this is not a shipped product capability. Curate a product note when the workflow is usable end to end.
