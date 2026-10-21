# Phase 2 personal credential review - 2026-10-21

## Findings

Critical: None remaining in reviewed code.
High: None remaining in reviewed code. The inherited silent-envelope replacement, key-dependent revocation lookup and replacement-retry rotation defects were corrected.
Medium: Production router, reverse-proxy and external logging/drain configuration could not be inspected. Required live logging investigation remains incomplete: Heroku CLI inventory attempts did not return a usable app inventory, and no Better Stack/logging connector was available. No production request path privacy is claimed. Fragment transport avoids putting the bearer in those paths regardless.
Low: None remaining in reviewed code. The existing gated administrator control persists only its non-secret replacement operation ID in church/member-scoped sessionStorage before sending; retry after editor reload uses the same receipt. Successful lifecycle adoption clears it. No personal token or envelope is stored there.

## Product authorization status

Authorized by the current Phase 2 request: 192-bit church/member credentials, configurable fixed 90-day expiry, exact reuse, revocation/restoration, replacement invalidation, encrypted recoverability, isolated redemption/session authority, CSRF, rate limits, redaction, real concurrent tests and Phase 3 authorization primitives. Fragment format follows the request's explicit preference when path logging cannot be eliminated. Authorized by the follow-up request: merge local in-progress into in-progress-2 first. That merge is committed as `0ca4eb741224b3b0f9e3d6ff9275b649322c6bc4` with both parent histories.

Not part of this implementation: new schedule UI, recovery or OTP workflow, notification content/dispatch, real issuance/delivery, activation or deployment. Existing later-phase code was inherited by the requested merge; the only client adjustment is replacement operation-key compatibility in its already gated control. The existing recovery adapter was updated only to keep using the same credential envelope/state implementation.

## Open questions / assumptions

Current identity records and digest/state documents remain server-only under deny-all Firestore rules. Stable state IDs do not use encryption keys. Legacy state lookup is exact and bounded, fails on ambiguous matches, and preserves the original state document so revocation cannot vanish on a key change. New envelope writes are v2; v1 upgrades only during deliberate reuse without changing token/expiry. There is no automatic key rotation or keyring. Provisioning, coordinated rollout/re-encryption, session retention below the credential upper bound, recovery UX and later-phase activation remain separate decisions.

## Verification gaps

Scope: credential workflow/security review in the local production-relevant composition, not deployment approval or production-readiness certification. Required live production logging inspection is **Unverified** as described above. Consequently the complete requested task is reported INCOMPLETE despite passing local implementation checks. The foundation can be integrated in Phase 3 behind the disabled gate; production activation is not approved.

| Invariant | Concrete sequence | Code inspected | Controlled evidence |
| --- | --- | --- | --- |
| Single active issuance | two separate Node processes concurrently issue; then two processes replace while a session exists | prepare / accessRecord / transactional receipt | personalAccess emulator two-process test: Pass |
| Failed reuse cannot rotate | tamper actual ciphertext -> attempt reuse/current -> unchanged generation and credential count; restore envelope -> exact reuse | recoverToken / prepare | lifecycle integrity test: Pass |
| Envelope belongs to exact credential | save generation-1 envelope -> replace -> swap old envelope into generation 2 -> reuse rejected | envelopeScope / AES-GCM AAD / digest check | v2 binding and retry test: Pass |
| Lost replacement success is safe | concurrent same request ID -> identical result -> newer replacement -> retry old ID returns conflict | prepare / lifecycleRequests | lifecycle retry test: Pass |
| Revocation survives keys and expiry | revoke -> repeat -> expire -> change key -> issuance still blocked -> explicit restore -> new issuance -> repeated restore keeps session | accessRecord / changeRevocation | persistent revocation test: Pass |
| No contact/name identity inference | equal phone/email/name in two members and two churches -> three separate credentials -> delete one -> others survive | readMember / scope identity | lifecycle isolation/deletion test: Pass |
| Credential read rechecks current access | start read -> pause before authoritative transaction -> revoke -> resume -> revoked | validateCredential | delayed-read emulator test: Pass |
| Every bulk transaction rechecks access | commit schedule A -> revoke -> schedule B authorizer fails -> no B response | acceptPendingAssignments processGroup | bulk boundary emulator test: Pass |
| In-flight response/time off cannot use HTTP-only authorization | HTTP-equivalent session read succeeds -> pause mutation before transaction -> revoke -> resume -> commit rejected | sessionIdentity.authorize / volunteerMutations | delayed response and time-off emulator tests: Pass |
| Explicit identity cannot inherit human authority | human admin bearer plus personal cookie -> forged church/member inputs -> personal identity only | portal session adapter | synthetic HTTPS/Firestore test: Pass |
| Cookie/CSRF/preview boundary | Secure/HttpOnly/Strict/no Domain/expiry checks; missing CSRF/wrong Origin/prefetch/Slackbot rejection | portal handlers | synthetic HTTPS/Firestore test: Pass |
| No bearer in browser persistence or responses | open fragment -> scrub -> exchange -> refresh -> inspect local/session storage, IndexedDB, cache bodies/keys, referrers, network paths, console and API response bodies | main bootstrap / volunteerIngress / service worker / route registrar | actual built HTTPS mobile browser: Pass |
| Public data projections stay scoped | public shell never loads human bootstrap; private Draft/contact/note fields absent, refresh/revoke fail closed | shared getVolunteerSchedule, member/plan projection, PublicApp | built browser and operations emulator plus public/signed-in React suites: Pass |
| Adjacent invitation/auth/notification rules survive | existing token, response, invitation and notification-intent suites | authService / legacy writers / notification redaction | focused server run: Pass (four optional dispatcher-emulator tests skipped) |

### Exact successful local checks

All commands used repository-supported Node **24.12.0**. Firestore tests used local `127.0.0.1:8080`, Java 21, project `demo-worshipsync` and synthetic records only. `DOTENV_CONFIG_PATH=NUL` prevented local production configuration from entering focused server tests.

- `node --import tsx --test --test-concurrency=1 server/teamsApi.test.js server/scheduleResponses.test.js server/volunteerOperations.test.js server/volunteerProjection.test.js server/volunteerPrivacy.test.js server/teamsBootstrapProjection.test.js server/authLifecycleHappyPath.test.js server/authLifecycleGuards.test.js server/authLifecycleDeep.test.js server/authSessionRecovery.test.js server/authInviteLifecycle.test.js server/authInviteRevoke.test.js server/notificationIntents.test.js`: **556 passed, zero failed, four skipped**. Skips were the unrelated dispatcher emulator scenarios: competing sends/provider request; repeated confirmation before approved batch; consent between recipients; callback evidence under delayed/duplicate provider results. These were not run against the emulator because this phase makes no dispatcher change.
- With `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `node --import tsx --test --test-concurrency=1 server/volunteerPersonalAccess.firestore.test.js server/volunteerMutations.firestore.test.js server/volunteerOperationsMutationBoundary.firestore.test.js server/volunteerOperations.firestore.test.js server/volunteerCredentialHttp.firestore.test.js server/volunteerRecovery.firestore.test.js`: **53 passed, zero failed/skipped**, including two-process issuance/replacement and all new authority races. Existing recovery tests are regression checks only; all delivery is mocked.
- `node --import tsx --test server/volunteerBrowser.firestore.test.js` with the same emulator: **one built HTTPS browser integration passed**, covering actual public bootstrap, existing deferred My Schedule content, refresh, invalid/expired/revoked links, cookie flags, fragment removal, and browser privacy observations. This is localhost evidence, not Heroku log suppression evidence.
- `npm test --prefix client -- --runInBand --watch=false src/pages/Teams/managers/VolunteerPersonalAccessControls.test.tsx src/pages/Teams/managers/MemberManager.test.tsx src/public/PublicApp.portal.test.tsx src/App.test.tsx`: **97 passed in four suites**. The new control tests hold an uncertain response, reuse its key on retry and after editor reload, and retire that key after confirmed completion. Storage failure prevents sending a replacement without a retained retry identity.
- `npm run type-check --prefix client`: **passed** after the final client change.
- `npm run build:strict --prefix client`: **passed** (strict lint and Vite/PWA build); esbuild required the same sandbox escalation used for merge verification. Existing bundle size/fixture URL warnings remain.
- After the final serialized-envelope redaction improvement, `node --import tsx --test server/volunteerPrivacy.test.js server/notificationIntents.test.js`: **60 passed, zero failed, the same four unrelated dispatcher emulator checks skipped**. This verifies both structured envelope fields and serialized envelope text.
- `git diff --check`: **passed**. Complete implementation/test/doc diff reviewed, along with creation/reuse/recovery/session consumers and both mutation implementations. Merge verification and earlier successful controller/public/signed-in checks are recorded in `merge-in-progress-2026-10-21.md`.

Earlier browser privacy instrumentation attempted to read DevTools response bodies after navigation; that test-harness failure was corrected by reading each real response before delivering it to the page. The final browser rerun passed. No assertion was removed or privacy check weakened.

## Pattern / learning opportunities

Key-dependent document IDs can hide durable security blocks after a key change. Keep revocation ownership stable, and test key changes explicitly. A recoverable encrypted credential is a delivery capability: decryption failure must not be interpreted as permission to mint another. A durable replacement receipt must survive loss of the HTTP success, and every independent bulk transaction needs its own authorizer.

## Final readiness

**Not ready** for the complete requested production-context investigation, because live hosting/logging inspection is unavailable. Backend and local Phase 3 integration verification pass. Phase 2 changes remain uncommitted in the worktree; the prerequisite merge is committed. The local emulator was stopped after verification. No activation/deployment recommendation is made.

- Cross-boundary review performed: Yes (member/church, request/transaction, key/state and browser/human authority).
- Sibling-pattern search performed: Yes (legacy invite envelopes, recovery, single/bulk response/time-off writers, Sentry/notification redaction).
- Legacy/persisted-state compatibility reviewed: Yes (v1 envelopes and keyed scope IDs, no schedule/roster rewrite).
- Identity-switch test reviewed or added: Yes (existing My Schedule tests, isolated HTTP identity and cross-member/church tests).
- Unmount/lifetime test reviewed or added: Yes (existing keyed management control ownership and request retry test; My Schedule suites from merge).
- Contract round trip traced: Yes (issuance -> envelope/digest -> reuse -> redemption -> session -> transaction authorizer -> response).
- Validate/use security boundary reviewed: Yes.
- Retry-state authority reviewed: Yes.
- Owner-retirement handoff reviewed: Not applicable; no globally retained action/runtime added. Backend receipts persist independently; existing editor retires its local callback on unmount.
- External side-effect adoption/compensation reviewed: Not applicable; no provider or dispatch side effects added.
- Authorization/data-projection reviewed: Yes (explicit personal projection, no human fallback or membership creation).
- Production entry point, runtime context, and test composition compared: Yes locally; live hosting/logging remains Unverified as stated above.
