# Phase 3B: Team-scoped schedule messaging

## Goal
Extend existing individual schedule messaging to current Team editors, with no unrelated-Team disclosure. Work is confined to `in-progress-2`.

## Existing architecture and before behavior
`authService.js` composes `notificationIntents.js` with Teams source resolvers and current session guards. `notificationBatches.js` supplies reviewed batch mechanics for availability; no schedule batch adapter exists.

| Operation | Endpoint / handler | Before authorization |
| --- | --- | --- |
| Schedule history and delivery summary | GET `/api/churches/:churchId/notification-intents?scheduleId=...`, `listIntents` | Broad `requireTeamsEdit`; schedule is read later for responses |
| Individual preview | POST `.../notification-intents/:intentId/preview`, `getIntentPreview` | Broad edit for schedule sources |
| Reviewed SMS | POST `.../notification-intents/:intentId/send`, `sendIntent` | Broad edit before claim and again before provider |
| Replacement preparation | POST `.../notification-intents/replacement-invitation` | Broad edit before vacancy/candidate validation |
| Replacement resolution | POST `.../notification-intents/:intentId/resolve-replacement` | Broad edit; intent read in transaction/lock |
| Email | POST `/api/churches/:churchId/team-schedules/:scheduleId/send`, `sendTeamSchedule` | Persisted schedule Team edit |
| Assignment responses | GET/POST `/api/team-schedule-response` and authenticated response handlers | Existing personalized token/session and current assignment validation; no operator messaging grant |
| Delivery history | Intent history loads attempts by authorized intent IDs; intake `/team-intake/forms/:formId/sms-attempts` is form-specific | Schedule history broad edit; intake uses its separate existing scoped boundary |

Discrepancies: Team editors can edit schedules/email but cannot manage SMS. Schedule authorization does not resolve current schedule ownership. Replacement preparation lacks the scoped approval fingerprint/privacy projection used by availability. Church-wide unfiltered history must remain broad-only so cursors and recipient identities cannot expose other Teams. The replacement preparation API client has no UI caller; the Schedule drawer previously only sent and closed existing invitations.

## After behavior
Use one source-specific boundary for schedule listing, preview, sending, preparation and resolution. Load the persisted schedule and authorize its current Team through Phase 3A. Scoped review masks phones/private links and binds approvals to current permissions. Recheck before dispatch. Replacement eligibility remains the existing vacancy/position/member validator.

The existing Schedule messages drawer now offers replacement preparation for visible vacant/declined staffing slots. It uses current Team roster/position data, shared Select/Button controls and the existing SMS confirmation modal. Pending preparation prevents duplicate activation and shows errors. Church/schedule changes retire the form and prevent an old result from opening a new schedule's preview. Preparing does not assign a volunteer or send SMS.

## Product Decision Check
Authorization source: current Phase 3B request; contracts: `features/team-scheduling.md`, `features/team-availability-sms.md`, `sms-foundation-architecture.md`. Existing assignment validation requires positions to belong to the schedule Team. Combined occurrences share occurrence identity, not permission. Inconsistent legacy position ownership must fail closed for scoped operators; no ownership migration or cross-Team grant is introduced. Broad editors/admins retain their access.

## Behavior intentionally unchanged
Individual intent identities, response tokens, guest/email behavior, notification records, durable claims, consent/STOP, manual confirmation and unknown-outcome blocks. No assignment-edit sends, publication change, schedule batch SMS, reminder job or background runner.

## Acceptance criteria and proposed implementation
Inject a Teams schedule authorization adapter into existing notification composition. It checks persisted ownership using existing Team helpers and assignment position ownership. Apply it before history queries and replacement validation, during resolution, and through the existing preview/send boundary. Preserve broad-only unfiltered history. Add scoped privacy and approval binding to replacements using existing mechanisms.

## Affected surfaces
Server intent handlers, Teams ownership adapter, auth composition, existing Schedule drawer/actions. Production uses Firestore/session guards; tests exercise real composition with memory auth plus transaction-shaped handler storage/fake providers. Display/IPC and scheduling mutations are unaffected.

## Risks / edge cases
Permission revocation/reassignment between review and send; stale intent IDs; cross-church sources; mixed legacy position ownership; invalid replacement candidates; already sent/uncertain invitations. No source metadata supplied by a request grants access.

## Questions requiring user input
None for Phase 3B. Future bulk-SMS product questions below remain unresolved and are not implemented.

## Verification
Focused notification/batch/authorization/assignment/email server tests, representative production-composition scoped messaging coverage, existing Schedule/Message UI tests, client TypeScript and diff checks. Providers are fake; real Twilio and Firestore contention are outside local verification.

## Next implementation slice (design only)
Confirmed: one SMS per volunteer per schedule, existing personalized multi-assignment response page, shared reviewed batches, manual approval including week-before reminders, continuation of approved work on the existing web dyno without new paid infrastructure.

Dependencies: separate publication from email under the scheduling lifecycle work; define a new grouped identity without rewriting legacy individual intents; settle changed/removed assignment and duplicate-send semantics; preserve provider acceptance monotonically and reconcile interrupted claims; add fenced batch progress, authorized discovery, operator review and restart recovery.

Ask before implementing unresolved choices: which changes justify another message and which removed volunteers receive updates; reminder timing/timezone and eligible subset; mixed-response summary; whether approved work may outlive ten-minute review expiry; how permission revocation affects unfinished work; which restart trigger resumes approved work. No behavior is selected here.

## Files changed

- `authService.js`: inject the source authorization adapter.
- `server/notificationIntents.js`: reusable persisted schedule boundary; scoped history/review/dispatch/replacements; transaction-read schedule ownership on resolution; scoped replacement projection and approval fingerprint.
- `server/teamsAuthHandlers.js`: reuse current Team edit helpers and enforce existing position ownership for scoped messaging.
- `server/notificationIntents.test.js`, `server/teamsApi.test.js`: handler and actual auth composition regression coverage.
- `client/src/pages/Teams/schedule/ScheduleTab.tsx`, `ScheduleMessagesPanel.tsx`, `ScheduleReplacementInvitationForm.tsx`: replacement preparation in the existing drawer and current-source guards.
- `client/src/pages/Teams/schedule/ScheduleMessagesPanel.test.tsx`, `client/src/pages/Teams/pages/TeamsSchedulesPage.test.tsx`: mounted preparation/error/pending/retirement and scoped UI authority tests.
- `client/src/pages/Teams/pages/TeamsMessagesPage.test.tsx`, `client/src/pages/Teams/availabilityRecipientSelection.test.ts`: correct two stale copy assertions retained after merge `a00f7291`; the merged runtime intentionally kept "No mobile number". No eligibility behavior or runtime copy is changed.
- `docs/features/team-scheduling.md`, this report, `release-notes/2026-10-06-team-data-privacy.json`: contract, audit/plan/review, and existing Team-access product note.

## Verification results

Actually executed, using fake providers only:

```powershell
node --import tsx --test --test-reporter=spec server/notificationIntents.test.js server/notificationBatches.test.js server/smsMessaging.test.js server/smsConsent.test.js server/smsInboundWebhook.test.js server/smsStatusWebhook.test.js server/notificationLedger.test.js server/assignmentResponseToken.test.js
# 106 passed; 0 failed/skipped.

node --import tsx --test --test-reporter=spec --test-name-pattern='Phase 3B|team-scoped|scoped.*(manager|edit)|team edit guard|archived teams|effective Teams reads|teams bootstrap allows|availability.*(SMS|messaging|notification)|sending a schedule|assignment email|responding records|emailed token|declining an assignment|notification requests' server/teamsApi.test.js
# 23 selected passed; 0 failed/skipped. Rerun after final API assertions: same result.

node --import tsx --test --test-reporter=spec server/notificationIntents.test.js server/notificationBatches.test.js
# Final handler rerun: 43 passed; 0 failed/skipped.

npm.cmd test --prefix client -- --watchAll=false --runInBand --runTestsByPath src/pages/Teams/pages/TeamsSchedulesPage.test.tsx src/pages/Teams/schedule/ScheduleMessagesPanel.test.tsx src/pages/Teams/pages/TeamsMessagesPage.test.tsx src/pages/Teams/ScheduleResponsePublic.test.tsx src/pages/Teams/availabilityRecipientSelection.test.ts
# Final run: 5 suites / 36 tests passed.

npm.cmd run type-check --prefix client
# Passed (tsc --noEmit, exit 0), after correcting the new date formatter argument.

npm.cmd run lint:check --prefix client
# Passed (exit 0).

# From client/, rerun on final edited client files:
node node_modules/eslint/bin/eslint.js src/pages/Teams/schedule/ScheduleTab.tsx src/pages/Teams/schedule/ScheduleMessagesPanel.tsx src/pages/Teams/schedule/ScheduleReplacementInvitationForm.tsx src/pages/Teams/schedule/ScheduleMessagesPanel.test.tsx src/pages/Teams/pages/TeamsSchedulesPage.test.tsx src/pages/Teams/pages/TeamsMessagesPage.test.tsx src/pages/Teams/availabilityRecipientSelection.test.ts --max-warnings 0
# Passed (exit 0).

git diff --check
# Passed.
```

Initial API fixture needed a last name; the initial client run exposed the two stale merged copy expectations described above. Both were corrected and their suites rerun successfully. No full server/client test suite, real SMS/email, live database, deployment or branch merge was performed.

## Final workflow review

### Findings
Critical/High/Medium/Low: None introduced by this patch after corrections. Existing provider/recovery risks in the SMS architecture audit remain; this is a permissions workflow review, not a production-readiness claim for the whole SMS foundation.

### Product authorization status
Authorized by the Phase 3B request: current persisted Team scope on individual messaging/replacements, no cross-Team disclosure, dispatch reauthorization and accessible existing workflows. Fail-closed mixed position ownership follows the existing schedule/position contract. No new publication, resend, grouping, reminder or continuation policy is implemented.

### Open questions / assumptions
Schedules retain one owning Team. Service requirements may mention several Teams in a combined occurrence; only persisted assignment ownership and the actual vacancy are checked, so combined service definitions do not create a cross-Team grant. Consequential future questions remain listed above.

### Verification gaps
Production-context verification: Pass for `server.js` route tracing and actual `authService.js` composition/session guards with memory persistence and fake SMS/email. Client route -> current Team edit prop -> drawer -> prepared intent -> existing preview/confirmation -> server claim/provider was traced; mounted tests open the real drawer/Select controls. No required local verification gap remains once the checks below pass. Real Firestore contention, live browser/mobile rendering, live Twilio callbacks and Heroku restart behavior are additional-confidence checks not performed.

| Invariant | Adversarial scenario | Code/test evidence | Result |
| --- | --- | --- | --- |
| Current authority controls sends | Review succeeds, authority is revoked before send or after claim | Composed Phase 3B test changes persisted membership; notification handler test changes authorization at final provider boundary in memory and transaction fake | Pass |
| History cannot disclose other Teams | Guess foreign intent ID/cursor, use cross-church session, or change schedule owner | Production-composition test covers history, direct preview/send, combined occurrence and mixed position ownership | Pass |
| Replacements retain vacancy safeguards | Occupied slot, wrong position/candidate, unrelated source, competing invitation, uncertain outcome | Phase 3B API coverage and existing replacement unit tests; existing validator runs again during final send | Pass |
| UI results remain with their source | Retire pending form and mount same identifiers under another church | Mounted keyed form test rejects the old request; ScheduleTab checks current church/schedule before adoption and preview | Pass |
| Manual sending and compatibility survive | Prepare without provider, repeat accepted send, email and response token round trips | Foundation/claim/batch/token tests and selected composed email/response tests | Pass |

### Pattern / learning opportunities
Reuse the source adapter for any later schedule batch authorization. A reviewed token is content approval, never a substitute for current operator authority. No new repository-wide policy is necessary.

### Final readiness
Ready for Phase 3B workflow scope following the recorded verification. Cross-boundary review, sibling-pattern search, persisted identity compatibility, identity-switch/unmount checks, contract round trip, validate/use authority, retry authority, provider adoption and authorization projections: reviewed. Production composition: compared and tested. Owner-retirement handoff: not applicable; no global job/Activity owner is introduced. Existing synchronous provider/recovery semantics are preserved.
