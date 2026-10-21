# Volunteer recovery review fixes

## Goal
Address the three October 20 review findings without weakening contact possession or identity checks.

## Existing architecture
Recovery validates member state, independent OTP proofs and consent in Firestore transactions. Human My Schedule uses shared volunteer operations, but two roster-link lookups select the first match. Bootstrap already has `resolveSelfMemberId`.

## Before behavior
Stale proofs block lost-link recovery. Duplicate account links select an arbitrary member. Contact checks read up to 5,000 members and reject at the cap.

## After behavior
Count only currently eligible proof identities. All human self operations reuse the strict resolver and reject unresolved links. Migrated churches use at most two contact-index matches; legacy churches scan in pages without the 5,000-member rejection.

## Product Decision Check
The current review request authorizes all three corrections. `docs/features/volunteer-my-schedule.md` requires church-scoped keyed contact hashes, complete writer coverage, backfill, collision preservation and a coverage audit before indexed reads. The index is derived fields on the authoritative roster document, so archive/contact/church changes and ownership keys commit together. Multiple matching documents represent collisions; no owner is selected from a collision.

## Behavior intentionally unchanged
Public recovery response shapes, OTP budgets, consent, proof versions, revocation, CSRF, publication filtering and unlinked-account empty reads remain stable.

## Acceptance criteria
Stale/archived/moved/revoked proofs cannot block a sole eligible identity or redirect recovery. Multiple eligible identities still deny recovery. Duplicate links reject all human self reads/writes without mutations. Index lookups retain legacy normalization, tenant isolation and transaction revalidation; incomplete/key-mismatched migrations retain the authoritative scan.

## Proposed implementation
1. Page proof candidates, validate and deduplicate identities before choosing one; recheck inside the challenge transaction.
2. Use `resolveSelfMemberId` in the common human resolver and route time-off writes through it.
3. Store derived keyed contact hashes and a schema/key marker on member documents. Cover central persistence helpers, nested-map field writes and direct import transactions. Backfill fresh transactional member snapshots, audit every row, then mark church coverage ready. Paginate the fallback scan and stop once a duplicate is found.

## Affected surfaces
`authService.js` persistence helpers, Teams handlers, recovery store, an explicit backfill CLI and Firestore emulator integration tests. The production server composes these through `authService.js`; tests must exercise that composition as well as the recovery store. No client, display, Electron or IPC changes.

## Risks / edge cases
Legacy formatted phones and mixed-case email; stale proofs before valid candidates; duplicate proofs; contact/archive/church changes; secret rotation; interrupted backfill and rolling deploys. Backfill activation requires all old server processes and external roster writers to be stopped/upgraded. New runtime writers maintain derived keys regardless of portal activation. Never run migration against production as part of this task.

## Questions requiring user input
None. Deployment/migration execution is outside this code-fix task.

## Verification
First reproduce stale-proof and duplicate-link failures. Run recovery, contact-index migration and volunteer operation tests against the Firestore emulator, strict resolver unit tests and focused Teams API regressions. Verify atomic key maintenance through real persistence helpers, contact/archive changes, collisions, incomplete coverage, key rotation and >5,000 legacy members. Review the full diff and all roster writers before handoff.

## Deployment procedure

Deploy the updated contact writers to every server before activating coverage. Stop old server processes and upgrade any external/direct roster writers first. Keep `AUTH_VOLUNTEER_PORTAL_SECRET` consistent across those writers and recovery. The index is maintained even when the portal feature gate is disabled.

For each church, run `node scripts/backfill-volunteer-contact-index.js --church=<churchId>` using the normal server Firestore configuration. The command disables indexed reads, backfills fresh transactional snapshots, then audits all records before enabling reads. It reports member, incomplete-row and collided-key counts without contact values. Collisions remain in the index and block recovery for that contact; administrators must resolve the roster ownership explicitly.

Use `--audit-only` to recheck coverage; an incomplete audit disables indexed reads. Interrupted migrations retain the authoritative paginated scan and can be rerun. After secret rotation, deploy all writers with the new secret and repeat the backfill; new-key recovery uses the legacy scan until the new-key audit completes. Do not activate coverage while an older or uninstrumented writer can still change roster contacts, archive state or church ownership.

For secret rotation, stop all old-key server processes and pause external roster writers before starting any new-key writer. Do not mix old-key recovery with new-key writers while an old coverage marker is active. Resume with one consistent key, then rerun the backfill.

This correction exceeds the repository's small-fix line-count guideline because the third finding requires atomic coverage across existing writers and an audited migration. Derived fields avoid a separate ownership-record synchronization subsystem.

## Verification record

- Before fixes, the new regressions failed for stale proof owners, old-proof address redirection, duplicate account links and exactly 5,000 roster members.
- `AUTH_VOLUNTEER_PORTAL_SECRET=<synthetic> node --import tsx --test server/teamsApi.test.js server/teamsBootstrapProjection.test.js`: 295 passed, no skips.
- With `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `node --import tsx --test --test-concurrency=1 server/volunteerRecovery.firestore.test.js server/volunteerContactIndex.firestore.test.js server/volunteerOperations.firestore.test.js server/volunteerMutations.firestore.test.js server/volunteerPersonalAccess.firestore.test.js server/firestoreNestedMapSemantics.test.js`: 32 passed, no skips.
- `node --import tsx --test server/humanApiBearerAuth.test.js server/authInviteLifecycle.test.js server/authLifecycleHappyPath.test.js server/dataTransfer/portableCreatePersister.test.js`: 22 passed; 18 pre-existing credential-dependent cases skipped.
- The actual backfill CLI and `--audit-only` ran against the emulator using a generated synthetic service-account key and unique synthetic church. Both reported complete coverage; two contact keys were persisted. Test artifacts were removed.
- `node --check` passed for `authService.js`, Teams handlers, recovery, contact index and backfill CLI. `git diff --check` passed.

## Workflow review

### Findings
No unresolved correctness finding in this change. Concurrent schedule-ownership work in this checkout is excluded from this review.

### Product authorization status
Authorized by the three current review fixes and the existing My Schedule recovery/identity contracts. No new public recovery response or account-link mutation behavior.

### Open questions / assumptions
Migration activation assumes every roster contact writer runs this implementation and uses the same key. The rollout procedure makes this operational requirement explicit. No release fragment: these corrections finish the gated, unreleased volunteer portal workflow.

### Verification gaps
Required production-context verification: Pass. Tests compose the real `authService.js` authentication guards, Teams handlers and Firestore adapter. Public recovery exercises the real Firestore recovery/access stores with a synthetic delivery sink. External delivery providers, production credentials and a production backfill were not exercised; no delivery-provider code changed. The full repository suite was not run, following the repository's focused-test policy.

| Invariant | Controlled sequence | Code / test evidence | Result |
| --- | --- | --- | --- |
| Recovery chooses one current identity | More than 100 stale/deleted proofs precede the eligible proof; old-address proof survives new-address enrollment; two eligible churches share a contact | `candidateFor`, recovery Firestore tests | Pass |
| Human writes cannot choose a duplicate account link | Add a second active link, call all six self operations, assert HTTP 409 and no member mutation; archive duplicate and resolve original | `resolveHumanVolunteer`, Teams API and volunteer operations Firestore tests | Pass |
| Indexed uniqueness tracks current ownership | Audit coverage; create/edit/import/archive/move members through actual handlers; introduce a formatted phone collision between OTP send and verify | Persistence helpers, direct import/intake writers, recovery/operations Firestore tests | Pass |
| Migration never publishes stale contact keys | Pause migration after roster enumeration; change the contact; resume fresh transactional read; interrupt another migration; rotate key with legacy collision | `backfillChurch`, `auditChurch`, contact index Firestore tests | Pass |
| Recovery retries preserve durable outcomes | Concurrent OTP completion, repeated request key, cooldown and hourly ceilings, later STOP/revocation | Existing recovery/personal-access Firestore cases | Pass |

Cross-boundary and sibling-writer review, persisted-format compatibility, owner-scope changes, contract round trip, validate/use, retries, authorization/projections and real runtime/test composition: reviewed. Browser component lifetime, owner-retirement handoff and external-result compensation: not applicable; this change owns server requests and derived Firestore fields, and changes no client lifetime or provider adoption flow.

Independent read-only workflow review: Ready; no findings. The reviewer separately ran the recovery and contact-index emulator suites: 17 passed, no failures or skips. Production rollout and concurrent schedule-ownership/E2E edits were outside that review scope.
