# Team Lead access follow-up

## Goal
Prevent stale access saves from erasing Team Lead assignments and refresh personal notification controls after self-access saves.

## Existing architecture
People loads member snapshots; the drawer sends a full permission map. The writer checks role but accepts stale permission maps. GlobalInfoProvider owns permissions/categories through applyBootstrap and exposes refreshAuthBootstrap; the drawer only refreshes the People list today. Existing service-plan revision conflicts and Firestore transaction fixtures provide analogous patterns.

## Before behavior
Same-role concurrent edits can silently replace scopes. Self-editing leaves the account menu's category list stale until another bootstrap.

## After behavior
Member rows carry a derived access revision. The drawer sends its loaded revision; fresh transactional validation/merging rejects stale saves with a recoverable conflict. Legacy callers can still change unrelated access but cannot change scopes without a revision. Self-saves refresh the existing global bootstrap after the durable mutation; they never maintain a second permission/category copy.

## Product Decision Check
Authorized by the current two review findings and the confirmed account-team-leads contract. Conflict rejection is the requested explicit concurrency strategy. No new assignment model or persisted revision field is needed.

## Behavior intentionally unchanged
Admin-only assignment, active-team/church validation, broad privileges, personal opt-outs, digest routing/delivery, invitation behavior and roster data.

## Acceptance criteria
Two admins with the same loaded revision cannot erase each other's changes, including a commit during another request's validation. Client conflicts refresh the list and retain unsaved drafts until the administrator closes/reopens to review. Self add/remove updates the real UserSection switches without reload; other-account edits do not refresh auth. A failed post-save bootstrap retry does not repeat the access mutation.

## Proposed implementation
Derive a canonical revision from role, controller access and permissions. Compare it inside Firestore transactions (and an atomic in-memory compare/write), normalize merged permissions from the fresh record, and audit committed permissions. Reuse refreshAuthBootstrap through the existing account context after self-save.

## Affected surfaces
Member-list API/types, access API client, MemberAccessSheet, GlobalInfoProvider/applyBootstrap and UserSection. Real handler tests cover persistence; a faithful provider/page/account-menu integration covers deferred controls. No display, SMS or scheduling changes.

## Risks / edge cases
Role/access races, view scopes, token ordering/defaults, legacy callers, partial request payloads, stale drafts after conflict, self-save followed by refresh failure, identity changes during pending work. Pending UI remains disabled for the refresh lifetime.

## Questions requiring user input
None.

## Verification
First reproduce stale two-admin saves with the existing handlers in memory and Firestore fixtures. Exercise self add/remove through the real global provider, access UI and account menu. Run directly changed tests, adjacent auth/account tests, globalInfo tests, TypeScript, lint and diff/syntax checks. Review transaction retries, committed-state audit and bootstrap ownership before handoff.

## Implementation notes
The access token is derived from canonical access fields, including sorted scopes; it is not another persisted source of truth. Legacy full scope replacements without a reviewed revision fail safely. The global refresh API gained an opt-in `requireFresh` option: self-save waits for any older refresh, then requests current server data through the same provider. Default refresh deduplication and all other callers are unchanged.

The implementation adds about 100 production lines across server transaction handling, one drawer and existing API/types/provider. Most added lines are controlled regression tests. The stale pre-transaction permission-map construction was removed. No assignment subsystem, additional global permission copy or persisted schema was added. This scope is necessary to bind a loaded draft to its eventual transaction and verify the real deferred account menu.

Release-note decision: the existing unreleased account-Team-Leads fragment already describes the finished capability. These corrections do not change that product story; no separate development-fix fragment is warranted under `release-notes/README.md`.

## Verification results
- Before-fix evidence: both new two-admin handler tests failed with HTTP 200 instead of 409. After the fix, the memory and Firestore-fixture cases pass. Temporarily removing `requireFresh` also made the provider regression fail: permissions remained at the old empty scope map after the durable save. The option was restored and the test passed.
- Client: `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/context/globalInfo.test.tsx src/pages/Account/pages/AccountPeoplePage.teamLeads.test.tsx src/pages/Account/components/MemberAccessSheet.test.tsx src/api/__tests__/auth.test.ts src/containers/Toolbar/ToolbarElements/UserSection.test.tsx` — 5 suites, 115 tests passed.
- Server: `node --import tsx --test server/accountTeamLeads.test.js server/authLifecycleHappyPath.test.js server/authLifecycleGuards.test.js server/authLifecycleDeep.test.js server/authResponseSanitize.test.js server/authInviteLifecycle.test.js server/authErrorResponse.test.js server/humanApiBearerAuth.test.js server/notificationPreferences.test.js server/notificationRecipients.test.js server/intakeSubmissionDigest.test.js server/scheduleResponseDigest.test.js` — 228 passed, 1 credential-dependent custom-token test skipped. After adding the final cross-church revision regression, `node --import tsx --test server/accountTeamLeads.test.js` passed all 12 tests. Runs used `WORSHIPSYNC_SERVER_TEST_SUPPORT=1` and a nonexistent `DOTENV_CONFIG_PATH` to avoid loading local credentials.
- `npm.cmd run type-check --prefix client` passed.
- `npm.cmd run lint:check --prefix client` passed with zero warnings.
- `node --check authService.js`, `node --check server/accountTeamLeads.test.js`, and `git diff --check` passed.
- No live Firebase/email requests, browser session, full test suites, Heroku build or Electron build were run.

## Final review — workflow scope

### Findings
Critical: None in the changed workflow. High: None. Medium: None. Low: None.

### Product authorization status
Authorized by the two current review findings: reject stale member-access replacement and refresh the canonical bootstrap after self-access saves. The confirmed account-Team-Leads contract continues to own assignment, eligibility and opt-outs. The revision requirement for scope changes closes the same overwrite path for older callers; no persisted format changes.

### Open questions / assumptions
None for the reported member-access defects. Pending invitations retain their existing access-edit contract and are outside this member-revision change.

### Verification gaps
Required: None for this workflow review. Production context: **Pass**. `App.tsx` supplies GlobalInfoProvider above routing and the account menu; `Account.tsx` supplies AccountPageProvider to the People route. The integration renders those real state owners, the real drawer and deferred UserSection popover; only external auth/Firebase/HTTP and unrelated chat/autosave dependencies are mocked. It asserts rendered switches and global permissions, not just a refresh callback. Browser cookies and packaged Electron human Bearer transport still use the existing API client; server human/admin and CSRF guards were exercised. Workstation/display bootstrap consumers retain default deduplication and their existing provider tests passed.

Optional confidence gaps: live Firestore contention (the fixture serializes transactions and enforces reads before writes), the credential-dependent Firebase custom-token test, browser interaction and production builds. No inbox-delivery claim is made.

| Invariant | Controlled sequence | Code / executed evidence | Result |
| --- | --- | --- | --- |
| A stale save cannot erase a lead | Both admins load; B grants Media; A sends its older full map; A reloads and saves again | `membershipAccessRevision`, `updateMemberAccessSettings`; two-admin regression, both stores | Pass |
| Request-time validation is insufficient | Hold A before transaction; B commits; release A | Firestore fresh transactional read; mid-request admin regression | Pass |
| Legacy partial writes preserve current assignments | B grants Media; old caller sends stale scopes, then an unrelated partial patch | No-revision scope guard and fresh merge; legacy regression also checks committed audit data | Pass |
| Tokens belong to the full church/account scope | Same user and permission map in two churches; use church A's revision for B | Revision includes church/user; cross-church regression rejects and leaves B unchanged | Pass |
| Notification controls follow committed access | Hold old bootstrap; self grants Media; release old response; open menu; self removes Media; reopen menu | `requireFresh`, `applyBootstrap`, real provider/drawer/UserSection integration | Pass |
| Durable success is not retried after refresh failure | Save succeeds; refresh rejects; reopen drawer | Member draft cleared, completed drawer closed; failure/reopen regression asserts one write and disabled Save | Pass |
| Navigation does not strand the global refresh | Hold self-save; unmount Administration; finish save | Original church/user/payload captured; lifetime regression checks saved scopes and global refresh once | Pass |

### Pattern / learning opportunities
The targeted sibling search covered membership promotion/demotion/recovery, invitation access transaction/lock merging, notification preference patches, global bootstrap consumers and error serialization. Existing field-only preference writes remain independent of the new token. Invitation draft conflict protection is not added here. The new token is returned to the same drawer that submits it; security events use transaction results. Only the known member-conflict code is exposed by this handler; it cannot trigger the API client's CSRF-only automatic mutation retry. Focused regressions and the feature contract are sufficient enforcement; no new general policy or abstraction is needed.

### Final readiness
**Ready** for the two reported fixes and the affected workflow; this is not a branch-wide production-readiness review.

- Cross-boundary review performed: Yes — draft → revision → transaction → audit → canonical bootstrap → deferred controls.
- Sibling-pattern search performed: Yes — listed above; pending-invite concurrency policy remains separate.
- Legacy/persisted-state compatibility reviewed: Yes — no migration; no-revision scope changes fail safely; unrelated patches remain supported.
- Identity-switch test reviewed or added: Yes — cross-church token rejection for identical account IDs and permissions.
- Unmount/lifetime test reviewed or added: Yes — navigation during held durable save.
- Contract round trip traced: Yes — list/API types/drawer/client/body/transaction/result/bootstrap/menu.
- Validate/use security boundary reviewed: Yes — fresh membership, revision, role/status and church-team validation before commit.
- Retry-state authority reviewed: Yes — conflicts preserve the dirty draft until explicit close; completed saves clear it before refresh.
- Owner-retirement handoff reviewed: Yes — durable original-owner work continues and the global provider owns refresh; no global retry callback retains the route.
- External side-effect adoption/compensation reviewed: Not applicable — no external resource creation/deletion added.
- Authorization/data-projection reviewed: Yes — admin and CSRF guards unchanged; revision is only exposed with the existing admin member list.
- Production entry point, runtime context, and test composition compared: Yes — described above.
