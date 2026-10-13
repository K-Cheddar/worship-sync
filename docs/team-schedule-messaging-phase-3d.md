# Phase 3D: Reliable schedule SMS dispatch and recovery

**Branch:** `in-progress-2`  
**Implementation status:** INCOMPLETE  
**Production SMS readiness:** DISABLED (`SCHEDULE_BULK_DISPATCH_READY = false`)

## Before and after

Phase 3C persisted grouped schedule previews, but dispatch either stayed disabled or used the request-bound availability executor. Closing the browser could not continue work or reliably discover progress from another device.

Phase 3D adds explicit durable approval to the existing `notificationBatches` record. The approved snapshot stores the review version, operator, approval time, selected recipient identities and each exact reviewed message. A separate in-process dispatcher scans only already-approved schedule batches, claims a Firestore lease, sends a bounded number of recipients, persists progress after each one, and releases the lease. The existing per-intent claim, attempt identity, Twilio callback correlation and monotonic reconciler remain the source of delivery truth.

The confirmation endpoint writes approval before responding and does not wait for provider calls. Refreshing or reopening the schedule discovers the current approved batch from the server. When the progress drawer is open, the client polls the authorized batch endpoint; polling stops when it closes or the batch reaches a non-active state.

## Decisions approved by the product owner

The user selected these policies on 2026-10-12. The gate remains closed until the operational verification below is complete.

### A. Review expiry

Options considered:

- Require every unsent recipient's ten-minute preview to remain unexpired at send time. This gives the freshest review but can strand a large batch after explicit approval.
- Freeze the exact content and review version at explicit batch approval, then recheck source eligibility, schedule publication, current member/phone, church messaging configuration and consent immediately before every provider call. This honors the reviewed text while blocking messages that are no longer eligible.
- Use a separate approval grace period and ask for renewed approval after that period. This adds another expiry policy and still needs per-recipient current eligibility checks.

**Recommended and selected:** the second option. After batch approval, an individual preview may expire without changing its frozen content. Each send still requires the approved message/version to match and current consent, phone, source, publication and permission checks to pass. Any mismatch excludes that recipient from this approved batch; it does not silently edit the approved text.

### B. Permission revocation

Options considered:

- Let an approved batch finish after its operator loses Team access. This preserves completion but makes stored approval outlive the authority that granted it.
- Pause before processing more recipients when the original approver no longer has current management access. Re-review and explicit approval can resume eligible unsent work after access is restored.
- Transfer the work to any current administrator automatically. This changes who authorized the content and widens authority without an operator action.

**Recommended and selected:** the second option. The worker checks the approver's current church/Team scope before each recipient, and the send path checks again immediately before provider work. On revocation, it records `paused`, releases its lease and leaves unsent recipients for a fresh review/approval. Already accepted or uncertain recipients remain fenced and are not retried.

### C. Restart recovery

Options considered:

- Require a new authorized operator action after every restart. This gives more control but leaves already-approved work idle until a person returns.
- Automatically resume persisted approved work on web-dyno startup and through an active-process polling check. This reduces stalls but consumes web-process capacity and cannot run if no dyno is running.
- Add a separate worker or scheduler. This adds infrastructure/cost and was not authorized.

**Recommended and selected:** the second option, using only the existing web dyno. A new process scans approved/expired-lease batches at startup; active processes poll every five seconds. No draft is auto-approved. If Heroku has no web dyno running, no code can execute until one starts; unattended completion is not guaranteed by this design.

## Durable states and duplicate prevention

Batch states for this path are:

`prepared -> approved -> dispatching -> approved -> complete | partial`

`paused` records approver permission revocation. The dispatcher processes at most two new sendable recipients per pass and then returns unfinished work to `approved`. Persisted progress lets the next pass move beyond already handled recipients; batches rotate by a Firestore indexed dispatch priority so a large batch does not hold later approved batches at the front of every scan. `complete` means all recipient intents were handled; `partial` includes definitive failures and uncertain outcomes. It does not mean every handset received the SMS.

Each active dispatcher claim stores a random owner token, monotonically increasing generation, heartbeat and lease expiry. Production claim, lease renewal, per-recipient progress and release are Firestore transactions. Every progress/final-state mutation compares the owner token and generation. A newer lease fences an older process from batch writes. The lease is 90 seconds; an expired lease allows another process to inspect persisted intents, but is never evidence that provider work failed.

Before each SMS, the existing intent transaction atomically moves the reviewed intent to `sending` and creates a unique attempt ID. Another process cannot claim that same intent. Confirmed provider evidence is monotonic and blocks further sends, including accepted attempts whose later delivery callback is `failed` or `undelivered`. Unknown outcomes stay blocked. A definitive rejection remains failed and requires deliberate preparation/review; no background automatic retry occurs. If a process stops after the intent claim but before proving whether the provider was called, the conservative recovery result is unknown rather than a retry.

The provider request timeout is 15 seconds. Twilio status callbacks remain bound to persisted attempt identity and callback token. If acceptance was recorded on the attempt but not the intent, recovery reconciles the accepted attempt before considering any new provider call. Duplicate and late callbacks use the existing monotonic reconciler.

## Authorization, consent and privacy

Approval requires the existing authorized schedule route and exact batch review version. An active approval is not a permanent authorization or consent bypass. The worker checks that the original operator still has access to the church and schedule Team; the individual send validates schedule publication, current assignments/message, active member, current phone, messaging configuration and consent again before provider work. The direct single-intent route remains blocked for this grouped initial message.

Progress is available only through existing schedule-scoped authorization. Admins retain church-wide access; scoped Team managers must retain current Team access. The response masks phone numbers and redacts personalized response links. Persisted exact messages, phone snapshots and secure response URLs are not returned as internal approval fields. The Phase 3C admin-prepared/scoped-manager privacy path remains covered by API tests; Phase 3D progress tests also verify no private token in the recovered view.

## UI

`ScheduleInitialSmsSendFlow` recovers the current approved batch from the server, polls only while the progress panel is mounted/open and the batch is active, and displays recipient counts for awaiting execution, sending, provider accepted, delivered, failed, uncertain and excluded. After a later review replaces the current batch, a privacy-safe recent-batch summary preserves prior outcomes. Provider acceptance and handset delivery are separate labels. Closing the panel does not cancel approved work. Uncertain outcomes have no retry control.

The final-confirm action remains disabled in the client, and the server readiness constant remains false. There is no client-only path around the server gate. A deliberate future readiness change must update both the server-side gate and the user-facing readiness state after production verification.

## Heroku operating model inspected

- `npm start` runs `tsx server.js`; `package.json` pins Node `24.x`.
- The repository has no `Procfile`, `app.json` or `heroku.yml`. The configured number, size, stack and awake/idle behavior of the deployed web dyno could not be determined from the checkout.
- `server.js` now starts the dispatcher only after the web server listens and after Firestore is available. SIGTERM/SIGINT stops new dispatcher scans, waits for the current bounded recipient operation, then closes the server and active connections.
- The 15-second Twilio request deadline is shorter than the 90-second batch lease. The process handles one recipient at a time; each pass handles at most two recipients. Multiple web processes rely on Firestore fencing rather than a process-local mutex.
- The candidate query needs the `notificationBatches(intentType, status, dispatchPriorityAt)` composite index added to `firestore.indexes.json`. It has not been deployed to production.
- Firebase CLI is installed, but `firebase.json` has no Firestore emulator configuration. No emulator was started and no emulator-backed contention/restart test was run.
- Heroku CLI discovery was attempted with `heroku apps --json`, but the command could not open `%LOCALAPPDATA%\heroku\error.log` because the workspace sandbox denied writes there. The only configured Git remote is the source repository, so no Heroku app could be identified for read-only dyno inspection.
- With no running web dyno, approved records wait in Firestore. They resume only when a web process starts and the index is deployed; this does not promise unattended delivery.

## Verification record

Fake SMS providers and a serial transaction-shaped Firestore fake were used. These tests establish handler behavior in the fake, not Firestore's real retry/contention semantics. No live Firestore emulator, production database, Heroku dyno, deployment, Twilio account or real SMS was exercised.

Commands run for this phase:

```powershell
node --import tsx --test --test-reporter=spec server/notificationBatches.test.js server/notificationIntents.test.js
# 67 passed, 0 failed.

node --import tsx --test --test-reporter=dot server/smsDeliveryReliability.test.js server/smsStatusWebhook.test.js server/smsMessaging.test.js server/smsConsent.test.js server/smsInboundWebhook.test.js server/scheduleInitialSms.test.js
# Passed.

node --import tsx --test --test-reporter=dot --test-name-pattern="Phase 3C schedule SMS review uses current Team access and never sends" server/teamsApi.test.js
# Focused privacy/authorization composition test passed.

npm.cmd test --prefix client -- --watchAll=false --runInBand --runTestsByPath src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx src/pages/Teams/components/AvailabilityBatchReview.test.tsx
# 2 suites / 6 tests passed.

npm.cmd run type-check --prefix client
# Passed.

npm.cmd run lint:check --prefix client
# Passed with zero warnings.

git diff --check
# Passed.
```

Node syntax checks also passed for the changed server modules. The dispatch gate must stay closed until representative real Firestore contention/restart tests, applying the index, and actual Heroku process inspection have completed.

## Changed files

- `server/notificationBatches.js`, `server/notificationBatches.test.js`: schedule approval and fenced dispatcher mechanics.
- `server/notificationIntents.js`, `server/notificationIntents.test.js`: approval endpoint, worker storage adapter, current-state checks, progress projection and gated route tests.
- `authService.js`, `server.js`: current approver authorization, worker startup and graceful shutdown.
- `server/smsProvider.js`, `server/smsMessaging.test.js`: provider deadline and test coverage.
- `firestore.indexes.json`: dispatcher candidate index.
- `client/src/api/auth.ts`, `client/src/api/authTypes.ts`, `client/src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.tsx`, `client/src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.tsx`: server discovery, progress polling and status copy.
- `docs/sms-foundation-architecture.md` and this handoff: architecture, decisions and operational readiness.

## Readiness outcome

The code path is implemented behind the server gate. **Dispatch is not ready to enable.** The remaining blockers are representative real Firestore contention/restart verification, applying and exercising the new production index, and inspecting the actual Heroku dyno configuration/process capacity. The final local privacy/API/client checks pass. No deployment or merge was performed.
