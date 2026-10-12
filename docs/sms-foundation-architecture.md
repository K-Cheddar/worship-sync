# SMS foundation audit and incremental design

Audited on 2026-10-12 on `in-progress`. This phase extracts shared batch mechanics; it does **not** implement bulk schedule SMS, background execution, or permission redesign. Production infrastructure/configuration was not inspected. Unresolved proposals below are not approved product decisions.

## Planning and authorization

### Goal

Let additional SMS features reuse approval and transport safety while keeping feature recipient rules and responses local.

### Existing architecture / before behavior

`authService.js` composes the notification handlers, availability/schedule context resolvers, consent storage, Twilio provider and webhooks. `server.js:1402` onwards exposes intent and availability batch routes. Production auth persistence requires Firestore (`authService.js:402`); fallback Maps are development/test storage, not a deploy strategy. The repository has no Procfile or app.json defining a separate worker; actual dyno configuration and billing are unknown.

Availability preparation, batch confirmation, sequential dispatch and results lived inside `notificationIntents.js`. Individual sends already use durable claims and final source/consent checks. Schedule messages are assignment-specific drafts and individually approved sends.

### After behavior

`notificationBatches.js` owns the stable batch review hash, approval claim transition, selected-intent iteration, resume exclusions and dispatch result aggregation. Existing handlers remain compatibility adapters. A send claim now checkpoints `attemptId` before provider work. The batch executor validates church, batch and feature ownership before recovering stale sends or projecting their results.

### Product Decision Check / behavior intentionally unchanged

The current foundation task authorizes extraction, recovery hardening and documentation. [Availability SMS contract](features/team-availability-sms.md) governs selection, shared numbers, explicit review and deliberate failed-send retries. Preserve those decisions. No UI, public API, idempotency identity, link format, collections or schedule email behavior changes. Unknown sends stay blocked. No new execution architecture, scheduler or automatic send path is implemented here. The operator subsequently selected continuation of approved work on the existing web dyno and one message per volunteer per schedule; implementation remains a later phase.

### Acceptance criteria / affected surfaces

Reuse mechanics without passing Express objects into shared code; retain persisted/API shapes and actual reviewed messages; keep datastore claims in transactions; prove no-send preparation, concurrent confirmation, interruption and ownership checks with fakes. Consumers are Forms, Messages and individual schedule sends through `authService.js`; display surfaces and Electron IPC are unaffected. The production composition is checked through auth-handler integration tests with memory persistence, plus transaction-shaped fakes; those do not establish real Firestore contention or Heroku resilience.

### Smallest implementation and limits

Moving the already used execution rules removes feature coupling at a real boundary rather than renaming availability handlers. Reservation, reminder rounds, secure recipient creation and availability result formatting remain local. There is no plugin registry, event bus or new persistence model. The Express response shim remains only in the compatibility adapter so sending continues through existing authentication and claim validation. Extracting a non-HTTP individual dispatch service is a later focused step.

## What is reusable today

| Responsibility | Existing owner | Feature supplies / remaining boundary |
| --- | --- | --- |
| Provider | `smsProvider.js` | Per-church approved/enabled config; centralized Twilio credentials, sender/service selection, normalized result and fake provider |
| Eligibility | `smsEligibility.js`, `smsConsent.js`, `churchMessagingConfig.js` | Active member and feature scope; church/normalized-phone consent and opt-out are shared |
| Feature adapter | `teamsAuthHandlers.js:8288`, `:8452`, `:8498` | Recipient rules, source context, response URL and current message material |
| Intent | `createNotificationIntent`, `saveEventIntents` | Stable event/source/member identity; preparation writes previews only |
| Review | `prepareIntentReview`, `reviewStillMatches` | Source fingerprint and message builder; version binds identity, phone, consent evidence, content and segment count |
| Batch mechanics | `notificationBatches.js` | Prepared rows/intents and `matchesSource`; storage claim wrapper and send callback |
| Send | `claimIntent`, `sendIntent` | Current source resolution; shared atomic claim, attempt, revalidation, provider and outcome rules |
| Tracking | `smsDeliveryAttempts.js`, `smsStatusWebhook.js`, `notificationLedger.js` | Delivery state; ledger is supplementary history, not the SMS send lock |
| Response | Intake recipient submission and assignment response handlers | Availability submitted fields or schedule accepted/declined answers; never infer them from SMS delivery |

A future feature should supply selection, content, scoped authorization, source freshness and a secure response destination. It must not bypass the intent claim or final consent validation. The extracted executor is deliberately source-independent; it is tested with a non-availability source, but no schedule bulk adapter is installed.

## Concrete findings and consequences

1. **HTTP timeout and unfinished work:** `notificationBatches.js:32` iterates sequentially inside `dispatchAvailabilityBatch` (`notificationIntents.js:1386`). There is no time budget, provider request deadline, heartbeat or independently durable execution cursor. Up to 500 recipients may be selected. Heroku drops a request after 30 seconds while application processing can continue: [Heroku H12 guidance](https://devcenter.heroku.com/articles/preventing-h12-errors-request-timeouts). Browser disconnect and timeout do not reliably stop the loop; a process crash does. The extraction does not fix or hide this risk.
2. **Stale timestamps are not ownership leases:** `notificationIntents.js:188`, `:193`, `getAvailabilityBatch` and the shared claim allow two-minute stale recovery. An old process can still be running when a new request recovers the batch. Per-intent transactions block duplicate active sends, but recovery blindly writes unknown from an earlier read and batch completion writes a retained batch snapshot without fencing. A stale read can overwrite a newly confirmed result; competing finalizers can replace progress. Safe long-running recovery needs conditional attempt-state transitions and dispatcher ownership tokens, not a longer timeout.
3. **Attempt pointer gap fixed here:** `claimIntent` used to create an attempt without attaching its ID to the sending intent until provider completion. A crash left recovery unable to mark that attempt uncertain. Both transaction and memory claim paths now checkpoint `attemptId` with `sending`. Legacy sending intents without this field remain blocked; do not invent an attempt association or resend them.
4. **Provider acceptance is not atomic with application persistence:** `sendIntent` writes provider SID/status to attempt, then intent. If the second write fails, its catch writes unknown/pending over the confirmed attempt. A crash before the SID write leaves callbacks unable to match. This avoids automatic resend but can strand known sends and lose evidence. Preserve accepted evidence monotonically, atomically reconcile attempt/intent where possible, and add an attempt-bound signed callback correlation before unattended recovery. Never use absence of a saved SID as proof the provider did not accept.
5. **Callback ordering has a concurrency gap:** `smsStatusWebhook.js:32` queries by SID, then writes without a transaction (`:44`). `nextSmsDeliveryStatus` protects sequential duplicated/delayed callbacks, not simultaneous callbacks or a send-result write racing a callback. A callback arriving before SID persistence is acknowledged as ignored and is not retained. Webhook updates attempts only, not unknown intents. Transactional monotonic reconciliation and durable unmatched callback capture remain necessary.
6. **Broad authorization:** all notification preparation/history/review/dispatch paths use `requireTeamsEdit`; production injects `requireTeamsEditSession` (`authService.js:6654`, predicate at `:5121`). Team-scoped editors can be denied messaging despite schedule edit rights; globally authorized editors are not filtered by source teams. Compare `sendTeamSchedule` at `teamsAuthHandlers.js:13064`, which authorizes the schedule team. Recipient inclusion in a form's teams is not authorization for the operator. Read-only inspection of `in-progress-2` confirms its team-scoped helper validates the scoped team's church and active state, while its broad Teams edit helper remains broad. Align with those helpers when that work is available; no branch was switched or merged.
7. **Feature scope is not fully revalidated:** preparation checks member/form membership (`teamsAuthHandlers.js:8265`, `:8342`); `resolveAvailabilityNotificationContext` and the transaction validation path check church, active source, response and consent but do not repeat that membership resolution. Review fingerprints include form team IDs, not current member/position/team membership. Moving a member out of scope after review can escape final source-scope enforcement. Final validation must also bind recipient.memberId to intent.memberId. Keep this adapter responsibility explicit before adding features.
8. **Draft preparation concurrency:** reservation binds church/form/type/selected member IDs and request key and allocates reminder rounds transactionally. Remaining preparation happens outside that transaction. Two requests observing `preparing` can both build previews; adoption from a different batch checks and writes separately and can race dispatch. The existing ten-minute review fingerprint blocks many stale sends, but this is not a fenced preparation lifecycle. Reservation and preparation need conditional completion/adoption tests before a generic prepare endpoint.
9. **Inbound mapping is single-number-only:** `smsInboundWebhook.js:76` maps `To` to exactly one `senderPhoneNumber`; no match or ambiguity returns successful empty TwiML without changing consent. The provider preferentially uses a Messaging Service, which may select another sender. Inbound code ignores service/account metadata and `OptOutType`. [Twilio Messaging Services](https://www.twilio.com/docs/messaging/services) documents sender-pool selection, inbound webhook settings and Advanced Opt-Out. Verify unique church/account/service ownership, every pool number, enabled webhook/signature credentials and keyword settings before adding senders. Never choose an arbitrary church under ambiguity.
10. **Publication/email coupling:** `sendTeamSchedule` first emails (`:13150`), sets `sentAt` (`:13156`), then records SMS drafts (`:13161`). `validateIntent` requires `sentAt` for assignment notifications. The smallest future separation is a channel-neutral publication checkpoint and independent email/SMS delivery operations. Preserve legacy `sentAt` interpretation for old schedules and keep today's Send schedule action calling the same sequence. Do not silently define a publication revision from a timestamp changed by unrelated writes.
11. **UI recovery is useful but limited:** `availabilityBatchActions.ts` persists request and last-batch IDs; Messages reloads the latter, and Forms reads current batch after dispatch errors. Recovery depends on that browser's local storage and history queries; there is no authorized server batch list or polling while a dispatcher continues. It cannot guarantee progress discovery from another browser/device.

## State, identity and approval contracts

Intent creation starts at `preview`. Review attaches a snapshot; `ready` is also sendable. A transaction checks current source/member/config/consent and matching unexpired version, then writes `sending` plus attempt and operator identity before provider work. Final validation immediately precedes the provider call; it cannot eliminate an opt-out racing the external side effect after that read.

- Accepted with a provider SID: intent `sent`, attempt `confirmed` with accepted/sent/delivered/undelivered/failed delivery status. Later undelivered or failed callbacks never make the intent retryable.
- Definitive rejection or pre-provider failure: intent `failed`, attempt `failed` or `not_sent`; clear approval. Deliberately prepare/review again before retrying.
- Ambiguous provider/network outcome or interrupted active claim: intent `unknown`, attempt outcome `unknown`; never automatically retry. Existing reconciliation is insufficient to release this state safely.
- `suppressed` is handled/non-sendable. `sending` and `unknown` cannot be claimed again.

Current provider error classification treats an HTTP status below 500 or five-digit provider code as definitive; ambiguous/network failures without such evidence remain unknown. Review this classification against actual Twilio error semantics before expanding recovery; a code alone is not general proof of non-acceptance across arbitrary providers.

Batch lifecycle: `preparing -> prepared -> dispatching -> sent | partial`; adoption by another draft can set `superseded`. Stale dispatch is recoverable as `partial`. `sent` describes processing/provider acceptance, not guaranteed handset delivery. `partial` also covers unknown, failed, pending and invalidated previews. Failed intents require new deliberate preparation; batch resume sends only untouched `preview`/`ready` intents. Excluded rows stay in the review for explanation.

Batch review hash retains its exact legacy serialization: batch ID, ordered selected member IDs, and each row's intent ID/version/segment count. Individual versions bind actual message/phone/source/consent. Individual review TTL is ten minutes. Batch review itself has no independent expiry; each send enforces its snapshot TTL. Formatting a batch does not renew approval. A 500-message loop can outlast review validity.

Persisted identities remain unchanged:

- Batch ID: hash of `churchId|notification-batch|requestKey`; repeating a reserved key with another source/type/selection is rejected.
- Intent ID: hash of `churchId|notification-intent|idempotencyKey`.
- Availability initial key: `availability_request|formId|recipientId`; reminder adds reminder round.
- Schedule drafts use event/schedule/occurrence/cell/member identity. They are not suitable as the canonical identity of a schedule-wide member message.
- Consent: church + normalized phone. Shared numbers retain separate member messages/private links under the approved availability contract.
- Ledger: recipient/event/subject/occurrence; phone-based collisions do not control SMS claims. Do not change its identity or use it to merge members' secure messages.

Authorization must be applied at selection, preview/history projection, approval and immediately before dispatch using current source ownership and all affected teams. Future adapters must resolve authorized form/schedule scope using established permission helpers. A background runner would need an explicitly defined operator authority snapshot/recheck policy; possession of a persisted approved batch does not grant unrelated-team access.

## Dispatch and recovery options — design only

Firestore can store approved work and atomic per-intent claims without Redis or a queue service. It cannot itself run unfinished sends after a web process exits. Distinguish automatic *creation/approval* (prohibited) from executing already approved immutable work (requires the selected execution contract).

| Option | Costs / tradeoffs | Recovery |
| --- | --- | --- |
| Bounded HTTP chunks, existing web + Firestore | No new service/dyno; extra requests and Firestore reads/writes; no unattended completion after app closure | Persist approval and immutable reviewed IDs first. Process a bounded number under a deadline below router timeout. Poll saved progress. Operator explicitly resumes after disconnect/closure; pause for new review if remaining approvals expire. Provider timeout/unknown still requires reconciliation. Lower-complexity alternative, not the selected direction. |
| Continue approved work on existing web dyno | No separate dyno; consumes web capacity; cannot guarantee execution on sleeping/restarting dynos | Persist approval, use fenced leases/heartbeat and conditional transitions; return progress immediately. Define restart/recovery trigger and expiry/permission policy before implementation. A detached Promise alone is insufficient. |
| Dedicated worker with Firestore work records | Added Heroku dyno cost and operations; exact cost depends on existing plan and worker size, which were not inspected | Worker can continue approved work separately from HTTP. Still needs fenced claims, provider deadlines, reconciliation and deploy recovery; Redis is not intrinsically required. No worker/dyno purchase approved. |

Required recovery order: inspect accepted attempt evidence -> reconcile intent monotonically -> classify unconfirmed active attempt as blocked unknown -> continue only unclaimed reviewed recipients. Persist progress per item; fence finalization; never let an older dispatcher overwrite newer outcomes. Catch recipient-level application/provider failures so remaining recipients are accounted for; datastore failure can interrupt the run and must remain visible/recoverable. No scheduler may initiate volunteer notifications.

## Confirmed direction and unresolved details

Product-owner replies on 2026-10-12 authorize the direction for subsequent work:

- Continue explicitly approved dispatch on the **existing web dyno**, including after app closure. This does not authorize new notification initiation, a scheduler, a worker dyno, or new paid infrastructure. Use persisted approved work, fenced leases and restart recovery; actual hosting capacity/awake behavior must be verified.
- Send **one message per volunteer per schedule**. The product owner also intends reminders the week before. The original explicit operator initiation/review/approval invariant remains in force for reminders; automatic timed sending has not been requested or approved. Exact reminder identity, eligible subset, date interpretation and content belong to that later feature contract.

Still unresolved: whether approved work may continue beyond the existing ten-minute review expiry, how permission revocation affects approved work, and which restart trigger can resume it on the current dyno. These are consequential design details, not silently selected defaults. Also resolve changed-schedule/removal resend semantics and mixed assignment-response summaries before implementing bulk schedule SMS.

## Future schedule SMS integration contract — not implemented

1. Choose an existing schedule and SMS channel independently of email. Resolve channel-neutral publication under the future publication contract.
2. Adapter gathers all current assigned roster volunteers, once per person; applies authorized team scope, active member and current consent. Guests without established roster/SMS consent must not be silently included.
3. Build personalized reviewed content and use the existing `(church, schedule, member)` assignment response token/page. That page already supports answering multiple assignments; link format need not change.
4. Confirmed grouping is one message per member per schedule containing all their assignments. Do not silently collapse old assignment-specific intents or use them as proof the grouped message was sent. Week-before reminders will be a separately prepared and explicitly approved event, not an automatic consequence of publishing.
5. Duplicate identity should include church, event, schedule, member and the explicitly approved publication/change identity for the chosen grouping. Source freshness should hash the canonical sorted assignment set shown in the review, occurrence dates/names, role labels, publication and recipient context. Exclude unrelated edits only under an explicit freshness contract.
6. Review rows, exclusions, destinations, complete message/link and segment estimates; persist approval before the shared executor sends. Consent and assignment set must be reread for each claim/final send.
7. Track application send state, provider delivery and each assignment response separately. A grouped message may have mixed accepted/declined/unanswered assignments. Define the summary policy before showing a single volunteer response label.
8. For later changes, compare the published assignment snapshot to the next explicitly approved change set, select only affected people (including removed holders where authorized), and group their relevant changes. A source hash alone is not resend permission. Define removal wording, removal-link behavior, material changes and no-change resend policy before implementation.

## Ordered next phases / readiness

1. Make recovery state transitions conditional and preserve confirmed provider evidence; transactional callbacks, correlation/unmatched callback capture, and controlled race/failure tests.
2. Align source/team authorization and final member/source scope validation with the separate permissions work; include history and preview projections, not only sending.
3. Implement the selected existing-web-dyno continuation design with fenced progress and server-side authorized batch discovery, once expiry/reapproval, permission revocation and restart recovery behavior are resolved. Add provider deadlines. Verify real Firestore contention and representative Heroku interruption before claiming reliability.
4. Separate publication from channel delivery while retaining today's email action and legacy schedules.
5. Use the confirmed per-member/per-schedule grouping and resolve change/resend/reminder/response-summary details; only then implement the schedule adapter and bulk UI through shared mechanics.

Schedule bulk SMS is **not ready yet**. The reusable mechanics are a useful first extraction, but execution/reconciliation, scoped authorization, independent publication and message grouping identity remain blockers. Existing individual schedule drafts and availability sending continue to work; this phase is not a claim of production fault tolerance.

## Verification and review scope

Verification commands/results are recorded below and in the task handoff. Test providers never send real SMS. Node handler tests use memory storage and a serial transaction-shaped fake; API tests use real auth-service composition with memory storage and fake SMS; Jest tests mock API operations. Real Firestore retry semantics, live Twilio callbacks/sender pools and Heroku restart/timeout behavior are not verified.

Commands actually executed (reporter/output filtering does not change test selection):

```powershell
node --import tsx --test --test-reporter=spec server/notificationBatches.test.js server/notificationIntents.test.js server/smsMessaging.test.js server/smsConsent.test.js server/smsInboundWebhook.test.js server/smsStatusWebhook.test.js server/notificationLedger.test.js server/assignmentResponseToken.test.js
# 101 passed, 0 failed, 0 skipped

node --import tsx --test --test-reporter=spec --test-name-pattern='SMS|notification requests|schedule.*(send|email)|send.*schedule' server/teamsApi.test.js
# 8 selected tests passed, 0 failed, 0 skipped

npm.cmd test --prefix client -- --watchAll=false --runInBand --runTestsByPath src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx src/pages/Teams/components/AvailabilityBatchReview.test.tsx src/pages/Teams/pages/TeamsMessagesPage.test.tsx src/pages/Teams/availabilityBatchActions.test.ts
# 4 suites / 29 tests passed

npm.cmd run type-check --prefix client
# Passed (tsc --noEmit, exit 0)

git diff --check
# Passed
```

Initial `npm run type-check --prefix client` was blocked by the Windows PowerShell execution policy for `npm.ps1`; invoking `npm.cmd` succeeded without changing that policy. No full suite, live sends, deployment or real database test was performed.

Self-review scope: extraction and affected workflow compatibility, not branch production readiness. Full diff/callers/API types/route wiring, legacy identity/hash serialization, operator confirmation and response-token compatibility were traced. Known audit findings above remain outside this incremental patch.

| Invariant | Adversarial scenario | Code / test evidence | Result |
| --- | --- | --- | --- |
| Resume never resends a confirmed item | First intent persists sent, request fails before second claim, retry | Shared executor; controlled interruption test in `notificationBatches.test.js` | Pass in fake storage |
| Claim carries recovery identity | Provider is entered before outcome persistence | `claimIntent`; attempt checkpoint tests in both memory and transaction fake | Pass in fakes |
| Foreign intents cannot be recovered | Stale row belongs to another church/batch/source | Shared executor ownership guards; shared and availability handler regression tests | Pass in fakes |
| Exact review and current consent remain required | Expire approval/delete or withdraw consent after review | `claimIntent` and final check; batch regression and composed API tests | Pass in fakes |
| Existing public link and accepted-send block survive | Prepare twice, confirm, later mark undelivered, prepare again | New composed auth-handler batch test and assignment token suite | Pass in memory integration |
| Long-running concurrency is fenced | Old dispatcher completes after stale recovery | Existing timestamp/write sequence inspected; no new execution architecture | Finding, unresolved |

Review checklist: cross-boundary, sibling-pattern, persisted compatibility, identity isolation, contract round trip, validate/use, retry authority, provider-result adoption, authorization/projection, and production composition reviewed. No new long-lived UI owner or callbacks were introduced; existing client unmount tests were reviewed/run. No optional check is represented as live production verification.

Final review readiness: **Ready** for the bounded extraction/compatibility scope. No blocking regression was found in this patch. The broader production reliability and schedule readiness review remains **Not ready** for the concrete findings and missing infrastructure verification above.
