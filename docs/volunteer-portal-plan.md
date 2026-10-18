# Personal volunteer portal: audit and implementation plan

Planning artifact, 2026-10-18. No application behavior changed. Owner decisions and remaining proposals are distinguished below.

## Goal

Give signed-in and accountless volunteers one mobile-first My Schedule experience across Teams and schedules, with responses, time off, conflict feedback, history and appropriate service details. Initial schedule SMS becomes a brief notification with a first-party personal link and the existing opt-out instruction.

## Existing architecture

### Baseline

- Fetched `origin/in-progress-2` successfully: `4f6b5d1c93a82fe89cc1885e11b1409b1f36226c`.
- The clean `worship-sync-2` worktree is on local `in-progress-2`, at `bf6a9ddb444a61bccf8231dac0780096424f8c4a`, with additional local commits. No checkout, reset, merge or push was performed.
- Compared the relevant files between these revisions. My Schedule, its time-off and plan components, the public response page and public shell, assignment tokens, initial SMS builder, notification intents and Phase 3D report are identical. Differences in `teamsAuthHandlers.js` concern occurrence ownership and preservation of schedule metadata, outside the inspected self-service handlers. Implementation must deliberately select and record its baseline; do not discard local commits.

### Reuse map and findings

| Area | Current evidence | Consequence for implementation |
| --- | --- | --- |
| Signed-in UI | `client/src/pages/MySchedule.tsx` loads through `GlobalInfoContext` and signed-in API functions; offers search, filters, past services, response controls, exports and service tabs. | Extract its existing presentation and operations boundary. Preserve signed-in conveniences; do not build another schedule application. |
| Time off | `MyScheduleBlockouts.tsx` calls `updateMyBlockoutDates` directly and supports dirty edits, conflicts and stale refresh. | Inject the save operation; reuse the same editor and conflict behavior for both identities. |
| Plan details | `MyScheduleServicePlanPanel.tsx` consumes Redux and optional Chat context, follows a published team share URL when available, otherwise renders a stripped assignment-plan snapshot. | A component-only test with added providers is insufficient. Check actual public bootstrap, contexts and every nested data request, including the team-share fallback. |
| Public entry | `client/src/main.tsx` selects a bootstrap using `utils/publicSharePathRedirect.ts`. `public/PublicApp.tsx` uses BrowserRouter; operator `App.tsx` uses the separate operator routing composition. | `/s/:token` needs pathname classification, public routing, server handling/metadata and production-shell coverage, not just a React route. |
| Existing links | `assignmentResponseToken.js` actually signs church + schedule + member, with 120-day expiry. Some earlier comments still describe obsolete single-slot scope. | Retain existing emailed schedule links; never widen their authority to the new portal. |
| Public response | `getAssignmentResponseContext`, `respondToAssignmentByToken`, `requestAccountFromAssignmentToken`; public page only covers one schedule and offers account invitation. | Reuse response behavior, preserve legacy routes and invitations. An old token is not authorization to mint a cross-schedule credential. |
| Response persistence | Both response paths call `writeAssignmentResponses`, using a Firestore transaction and `scheduleResponses.js`. `applyAssignmentResponses` rewrites each targeted current member response. | Add pending-only semantics inside the transaction for Accept all unanswered. Filtering pending rows in the browser would overwrite an intervening answer. Preserve explicit individual answer changes. |
| Time-off persistence | `updateMyBlockoutDates` checks identity, archive state, timestamps, validation, retention and limits, then calls generic `upsertTeamEntity`. | Extract shared rules, but fix the read/check/write race: the revision and archive checks currently occur before the write. Generic upsert also writes `archivedAt: null`, so a concurrent archive can be undone. Use a transactional, field-limited writer for this self-service path. Inspect competing admin writers too. |
| Publication | My Schedule's two schedule passes skip archived schedules, but do not filter `published === false`. Existing token response context likewise does not enforce schedule publication. | This conflicts with the confirmed Draft privacy contract. Shared portal reads and writes must enforce Published/legacy-publication rules, including teammate joins. Treat legacy endpoint corrections as an explicit compatibility item, not an assumed safe refactor. |
| Signed-in projection | `getMyTeamAssignments` returns the member document, teammate display names with only the reader's response, and stripped service plans even if no public share was minted; published plans may include reusable team URLs. | Do not serialize the signed-in payload unchanged for bearer users. Agree on fields; use an allowlist, and prevent nested loaders or share URLs from widening it. |
| Initial SMS | `scheduleInitialSms.js` enumerates all assignments; `resolveScheduleNotificationContext` creates schedule-scoped HMAC URLs. `notificationIntents.js` builds and compares exact approval snapshots and fingerprints. | Change initial SMS source resolution and builder together. Keep source eligibility checks even though assignment details disappear from the text. |
| Privacy | `redactPersonalizedLinks` in `notificationIntents.js` recognizes schedule-response and intake paths, not a new `/s/` path. | Extend all preview/history sanitizers before returning portal messages to scoped operators. Keep real URLs in exact server approval/send data only where already required. |
| Recovery analogue | `smsConsent.js` has 10-minute codes and five-attempt policy; `authService.js` has transactional challenges and encrypted pending-invite resend tokens. Consent is keyed by church + phone, not volunteer. | Reuse proven primitives where appropriate, with separate recovery purpose and state. Neither consent nor a roster email proves individual contact ownership. |
| Dispatcher | Existing durable approval, claims, fencing, pacing, restart recovery and disabled-by-default gate remain present. Phase 3D report still says INCOMPLETE. | No dispatcher rebuild. Operational readiness is not established by source inspection. |

## Before behavior

Signed-in volunteers use My Schedule for their services, responses, time off and details. Accountless volunteers have a narrower schedule-specific response page. Initial SMS includes every assignment and a long response URL. There is no reusable personal-portal credential or portal recovery flow in the inspected implementation.

## After behavior

One shared volunteer view supports either identity. A personal link authorizes only its church/member's permitted self-service operations. Returning reads current published scheduling data. The home view prioritizes upcoming assignments and pending responses; past services, filters, time off and service details remain accessible. Accept all unanswered preserves every existing answer, including concurrent answers. Expiration offers approved recovery options without losing scheduling data. Explicitly reviewed initial SMS contains concise copy, one short personal URL and opt-out information.

## Product Decision Check

Applicable contracts: `docs/features/team-scheduling.md` and `docs/features/team-availability-sms.md`. The latter is an adjacent analogue for explicit review, consent and duplicate prevention, not authority to change schedule SMS policies. No personal-portal contract currently settles the new decisions.

Authorization: the supplied 2026-10-18 brief confirms accountless core capabilities, one shared experience, personal church/member scope, expiry, administrator revocation/replacement, concise SMS and no unapproved sends. The scheduling contract confirms Draft privacy and publish/send separation. Existing tests and implementation describe current behavior, not product approval.

### Confirmed decisions and questions requiring user input

Approval source: product-owner answers in this conversation, 2026-10-18.

1. **Lifetime — confirmed:** 90 days, configurable. Whether a later explicit notification extends the same credential's expiration remains open; do not silently extend it on every read.
2. **Visibility — confirmed:** own assignments/responses/time off plus teammate display names and volunteer-safe plan details; exclude contacts and private notes. Preserve the brief's prohibition on another volunteer's private information. Still define the field allowlist and whether safe plan content may be read before a public share exists, as signed-in volunteers can today.
3. **Recovery eligibility — confirmed:** independently verified, consented, uniquely mapped phone; verified unique email alternative; otherwise administrator assistance. Still establish how existing accountless records obtain initial ownership verification. Admin-recorded consent is not proof of possession. A phone-level OTP must never select the first member sharing that number.
4. **Renewal/revocation — option 1 selected, renewal simplification under discussion:** reuse valid links rather than rotating every month; explicit revocation blocks ordinary recovery until deliberate administrator restoration. The owner asked why expired links need renewal and whether there is a simpler approach. Do not assume approval to change rotation, extend an expired token or reactivate older copies. Explain automatic handling during explicit notification preparation versus an alternative stable URL with a renewed expiration, including its effect on older copies. Administrator control location remains to be specified.

Additional recovery policy to settle before that phase: proposed ten-minute single-use code, five guesses per challenge, resend cooldown and durable per-IP/contact/member/church send and attempt budgets; expired-link recovery and lost-link discovery have generic responses. Agree on eligibility and limits before enabling provider delivery. Exact budgets should be recorded in the contract, not inferred from the unrelated consent workflow.

The confirmed decisions above authorize their stated policies; unresolved details remain proposals. Independent audit, planning and behavior-preserving extraction may proceed. Record these answers in a personal-portal feature contract before behavior changes and reconcile the scheduling contract's earlier one-message-containing-assignments description when the new implementation lands.

## Behavior intentionally unchanged

- Publish/unpublish remains separate from sending; Drafts remain private under the confirmed contract. Legacy schedules without publication metadata retain Published semantics.
- Existing explicit individual answer changes, assignment ownership, time-off conflict retention, leader digest behavior and signed-in account permissions remain authoritative.
- Existing email links remain schedule-scoped. Do not convert them into portal credentials or disable them simply because a new link format exists.
- No changes to Twilio architecture, dispatcher execution, provider acceptance/uncertainty fencing, consent, STOP, initial-message idempotency or final explicit approval.
- No production sends, activation, deployment, automatic reminders, automatic new notifications or unrelated display changes.

## Acceptance criteria

1. Signed-in and personal-link routes compose the same volunteer UI and canonical business operations; browser refresh, reconnect and cross-Team history show current permitted data.
2. No sign-in is required for individual responses, pending-only bulk responses, viewing own prior answers, or time-off add/edit/remove and conflicts.
3. Every request derives church/member from trusted identity. Forged member/church/schedule IDs, archived members, removed/reassigned slots, Drafts and revoked credentials fail without disclosure or unauthorized writes.
4. A time-off commit atomically enforces its revision and archive checks, preserves unrelated roster fields and reports conflict notification failure separately from a committed save.
5. Credential expiry/replacement/revocation and recovery obey the approved policies. Ordinary recovery cannot resurrect revoked authority. A forwarded live bearer link grants its holder the approved scope; explain this in appropriate operator help.
6. SMS length is independent of assignment count. Real text determines encoding and estimated texts; no promise of one segment for every church name/language. Full private URLs are absent from masked previews/history, logs, analytics and error telemetry.
7. Review never sends; the exact approved URL/text is dispatched or rejected for re-review when no longer valid. Old accepted/uncertain deliveries remain fenced across deployment and credential changes.
8. Mobile and keyboard users can find pending responses, bulk action, time off, conflicts, past services and permitted plans, with immediate pending feedback and useful retry/expired/revoked states.

## Proposed implementation

### Phase 0: decisions and contract

Record policy answers, field-level plan projection and recovery eligibility. Resolve the branch baseline. Add a personal-portal contract and cross-links; label proposals separately from approved intent. Keep production dispatch disabled throughout this work.

### Phase 1: shared self-service boundary

Resolve a trusted volunteer principal from either the existing human session or a new narrowly scoped credential. The human path still requires its existing session and CSRF checks. Keep portal identity separate from church membership/admin auth.

Extract the current My Schedule read projection and time-off mutation into reusable operations. Preserve signed-in fields and compatibility; explicitly allowlist public outputs, including a small time-off result instead of a whole roster record. Enforce schedule publication in every join. Fix the time-off atomicity gap as part of this shared path; read current member, revision and archive state inside the committing transaction and patch only blockouts/audit fields. Check other roster writers cannot replay stale blockouts or clear archive state concurrently.

Extend the existing response writer with pending-only application based on the transaction's current response. Group bulk targets by schedule, preserve unrelated response keys and return per-target results. Do not claim cross-schedule all-or-nothing behavior: report partial completion and safely resume unanswered work. Re-check credential/member authorization inside the commit boundary so revocation wins against a delayed write.

### Phase 2: compact personal credential

Proposed implementation: 24 cryptographically random bytes encoded base64url (32 characters) at first-party `/s/<token>`. Store a digest-indexed credential scoped to church/member with issuance/expiry/revocation and generation. Keep member access revocation state separate from a single expired credential so issuance/recovery cannot bypass an administrative block. Use Firestore transactions and existing persistence patterns, with a correctly scoped fallback only if that runtime is supported.

Repeated notifications need to retrieve the same valid URL: a hash-only record cannot do this. Store a server-only authenticated-encryption envelope for deliberate resend, following the existing pending-invite pattern, plus its lookup digest. Bind encryption to church/member/credential identity, define key/version handling, and never serialize the envelope in roster/bootstrap/API responses. Exact approval storage already contains private message URLs; treat that as privileged data and inspect all serialization paths rather than claiming tokens never exist at rest.

Proposed browser access: redeem the link through a non-cacheable endpoint into a dedicated Secure/HttpOnly/SameSite cookie, clear the bearer path from the active address after redemption, and protect mutations against CSRF. It is not a human login. Limit session lifetime to credential expiry and validate its credential generation/current member on each request. Scope route behavior to this volunteer identity even when the browser also has an operator session. Recheck authority at mutation commit; revoke/replace invalidates active portal access, not just future redemptions.

GET/link previews must not mutate scheduling data, rotate/revoke credentials or send anything. Expired credentials may identify a recovery candidate internally without returning scheduling data. Unknown and revoked links never gain renewal authority. Prevent secrets in cache, referrers, page metadata, client persistence, analytics, exception breadcrumbs and request paths. Inspect hosting/proxy access-log behavior: application redaction alone cannot prove that path tokens are absent from Heroku/router logs. If the deployment cannot redact them, resolve a fragment-carried secret or another approved ingress design before shipping; the fragment also affects the final compact URL and tests.

### Phase 3: one volunteer interface

Make My Schedule's data load/respond/save operations injectable or equivalently composed through a small access adapter. Keep the existing renderer, time-off editor and service-plan presentation; separate operator shell/account navigation from volunteer content. Add the personal route through both relevant router compositions and public-path bootstrap. Supply the actual contexts required by deferred time-off and plan/export views without bootstrapping privileged roster data. Add the upcoming pending summary and Accept all unanswered to the shared UI. Preserve search, filters, past services, plans and existing signed-in exports.

### Phase 4: secure expiration and recovery

Implement expired and lost-link journeys according to approved identity policy. Candidate lookup never returns a roster match list or full contact destination. Resolve delivery only from trusted, currently eligible contacts. A valid link cannot be used to change its contact method. Reuse SMS/email delivery and OTP primitives where suitable, but use distinct challenges bound to member, church, contact version, purpose and credential generation.

Persist keyed code digests, expiry, attempt/resend budgets and single-use consumption. Enforce distributed limits, not only process memory or a key containing attacker-supplied tokens. Recheck archive, revocation, current contact, consent and STOP before sending and again before granting access. Verification and issuance must be atomic; two verifies cannot mint independent active credentials. Use an idempotent completion/retrieval path for a lost success response, without making the code reusable for another renewal. A sent code is not evidence of delivery; unknown provider outcomes do not cause uncontrolled retry. Recovery user actions authorize only the requested verification delivery, never a schedule notification.

### Phase 5: short SMS and review UI

Change `schedule_initial_notification` only. Use church identification, brief schedule-ready copy, one personal URL and required opt-out text. Use a month only when the persisted schedule period makes it unambiguous; otherwise use neutral schedule wording. Apply `$brand-voice` during implementation.

Issue/reuse the credential at an intentional preparation boundary rather than changing credentials in a read or per-send validation. Reuse the reviewed URL for fingerprint comparison and dispatch. If it expires or is revoked/replaced before provider work, block that recipient for fresh review; never silently substitute a new URL into approved text. Inspect pre-deployment prepared/approved batches: preserve accepted/uncertain fences, and explicitly invalidate incompatible unsent reviews for re-review rather than resetting intent identity or re-sending historical messages.

Keep current-source eligibility checks even if assignments are no longer in the message. Extend server redaction to `/s/` and any clean portal/session route. Count the actual outgoing body with the existing encoding estimator; masking is presentation only. Prioritize eligible recipients; collapse ineligible rows under Needs attention; expose server readiness before review, one coherent status, Estimated texts labels, responsive preview and no duplicate separator. Preserve final operator approval and current progress recovery. Add a release-note fragment.

## Affected surfaces

Server `server.js` routes/static handling, `teamsAuthHandlers.js`, response helpers, notification intent source/snapshot/redaction paths, Firestore transactions and rules/index definitions as needed. Client `main.tsx`, public pathname classifier, `PublicApp.tsx`, operator `App.tsx`, auth API/types, My Schedule/time-off/plan components and schedule SMS review. Inspect `server/publicShareMeta.js`, error instrumentation and any caching/service worker for private routes.

Production is Node 24 via `tsx server.js`, Heroku web processes and Firestore; signed-in routes use operator auth/context, while public BrowserRouter has a different provider tree. Test both real compositions and nested requests rather than mounting every component inside a permissive mock. Electron signed-in My Schedule must continue working; sending the first-party link opens the web portal. Projector, monitor, stream, media and live presentation behavior are outside this change.

## Risks / edge cases

- Concurrent blockout save versus admin edit/archive, response versus reassignment/unpublish, pending-only accept versus decline, revocation versus already-authenticated write, code verification versus contact change.
- Same member/schedule IDs under different churches; browser human session plus another volunteer link; delayed loads after link/church changes; dirty time-off state during refresh/reconnect.
- Multi-schedule partial success, persisted mutation followed by digest failure, lost HTTP success, expired code/resend race and process restart after provider acceptance.
- Shared/recycled phone or email, consent with no identity proof, no eligible recovery method, malformed/unknown/expired/revoked links, old email token compatibility and delayed previously approved SMS.
- Teammate or plan data reintroduced by exports, nested public-share loaders, cached responses or returned whole member records. Public-share URLs are separate bearer authority, not harmless display fields.
- Schedule publication privacy gap and time-off atomicity are observed implementation defects, not merely theoretical future risks. Fix them with regression tests and explicit compatibility review.

## Verification

### Checks performed for this planning audit

- Fetched remote branch, inspected clean local worktree and compared relevant remote/local source.
- `node --import tsx --test server/assignmentResponseToken.test.js server/scheduleInitialSms.test.js`: 12 passed, 0 failed/skipped. This verifies current token and verbose-SMS expectations only.
- Host Node is `v22.23.1`, below the repository's required Node 24. No production readiness conclusion follows from these local checks.
- No real SMS/email, production database access, deployment, bulk activation, index deployment or full regression run.

### Required for implementation completion

- Focused server coverage: existing `assignmentResponseToken.test.js`, `scheduleResponses.test.js`, `scheduleInitialSms.test.js`, `teamsApi.test.js`, notification intents/batches, consent/delivery regressions, plus new credential/recovery/shared-time-off cases. Run changed files directly; add name-filtered cases where useful.
- Real Firestore emulator tests on Node 24: concurrent pending-only accept/decline, time-off revision/archive contention, cross-church attempts, revoke-versus-commit, one-use OTP verification/rotation races, contact/consent changes, and multi-process rate/issuance limits. Mocks alone do not establish atomicity.
- Representative API/route tests must reject Drafts in primary and teammate joins, archived members, other volunteers, stale/reassigned slots and every non-self-service roster field. Inspect exact responses and nested service-plan reads for forbidden fields/tokens.
- Client focused tests: `pages/__tests__/MySchedule.test.tsx`, `Teams/ScheduleResponsePublic.test.tsx`, `Teams/schedule/ScheduleInitialSmsSendFlow.test.tsx`, `Teams/components/AvailabilityBatchReview.test.tsx`, `public/PublicApp.test.tsx`, `utils/publicSharePathRedirect.test.ts`, `main.test.tsx`, and new portal/recovery cases. Include deferred time-off editing, service-plan tabs, filtering/past services and exports through production-equivalent providers.
- Controlled identity/lifetime tests: start load/save as A, switch to B with the same IDs/version zero, settle A, and prove B is untouched; reopen after partial durable success and ensure retry does not repeat it.
- SMS tests: assignment-count-independent body, exact real URL in approval/provider request, masked preview/history with no bearer leakage, GSM/Unicode/long names, fresh-link preparation idempotency, expiry/revocation after approval, old-batch handling and unchanged accepted/uncertain fences. Fake providers only.
- Run focused Jest selection, `npm.cmd run type-check --prefix client`, `npm.cmd run lint:check --prefix client`, applicable strict build per repository skills, and `git diff --check`. Exhaustive CI remains separate; do not change unrelated failing expectations.
- Browser acceptance through actual `/s/...` HTTP ingress: cold open, reload, expired/revoked/lost link, permitted recovery, mobile/keyboard use, opening deferred views and returning later with updated assignments. Inspect cache/referrer/telemetry and host access-log policy with synthetic credentials.
- Apply `$code-review` to the implementation and full affected workflow; report exact executed checks and remaining required gaps. Document final before/after/unchanged behavior and implementation status per `AGENTS.md`.

### Separate operational readiness

The checked-in Phase 3D report still records unresolved emulator/CI, production index, Heroku capacity and Twilio throughput evidence. This audit did not query those live systems or remote CI. Do not assume those findings were resolved, and do not enable dispatch. The existing report's statements are historical evidence, not a fresh live assessment.

## Planning review

Review scope: audit and proposed implementation, not production readiness. Cross-boundary review covered identity, persistence, authorization/projections, approval-to-dispatch binding, routing/provider composition and recovery retry boundaries. No application diff exists to validate yet.

Findings: time-off non-atomic stale/archive check; Draft filtering gap; old redactor misses new path; signed-in projections and nested plan URLs cannot be copied indiscriminately; repeated-link storage and ingress logging need explicit handling. These are incorporated above. The owner confirmed configurable 90-day lifetime, the broad accountless projection and recovery eligibility, and selected link-lifecycle option 1 while asking to simplify renewal. Remaining renewal and detailed policy questions are recorded above. Final readiness: ready as a draft planning artifact; unresolved details must be settled before their dependent implementation, and sending remains disabled. Review the concrete implementation with regression tests after decisions are recorded.
