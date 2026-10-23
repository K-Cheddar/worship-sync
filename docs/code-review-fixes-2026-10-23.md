# WorshipSync review corrections — October 23, 2026

## Goal

Correct the four confirmed review defects on `in-progress` while preserving durable delivery, team permissions, draft ownership, and access-save concurrency.

## Existing architecture

Schedule documents own pending digest markers and frozen batches. Transactions claim/renew leases; the delivery ledger and provider keys suppress repeat acceptance. Local timers and periodic recovery schedule work. Intake has a separate retry policy and remains unchanged.

The Teams shell owns `TeamsNavigationGuardProvider`. Managers register dirty/saving state through `useTeamsUnsavedChanges`; scoped profile editors are keyed by church/member/team and cancel old loads on unmount. `TeamsMembersPage` filters manager data to authorized teams before mounting the manager. `MemberAccessSheet` persists access through the existing action wrapper, then refreshes the shared global bootstrap and account directory.

## Before behavior

- Restart recovery could arm a full 20-minute timer after an active five-minute lease refused a claim.
- Create new member bypassed dirty-team confirmation.
- URL member changes replaced drafts directly; team-only changes were suppressed by member-only tracking.
- Bootstrap failures could return normally after offline fallback, so a completed self-access save appeared fully refreshed.

## After behavior

- Existing batches wait for active lease expiry or a one-minute failure retry; new work retains its coalescing window.
- Create new member uses the existing guard and keeps team preselection.
- Route intent and applied editor identity include church/member/team. Dirty route changes use confirmation and retain the current URL while pending. Confirmed browser history uses the shell's existing POP guard once.
- Bootstrap refresh returns a boolean for fresh authenticated data. Failed refreshes close the completed access draft and show the existing reload guidance without replaying persistence.

## Product Decision Check

Authorized by the current correction request and the confirmed [Team roster](features/team-roster.md), [Account Team Leads](features/account-team-leads.md), and [Teams navigation](features/responsive-navigation.md) contracts. No unresolved product decision. The one-minute schedule retry is a bounded implementation choice; lease exclusion remains authoritative.

## Behavior intentionally unchanged

Global administrators keep draft-based team membership saves; scoped managers keep restricted immediate roster writes. Server authorization, access revisions, initial digest coalescing, intake delivery, frozen content, accepted-recipient records, provider keys, concurrent responses/conflicts, return navigation, and bootstrap credential transport remain unchanged.

## Acceptance criteria

All four defects have transition regressions; dirty Stay/Discard and clean navigation work; direct links wait for data; stale member/team/church profile responses are ignored; Back/Forward confirms once; unauthorized profiles are never requested; access refresh failure cannot repeat the save.

## Proposed implementation

Use a small schedule-delay selector; replace the single bypassing navigation call; extend the existing pending/applied route refs to full identity; use the existing guard and keyed profile lifecycle; add a bootstrap result to the existing refresh mechanism. No additional permission store, persistence path, bootstrap service, or delivery subsystem.

## Affected surfaces

`server.js` starts digest recovery. Browser/Electron `App` mounts the global provider. Controller, human, workstation and paired display callers retain existing bootstrap behavior and credentials. Teams routes compose the navigation guard and authorized Teams projection. Account People mounts the actual drawer through `AccountPageProvider`. Tests use these real providers/guards where relevant; server tests use the existing transaction fixture and memory backend.

## Risks / edge cases

Review active/renewed leases, partial acceptance, uncertain acceptance and ledger failure, concurrent responses/conflicts, pending route changes, same IDs in different churches, delayed profile loads, stale in-flight bootstrap, and persistence followed by refresh failure. Real provider delivery and Firestore deployment are outside these local transport/transaction fixtures.

## Questions requiring user input

None.

## Verification

Focused digest/intake/access/team server tests; actual Teams navigation and account provider tests; controlled route/history/profile/bootstrap transitions; selected Teams shell integration tests; full client lint and TypeScript checks; production build.

## Root causes and changes

1. `sendScheduleResponseDigest` always rearmed a full coalescing window, even after a lease refused a claim. The shared schedule delay calculation now distinguishes new work, an active durable lease, and failed delivery. The existing transaction, frozen batch and ledger are unchanged.
2. The scoped Create new member callback called React Router directly. It now calls `requestNavigation` with the same team-creation state. Manage and the related positions/roles/qualifications links already use the guard. Existing return-navigation and separate roster persistence models are unchanged.
3. URL application tracked only a member ID and called `openMemberEditor` without confirmation. Pending/applied identity now includes church/member/team, waits for matching-church data, and routes replacement through `requestDiscardAction`. Local opens and confirmed browser history do not get reapplied by a stale route render. The existing keyed profile editor already cancels old success/error handlers; controlled tests establish this across member, team and church changes.
4. `refreshAuthBootstrap` swallowed refresh failures as part of its existing offline/session recovery contract. It now returns `true` only after applying authenticated server data and `false` for other outcomes. The drawer consumes that result after persistence, closes the completed draft, and uses the existing saved-access/reload message. Default deduplication, `requireFresh`, credentials and session recovery remain intact.

## Files modified

- Runtime: `authService.js`; `client/src/context/globalInfo.tsx`; `client/src/pages/Account/components/MemberAccessSheet.tsx`; `client/src/pages/Teams/managers/TeamManager.tsx`; `client/src/pages/Teams/managers/MemberManager.tsx`.
- Regression coverage: `server/scheduleResponseDigest.test.js`; `client/src/context/globalInfo.test.tsx`; `client/src/pages/Account/pages/AccountPeoplePage.teamLeads.test.tsx`; `client/src/pages/Teams/managers/MemberManager.test.tsx`; `client/src/pages/Teams/managers/TeamManager.navigation.test.tsx`; shared successful-bootstrap fixtures in `client/src/test/mocks.ts`.
- Contracts/copy: `docs/features/account-team-leads.md`; `docs/features/team-roster.md`; existing `release-notes/2026-10-18-team-members-inline-search.json`; this report.

## Tests added and executed

Added 15 test cases: two server timer/restart regressions; six member route/identity/loading/history cases; two Create new member guard cases; three session-kind refresh failure cases; one stale-in-flight/deduplication case; and one unavailable-refresh case through the actual Account People provider/drawer. Existing tests cover successful self-access refresh, accepted-recipient skipping, partial/uncertain delivery, failed ledger writes, opt-outs, concurrent responses/conflicts, and access revisions.

The original implementation was temporarily restored for a controlled negative run, then all five implementation files were restored byte-for-byte before further checks. Both new server regressions and eight selected client regressions failed with behavioral assertions against the original implementation. No commit or branch operation was used.

Commands actually executed:

```powershell
node --import tsx --test server/scheduleResponseDigest.test.js server/intakeSubmissionDigest.test.js server/accountTeamLeads.test.js server/teamIntakeTransactionDigest.test.js server/teamsApi.test.js server/teamsBootstrapProjection.test.js
# 356 passed, 2 skipped; 358 tests total.

npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/managers/MemberManager.test.tsx src/pages/Teams/managers/TeamManager.navigation.test.tsx src/pages/Teams/managers/TeamManager.permissions.test.tsx src/pages/Teams/TeamsNavigationGuardContext.test.tsx src/pages/Account/pages/AccountPeoplePage.teamLeads.test.tsx src/pages/Account/components/MemberAccessSheet.test.tsx src/context/globalInfo.test.tsx --silent
# 191 passed at that revision. After the final additional new-draft case and
# church-data guard, MemberManager.test.tsx was rerun: all 75 passed.
# This establishes 192 distinct focused client cases across these seven files.

npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx --testNamePattern='confirms before|passes the authoritative|scoped manager|Manage|member creation' --silent
# 7 selected integration cases passed; 115 excluded by name selection.

npm.cmd run lint:check --prefix client
npm.cmd run type-check --prefix client
# Both passed. The strict build also runs the full client lint gate.

$env:SENTRY_AUTH_TOKEN = ''
npm.cmd run build:strict --prefix client
# Passed on final implementation. Uploads disabled; local artifacts only.
```

An initial client invocation included a nonexistent standalone profile-editor test path; the corrected invocation above passed. The initial build hit a sandbox ancestor-directory read restriction; the local build was rerun with filesystem access and passed. Intermediate implementation/test-fixture failures were corrected before the passing runs above. The final 75-case member run and selected seven-case shell integration run both passed after the matching-church correction. Final TypeScript and strict build/lint passed. `git diff --check` passed.

The build emitted CSS URL warnings from unchanged adversarial `javascript:alert(1)` test strings scanned by Tailwind and the existing large-chunk warning. These did not fail the build and are outside the requested corrections.

## Final code review

**Scope:** fix verification and affected workflow review. This is not a whole-branch production-readiness assessment.

### Findings

- Critical: None.
- High: None remaining.
- Medium: None remaining.
- Low: None remaining in scope.

### Product authorization status

Authorized: all four corrections are explicitly requested and align with the confirmed contracts linked above. The new-church projection check is part of the requested full editor identity boundary. There are no unrelated architectural or UI changes.

### Open questions / assumptions

None. Initial coalescing remains 20 minutes; transient schedule failures use a one-minute retry. Browser POP confirmation remains owned by the existing HashRouter guard, as exercised by the history regression.

### Verification gaps

Production context: **Pass.** Traced `server.js` recovery startup; `App` provider composition for browser/Electron/controller/display; `getAuthBootstrap` human/device credential transport; Teams shell/guard composition; authorized projections in `TeamsMembersPage`; restricted profile GET/PATCH authorization in `teamsAuthHandlers.js`; and Account People action/drawer composition. Tests exercise actual navigation/account/global providers, HashRouter history, and the existing server transaction fixture.

| Invariant | Controlled transition | Inspected path | Executed evidence | Result |
| --- | --- | --- | --- | --- |
| Durable work resumes promptly without resending accepted recipients | Freeze partial batch → lose process timers → restart under valid five-minute lease → scan/competing attempt → expiry | response delay, recovery, claim transaction, delivery ledger | Two new digest tests; existing multi-worker/partial/uncertain-acceptance tests | Pass |
| New delivery-time work is retained | Provider send overlaps new response and updated/new conflicts | `finishResponseDigest`, transaction patch | Existing partial-failure and conflict-preservation tests in executed server suite | Pass |
| Dirty drafts require approval | Edit team/member/profile → request creation or URL member/team change → Stay → Discard | guard, pending/applied identity, `openMemberEditor` | New team/member tests through real guard; existing Teams shell confirmation tests | Pass |
| Full identity owns profile data | Deferred A profile → switch member/team/church, with same IDs and a lagging church projection → settle A | church checks, scoped options, keyed editor load cleanup | Delayed-profile and direct-link/church tests; 75-case final member run | Pass |
| History prompts once | Dirty Media profile → browser Back → Stay → Back/Discard → Forward | shell POP restoration and member route application | New actual HashRouter history test | Pass |
| Persistence is not replayed after refresh failure | Access commits → bootstrap reports false → close → reopen | access revision/mutation wrapper, bootstrap boolean, draft cleanup | Real Account People provider test, plus existing failed-after-unmount case | Pass |
| Fresh refresh cannot adopt an older request's success | Hold old bootstrap → save or request fresh refresh → old success → fresh success/failure | shared bootstrap promise and `requireFresh` | Existing real self-access integration and new controlled failure/dedup test | Pass |

Optional additional confidence: no real provider/inbox test, deployed Firestore test, native Electron session, or exhaustive branch CI run. The two skipped server cases require a Firestore emulator (transactional volunteer contact indexes and personal-link SMS review); these are adjacent existing paths. Provider idempotency retains its existing retention-window limit; no new delivery guarantee is claimed beyond that contract.

Required verification gaps: None.

### Pattern / learning opportunities

The new transition tests enforce the reusable full-identity and post-persistence-failure boundaries. Existing repository guidance already covers these patterns; no additional policy or general abstraction was added.

### Completion checklist

| Review boundary | Status / evidence |
| --- | --- |
| Cross-boundary review performed | Yes — route → draft/profile; persistence → bootstrap; durable marker → provider → ledger. |
| Sibling-pattern search performed | Yes — team Manage/related links, member selector/team selector, intake retries and bootstrap callers. |
| Legacy/persisted-state compatibility reviewed | Yes — no new persisted fields or batch/ledger format; existing records resume. |
| Identity-switch test reviewed or added | Yes — member/team/church, including repeated IDs and stale projection. |
| Unmount/lifetime test reviewed or added | Yes — keyed profile unmount with held response; existing access-save completion after leaving Administration. |
| Contract round trip traced | Yes — origin team preselection/return state, access revision → mutation → fresh categories, frozen digest → ledger. |
| Validate/use security boundary reviewed | Yes — client projection filtering and server profile/session/team checks remain authoritative. |
| Retry-state authority reviewed | Yes — durable batch/ledger and completed access mutation retain authority. |
| Owner-retirement handoff reviewed | Yes — process timers retire while durable digest survives; access save continues after drawer owner retires. No new global callback lifetime. |
| External side-effect adoption/compensation reviewed | Yes — provider acceptance → ledger and stable retry key; no compensation/deletion introduced. |
| Authorization/data-projection reviewed | Yes — scoped team profile reads/writes and unchanged server authorization tested. |
| Production entry point/runtime/test composition compared | Yes — actual providers/guard and relevant server entry points inspected, as recorded above. |

### Final readiness

**Ready** for the stated fix-verification and affected-workflow scope. No remaining blocking finding. Implementation status: **COMPLETE**. Known required follow-ups: None. No push or merge was created.

Complexity check: runtime changes add about 43 net lines across the five runtime files. The full route identity and pending-intent handling are necessary to distinguish URL changes, local editor actions, history confirmation and lagging church projections. The rest of the patch is controlled regression coverage, fixture alignment and documentation; no new state-management subsystem was introduced.
