# Phase 3D: Reliable schedule SMS dispatch and recovery

**Branch:** `in-progress-2`

**Implementation status:** INCOMPLETE — code and test paths are prepared; Firestore, Heroku and Twilio production evidence is still missing.

**Production SMS readiness:** DISABLED by default. `SCHEDULE_BULK_DISPATCH_ENABLED` and a verified `SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND` are both required.

## Before and after

Phase 3C persisted grouped schedule previews, but dispatch either stayed disabled or used the request-bound availability executor. Closing the browser could not continue work or reliably discover progress from another device. The old loop processed up to two recipients per pass and waited about five seconds before another pass.

Phase 3D adds explicit durable approval to the existing `notificationBatches` record. The approved snapshot stores the review version, operator, approval time, selected recipient identities and each exact reviewed message. A separate in-process dispatcher scans only already-approved schedule batches, claims a Firestore lease, sends a bounded number of recipients, persists progress after each one, and releases the lease. The existing per-intent claim, attempt identity, Twilio callback correlation and monotonic reconciler remain the source of delivery truth.

The confirmation endpoint writes approval before responding and does not wait for provider calls. Refreshing or reopening the schedule discovers the current approved batch from the server. When the progress drawer is open, the client polls the authorized batch endpoint; polling stops when it closes or the batch reaches a non-active state. Useful work continues immediately in bounded passes of ten recipients by default; idle scans wait five seconds. Provider concurrency defaults to one and is configurable up to two. The app-wide Firestore coordinator also shares segment-based pacing across web processes.

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

`paused` records approver permission revocation. The dispatcher processes at most ten new sendable recipients per pass by default and then returns unfinished work to `approved`. This bound is configurable from 1 to 25. Persisted progress lets the next pass move beyond already handled recipients; batches rotate by Firestore indexed dispatch priority so a large batch does not hold later approved batches at the front of every scan. `complete` means all recipient intents were handled; `partial` includes definitive failures and uncertain outcomes. It does not mean every handset received the SMS.

Each active dispatcher claim stores a random owner token, monotonically increasing generation, heartbeat and lease expiry. Production claim, lease renewal, per-recipient progress and release are Firestore transactions. Every progress/final-state mutation compares the owner token and generation. A newer lease fences an older process from batch writes. The lease is 90 seconds; an expired lease allows another process to inspect persisted intents, but is never evidence that provider work failed.

Before each SMS, the existing intent transaction atomically moves the reviewed intent to `sending` and creates a unique attempt ID. Another process cannot claim that same intent. Confirmed provider evidence is monotonic and blocks further sends, including accepted attempts whose later delivery callback is `failed` or `undelivered`. Unknown outcomes stay blocked. A definitive rejection remains failed and requires deliberate preparation/review; no background automatic retry occurs. If a process stops after the intent claim but before proving whether the provider was called, the conservative recovery result is unknown rather than a retry.

The provider request timeout is 15 seconds. Twilio status callbacks remain bound to persisted attempt identity and callback token. If acceptance was recorded on the attempt but not the intent, recovery reconciles the accepted attempt before considering any new provider call. Duplicate and late callbacks use the existing monotonic reconciler. The shared schedule dispatcher accounts for SMS segments, but it cannot set a production segment rate until the account, sender pool, destination countries and applicable A2P/Messaging Service limits are inspected. The rate variable has no default; an absent or invalid value keeps the feature disabled.

## Authorization, consent and privacy

Approval requires the existing authorized schedule route and exact batch review version. An active approval is not a permanent authorization or consent bypass. The worker checks that the original operator still has access to the church and schedule Team; the individual send validates schedule publication, current assignments/message, active member, current phone, messaging configuration and consent again before provider work. The direct single-intent route remains blocked for this grouped initial message.

Progress is available only through existing schedule-scoped authorization. Admins retain church-wide access; scoped Team managers must retain current Team access. The response masks phone numbers and redacts personalized response links. Persisted exact messages, phone snapshots and secure response URLs are not returned as internal approval fields. The Phase 3C admin-prepared/scoped-manager privacy path remains covered by API tests; Phase 3D progress tests also verify no private token in the recovered view.

## UI

`ScheduleInitialSmsSendFlow` recovers the current approved batch from the server, polls only while the progress panel is mounted/open and the batch is active, and displays recipient counts for awaiting execution, sending, provider accepted, delivered, failed, uncertain and excluded. After a later review replaces the current batch, a privacy-safe recent-batch summary preserves prior outcomes. Provider acceptance and handset delivery are separate labels. Closing the panel does not cancel approved work. Uncertain outcomes have no retry control.

The final-confirm action follows server-provided readiness and defaults disabled. There is no client-only path around the server gate. Activation requires explicit server-side environment variables; changing a client request cannot enable it.

## Hosting and provider findings

- `npm start` runs `tsx server.js`; `package.json` pins Node `24.x`. The repository has no `Procfile`, `app.json` or `heroku.yml`, so the deployed web dyno count, size, stack and awake/idle behavior cannot be inferred from source.
- `server.js` starts the dispatcher after the web server listens. SIGTERM/SIGINT stops new scans, waits up to 20 seconds for the dispatcher, closes active HTTP connections, then exits by 25 seconds. Another web process can recover an abandoned lease after its 90-second expiry.
- The Twilio request deadline is 15 seconds. The process handles one provider request by default (configurable to two), at most ten recipients per pass, and five-second idle scans. Useful work continues immediately between passes.
- Twilio throughput is measured in message segments per second and depends on account, sender and registration configuration. Twilio also documents account-level REST concurrency responses (20429). The actual Messaging Service, sender/A2P registration and account limit are unavailable here, so neither increased Twilio concurrency nor a segment rate is recommended. Keep concurrency at one until those values are inspected. See [Twilio throughput and account queues](https://www.twilio.com/docs/messaging/guides/account-based-throughput-overview), [A2P 10DLC throughput](https://help.twilio.com/articles/1260803225669-Message-throughput-MPS-and-Trust-Scores-for-A2P-10DLC-in-the-US) and [Twilio concurrency error 20429](https://www.twilio.com/docs/api/errors/20429).
- The candidate query exactly matches the existing composite index definition in `firestore.indexes.json`: `notificationBatches`, ascending `intentType`, ascending `status`, ascending `dispatchPriorityAt`. The definition appears once in the checked-in file; production deployment/readiness was not verified. After confirming the target project and deployment window, run `npm run firebase:update-indexes -- --project <FIREBASE_PROJECT_ID>` and wait for the index to become ready. Firestore builds the index over existing records; this does not change application data, but takes time and consumes index storage during the build.
- Emulator integration tests now cover real batch/coordinator transactions, lease transfer and fencing, 100-recipient recovery, intent claim races, repeated approval, consent revocation and callback races. `firebase.json` points the emulator at the production index definition, and server CI is configured to run the tests through `firebase emulators:exec`. They were skipped locally because `FIRESTORE_EMULATOR_HOST` is unset and Java is not installed. CI was not triggered from this task.
- Heroku CLI inspection was attempted read-only. `heroku auth:whoami` returned `EACCES`; no app name, dyno formation, size, runtime, memory or logs could be read. To continue after CLI authentication works, run `heroku apps --json`, `heroku ps --app <APP> --json`, `heroku ps:type --app <APP>`, and `heroku ps:scale --app <APP>`. Inspect recent releases and the safe feature/runtime variables with `heroku releases --app <APP> --num 10` and `heroku config:get NODE_OPTIONS SCHEDULE_BULK_DISPATCH_ENABLED SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY --app <APP>`. Review startup/restart and memory-limit errors in `heroku logs --app <APP> --num 200`; current memory utilization requires the app's Heroku Metrics view or existing process memory telemetry. These commands are read-only. Do not use `heroku config:set` during inspection.
- With no running web dyno, approved records wait in Firestore. They resume only when a web process starts and the index is deployed; this design does not promise unattended delivery.

## Benchmark and recommendation

`npm run benchmark:schedule-sms-dispatch` runs a fake-provider benchmark for batches of 10, 25, 50 and 100 recipients. The captured run is in [schedule-sms-dispatcher-benchmark.json](schedule-sms-dispatcher-benchmark.json). It uses 400–820 ms typical request latency, one 1.8-second request per 25 recipients, one segment for most messages and two segments for every eighth message. Separate 15-second timeout and restart cases (60 accepted, 1 uncertain and 39 untouched recipients) are included. Provider time is scaled for test speed; elapsed time is modeled, not measured against Twilio. Firestore operation counts come from the dispatcher store boundary; the separate 25 ms read/write cost is an estimate and is not added to modeled wall time. Event-loop lag was measured locally on Node 22; CI and the app target Node 24.

| Recipients | Old loop: modeled time | New default: modeled time | Old requests/s | New requests/s | Old reads/writes | New reads/writes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 28.68 s | 8.68 s | 0.35 | 1.15 | 45 / 28 | 45 / 32 |
| 25 | 83.52 s | 23.52 s | 0.30 | 1.06 | 114 / 64 | 115 / 81 |
| 50 | 167.88 s | 47.88 s | 0.30 | 1.04 | 225 / 126 | 225 / 164 |
| 100 | 340.69 s | 95.69 s | 0.29 | 1.05 | 450 / 282 | 450 / 337 |

The 10-recipient/serial profile was 3.3–3.6 times faster in this model, retaining five-second idle polling and removing the delay between useful passes. Reads stayed about level; shared coordination adds Firestore writes. Removing a redundant preflight coordinator renewal reduced that overhead. At 100 recipients, the simulated 15-second timeout leaves one uncertain result and continues; restart recovery offers only the 39 untouched messages, not the 60 accepted or 1 uncertain outcomes. Concurrency two roughly halves normal modeled time, but it is not the recommendation until actual Twilio concurrency and sender limits are known.

**Candidate configuration after operational blockers close:** `SCHEDULE_BULK_DISPATCH_ENABLED=true`, `SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN=10`, `SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY=1`, and `SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND=<verified account/sender allowance>`. Retain the 90-second lease and five-second idle poll. No MPS value is supplied by this change.

## Verification record

Fake SMS providers and a serial transaction-shaped Firestore fake were used locally. The emulator suite was added but is not evidence yet because the local emulator could not start. No production database, Heroku dyno, deployment, Twilio account or real SMS was exercised.

Commands run for this phase:

```powershell
node --import tsx --test --test-reporter=spec server/notificationBatches.test.js server/notificationBatches.firestore.test.js server/notificationIntents.test.js server/scheduleSmsDispatchConfig.test.js
# 75 passed, 0 failed, 8 emulator tests skipped without FIRESTORE_EMULATOR_HOST.

npm run benchmark:schedule-sms-dispatch
# Fake-provider simulation completed for 10/25/50/100 recipients and timeout/recovery scenarios.

node --import tsx --test --test-reporter=dot server/smsDeliveryReliability.test.js server/smsStatusWebhook.test.js server/smsMessaging.test.js server/smsConsent.test.js server/smsInboundWebhook.test.js server/scheduleInitialSms.test.js
# Passed.

node --import tsx --test --test-concurrency=1 --test-reporter=dot server/notificationBatches.test.js server/notificationBatches.firestore.test.js server/notificationIntents.test.js server/scheduleSmsDispatchConfig.test.js server/smsDeliveryReliability.test.js server/smsStatusWebhook.test.js server/smsMessaging.test.js server/smsConsent.test.js server/smsInboundWebhook.test.js server/scheduleInitialSms.test.js server/teamsApi.test.js
# Passed (11 focused server regression files; emulator cases skipped).

node --import tsx --test --test-reporter=dot --test-name-pattern="Phase 3C schedule SMS review uses current Team access and never sends" server/teamsApi.test.js
# Focused privacy/authorization composition test passed.

npm.cmd test --prefix client -- --watchAll=false --runInBand --runTestsByPath src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx src/pages/Teams/components/AvailabilityBatchReview.test.tsx
# 2 suites / 7 tests passed.

npm.cmd run type-check --prefix client
# Passed.

npm.cmd run lint:check --prefix client
# Passed with zero warnings.

git diff --check
# Passed.
```

`npm run checks` was attempted, but the 92-file server suite stopped producing output after its initial tests for more than ten minutes; it was stopped, and the client/lint/typecheck stages were then run separately. The full client Jest run exposed failures and cascading timeouts in unchanged `TeamsAndServices.test.tsx` and `IntakeManager.test.tsx`; the focused schedule SMS UI suites passed. ESLint and TypeScript passed after the test fixes. `gh auth status` reported an invalid GitHub token and the GitHub API connection was blocked, so remote CI results could not be retrieved. Local Node is 22.23.1 versus the project's required Node 24.x. The dispatch gate must stay closed until the emulator suite passes, the production index is active, actual Twilio sender/account limits are documented, and Heroku process/memory inspection is complete.

## Changed files

- `server/notificationBatches.js`, `server/notificationBatches.test.js`: schedule approval and fenced dispatcher mechanics.
- `server/notificationBatches.firestore.test.js`: real-emulator transaction and recovery cases.
- `server/notificationIntents.js`, `server/notificationIntents.test.js`: approval endpoint, worker storage adapter, current-state checks, progress projection and emulator-gated send/callback cases.
- `authService.js`, `server.js`: current approver authorization, worker startup and graceful shutdown.
- `server/scheduleSmsDispatchConfig.js`, `server/scheduleSmsDispatchConfig.test.js`: disabled-by-default activation and bounded limits.
- `scripts/benchmark-schedule-sms-dispatcher.mjs`, `docs/schedule-sms-dispatcher-benchmark.json`: reproducible benchmark and captured output.
- `.github/workflows/checks.yml`, `firebase.json`: Firestore emulator and index wiring for server CI.
- `client/src/api/auth.ts`, `client/src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.tsx`, `client/src/pages/Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx`: server discovery, progress polling and readiness copy.

## Readiness outcome

The code path is prepared behind a server-only gate. **Dispatch is not ready to enable.** Emulator, index deployment, Twilio account limits and Heroku capacity remain unverified. No deployment, merge or real SMS was performed.

## Activation and rollback checklist

1. Pass the emulator-backed server CI job and all client/server checks on Node 24.
2. Authenticate to the intended Firebase project, deploy `firestore.indexes.json` with `npm run firebase:update-indexes -- --project <FIREBASE_PROJECT_ID>`, and verify the index is ready.
3. Inspect the actual Twilio Messaging Service/sender pool, registration and per-country segment throughput. Select a segment rate at or below the confirmed allowance; do not copy a benchmark value.
4. Inspect Heroku web dyno size/count, Node runtime, memory headroom, restart logs and normal API latency. Confirm that one in-process dispatcher per web process is acceptable with the shared Firestore coordinator.
5. Deploy the code with `SCHEDULE_BULK_DISPATCH_ENABLED` absent or `false`. Review current batches and confirm no unwanted work is already approved.
6. For controlled activation, set `SCHEDULE_BULK_DISPATCH_ENABLED=true`, the verified `SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND`, `SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN=10` and `SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY=1` on the intended web app, then restart/release and watch structured `schedule_sms.*` events and application metrics. For example, after replacing the placeholders with verified values: `heroku config:set SCHEDULE_BULK_DISPATCH_ENABLED=true SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND=<VERIFIED_SEGMENTS_PER_SECOND> SCHEDULE_BULK_DISPATCH_MAX_RECIPIENTS_PER_RUN=10 SCHEDULE_BULK_DISPATCH_MAX_PROVIDER_CONCURRENCY=1 --app <APP>`. This can resume existing approved unfinished work; it does not approve drafts.
7. Roll back dispatch with `heroku config:set SCHEDULE_BULK_DISPATCH_ENABLED=false --app <APP>`; the config change restarts the app. An in-flight provider call may finish during bounded shutdown; accepted and uncertain intents remain recorded and will not be retried. Leave the additive index in place while this code is deployed. If code rollback is also needed, disable the gate first, then roll back to the chosen prior release after confirming no process is still sending.

**NOT READY — BLOCKERS REMAIN**
