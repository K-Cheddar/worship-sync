# Shared volunteer bulk response review

> Historical implementation record. The October 21 standard-feature decision supersedes portal activation restrictions in this record. Personal access now has no feature gate; see [current contract](features/volunteer-my-schedule.md) and [deployment prerequisites](volunteer-portal-deployment.md).

Scope: workflow review of the fix from `2dbb4e6` on `in-progress-2`, including both HTTP identities, shared bulk decisions, transaction authorization, post-commit effects, pagination, React lifetime and retry behavior. This is not a deployment or branch-wide production-readiness review.

## Findings

Critical: None. High: None. Medium: None. Low: None remaining.

The previous unanswered implementation bypassed upcoming-occurrence filtering and used whole-response normalization. It has been removed. `applyPendingAssignmentResponses` is now the only bulk response decision helper. The explicit-response helper remains intentionally distinct because individual and legacy schedule links may deliberately change an earlier answer.

## Product authorization status

Authorized: the current Shared Volunteer Bulk Response fix request requires identity parity, upcoming published primary assignments, exact unrelated-response preservation, independent transactions, safe partial retries and per-transaction credential checks. Recorded in both affected feature contracts. Personal UI now uses the existing signed-in action, eligibility count and partial-completion feedback while retaining its label. No activation or delivery change.

Legacy unanswered HTTP responses retain `results` alongside canonical totals/cursors; fully answered schedules disappear from retry discovery. Tests expecting a zero-work row were updated because the explicitly required canonical pending discovery excludes those schedules. The previous fixture's past date was changed to a future date because upcoming-only acceptance is explicitly authorized.

## Open questions / assumptions

None blocking. Audit identity and actual response timestamps differ naturally between separately executed HTTP operations; fixed-clock transaction tests compare exact response maps. API tests compare newly generated timestamps separately while preserving all original metadata exactly.

## Verification gaps

Required: None.

Optional: exhaustive repository CI, production datastore load and live multi-device deployment testing were not run. No deployment, real link issuance, portal activation or message delivery occurred. Existing build warnings remain for the pre-existing `javascript:alert(1` fixture reference and large chunks; lint completed with zero warnings. Emulator SDK metadata discovery logged sandbox `EACCES` warnings; all emulator tests passed without skips.

Production context: Pass. The built mobile HTTPS test uses the production public bootstrap/providers, route registrar, actual personal cookies/CSRF and Firestore. It clicks the bulk action and deferred time-off/plan controls. Human coverage combines actual authentication handlers against Firestore, the authenticated App routing tests and MySchedule's faithful Redux/router/global-context composition. `server.js` still registers the signed-in accept-pending endpoint directly beside the shared registrar. The full production server/infrastructure was not started.

| Invariant | Controlled transition and path | Evidence | Result |
| --- | --- | --- | --- |
| Identity parity and exact preservation | Same schedules through human and personal principals; old occurrence, answered cells and unrelated nested metadata survive `acceptPendingAssignments` / `applyPendingAssignmentResponses` | `volunteerOperationsMutationBoundary.firestore.test.js`, parity `none` | Pass |
| Latest persisted decision wins | Pause before commit, persist decline/reassignment/Draft, abort and retry the real transaction against those records | Same file, parity `decline`, `reassignment`, `draft` | Pass |
| Independent durable commits and retry | Exhaust one schedule's transaction attempts, commit another; remove contention, retry only remaining pending work | Same file, parity `failure`; existing schedule-failure test | Pass |
| Personal authority cannot span generations | Commit schedule A, revoke or replace credential, authorize schedule B in a new transaction using `readSession` | Same file, personal bulk `revoke` and `replace` tests; B remains unanswered | Pass |
| HTTP scope and bounded pages | Personal cookie coexists with admin session; forged body scope ignored; both adapters traverse 27 eligible schedules in two pages with at most 25 groups per request | `volunteerOperations.firestore.test.js`, portal integration | Pass |
| UI follows pages and retains partial results | Resolve first page, report second-page partial failure, retry from beginning; stop traversal after authority change | `MySchedule.timeOffConcurrency.test.tsx`, human/personal pagination and personal authority-change tests | Pass |
| Owner retirement and dirty drafts | Church changes with repeated IDs before bulk completion; late completion cannot reload new scope. Bulk refresh cannot lend a new revision to an edited time-off draft | `MySchedule.test.tsx` retirement test; concurrency test A for both identities | Pass |
| Actual public composition | Synthetic fragment link -> redemption -> bulk click -> current response accepted; past response and unrelated metadata unchanged; refresh/revocation remain valid | `volunteerBrowser.firestore.test.js` | Pass |

### Exact checks

All commands used Node `v24.12.0`. Server commands used `DOTENV_CONFIG_PATH=NUL`; emulator/browser commands additionally used `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, Firestore emulator `1.22.0`, Java 21 and synthetic fixtures.

- `node --import tsx --test --test-concurrency=1 server/scheduleResponses.test.js server/volunteerOperations.test.js server/teamsApi.test.js server/volunteerProjection.test.js server/volunteerPrivacy.test.js`: 316 passed, 0 failed, 0 skipped.
- `node --import tsx --test --test-concurrency=1 server/volunteerOperationsMutationBoundary.firestore.test.js server/volunteerMutations.firestore.test.js server/volunteerOperations.firestore.test.js`: 35 passed, 0 failed, 0 skipped.
- `npm test --prefix client -- --runInBand --watch=false src/pages/__tests__/MySchedule.test.tsx src/pages/__tests__/MySchedule.timeOffConcurrency.test.tsx src/public/PublicApp.portal.test.tsx src/App.test.tsx src/public/PublicApp.test.tsx`: 5 suites, 104 tests passed.
- `npm run type-check --prefix client`: passed.
- `npm run build:strict --prefix client`: passed, including ESLint `--max-warnings 0`, Vite production build and PWA service-worker build.
- `node --import tsx --test server/volunteerBrowser.firestore.test.js`: 1 built HTTPS browser test passed, 0 skipped.
- `git diff --check`: passed.

## Pattern / learning opportunities

Keep future pending-only consumers on the canonical operation; the individual writer no longer exposes that option. No new framework or repository policy is needed. No separate release-note fragment: this corrects the existing gated, unreleased personal My Schedule feature without changing its product story.

## Final readiness

Ready for the stated workflow-review scope.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; bulk routes, response helpers, individual writer, legacy link caller and both client transports inspected.
- Legacy/persisted-state compatibility reviewed: Yes; legacy publication/assignment forms and unrelated response metadata preserved; explicit response semantics unchanged.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes; existing MySchedule tests cover retirement during pending work.
- Contract round trip traced: Yes; cursor/totals from canonical result through both transports to one client loop.
- Validate/use security boundary reviewed: Yes; authoritative session callback runs inside each schedule transaction and on its retries.
- Retry-state authority reviewed: Yes; persisted answers own completed progress, not a browser snapshot.
- Owner-retirement handoff reviewed: Yes; an active request may finish for its original identity, later pages and UI publication stop after retirement. No global Activity handoff exists here.
- External side-effect adoption/compensation reviewed: Yes; only committed changes reach existing best-effort previews/SSE/digest; retries skip committed responses. No send or compensating deletion added.
- Authorization/data-projection reviewed: Yes; personal bulk returns scoped counts/IDs only, never raw schedules or credentials; individual/general projections unchanged.
- Production entry point, runtime context, and test composition compared: Yes, as described above.
