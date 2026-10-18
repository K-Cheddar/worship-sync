# Unified My Schedule verification and review

Review scope: workflow review of milestones A-D on `in-progress`, 2026-10-18.
This is not a deployment or full-branch production-readiness approval. Unrelated
scheduling edits and earlier service-plan commits were preserved.

## Findings

Critical: None outstanding.
High: None outstanding.
Medium: None outstanding.
Low: Vite reports existing large-chunk guidance; no build failure.

The review corrected Draft exposure in self-service siblings, non-atomic time-off
writes, stale UI completion after identity retirement, and same-document fragment
navigation retaining the previous personal screen. A new personal fragment now
restarts the public bootstrap; the secret is scrubbed before instrumentation.

## Product authorization status

Authorized: all milestone A-D behavior by the owner's Unified My Schedule request
and [confirmed feature contract](features/volunteer-my-schedule.md). Recovery TTL,
guesses, cooldown and durable budgets were explicitly approved in conversation.
Unverified existing contacts remain ineligible pending independent possession
proof. No administrative role, consent, dispatcher or deployment expansion.

## Open questions / assumptions

None blocking. Portal activation is deliberately separate and disabled by default.
The existing HTTPS app origin and configured delivery integrations are operational
prerequisites, not test credentials. Default expiry is 90 days, configurable.

## Verification gaps

Required workflow checks: see results below. Optional: exhaustive repository CI,
live Heroku/CDN validation and real Twilio/email delivery were not run. Delivery
was faked; local browser external requests were blocked. No production messages,
deployment, branch merge or dispatcher activation occurred.

Production-context verification covers actual `main.tsx` public selection, Redux
and Toast providers, built client, HTTPS Express route registrar, real auth
handlers and actual demo Firestore. Deferred plan/time-off views are opened by
interaction. Browser session cookies, fragment removal, no privileged bootstrap,
no external requests, Draft privacy, persisted writes and recovery are checked.

| Invariant | Concrete transition | Code boundary | Controlled evidence |
| --- | --- | --- | --- |
| Answers survive bulk retry | Decline races pending acceptance; retry applies zero | volunteerMutations/applyAssignmentResponses | volunteerMutations.firestore.test.js |
| Time off cannot undo archive or admin edits | Two same-revision saves; archive/revision/link changes before commit | saveBlockouts transaction | volunteerMutations.firestore.test.js |
| Old identity cannot update new UI | Church A pending bulk; church B same member/schedule IDs and reset counters; A resolves | keyed MySchedule + mounted guard | MySchedule.test.tsx |
| Credentials remain scoped | Wrong church, archive, replacement, revoke versus redemption | personalAccess validate/readSession | volunteerPersonalAccess.firestore.test.js |
| Recovery is single-use and interruption-safe | Concurrent same completion and lost-success retry; different completion rejected | recovery.verify + access.recover transaction | volunteerRecovery.firestore.test.js |
| Proof and budgets remain authoritative | Changed/shared contact, STOP after send, five attempts, TTL, cooldown, final IP/church quota then rejection | recovery eligible/reservation/verify | volunteerRecovery.firestore.test.js |
| Human and personal identities stay separate | Human cookie alongside personal cookie; wrong CSRF, safe plan projection, revoke reads/writes | real portal/human handlers | volunteerOperations.firestore.test.js |
| Approval cannot silently change | Exact reviewed provider body; masked preview; replaced link rejects; accepted retry never sends twice | notification intent source fingerprint/dispatch | notificationIntents.test.js |
| Public composition and ingress stay private | Real mobile entry, deferred views, second fragment, recovery and reload | main/PublicApp/registrar/handlers | volunteerBrowser.firestore.test.js; main.test.tsx |

## Exact checks

- Node 24: `node --import tsx --test` for teamsApi, scheduleResponses,
  assignmentResponseToken, scheduleInitialSms, blockoutConflicts,
  servicePlanPublic, notificationIntents, publicShareMeta and volunteerPrivacy:
  401 passed, four existing emulator-only cases skipped in this non-emulator run.
- Real demo Firestore: volunteerMutations, volunteerPersonalAccess,
  volunteerRecovery and volunteerOperations: 18 passed, none skipped.
- Client Jest: MySchedule, PublicApp.portal, PublicApp, main,
  publicSharePathRedirect, MemberManager and buildMyScheduleExportModel:
  119 passed. Final main/MySchedule rerun including new ingress regression:
  50 passed (one additional test).
- Scheduling assertion-only lint repairs: three quick-member workflow cases and
  all 28 ScheduleAssignmentPicker tests passed; no behavior expectations removed.
- TypeScript `tsc --noEmit -p client/tsconfig.json`: passed.
- Client `npm run lint:check --prefix client`: passed with zero warnings.
- Final `npm run build:strict --prefix client`: passed with exit 0, including
  zero-warning lint, production Vite build and PWA service worker. Sentry upload
  was disabled for local verification. Earlier scheduling-test conditional
  assertion lint failures were repaired without removing behavior assertions.
- `git diff --check`: passed (Git line-ending advisories only).

## Pattern / learning opportunities

The existing shared renderer and recipient transaction reduce duplication. Keep
transport authorization in adapters and recheck mutable authority within writes.
No new repository-wide policy is necessary for this implementation.

## Completion checklist

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; human, legacy token, public schedule and nested serving paths.
- Legacy/persisted-state compatibility reviewed: Yes; missing publication metadata, 120-day links, notification identity/uncertainty fences.
- Identity-switch test reviewed or added: Yes; same IDs across church scope.
- Unmount/lifetime test reviewed or added: Yes; retired pending mutation completion cannot refresh replacement scope.
- Contract round trip traced: Yes; shared operations through actual routes and persistence.
- Validate/use security boundary reviewed: Yes; member, publication, assignment and credential generation within transaction.
- Retry-state authority reviewed: Yes; persisted response state and recovery completion envelope.
- Owner-retirement handoff reviewed: Yes; old work finishes in captured server scope, UI completion ignored.
- External side-effect adoption/compensation reviewed: Yes; reserve before delivery, preserve accepted/uncertain fences, no resend on same request key.
- Authorization/data-projection reviewed: Yes; own member allowlist, teammate names only, safe plan without broad share token.

## Final readiness

Ready for the reviewed implementation/workflow scope. The built mobile HTTPS
browser test passed with actual routes, real Firestore, isolated cookies,
deferred plan/time-off/availability, same-tab fragment transition, revocation,
expired-link verification and restored access. No external requests or page
errors were observed. The test trusts the development certificate for Chromium
and its service-worker process; no production trust settings were changed.

Milestones A-D are implemented. Production activation remains disabled pending
the separately authorized operational rollout and delivery configuration.
