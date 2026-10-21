# WorshipSync browser coverage

Use the existing demo account and saved authentication, with the local renderer/API running at `E2E_BASE_URL`:

```bash
npm run test:e2e:smoke
npm run test:e2e:scheduling
```

The E2E target is the built-in church `demo`; `E2E_DEMO_CHURCH_ID` is deprecated and is not needed. If supplied, it must equal `demo` or the test fails. The saved account must match `E2E_TEST_EMAIL` and `playwright/.auth/worshipsync-user.json`. Neither command signs in with a password or requests verification email. Scheduling uses the existing setup project to validate/reuse the saved session, including guarded no-email recovery, then confirms the authenticated server bootstrap belongs to `demo` and the account can edit the reserved E2E team before creating fixtures. RTDB custom-token sign-in is permitted only with the exact token observed from the trusted authenticated API. Traces remain disabled to protect reusable credentials.

## Smoke

Smoke keeps one authenticated browser context across six navigation cases. Each page closes before the next case while synchronized IndexedDB/PouchDB data remains available. It targets `demo`, rejects church-scoped API traffic for other churches, and blocks church-scoped mutations. Authentication POSTs, automatic session renewal, and MailSlurp traffic are blocked during smoke cases. A stale session fails visibly.

| Area | Coverage |
| --- | --- |
| Core navigation | Home to Presentation, back to Home, then Teams and Services |
| Services | Load results/status, open an existing dated saved plan, verify summary and return control |
| Teams | Open an editable existing team and inspect positions/members without saving |
| Members | Open an active member's details without saving |
| Equipment | Load Microphones/IEMs; inspect records or explicit empty states; switch categories |
| Service Templates | Open an existing template with section structure; return and confirm availability |

Scheduling moved to the workflow suite because opening a saved schedule can reconcile occurrences and write ownership claims. Smoke never opens Scheduling and does not depend on workflow fixture provisioning. It still needs its existing demo records and permissions: an editable team, openable member, dated saved plan, and template with sections. Controller startup can synchronize PouchDB; each command can perform a cold synchronization.

Forms, Messages, song editing, and deeper service-plan editing remain outside this coverage. Presentation Controller tests remain separate under `npm run test:e2e:controller`.

## Scheduling workflow

The saved account needs **edit permission on the reserved E2E team**, or existing church-wide edit/admin permission. The suite fails before provisioning when authentication, church identity, or access cannot be verified. It never grants permissions or changes account membership. Setup and authoritative verification reuse the server's existing Firebase Admin configuration: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_DATABASE_URL`. These variables are required for scheduling, not smoke. Never commit credentials or auth state.

The team ID defaults deterministically from the built-in church ID. `E2E_SCHEDULING_TEAM_ID` can select a provisioned team only if its exact ownership marker matches. For church `demo`:

| Record | ID |
| --- | --- |
| Team | `e2e-scheduling-2a97516c354b6884` (`WorshipSync E2E Scheduling`) |
| Position | `e2e-scheduling-2a97516c354b6884-position` |
| Contact-free member | `e2e-scheduling-2a97516c354b6884-member` |
| Temporary services | `e2e-scheduling-2a97516c354b6884-service-a`, `e2e-scheduling-2a97516c354b6884-service-b` |
| Schedule | `generated_62c4dd26610602dc4b71849c3eeca3e4768352b85d0f60549141babe8430b9ca` |

The known period is January 2040, with one-time services on January 8 and 15 at 17:00 UTC, interpreted in the configured church timezone. The far-future period keeps fixtures away from current Services. The team, position, and member remain as reusable fixtures; the member has no email, phone, account link, or invitations. Unowned records are preserved even if their names match.

Temporary service definitions have no combined group and require only the reserved position. Existing definitions are never edited. RTDB transactions append/remove exact owned definitions using the latest list. Normal schedule generation filters staffing to each team's own positions, isolating test services from other teams' reconciliation. Cleanup refuses to remove services referenced by another schedule.

| Test | Assertions |
| --- | --- |
| A | Virtual rows without a persisted schedule/claims; first real assignment saves a private Draft; reload retains it; ensure reuses the same schedule without duplicates |
| B | An assignment and additional position slot survive real automatic reconciliation after a second test service is added; the schedule ID is reused; repeated ensure duplicates neither rows nor schedules |
| C | Existing deletion API removes the schedule and claims; normal virtual-view editing regenerates it; finally cleanup after a simulated assertion failure is verified against the backend |

Only fixture provisioning, ownership stamping, and backend inspection use Admin APIs. Schedule creation, assignment, extra slots, reconciliation, and deletion use real application/server behavior. Browser guards admit only the exact church/team/period/service/position/member scope and required endpoints. Publishing, messaging, links, invitations, archiving, unrelated writes, and email-generating authentication are blocked. Newly generated schedules have `published: false`; existing publication metadata is preserved.

## Cleanup and recovery

Before writing a service or sending ensure, each test atomically journals its ownership intent under ignored `playwright/.fixtures/scheduling-<runId>.json`. The manifest records exact IDs, creator, run ID, timestamps, a hash of unrelated records, operation events, and cleanup results. The reserved team has an exact active-run lease. Pending manifests or leases stop later runs; leftovers are never automatically deleted by name/date.

`finally` unmounts Scheduling, verifies the owned Draft, deletes it through the normal API, verifies authoritative Firestore documents/claims, removes exact run-owned services, compares unrelated scheduling/team/roster records and service definitions with the baseline, and releases the lease. Failures preserve exact IDs/reasons in the manifest and Playwright attachment. Published, communicated, referenced, or otherwise adopted records are preserved for review. Stable team/position/member fixtures intentionally remain.

Inspect an exact interrupted-run manifest:

```powershell
npm.cmd run test:e2e:scheduling:fixtures -- --manifest playwright/.fixtures/scheduling-<runId>.json
```

After reviewing it, explicitly recover that run:

```powershell
npm.cmd run test:e2e:scheduling:fixtures -- --manifest playwright/.fixtures/scheduling-<runId>.json --cleanup
```

Recovery revalidates manifest identity, active-run lease, ownership, and backend data. A schedule still requires the saved account's normal API deletion permission. If ownership or the original baseline cannot be verified, preserve the records and report exact IDs for manual review.

## Focused verification

```powershell
npm.cmd run test:e2e:scheduling:policy
node --import tsx --test server/teamScheduleOccurrenceOwnershipTransaction.test.js
node --import tsx --test server/teamsApi.test.js
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8187'
node --import tsx --test server/teamScheduleOccurrenceOwnership.firestore.test.js
Remove-Item Env:FIRESTORE_EMULATOR_HOST
npm.cmd run test:e2e:scheduling
npm.cmd run test:e2e:scheduling
```

Server tests cover memory and transactional storage, concurrent create/ensure/delete, replacement owners, more than 100 stale claims, exact tenant/team cleanup, and repeated regeneration. Emulator tests exercise real Firestore persistence. Browser durations, created/deleted IDs, and cleanup evidence appear in manifests, `scheduling-records.json`, and sanitized `browser-diagnostics.json`. See `scheduling-verification-2026-10-20.md` for this change's actual execution results.
