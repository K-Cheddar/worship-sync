# Merge in-progress into in-progress-2 ? 2026-10-21

## Goal
Merge local in-progress (c6659e25) into in-progress-2 (43018029), preserving both histories and behavior before resuming Phase 2.
## Existing architecture
Incoming branch refactors volunteer handlers into shared human/personal operations and adds participant projections; target adds transactional bulk acceptance, identity integrity, and stale-plan sync gates.
## Before behavior
Both branches contain independent changes to My Schedule, mutations, controller refresh and docs.
## After behavior
One merge retains incoming functionality and target safety protections. Portal activation remains off by default.
## Product Decision Check
Current user explicitly requests this merge. Existing feature contracts describe both branches; this merge adds no new product policy. Phase 2 must be reassessed after merge because incoming work overlaps later phases.
## Behavior intentionally unchanged
Human auth, accountless feature flag, scheduling authority, explicit sync and stream transparency.
## Acceptance criteria
No conflict markers, both parent histories, focused server/client regression checks, no deployment or messaging.
## Proposed implementation
Resolve refactored APIs against shared operations, preserve target bulk endpoint and identity deletion. Combine stale-preview guards with incoming participant projections and insertion fallback behavior.
## Affected surfaces
Express handlers/routes, Firestore mutations, signed-in/personal My Schedule composition, Controller saved-plan synchronization; no display renderer edits.
## Risks / edge cases
Duplicate declarations after refactors, stale plans accidentally syncing, async church switches, conflicting time-off revision baselines.
## Questions requiring user input
None for the merge; reassess Phase 2 after incoming architecture is available.
## Verification
Node 24 syntax and focused teams/auth/volunteer tests; client related My Schedule/controller/outline tests, type-check and lint; inspect complete merge diff against both parents.

## Resolution record
- Parents: target `43018029f652f9c8858d47ce49f4f4b22071d041`; incoming `c6659e25` (local in-progress). No remote fetch or push.
- Incoming shared personal/human operations, participant projections, placement fallbacks and off-by-default portal remain. Target identity claims, transactional roster deletion, paginated accept-pending and stale-plan sync gates remain.
- The incoming October 20 time-off contract supersedes the older keep-and-replace conflict action. Dirty drafts retain their baseline while fresh saved props expose conflicts; explicit discard/re-edit follows review. Incoming human bulk-button test fixtures now exercise the target accept-pending API shape.
- Required API fixtures now include successful response flags and the participant projection argument. A separate target stale-preview suite preserves its safety cases. Loaded refresh uses isRefreshing rather than initial isLoading; stale authorization remains blocked in Redux.
- Preserved target historical portal documents as `*-phase-2-baseline.md`; incoming current plan stays canonical pending Phase 2 reassessment.
- Target emulator fixtures now contain the single pending slot asserted by their bulk tests and a baseline schedule revision. Controlled external Firestore writes force ABORTED/retry without holding pessimistic read locks for 60 seconds. Actual concurrent requests remain separately tested.
- Identity-removal race starts from an actual linked record, so invitation cleanup has an authoritative account owner. Legacy string assignments are scrubbed on permanent roster deletion, alongside structured cells.

## Review
### Findings
Critical: None introduced by merge. High: None remaining in merge resolution. Medium: None remaining. Low: None.
### Product authorization status
Authorized: current request to merge; existing contracts from both parents, with newer incoming time-off reconciliation decisions retained. No activation, sending or deployment authorized or performed.
### Open questions / assumptions
Local in-progress is the requested source branch. Incoming broader portal work is preserved; completing the original Phase 2 security request requires a separate audit of that implementation.
### Verification gaps
Scope: workflow review of merge resolution, not production-readiness review of all 354 incoming files or completion of Phase 2. Compared critical implementations against both parents and the staged result.

| Invariant | Controlled transition and inspected path | Evidence |
| --- | --- | --- |
| Stale preview cannot sync | failed refresh -> schedule event -> explicit refresh; useCurrentServicePlanSource / SyncFloatingWindow / outline push | 215 client tests across five suites, including separate stale regression suite: Pass |
| Dirty dates never acquire another revision | bulk/409 refresh -> newer saved props -> explicit reconciliation; MySchedule / MyScheduleBlockouts | 163 tests across six routing, time-off, roster suites: Pass |
| Identity cleanup stays church-scoped | account removal/link race and roster deletion/replacement race; volunteerIdentity / cascadeTeamEntityDeletion | identity + operations emulator suites: 6 tests, Pass |
| Each bulk commit revalidates authority | concurrent accept/decline, archive, unlink, membership removal and partial retry; volunteerOperations | 17 mutation-boundary emulator tests: Pass |
| Sessions remain isolated | redemption, CSRF, revocation, shared projection; portal handlers / route registrar | 11 credential/mutation emulator tests plus built HTTPS browser test: Pass |
| Real Controller retains reading position | inserted/deleted items while scrolled, expanded notes | existing browser fixture, two scenarios: Pass |

Exact focused server command used Node 24.12.0 with `--import tsx --test --test-concurrency=1` for teamsApi, scheduleResponses, volunteerOperations, volunteerProjection, volunteerPrivacy, teamsBootstrapProjection, authLifecycleHappyPath, authLifecycleGuards, authLifecycleDeep, authSessionRecovery, authInviteLifecycle and authInviteRevoke: 499 passed, zero skipped. After the final legacy-assignment fix, teamsApi reran: 293 passed.
Client type-check passed. `npm run build:strict --prefix client` passed (lint and Vite/PWA build). Build required sandbox escalation for esbuild parent-directory resolution. Existing bundle-size and fixture URL warnings remain. Public/signed-in application route suites passed; built public HTTPS integration passed after rebuilding the final time-off fix.
Earlier failed runs were corrected and rerun: missing API fixture fields, conflicting time-off baseline behavior, emulator fixture cardinality, legacy string cleanup and missing isolated dotenv configuration. The interrupted old emulator run is superseded by the passing bounded-race run. No full repository suite or production hosting validation performed for this merge.
### Pattern / learning opportunities
Keep successful HTTP flags in faithful fixtures. Real emulator tests exposed fixtures and legacy cleanup paths missed by in-memory coverage.
### Final readiness
Ready for the requested local merge only.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes (shared human/personal mutations and legacy email responses).
- Legacy/persisted-state compatibility reviewed: Yes (string/structured assignment cells, identity claims).
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes (client suites).
- Contract round trip traced: Yes (bulk API and participant projection).
- Validate/use security boundary reviewed: Yes (transaction-bound authorization).
- Retry-state authority reviewed: Yes (bulk partial success and Firestore retry).
- Owner-retirement handoff reviewed: Not applicable; no new globally retained workflow.
- External side-effect adoption/compensation reviewed: Not applicable; no delivery or provider changes in conflict resolution.
- Authorization/data-projection reviewed: Yes.
- Production entry point, runtime context, and test composition compared: Yes (route registrar, public and signed-in apps, built HTTPS browser).
