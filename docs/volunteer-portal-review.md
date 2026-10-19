# Unified My Schedule: October 19 correctness review

Review scope: the shared time-off workflow, related async ownership, accountless
transport guidance and inactive pilot readiness. This supersedes the October 18
readiness conclusion for these paths; that review missed the dirty-draft revision
transfer and save-versus-old-load interleaving. It is not full-branch production
readiness or permission to activate a pilot.

## Findings

Critical: none outstanding in the reviewed feature.
High: confirmed revision/precondition transfer and stale-load-after-save defects
are fixed. A global activation gate cannot limit a shared deployment to one test
church; use an isolated environment for the proposed pilot.
Medium: live infrastructure, provider delivery and real-device pilot checks remain
unverified operational gates, detailed in the [pilot runbook](volunteer-portal-pilot.md).
Concurrent unrelated chat work has also caused shared-workspace type/lint failures;
it is excluded from the isolated feature result and was not changed here.
Low: existing Vite chunk-size advice; no related performance regression found.

## Product authorization status

Authorized by the owner's October 19 Final Correctness and Pilot Readiness brief
and [confirmed contract](features/volunteer-my-schedule.md): preserve the original
draft revision; explicit conflict review/discard; test A-E and related races;
inactive pilot checklist. Personal errors now retain personal-link guidance
instead of triggering human sign-in instructions. No credential policy, consent,
legacy authority, dispatcher, deployment, Electron or presentation changes.

## Before behavior

The editor retained dirty values and their signature while saving with the latest
`expectedUpdatedAt` prop. Bulk or 409 refresh could lend revision B to a draft from
A. Successful saves also failed to retire earlier pending loads. Personal errors
used AuthApiError and therefore the human-session refresh/sign-in toast.

## After behavior

Baseline ranges and revision are one state value. Draft edits leave that pair
unchanged. Clean reconciliation, deliberate Discard and successful normalization
adopt both together. Dirty refresh/409 shows an inline conflict, preserves the
draft, permits reviewing saved dates, and blocks Save until explicit resolution.
Discard adopts current saved dates; the volunteer then reapplies desired changes.
It is never an implicit force-save. A failed conflict refresh can be retried with
pending state and the draft intact; no new revision is granted on retry.

Save uses the captured baseline revision. Duplicate save activation is guarded;
editing is disabled while saving. Parent success increments the existing request
counter before adopting confirmed dates/revision, so older loads cannot undo it.
Human/personal ownership keys include authentication mode as well as church and
identity. Old-scope completion is ignored after retirement. Separate personal API
errors keep server guidance and avoid human auth side effects.

## Behavior intentionally unchanged

Shared renderer/operations, account features, schedule/availability rules, bounded
legacy links, privacy projection, atomic revision/archive/authorization checks and
field-limited writes. Reconnect still skips a dirty editor; discard/review handles
new server state without a broad synchronization layer. List/detail navigation
still owns the existing editor mount boundary; drafts are never transferred to
another authenticated identity. Nothing is activated or sent.

## Open questions / assumptions

No unresolved product decision. Pilot execution is a later explicitly authorized
operation. This task audits configuration contracts; it does not certify live
credentials, deployed indexes, Heroku logging drains or actual phone delivery.
The [runbook](volunteer-portal-pilot.md) separates those prerequisites from local
verification and describes rollback order and secret-rotation consequences.

## Verification gaps and adversarial evidence

Production-context verification: Pass for local equivalent composition: actual
public bootstrap/providers, built mobile HTTPS UI, canonical Express registrar,
real handlers/Firestore and fake delivery. Live deployment readiness is Unverified.

| Invariant | Controlled transition | Code boundary | Evidence / result |
| --- | --- | --- | --- |
| Dirty intent never borrows B | Load A, edit, admin B, finish bulk and refresh, attempt Save | MyScheduleBlockouts baseline/hasConflict/save | Test A in both modes; old code actually sends old ranges with revision B; corrected code sends nothing. Pass. |
| 409 never rebases | Save A rejected, load B, retry unchanged, explicitly discard/re-edit | save catch, refreshSavedDates, seedDraft | Test B: pre-fix issues second save; corrected retry blocked, deliberate new edit uses B. Pass. |
| Discard adopts one consistent source | Dirty A receives B, Discard, edit again | seedDraft(ranges, revision) | Test C verifies dates and next precondition B. Pass. |
| Confirmed save wins over old load | Retain A load, save/normalize C, resolve old load before or after acknowledgment | handleBlockoutsSaved/requestRef plus saving guard | Test D: old code returns to Original dates; corrected next edit uses C. Pass. |
| Retirement stays scoped | Pending save, change human/personal mode or church with overlapping member ID and reset request counts, complete old work | prefixed view key, mounted guards | Test E checks replacement dates and its next precondition. Pass. |
| Reconnect/error preserves intent | Dirty A offline -> admin B -> online -> save A rejects; or 409 load fails then manual refresh B | dirty ref, baseline pair, refresh pending state | Dedicated tests verify no data/revision theft, duplicate refresh blocked and draft preserved. Pass. |
| Revocation is checked at commit | Read valid session, pause delayed save before transaction, revoke, resume | authorize(transaction) -> access.readSession -> saveBlockouts | New real Firestore test rejects 401 with dates/revision/unrelated fields unchanged. Existing tests cover archive/contention/409. Pass. |
| Access failure preserves work | Actual personal fetch returns 401/403 during save | VolunteerApiError -> shared error toast | Real PublicApp test preserves input, shows personal link guidance and no human Refresh page action. Pass. |
| Public integration has real conflict UX | Real admin record B while dirty mobile portal -> bulk -> review -> discard -> save | built entry, real handlers and Firestore | Browser integration checks own notes, disabled stale Save, preserved private fields and administrator dates. Pass. |

Individual assignment success remains optimistic; failure uses the same guarded
page loader. It has no independent member revision writer. Availability saves
refresh only their recipient list and never write the parent's dates/stamp.
Neither operation can alter a mounted dirty baseline. Existing response,
availability and public-route regressions cover their surrounding workflow;
A/D control the shared loader interleavings. All nested personal reads retain
own-member allowlists, safe service-plan projection without broad public URLs,
teammate names only, and publication checks in both schedule passes. Browser and
handler tests exclude Draft/private fixture data and privileged bootstrap.

## Exact verification

- Negative regression evidence on detached pre-fix `e0e3eb0a`: new A-E suite,
  five failed / six passed. Failures include real requests carrying revision B
  for an A draft and an old load replacing the confirmed C state.
- Corrected client suites: MySchedule.timeOffConcurrency, MySchedule,
  PublicApp.portal, PublicApp, main, publicSharePathRedirect, useSyncOnReconnect:
  78 passed. Final run uses the isolated committed baseline plus this feature's
  exact changed client files; unrelated concurrent edits are excluded.
- Node 24 focused server suites: teamsApi, assignmentResponseToken,
  scheduleResponses, notificationIntents, scheduleInitialSms, volunteerPrivacy,
  scheduleSmsDispatchConfig and publicShareMeta: 366 passed, four emulator-only
  tests skipped in this non-emulator invocation.
- Actual demo Firestore: volunteerMutations, volunteerPersonalAccess,
  volunteerRecovery, volunteerOperations: 19 passed, none skipped.
- Built mobile HTTPS/real Firestore browser test: passed; extended conflict review,
  discard and save, session restoration, availability, safe plan, revocation and
  verified recovery. No external request or page error. Development TLS trust
  applies only to the synthetic local browser.
- `tsc --noEmit` and `npm run build:strict --prefix client`: passed with exit 0
  in the isolated committed baseline plus exact feature files, including full
  zero-warning ESLint, Vite and PWA build. Shared-workspace attempts were blocked
  by concurrent `ChatContext.tsx` type/lint work; no chat files were changed here.
  The final isolated built mobile browser test also passed, including its real
  conflict-refresh/discard behavior. The mobile screenshot was visually reviewed.
- `git diff --check`: passed; line-ending advisories only. No required feature
  verification remains. Shared-branch CI remains a separate integration gate.
- Full CI, live provider delivery, real phone reopening and deployed infrastructure
  remain later operational gates; no secret/contact values appear in this report.

## Pattern / learning opportunities

Pair comparison data with the write precondition. A server compare-and-swap is
only useful when the client submits the revision that actually produced its
intent. Retire cached reads at confirmed write acknowledgment, not just at the
next load. No broad synchronization or credential subsystem was added.

## Completion checklist

- Cross-boundary review performed: Yes, renderer -> operations -> identity adapter -> transaction -> normalized response -> baseline.
- Sibling-pattern search performed: Yes, bulk, individual, availability, reconnect, public providers and existing schedule draft reconciliation.
- Legacy/persisted-state compatibility reviewed: Yes, missing old revision and retained historical blockouts; response/availability token authority unchanged.
- Identity-switch test reviewed or added: Yes, both authentication modes and overlapping member IDs across churches.
- Unmount/lifetime test reviewed or added: Yes, old save completion after retirement.
- Contract round trip traced: Yes, exact baseline revision and server-normalized response.
- Validate/use security boundary reviewed: Yes, transaction-scoped member/archive/revision/session checks.
- Retry-state authority reviewed: Yes, 409 and failed refresh preserve original intent; recovery completion remains idempotent.
- Owner-retirement handoff reviewed: Yes, server may finish original work; replacement view cannot adopt it.
- External side-effect adoption/compensation reviewed: Yes, no changed sending path; fake delivery only and existing accepted/uncertain fences retained.
- Authorization/data-projection reviewed: Yes, personal nested loaders and existing private/Draft allowlists.

## Final readiness

Ready for the reviewed correctness/workflow phase. Implementation status:
COMPLETE for this phase. Operational pilot remains not activated and not ready
to start until the runbook prerequisites are satisfied. Live providers,
infrastructure and real-phone acceptance are deliberately unverified operational
gates; unrelated shared-branch work is outside this isolated verification scope.

---

## Historical October 18 review (superseded where corrected above)


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
