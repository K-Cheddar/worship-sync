# Account Team Leads verification and review

Implementation status: COMPLETE. Workflow review, October 23, 2026. Implemented on `in-progress`, starting from the matching fetched `origin/in-progress` commit. Existing Home-page changes were left untouched.

## Before behavior
Admin normalization erased explicit scopes and global editing hid/cleared selections. Intake used roster lead flags and account links; schedule responses included every broad editor. Debug email could count as delivery and schedule send failures could advance pending state.

## After behavior
`permissions.teamScopes[teamId] === "edit"` is the sole Team Lead designation. Membership and invite scopes survive access edits, acceptance, promotion, demotion, recovery, account lists and bootstrap, with church/active-team validation. Demotion removes global Teams/Services grants. Pending role-only edits retain scopes without inheriting admin global grants. A stale access save cannot undo a concurrent demotion.

People-page access actions include admins and self-editing; destructive self-actions remain unavailable. The existing drawer and global dropdown are retained. View scopes survive unrelated saves, and Team Lead checkboxes remain visible for global editors/admins. Archived teams are excluded. Both volunteer editors lose only the obsolete lead control; stored legacy API fields remain compatible and have no routing authority.

Both digests use active church account memberships, matching active-team edit scopes, an account email and personal category preferences. Multi-team forms use a deduplicated union; empty form teamIds resolve to active church teams. Admin/global privileges never subscribe an account. Bootstrap offers team settings only with active lead scopes and an email.

Production digests require provider acceptance. Intake retains its durable batches, delivery ledger and existing three-attempt bound. Schedule digests retain frozen content, owner identity, a renewable lease and per-recipient ledger keys through failure/restart. Provider acceptance and ledger failures have distinct diagnostic phases. Retries skip recorded deliveries and reuse provider keys after uncertain outcomes. New responses and conflict keys survive sends. A schedule moved to another team cannot route its old frozen payload to the new team's leads. Startup/periodic paginated recovery uses the existing 20-minute window.

## Behavior intentionally unchanged
Church authorization and active-team boundaries, broad admin/global editing, service-plan access for valid grants, Controller access on demotion, volunteer positions/roles/qualifications and scheduling, church administrative invite-accepted emails, personal category opt-outs, private individual emails, SMS/manual messaging, display/IPC behavior and stream transparency. No migration, backfill or separate assignment store was introduced.

## Implemented
- `authService.js`: permission normalization/validation, invite access round trips, acceptance, role/recovery transitions, role-race guard, account/session responses, common recipients, provider acceptance and durable schedule delivery/recovery.
- Account draft/types/helpers, `MemberAccessSheet`, `useAccountPageState` and `AccountPeoplePage`: preserved scopes and accessible Team Lead controls.
- `MemberManager` and `TeamMemberProfileEditor`: retired roster controls; compatible historical fields remain.
- `server/intakeNotifyRecipients.js`, `server/notificationPreferences.js`, `server.js`: shared matching/category semantics and recovery startup.
- Confirmed feature contract and release-note fragment.

## Verified (required)
All checks below exited successfully. These are focused checks, not the complete repository test suites.

### Server
`node --import tsx --test` with these 20 files: **604 passed, 0 failed, 2 skipped (606 total including subtests)**. `DOTENV_CONFIG_PATH` pointed to a nonexistent local test path and test support was enabled, preventing local `.env` provider credentials from entering these runs.

```text
server/accountTeamLeads.test.js
server/scheduleResponseDigest.test.js
server/intakeNotifyRecipients.test.js
server/notificationPreferences.test.js
server/intakeSubmissionDigest.test.js
server/authLifecycleHappyPath.test.js
server/authInviteLifecycle.test.js
server/authLifecycleGuards.test.js
server/authLifecycleDeep.test.js
server/teamAccess.test.js
server/teamIntakeTransactionDigest.test.js
server/teamsApi.test.js
server/authSessionRecovery.test.js
server/authResponseSanitize.test.js
server/inviteAcceptedAccessSummary.test.js
server/inviteAcceptedNotifyRecipients.test.js
server/notificationLedger.test.js
server/scheduleDigestEntries.test.js
server/scheduleResponses.test.js
server/teamsBootstrapProjection.test.js
```

### Client
`npm.cmd test --prefix client -- --runInBand --runTestsByPath` with these 13 files: **210 passed, 0 failed, 0 skipped**. After final draft typing changes, the three account access/invitation suites were rerun: **21 passed**.

```text
src/pages/Account/accountInviteAccess.test.ts
src/pages/Account/accountServicesAccess.test.ts
src/pages/Account/accountUtils.test.ts
src/pages/Account/components/MemberAccessSheet.test.tsx
src/pages/Account/pages/AccountPeoplePage.teamLeads.test.tsx
src/pages/Controller/AccountFormSections.test.tsx
src/pages/Teams/managers/MemberManager.test.tsx
src/pages/Teams/managers/TeamManager.permissions.test.tsx
src/utils/notificationCategories.test.ts
src/containers/Toolbar/ToolbarElements/UserSection.test.tsx
src/components/TeamsAccessGuard.test.tsx
src/utils/sessionRouteAccess.test.ts
src/api/__tests__/auth.test.ts
```

`npm.cmd run type-check --prefix client` and `npm.cmd run lint:check --prefix client` passed. `node --check` passed for `authService.js`, `server.js`, `server/intakeNotifyRecipients.js` and `server/notificationPreferences.js`. `git diff --check` passed. There is no separate server lint command in package scripts.

Production context: **Pass** for this workflow review. The UI integration test mounts the real People page, AccountPageProvider/useAccountPageState, GlobalInfo/Toast contexts, drawer, menus, selects and checkboxes, with API boundaries mocked. It opens deferred access controls from real People-page actions, saves an admin/self account, exercises pending progress, refresh hydration, pending invitations, role/global access changes and invitation sending. The existing responsive drawer width, scrolling and wrapping are retained. Server tests run real auth/Teams handlers, in-memory persistence, and shared Firestore fixtures enforcing read-before-write transactions and nested-map merge behavior. Separate module instances exercise shared durable leases/restart recovery. `server.js` startup wiring and Teams response/blockout scheduling entry points were traced. View-only schedule projection excludes internal digest fields.

## Not verified (optional)
- Two existing Teams API tests require a Firestore emulator: `Firestore member revision writes keep ready volunteer contact indexes current` and `Phase 3C schedule SMS review uses current Team access and never sends`. They were skipped by their existing guards. No live Firestore/emulator or cross-device deployment was used; new transaction paths were verified with deterministic fixtures.
- No real email provider request, inbox delivery, browser/Electron visual smoke or exhaustive repository-wide suite was run. Test transports and injected failures establish code behavior, not production delivery.

## Findings
Critical: None. High: None. Medium: None. Low: None remaining in the reviewed scope. Review corrections included reachable admin/self access actions, preserving omitted pending-invite permissions, recovery promotions, role-race rejection, frozen digest owner binding, and email-aware category visibility.

## Product authorization status
Authorized by the October 23, 2026 account-based Team Leads request, recorded in `docs/features/account-team-leads.md`. Existing all-team form semantics are confirmed in `docs/features/team-scheduling.md`. No consequential product choice remains unresolved.

## Open questions / assumptions
None blocking. An empty form team list means all active teams in its church; an empty account scope never broadens recipients. Provider acceptance is not proof of delivery to an inbox.

## Verification gaps
No required gap for this workflow review. Optional gaps are listed above. This is not a production-release or complete branch readiness claim.

| Invariant | Adversarial sequence | Code evidence | Controlled test evidence | Result |
| --- | --- | --- | --- | --- |
| Scoped grants survive role changes without global escalation | Save reads admin -> demotion commits -> old access save resumes | `updateMemberAccessSettings` expectedRole guard; fresh transaction reads in promotion/demotion/recovery | `accountTeamLeads.test.js` interleaves demotion during validation, checks 409 and retained restrictive permissions; Firestore role/recovery tests check maps/preferences | Pass |
| Accepted deliveries are not repeated as new work | Provider accepts -> ledger write fails -> retry | Frozen batch, stable provider key, existing delivery ledger | `scheduleResponseDigest.test.js` injects ledger failure and checks identical content/key, two distinct provider identities for three attempts | Pass |
| Restart resumes remaining recipients | One worker is blocked -> second worker attempts -> first fails -> fresh module recovers | Durable leased batch and paginated recovery | Separate-worker/restart test blocks transport, proves one active send and reuse of the original key | Pass |
| Concurrent responses/conflicts survive completion | Batch reads -> sending begins -> new response or changed/added conflicts persist -> finish | Transactional finish checks fresh responses and removes only unchanged read conflicts | Partial-failure/new-response and changed-conflict tests inspect persisted maps/markers | Pass |
| Work cannot leak across team owners | Frozen batch fails -> schedule moves to another team -> retry | Batch church/team identity checks on claim, renewal and finish | Owner-switch test creates a new team's lead and proves no old content is sent | Pass |
| No broad or roster-based subscriptions | Admin/global editor without scopes, old roster lead, inactive/foreign/archived grants enter lookup | Shared `listTeamLeadNotifyRecipients` and active-team/account checks | Actual intake and schedule digest recipient matrix, including multi-team deduplication and independent personal opt-outs | Pass |

## Pattern / learning opportunities
Keep permission round trips and digest retry transitions covered by the existing focused suites. No new repository policy or generalized framework is needed.

## Final readiness
Ready for the reviewed account/team notification workflow.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes, including recovery promotions, both digest senders and roster editors.
- Legacy/persisted-state compatibility reviewed: Yes; old timestamp-only schedule work still resumes and historical roster flags stay inert.
- Identity-switch test reviewed or added: Yes, schedule owner switch and validated church/team scopes.
- Unmount/lifetime test reviewed or added: Not applicable to new background job ownership; jobs are server-owned. Existing roster editor lifecycle tests passed; the access test covers pending UI controls.
- Contract round trip traced: Yes, draft -> API -> invite -> membership -> account list/bootstrap -> recipient selection.
- Validate/use security boundary reviewed: Yes, active teams/churches, admin assignment guards, role races and frozen batch ownership.
- Retry-state authority reviewed: Yes, durable batch/ledger plus current personal eligibility.
- Owner-retirement handoff reviewed: Yes, schedule team changes invalidate frozen content without clearing pending work.
- External side-effect adoption/compensation reviewed: Yes, provider acceptance is checkpointed; retry reuses its identity instead of inventing a new send.
- Authorization/data-projection reviewed: Yes, existing edit/view guards and safe view-only schedule projection remain.
- Production entry point, runtime context and test composition compared: Yes.

## Known follow-ups
None required in implementation. Before production verification, manually assign the intended account's teams, confirm `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL` (and optional notification sender), then verify real provider acceptance and inbox delivery after a 20-minute digest window. No migration/backfill or production send was performed. Resend's existing 24-hour idempotency retention limits recovery of a provider-accepted send whose ledger acknowledgment was lost beyond that window.
