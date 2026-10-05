# Teams read boundary: iteration 4

This iteration closes the full-document Teams SSE and intake SMS history gaps before ordinary-member client access is enabled. Route/navigation access is not changed.

## Broad read rule

`requireBroadTeamsViewSession` first uses the unchanged legacy Teams guard for authentication, church validation, and booth workstation restrictions. It then requires admin, global Teams view/edit, or human Services edit (temporary compatibility). Workstations must have the booth grant and normalized broad Teams permissions. Team scopes and roster-derived membership alone do not qualify.

The full Teams stream and intake SMS delivery history use this rule. Scoped/member callers receive 403, including when the intake form belongs to their own team. Church mismatch remains 403; a foreign-church form requested by an authorized reader remains 404.

`canUseTeamsLiveSync` mirrors the broad session rule, including normalized legacy booth permissions. All five subscription consumers pass it to `useTeamsLiveSync`: Teams page state, Current Service Workspace, current service-plan source, Current Service Viewer, and Services plan editor (the source/controller path covers its controller consumers). Disabled access creates no EventSource; access loss closes the existing source and ignores queued callbacks. Scoped Teams page state retains bounded bootstrap/focus refresh.

Bootstrap passes `access.viewAll` into construction. Non-global requests do not load intake forms/submissions/recipients or run SMS eligibility processing. Existing canonical roster/team loading and the effective REST resolver/projection/detail contracts remain unchanged.

## Deferred Services permissions review

These reads still intentionally inherit legacy Teams semantics. Paths below are relative to `/api/churches/:churchId`.

| Guard/helper | Handler | GET path | Remaining coupling |
| --- | --- | --- | --- |
| `requireTeamsView` | `listServicePlanTemplates` | `/service-plan-templates` | Any team scope grants church-wide template reads. |
| `requireTeamsView` | `getServicePlanAssignmentHistory` | `/service-plan-assignment-history` | Any team scope grants church-wide assignment history. |
| `requireTeamsView` | `getServicePlanMicrophones` | `/service-plan-microphones` | Any team scope grants the church microphone catalog. |
| `requireTeamsView` | `getServiceEquipment` | `/service-equipment` | Any team scope grants the church equipment catalog. |
| `requireServicePlansView` | `listServicePlans` | `/service-plans` | Global Teams, any team scope, or Services view/edit admits plan list reads. |
| `requireServicePlansView` | `getServicePlan` | `/service-plans/:planKey` | Same legacy admission; assignments use `isPlanOnlyReader`. |
| `requireServicePlansView` | `getServicePlanPublicSnapshot` | `/service-plans/:planKey/public-snapshot` | `hasTeamsPlanAccess` additionally admits any team scope to the detailed team snapshot. |
| `requireServicePlansView` | `getServicePlanViewer` | `/service-plans/:planKey/viewer` | Plan projection uses `isPlanOnlyReader`; the detailed snapshot also needs future review. |
| `requireServicePlansView` | `getServicePlanAssignments` | `/service-plans/:planKey/assignments` | `isPlanOnlyReader` determines whether assignments are returned. |

`hasTeamsPlanAccess` counts any stored `teamScopes` entry as Teams-backed plan access, alongside admin/global Teams/Services edit. `isPlanOnlyReader` calls it for humans and treats booth workstations as Teams-backed; `withoutServicePlanAssignments` uses that decision to retain/remove embedded roster assignments. These helpers and their consumers need a deliberate Services ownership/projection review. No Services authorization or mutation guard was changed here.

`resolveTeamsReadAccess` still calls the legacy Teams guard only for workstation validation and keeps the temporary human Services-editor `viewAll` compatibility. The pure effective resolver remains unchanged.

## Release scope

The existing selected-team privacy fragment remains accurate for Teams roster/schedule reads after the stream restriction. No membership-access release note is added; ordinary-member client navigation is still deferred.

## Files changed

- `authService.js`: broad guard and injection into Teams handlers.
- `server.js`: full Teams stream admission.
- `server/teamsAuthHandlers.js`: broad SMS history guard and conditional administrative bootstrap reads.
- `server/teamsApi.test.js`: four new auth/history/read-observer integration tests; Iteration 3 tests unchanged.
- `client/src/context/globalInfo.tsx`: derived session capability.
- `client/src/context/globalInfo.test.tsx`: eleven actual EventSource admission cases through the provider.
- `client/src/pages/Teams/hooks/useTeamsLiveSync.ts`: explicit required capability and cleanup on access changes.
- `client/src/pages/Teams/hooks/useTeamsLiveSync.test.ts`: disabled connection and access loss/restoration coverage, including queued schedule and service-plan events.
- `client/src/pages/Teams/hooks/useTeamsPageState.ts`: capability at subscription.
- `client/src/pages/Teams/hooks/useTeamsPageState.test.tsx`: bounded REST recovery without an EventSource.
- `client/src/pages/Controller/CurrentServiceWorkspace.tsx`: capability at subscription.
- `client/src/pages/Controller/useCurrentServicePlanSource.ts`: capability at subscription.
- `client/src/pages/Controller/useCurrentServicePlanSource.test.tsx`: capability-aware mock and scoped subscription denial while existing Services loading continues.
- `client/src/pages/CurrentServiceViewer.tsx`: capability at subscription.
- `client/src/pages/Services/ServicePlanEditor.tsx`: capability at subscription.
- `client/src/test/mocks.ts`: explicit broad-access defaults for existing editor fixtures.
- `docs/teams-read-boundary-iteration-4.md`: this audit and handoff.

## Verified

- `node --import tsx --test server/teamsApi.test.js server/authLifecycleGuards.test.js server/authLifecycleHappyPath.test.js`: 304 passed, zero skipped. Includes all unchanged Iteration 3 bootstrap/detail tests and existing SMS history/event payload/mutation tests.
- `npm.cmd test --prefix client -- --watchAll=false --runInBand src/pages/Teams/hooks/useTeamsLiveSync.test.ts src/context/globalInfo.test.tsx src/pages/Teams/hooks/useTeamsPageState.test.tsx src/pages/Controller/useCurrentServicePlanSource.test.tsx src/pages/CurrentServiceViewer.test.tsx src/pages/Services/ServicePlanEditor.test.tsx`: 205 passed at the first checkpoint.
- After adding normalized-booth and bounded-refresh/source assertions, reran the four changed suites (`useTeamsLiveSync`, `globalInfo`, `useTeamsPageState`, `useCurrentServicePlanSource`): 114 passed.
- `npm.cmd run lint:check --prefix client`: passed after final client changes.
- `npm.cmd run type-check --prefix client`: passed after final client changes.
- `git diff --check`: passed.

The read-observer fixture uses a valid US number so broad SMS eligibility must actually read consent. It checks both full and summary bootstrap requests. This avoids a false negative from invalid legacy phone numbers.

## Final code review

### Findings

Critical: None. High: None. Medium: None. Low: None in this iteration's changes. Deferred Services coupling is recorded above rather than silently changed.

### Open questions / assumptions

None. Broad compatibility follows existing normalized server permissions, including older booth records.

### Verification gaps

Required: None. Optional: no real browser/Electron multi-device exercise or live HTTP SSE transport test was run. Admission guards, client constructors/cleanup, and existing event payload tests were exercised; route wiring was reviewed. Full repository suites were left to CI.

### Pattern / learning opportunities

Church-wide full-document channels need an explicit broad capability alongside effective per-team REST access. This pass adds no new state, protocol, permission shape, or mutation path; the small guard and derived capability avoid a long-lived entitlement subsystem.

### Final readiness

Ready for the ordinary-member Teams client access iteration within the defined Teams REST read boundary. Services ownership and assignment projections remain a separate review; ordinary-member routes/navigation were not started.
