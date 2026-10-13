# SMS foundation audit and incremental design

Audited and hardened on 2026-10-12 on `in-progress`. Phase 1 extracts shared batch mechanics; Phase 2 adds monotonic send reconciliation. The initial audit did not implement bulk schedule SMS, background execution, or permission redesign. The Phase 3D update below supersedes its schedule-dispatch status; Heroku deployment configuration and live Firestore contention remain unverified.

**Phase 3C update on `in-progress-2`:** the first-send schedule adapter, current-Team authorization, distinct per-schedule/member identity, publication check, recipient selection and persisted personalized review were implemented. Its dispatch blocker is superseded by the Phase 3D update and [Phase 3D handoff](team-schedule-messaging-phase-3d.md).

**Phase 3D update on `in-progress-2`:** the gated implementation now has durable explicit approval, Firestore-transaction batch leases with generation fencing, recipient progress, current authorization/consent/source checks, startup and polling recovery, authorized server-side progress discovery, and UI recovery/polling. The product owner selected the review-expiry, permission-revocation and restart policies recorded in the [Phase 3D handoff](team-schedule-messaging-phase-3d.md). `SCHEDULE_BULK_DISPATCH_READY` remains `false`: transaction-shaped tests pass, but real Firestore contention and the actual Heroku app/dyno configuration were not verifiable from this workspace.

## Planning and authorization

### Goal

Let additional SMS features reuse approval and transport safety while keeping feature recipient rules and responses local.

### Existing architecture / before behavior

`authService.js` composes the notification handlers, availability/schedule context resolvers, consent storage, Twilio provider and webhooks. `server.js:1402` onwards exposes intent and availability batch routes. Production auth persistence requires Firestore (`authService.js:402`); fallback Maps are development/test storage, not a deploy strategy. The repository has no Procfile or app.json defining a separate worker; actual dyno configuration and billing are unknown.

Availability preparation, batch confirmation, sequential dispatch and results lived inside `notificationIntents.js`. Individual sends already use durable claims and final source/consent checks. Schedule messages are assignment-specific drafts and individually approved sends.

### After behavior

`notificationBatches.js` owns the stable batch review hash, approval claim transition, selected-intent iteration, resume exclusions and dispatch result aggregation. Existing handlers remain compatibility adapters. A send claim now checkpoints `attemptId` before provider work. The batch executor validates church, batch and feature ownership before recovering stale sends or projecting their results.

### Product Decision Check / behavior intentionally unchanged

The foundation task authorized extraction and recovery hardening. [Availability SMS contract](features/team-availability-sms.md) governs selection, shared numbers, explicit review and deliberate failed-send retries. Preserve those decisions. The operator subsequently selected continuation of approved work on the existing web dyno and one message per volunteer per schedule. Phase 3C implements first-send selection and review only; execution remains gated pending the separately planned continuation and recovery work.

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

Schedule SMS supplies its recipient selection, content, scoped authorization, source freshness and secure response destination through the Phase 3C adapter. It uses existing intent review, consent, segment measurement and batch review-version mechanics, and does not bypass individual intent claims. No schedule bulk dispatch adapter is enabled until safe execution and recovery are ready.

## Concrete findings and consequences

1. **HTTP timeout and unfinished work:** `notificationBatches.js:32` iterates sequentially inside `dispatchAvailabilityBatch` (`notificationIntents.js:1386`). There is no time budget, provider request deadline, heartbeat or independently durable execution cursor. Up to 500 recipients may be selected. Heroku drops a request after 30 seconds while application processing can continue: [Heroku H12 guidance](https://devcenter.heroku.com/articles/preventing-h12-errors-request-timeouts). Browser disconnect and timeout do not reliably stop the loop; a process crash does. The extraction does not fix or hide this risk.
2. **Stale timestamps are not ownership leases:** Phase 2 fixes per-intent recovery with fresh transactional reads, claim/owner checks and provider-evidence reconciliation. Batch claim/completion still lack dispatcher fencing: an old process can be running during stale batch recovery and retained final batch snapshots can replace progress. Fenced batch generations/leases remain continuation work; per-intent claims prevent resend of confirmed/unknown work.
3. **Attempt pointer gap fixed here:** `claimIntent` used to create an attempt without attaching its ID to the sending intent until provider completion. A crash left recovery unable to mark that attempt uncertain. Both transaction and memory claim paths now checkpoint `attemptId` with `sending`. Legacy sending intents without this field remain blocked; do not invent an attempt association or resend them.
4. **Provider acceptance is outside the database transaction:** Phase 2 replaces separate result/error writes with shared reconciliation. Firestore commits attempt/intent together; memory checkpoints the attempt first. Confirmed SID/outcome/delivery evidence survives subsequent exceptions. New sends persist callback correlation before contacting Twilio, so an authenticated early callback can checkpoint acceptance. A process/database failure before any result/callback checkpoint still leaves unavoidable uncertainty, never proof of non-sending.
5. **Callback ordering gap fixed in Phase 2:** query/URL attribution is followed by a fresh transactional read of attempt and intent. The same monotonic rule handles callback, result, exception and recovery writes. New correlation eliminates the SID-persistence race for newly claimed attempts. Legacy unmatched callbacks remain conservative no-ops because they cannot be attributed safely; no unmatched-message collection was introduced.
6. **Broad authorization:** all notification preparation/history/review/dispatch paths use `requireTeamsEdit`; production injects `requireTeamsEditSession` (`authService.js:6654`, predicate at `:5121`). Team-scoped editors can be denied messaging despite schedule edit rights; globally authorized editors are not filtered by source teams. Compare `sendTeamSchedule` at `teamsAuthHandlers.js:13064`, which authorizes the schedule team. Recipient inclusion in a form's teams is not authorization for the operator. Read-only inspection of `in-progress-2` confirms its team-scoped helper validates the scoped team's church and active state, while its broad Teams edit helper remains broad. Align with those helpers when that work is available; no branch was switched or merged.
7. **Feature scope is not fully revalidated:** preparation checks member/form membership (`teamsAuthHandlers.js:8265`, `:8342`); `resolveAvailabilityNotificationContext` and the transaction validation path check church, active source, response and consent but do not repeat that membership resolution. Review fingerprints include form team IDs, not current member/position/team membership. Moving a member out of scope after review can escape final source-scope enforcement. Final validation must also bind recipient.memberId to intent.memberId. Keep this adapter responsibility explicit before adding features.
8. **Draft preparation concurrency:** reservation binds church/form/type/selection/request key and allocates reminder rounds transactionally. Phase 2 makes intent creation and adoption conditional, so stale preparation cannot reset a completed or uncertain send. The broader preparation lifecycle and prior-batch supersession still lack dispatcher fencing; this remains a continuation boundary.
9. **Inbound mapping is single-number-only:** `smsInboundWebhook.js:76` maps `To` to exactly one `senderPhoneNumber`; no match or ambiguity returns successful empty TwiML without changing consent. The provider preferentially uses a Messaging Service, which may select another sender. Inbound code ignores service/account metadata and `OptOutType`. [Twilio Messaging Services](https://www.twilio.com/docs/messaging/services) documents sender-pool selection, inbound webhook settings and Advanced Opt-Out. Verify unique church/account/service ownership, every pool number, enabled webhook/signature credentials and keyword settings before adding senders. Never choose an arbitrary church under ambiguity.
10. **Publication/email coupling:** `sendTeamSchedule` first emails (`:13150`), sets `sentAt` (`:13156`), then records SMS drafts (`:13161`). `validateIntent` requires `sentAt` for assignment notifications. The smallest future separation is a channel-neutral publication checkpoint and independent email/SMS delivery operations. Preserve legacy `sentAt` interpretation for old schedules and keep today's Send schedule action calling the same sequence. Do not silently define a publication revision from a timestamp changed by unrelated writes.
11. **UI recovery is useful but limited:** `availabilityBatchActions.ts` persists request and last-batch IDs; Messages reloads the latter, and Forms reads current batch after dispatch errors. Recovery depends on that browser's local storage and history queries; there is no authorized server batch list or polling while a dispatcher continues. It cannot guarantee progress discovery from another browser/device.

## State, identity and approval contracts

Intent creation starts at `preview`. Review attaches a snapshot; `ready` is also sendable. A transaction checks current source/member/config/consent and matching unexpired version, then writes `sending` plus attempt and operator identity before provider work. Final validation immediately precedes the provider call; it cannot eliminate an opt-out racing the external side effect after that read.

- Accepted with a provider SID: intent `sent`, attempt `confirmed` with accepted/sent/delivered/undelivered/failed delivery status. Later undelivered or failed callbacks never make the intent retryable.
- Definitive rejection or pre-provider failure: intent `failed`, attempt `failed` or `not_sent`; clear approval. Deliberately prepare/review again before retrying.
- Ambiguous provider/network outcome or interrupted active claim: intent `unknown`, attempt outcome `unknown`; never automatically retry. Phase 2 can repair this state from confirmed evidence; absent evidence it remains blocked.
- `suppressed` is handled/non-sendable. `sending` and `unknown` cannot be claimed again.

Phase 2 classifies rejection at the Twilio adapter: a REST exception must carry an integer HTTP `status` of 400?499 (excluding timeout 408) and an integer Twilio request-error `code` in 20000?29999. The handler consumes only its explicit `definitiveRejection` signal. Codes alone, `statusCode` from arbitrary errors, delivery-error codes, 5xx and network failures stay unknown. See [Twilio REST responses](https://www.twilio.com/docs/usage/twilios-response) and [invalid callback rejection 21609](https://www.twilio.com/docs/api/errors/21609).

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

## Confirmed direction and remaining product scope

Product-owner replies on 2026-10-12 authorize the direction for subsequent work:

- Continue explicitly approved dispatch on the **existing web dyno**, including after app closure. This does not authorize new notification initiation, a scheduler, a worker dyno, or new paid infrastructure. Use persisted approved work, fenced leases and restart recovery; actual hosting capacity/awake behavior must be verified.
- Send **one message per volunteer per schedule**. The product owner also intends reminders the week before. The original explicit operator initiation/review/approval invariant remains in force for reminders; automatic timed sending has not been requested or approved. Exact reminder identity, eligible subset, date interpretation and content belong to that later feature contract.

Resolved on 2026-10-12: approval freezes the reviewed content while current eligibility and consent are checked again immediately before each provider call; unsent recipients pause if the approver loses Team management access; an existing web dyno automatically resumes persisted approved work on startup and through active-process polling. The exact alternatives and tradeoffs are recorded in the [Phase 3D handoff](team-schedule-messaging-phase-3d.md). Changed-schedule/removal resend semantics, reminder timing/eligibility and mixed assignment-response summaries remain separate product scope.

## Schedule SMS integration status

Phase 3C implements initial preparation and review. Phase 3D adds the gated continuation described in the [Phase 3D handoff](team-schedule-messaging-phase-3d.md):

- An existing Published schedule can be reviewed for SMS independently of email. Drafts are blocked; missing publication metadata keeps the legacy Published behavior. The existing email path and `sentAt` meaning remain intact.
- The Team adapter groups current primary assignments by roster member, checks active roster state, consent, opt-out and phone validity, excludes guests, and authorizes the persisted schedule Team. Scoped views mask full phones and response links.
- Messages use the existing schedule response page and one secure link per member. The initial identity is stable per church, schedule and member; old assignment-specific drafts are not grouped or adopted as proof of a grouped send.
- Reviewed recipients, actual messages, segment estimates, approval versions and batch review state are persisted. Opening or preparing the batch never calls the provider. Changed assignments, consent, publication or authority invalidate the review.
- The production readiness constant remains hard-disabled. Product approval now persists before any worker can act, and both the direct route and worker require the same server-side readiness dependency. Later reminders, resends, removal notices, assignment-change messages and single-label response summaries remain outside this implementation.

## Remaining execution and product decisions

1. Run a Firestore emulator or live non-production contention/restart suite against approval, competing leases, lease transfer and accepted-result recovery.
2. Inspect the actual Heroku app's web dyno count/size and process behavior, and exercise shutdown/restart recovery there before enabling the hard gate.
3. Keep the first-send identity and grouping semantics stable. Separately decide which assignment changes warrant a new message, whether removed volunteers are notified, whether accepted sends can be deliberately resent, reminder timing/eligibility, and how mixed responses should be summarized.

## Ordered next phases / readiness

1. Phase 2 implements conditional recovery, confirmed-evidence preservation, transactional callbacks and attempt correlation with controlled race/failure tests. Unattributable legacy outcomes remain blocked; no unsafe attribution or automatic retry is added.
2. Phase 3B and the Phase 3C preparation adapter provide current Team authorization, persisted schedule scope and privacy-safe recipient/review projections.
3. Complete the real Firestore and Heroku operational verification above before considering a change to the readiness gate.
4. Keep the grouped initial identity and first-send review; add later reminders or change messages only after their product rules are approved.

Schedule bulk SMS is **not ready to send**. Recipient selection, grouped review, durable approval, fenced dispatch, recovery and progress projection are implemented on `in-progress-2`; the production gate remains closed because production Firestore contention/recovery and actual Heroku process capacity/restarts are unverified. No client-only bypass is available.

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

## Phase 2 delivery reliability contract (authoritative)

### Goal / existing architecture

Preserve provider evidence and converge after interruption through the existing intent and attempt collections. `smsDeliveryAttempts.js:createSmsDeliveryReconciler` is the shared boundary; `authService.js` injects the same concrete storage functions into sending and callbacks. No new queue, dispatcher, collection, scheduled work or external side effect is added.

### Before behavior / after behavior

Before Phase 2, intent-write failure could erase an accepted attempt, stale recovery could overwrite a newer result, and early callbacks could not match an unsaved SID. After Phase 2, all outcome writers read current state and share monotonic reconciliation. Firestore uses a transaction; fallback memory uses a datastore-function/church/intent lock shared with claims and conditional draft writes. The attempt ID already checkpointed by Phase 1 remains the unique claim generation.

### Product Decision Check / behavior intentionally unchanged

Authorization: the current Phase 2 request and [availability SMS feature contract](features/team-availability-sms.md). The operator still selects, reviews and confirms; consent, phone, recipient, source and current authority checks stay in the existing claim/final validation. Text, secure links, identities, UI, schedule emails, reminders and permissions are preserved. The reliability changes and their additive fields are explicitly requested. No consequential product choice remains unresolved inside this phase; authority scope and background execution policy remain separate phases.

### Proposed implementation / affected surfaces

One shared reconciler replaces duplicated send-result, exception, recovery and callback writers. Conditional intent creation/adoption and deletion of unused drafts close adjacent writers that could reset send state; a single history sanitizer removes the new secret. Forms, Messages and individual schedule sends use existing routes and API shapes. The Express status route still authenticates with Twilio signatures rather than browser CSRF. Display/Electron/client rendering are unaffected. The shared helper is necessary because independent guards cannot enforce invariants under concurrent writes.

### Permitted state transitions and evidence

| Fact | Permitted transition | Required evidence |
| --- | --- | --- |
| Intent review | `preview`/`ready`/`failed` -> `sending` | Explicit operator confirmation, matching unexpired reviewed version, current source/consent/authority and atomic durable attempt claim |
| Acceptance | `sending`/`unknown`/`failed` -> `sent` | Bound provider result with SID, or authenticated attributed callback, or current stored authoritative acceptance evidence |
| Definitive non-send | `sending`/`unknown` -> `failed` | Pre-provider failure or adapter-classified REST rejection; attempt outcome `not_sent` or `failed`; approval cleared |
| Uncertainty | Unresolved stale `sending` -> `unknown`; active external uncertainty -> `unknown` | Fresh matching claim with no authoritative accepted evidence; never assume SID absence means unsent |
| Manual retry | `failed` -> new reviewed claim | Deliberate preparation/review/confirmation; previous attempt not accepted/unknown; accepted-attempt fence absent |
| Delivery | `pending` -> `accepted` -> `sent` -> `delivered`/`undelivered`/`failed` (forward states may be skipped) | Provider result or attributed callback; first terminal state wins, contradictory terminal callbacks cannot replace it |
| Suppression | `suppressed` remains non-sendable | Existing workflow policy; no new suppression behavior |

Attempt outcomes remain compatible: `confirmed` is provider acceptance, `not_sent` is a definitive pre-provider failure, `failed` is definitive REST rejection, `unknown` is ambiguity; a freshly claimed `pending` attempt may lack an outcome. Delivery `failed` with a SID is **confirmed acceptance**, not definitive REST rejection. An accepted message later undelivered never becomes retryable. Volunteer response is read separately from recipient submission or schedule responses; delivery does not imply action completion.

Confirmed stored evidence includes a SID, `outcome: confirmed`, or accepted/sent/delivered/undelivered status. Bare `failed`/`pending` and error codes are not acceptance evidence. Historical intent `sent`/SID evidence is also retained for its current attempt. Ordinary error handlers cannot change acceptance or delivery status after confirmation. Provider SID conflicts are ignored rather than rebound. Observation timestamps (`acceptedAt`, `sentAt`, `deliveredAt`, `undeliveredAt`, `failedAt`) are additive; existing timestamps are retained. These are application observations, not precise provider event times. Intent `sentAt` means acceptance, separately from attempt `sentAt` delivery progression.

`providerAcceptedAttemptId` is a sticky acceptance fence on the existing intent. Normally it names the current confirmed attempt. A late callback for an older attempt updates only that attempt's delivery facts and sets the fence, keeping the newer attempt pointer/status intact. The fence blocks another claim or draft adoption. It never falsely confirms the newer attempt. If a newer external call has already begun, recording old acceptance cannot retract it; that contradictory-rejection case needs investigation, not another retry.

### Transaction and recovery boundaries

Firestore reads both documents before any writes and commits both atomically; transaction conflicts retry with fresh state. Twilio remains outside the transaction. The fallback store is single-process only, with the same per-intent lock for claims/results/recovery/callbacks; its writes are not atomic. Acceptance checkpoints the attempt before intent adoption, making a failed second write recoverable. The outer exception retains the actual provider result and attempts the same reconciliation again rather than overwriting it with unknown.

Recovery rechecks church, intent, attempt pointer, source/member/recipient/batch, start time and approving owner inside the commit boundary. Linked attempt ownership is also validated. Only a still-stale unresolved claim is changed to unknown. Confirmed evidence repairs `sending` or `unknown` intents to sent; newer callbacks/results and changed claim generations win. Repeated recovery converges without provider calls. History and stale batch processing return the actual reconciled state. Rejection facts survive a later generic interrupted handler.

### Callback correlation and authentication

New claims persist 256 random bits as `callbackToken` plus provider account identity before the send. The callback URL adds only `attempt` and `correlation`; no church, recipient, body or response-link data enters that URL. Both fields are covered by [Twilio URL/body signature verification](https://www.twilio.com/docs/usage/security). The signature verifier uses the configured public origin/path plus the exact received query; request host/proxy headers cannot redirect the authority. Changing callback configuration while messages are outstanding can invalidate signatures and is an operational constraint.

After signature verification, the handler validates one well-formed correlation pair, looks up the attempt, then rechecks the token in the transaction. Supplied destination/account must match the persisted snapshot; SID cannot contradict a saved SID. Uncorrelated legacy callbacks require exactly one SID match and revalidate that saved SID at commit time. Malformed, ambiguous, unknown/deleted or unattributable callbacks are successful ignored no-ops. Unrecognized delivery statuses are ignored. Database failures return a server error so callback delivery may be retried. Duplicate processing is idempotent. Tokens are omitted from manual-send responses and admin history; callback error responses do not expose internal exceptions or response links. Free-form provider callback error text is not persisted; numeric error evidence remains.

### Legacy behavior / risks and edge cases

Existing documents need no migration. Legacy attempts with a saved SID use signature-verified SID attribution and the same reconciliation. A legacy active intent without an attempt ID becomes blocked unknown if no authoritative intent evidence exists; no association is invented. Missing/deleted linked attempts and malformed ownership remain conservatively blocked. Pre-correlation sends whose SID was never saved cannot be attributed through an early callback; later correctly attributable evidence can reconcile, but absent such evidence they remain unknown indefinitely.

A crash after Twilio acceptance but before all database writes, coupled with an absent/lost/unauthenticatable callback, remains unknowable. Persistent database outages can lose locally returned evidence before checkpointing. No provider lookup/manual resolution endpoint is added. This does not guarantee exactly-once external delivery. The ancillary delivery ledger is best-effort and never controls SMS retries. Terminal-status conflicts retain the first terminal result; no event-time ordering or provider polling is introduced.

### Acceptance criteria / verification and review

Confirmed evidence never regresses; stale writes re-read/retry; authenticated early callbacks checkpoint their attempt; confirmed/unknown sends cannot be reclaimed; old-attempt results cannot mutate a newer attempt; existing manual workflows remain compatible. Tests use only fake sends.

Required checks run after implementation:

- Focused Node set: `notificationBatches`, `notificationIntents`, `smsDeliveryReliability`, `smsMessaging`, `smsConsent`, `smsInboundWebhook`, `smsStatusWebhook`, `notificationLedger`, `assignmentResponseToken` test files: **131 passed, 0 failed, 0 skipped**.
- Composed `teamsApi.test.js` selection `SMS|notification requests|schedule.*(send|email)|send.*schedule`: **8 passed, 0 failed, 0 skipped**, including the real auth-service callback factory, exact signed correlation URL and token-redacted history.
- `git diff --check`: required final check.

The new optimistic transaction fake overlaps transactions, stages atomic writes, rejects reads after writes, tracks read versions and retries conflicts. Explicit barriers force recovery and delayed `sent` callback reads before competing successful/delivered commits; retry counts and final persisted facts are asserted. Memory tests inject intent-write failures; send-handler tests assert one provider call after retry attempts. Ordinary serial transaction fixtures remain useful compatibility checks but are not concurrency proof.

Self-review traced claims, all intent/attempt writers, batch adoption, successful send, rejection, preflight exceptions, outer exceptions, stale/unknown history recovery, callbacks, status normalization, admin history, ledger and real Express/auth composition. Identity/persistence/retry/publication/compatibility/security boundaries were reviewed. No UI lifetime owner is added.

| Invariant | Adversarial scenario | Code/test evidence | Result |
| --- | --- | --- | --- |
| Confirmed evidence persists | Acceptance then repeated intent-write failure and later recovery | Shared reconciler + actual send-handler failure injection | Pass in memory |
| Newer state survives | Recovery paused before commit while result/callback commits | Optimistic MVCC conflict + explicit retry assertion | Pass in transaction fake |
| Delivery cannot regress | Delayed sent transaction overlaps delivered callback; original result follows early callback | Shared monotonic rule, conflict tests and composed auth test | Pass in fakes |
| Old attempt cannot impersonate newer attempt | Old SID callback after changed pointer | Old attempt updated, sticky fence recorded, newer pointer/status untouched | Pass in fakes |
| Correlation is authoritative | Forged signature/token, wrong phone/account/SID, missing legacy token | Real Twilio signature generation/verification + transactional token/SID checks | Pass in fakes |

Optional additional confidence not run: real Firestore/emulator contention, live Twilio callbacks, Heroku interruption and full repository suite. No real SMS, deployment or merge was performed.

### Questions requiring user input / known follow-ups

None for this bounded reliability phase. The foundation is ready for the next **authorization phase**, not for unattended background continuation. Continuation still requires approved expiry/reapproval and permission-revocation policy, scoped authority/source validation, fenced batch leases/generations and progress finalization, restart discovery/trigger, provider deadlines and representative operational verification. Inbound Messaging Service ownership and independent schedule publication/grouping remain the separate findings above.
