# Controlled personal-access pilot (not activated)

Status: preparation only, October 19, 2026. No portal activation, deployment,
branch merge, production messages or bulk-dispatch changes were performed.
The correctness implementation can be complete while an operational pilot remains
**not ready to start** until the environment checks below are signed off.

## Smallest safe scope

Use one isolated nonproduction app origin and Firestore project containing only
one synthetic test church. Use one administrator, one linked signed-in volunteer,
and one accountless volunteer; use test-owned contacts. Include one Published
schedule, a Draft with distinctive private text, a volunteer-safe service plan,
and one availability request. Keep an unrelated church/member fixture for negative
scope checks. Never copy a production roster into the pilot.

`AUTH_VOLUNTEER_PORTAL_ENABLED` is process/environment-wide, not a church allowlist.
Do not turn it on in a shared production environment expecting a church-only
pilot. A production pilot would need separately approved isolation or church
scoping. That capability is not added by this task.

## Prerequisites and evidence

| Dependency | Required configuration / check | Evidence and remaining gate |
| --- | --- | --- |
| Portal activation | Gate absent/false for current work. A future authorized isolated pilot explicitly sets `AUTH_VOLUNTEER_PORTAL_ENABLED=true` on all app processes. | Exact-true gate inspected in `getVolunteerAccessStore`; no environment changed. Live values not inspected. |
| Dedicated secret | Generate a dedicated random secret of at least 32 characters. Store securely; same stable value on all dynos. Do not use the human auth secret. | Constructor and secret mismatch tests verified locally. Live presence, entropy, access controls and process consistency are unverified. Never paste the secret in reports. |
| Lifetime | Leave `AUTH_VOLUNTEER_ACCESS_DAYS` unset for approved 90 days, or explicitly set 90. Config must produce a positive safe-integer number of milliseconds. | Default, no read extension, reuse/replacement/revocation checked with actual Firestore. No policy change. |
| HTTPS/origin | `AUTH_APP_BASE_URL` must be the canonical HTTPS app origin, with matching API proxy/SPA routing. Verify apex/www redirects preserve fragment ingress and POST Origin. | Built local HTTPS mobile route checked. Live DNS, TLS, redirects and proxy configuration unverified. Secure HttpOnly `__Host-` cookie, SameSite Strict, `/` path; dedicated CSRF and exact Origin checks inspected/tested. |
| Restoration | Same browser/profile must retain the cookie, bounded by credential expiry. A replaced/revoked credential invalidates all its sessions. | Local reload and cookie checks pass. Real iOS/Android browser close/reopen and privacy-mode behavior remain pilot acceptance items. |
| Logging/privacy | `/s#credential` keeps the credential out of router request paths. Scrub fragment before telemetry. Exclude personal routes and headers/bodies from any custom capture. | Bootstrap, no-referrer/no-store, service-worker NetworkOnly, generic metadata and telemetry redaction inspected/tested. Local HTTP path capture contains no bearer. Actual Heroku router drains, reverse proxies, APM and body/header capture are unverified; inspect using synthetic access only. Never log OTP bodies or cookies. |
| Firestore | Server Admin SDK access; direct browser rules deny all. Retain production rules/index deployment process and verify actual queries on isolated live Firestore before pilot. | Emulator transactions pass; emulator alone does not certify deployed index availability/IAM. New credential collections use document lookups; recovery queries roster `churchId` and proof `contactHash`; availability queries recipient `churchId` + `memberId`; shared schedule queries retain existing indexes. No new composite ordered query added. Check deployed `firestore.indexes.json`, automatic equality indexes and permissions. |
| Collections | `volunteerPersonalAccess`, `volunteerPersonalCredentials`, `volunteerPersonalSessions`, `volunteerContactProofs`, `volunteerRecoveryChallenges`, `volunteerRecoveryLimits`; existing church/roster/schedule/intake/consent collections. | Schema/transactions reviewed. Numeric expiry is enforced at read/commit; correctness does not depend on TTL deletion. No new retention/cleanup policy deployed. |
| Contact verification | Admin sends a deliberate independent possession code to the saved unique contact and verifies it. Contact changes invalidate proof. Shared or unverified contacts require administrator help. | Actual recovery tests cover shared/contact-version/ambiguity. Consent alone never creates proof. Recovery rejects a roster at its 5,000-record scan bound; keep the pilot small. |
| Email delivery | Existing Resend integration needs API key and valid `RESEND_FROM_EMAIL`, verified sender/domain, and actual delivery availability. | Code checks `emailDeliveryConfigured`. Provider calls were faked; live credentials/domain/quotas/delivery are unverified. Do not send during this task. |
| SMS verification | Existing church messaging configuration plus Twilio account/auth and messaging service or sender configuration; production provider callback requirements still apply. Current independently verified unique phone and consent required. | Consent and STOP rechecked before send and verification. Actual OTP delivery was faked. Test-owned destination and provider readiness require separate authorization. No SMS enrollment inferred. |
| Abuse limits | 10-minute single-use code; five guesses; 60-second cooldown; hourly five/contact/member, 20/IP, 200/church. Accurate proxy client IP and clock needed. | Durable boundaries and single-completion retry verified with Firestore. Shared dynos must use the same Firestore/secret. Proxy-derived client IP behavior and live clock are unverified. |
| Legacy links | Existing 120-day schedule-response links and limited availability links retain their authority; no exchange for personal access. Drafts remain hidden. | Relevant server regressions and shared safe projections checked. |
| Bulk sending | Keep `SCHEDULE_BULK_DISPATCH_ENABLED` absent/false. Do not configure/enable a send rate for this pilot. | Resolver requires explicit enable plus positive `SCHEDULE_BULK_DISPATCH_SEGMENTS_PER_SECOND`. Existing approval, consent/STOP and accepted/uncertain fences stay in place. No dispatcher activation or grouped messages authorized. |

## Secret rotation and rollback considerations

The secret keys credential/session digests, scope documents, resend encryption,
contact proofs and recovery budgets. Replacing it invalidates access and also
makes previous independent contact proofs unusable under the new key; plan to
prepare fresh links and re-establish proofs. Do not rotate monthly, rotate on
reads, or mix secrets across dynos. Do not restore an old secret as a convenient
rollback: its previous still-unexpired credentials/state may become usable again.
An incident response/rotation requires a separate approved procedure.

Disabling the gate stops API access but does not revoke persisted credentials.
Re-enabling with the same secret can restore still-valid links. Revoke pilot
members before disabling when permanent invalidation is intended.

## Future authorized pilot acceptance sequence

Record pass/fail, timestamps, browser/version and synthetic record IDs in a private
run record. Do not record full links, cookies, OTPs or contact values.

1. Complete all environment prerequisites above and obtain explicit authorization
   to activate only the isolated environment. Keep bulk dispatch off. Verify
   human sign-in/My Schedule first as a control.
2. An admin opens the accountless member's Personal My Schedule access controls
   and prepares a link. Confirm preparation itself sends nothing. Transfer it
   manually to the test volunteer through an authorized private method.
3. On a real phone, open the link. Confirm the fragment is cleared, only the
   volunteer's permitted rows/teammate names appear, and Draft/private fixture
   text, contacts, notes and others' responses are absent. Open service details,
   past history, filters and the permitted export; check mobile navigation.
4. Accept and decline an assignment, then accept all unanswered. Check the
   administrator's Teams/Scheduling views after reload; answered slots must not
   be overwritten by bulk retry. Do not send notifications.
5. Add, edit and remove time off. Check persisted dates and administrator conflict
   indicators. Make an unsaved volunteer draft, update saved dates as the admin,
   then accept all/refresh: verify the draft stays, Save is blocked, latest dates
   can be reviewed and deliberate Discard adopts the admin dates. Reapply one
   desired change and save. Verify unrelated member fields remain intact.
6. Submit availability and check the member/recipient result through the existing
   administrator availability workflow. Do not infer a generic roster overwrite.
7. Close and reopen the page/browser in the same normal profile. Confirm bounded
   session restoration. Disconnect/reconnect while clean and dirty; pending work
   cannot erase the draft. Verify signed-in My Schedule still works alongside it.
8. With separately authorized test delivery, establish independent unique contact
   proof using the admin controls. Exercise expired-link recovery with a synthetic
   member/credential issued with controlled historical time in the nonproduction
   fixture, preserving the 90-day policy. Never alter production records or lower
   the global lifetime simply to make the pilot expire sooner. Confirm verify ->
   My Schedule, single use, lost-success retry, STOP/shared-contact rejection and
   administrator help when no channel qualifies. Actual sends are outside this task.
9. Replace personal access; old link/session must fail. Revoke current access;
   next read/write must fail, including an already-open tab and a delayed save.
   Already displayed cached text is not retroactively erased; it grants no server
   authority. Preserve any draft on a rejected save and give personal-link guidance.
10. Recheck legacy response links and the signed-in volunteer. Record all results,
    stop on a privacy/authorization/data-loss finding, then perform rollback below.

## Rollback (future authorized pilot)

1. Stop all pilot interaction and leave bulk dispatch off. If a request may have
   committed, inspect the authoritative synthetic record before retry or repair.
2. While the gate is still enabled, use admin controls to revoke each pilot
   member. Verify old cookies/links cannot read or write. Do not rely on closing
   the browser or deleting a message.
3. Disable the portal gate across the entire isolated deployment, confirm rollout
   to every process, and verify personal endpoints reject access while signed-in
   My Schedule still works. No secret rollback and no broad database restore.
4. Preserve minimal synthetic evidence for diagnosis. Correct only known synthetic
   records if necessary; do not replace member documents or undo unrelated edits.
   Remove test data later through the existing approved retention process.

## Remaining blockers by severity

- Critical: none confirmed in the reviewed local implementation.
- High, before any pilot: isolate the environment (global gate), verify deployed
  secret/HTTPS/Origin/Firestore/indexes/log capture, and separately authorize any
  test delivery. These operational dependencies have not been certified live.
- Medium, pilot acceptance: actual phone close/reopen/reconnect, delivery and admin
  observation checks above, plus full repository CI for the eventual release.
- Low: existing Vite large-chunk advisory; no related performance regression shown.

No current-task permission is implied by this future checklist. Code-phase
completion and authorization to start a pilot are separate decisions.
