# Responsive navigation review

## Findings

No unresolved Critical, High, Medium, or Low findings in the navigation workflow review.

Resolved during review: history-only discard confirmation returned before applying its saved history delta. `TeamsNavigationGuardContext` now permits that path, and its regression test confirms the requested delta. Browser fixture and Testing Library query issues were corrected without changing product expectations.

## Product authorization status

Authorized by the Responsive Navigation Redesign request: shared four-group navigation, Equipment under Services, direct desktop destinations, mobile persistent shortcuts, collapsing header, consistent Menu, and immediate guarded navigation. The user explicitly limited the bottom bar to Teams and Services; Home remains outside this shell. Existing permission filtering and scoped Availability wording are preserved. See [the feature contract](features/responsive-navigation.md).

## Open questions / assumptions

None. The existing `lg` sidebar breakpoint remains the desktop boundary. Permission domains remain separate from presentation groups. Groups without authorized pages are hidden; a partially accessible group chooses its first authorized page.

## Verification gaps

Production-context comparison: Pass. `App` mounts TeamsAndServices under its protected route; the real TeamsPageProvider supplies permission-filtered navigation, and TeamsNavigationGuardProvider owns pending and dirty navigation. Existing integration tests mount those providers and real page components with mocked remote APIs. Browser tests mount the actual workspace/router/menu/guard/styles and use deterministic page/context fixtures, explicitly excluding backend behavior. Other AppWorkspaceShell callers retain default, non-collapsing behavior.

| Invariant | Adversarial sequence | Code path and test evidence | Result |
| --- | --- | --- | --- |
| Latest destination wins | Start Templates import, choose Team roles, settle Templates first | `requestNavigation`, pending context, `TeamsSectionReady`; controlled deferred-import integration test | Pass |
| History restores current selection | Start Teams import, Back to Members, finish old import, Forward to Teams | HashRouter, pending popstate cleanup; Back/Forward integration test | Pass |
| Dirty forms remain protected | Dirty form → drawer navigation → confirm; dirty form → browser Back → confirm | Guard provider; browser drawer confirmation and history-delta regression test | Pass |
| Restricted destinations stay hidden | Scoped membership or service denial → groups/defaults/direct route | Existing capability projection and `TeamsSectionAccessGuard`; metadata, shortcuts, integration and browser tests | Pass |
| Content stays reachable | Nested scroll → collapse → reverse → focused input → final action | AppWorkspaceShell capture handler, reserved bottom space; six-viewport browser matrix and shell tests | Pass |
| Navigation survives viewport changes | Desktop Qualifications → small phone; reduced motion and extra bottom inset | Secondary ResizeObserver cleanup and CSS layout; browser resize/motion/clearance checks | Pass |

Optional additional confidence: physical iOS/Safari home-indicator/browser-chrome behavior, a live authenticated backend, and native Electron windows were not exercised. No backend, Electron, presentation-output, or persisted data behavior changed. Existing React warnings about schedule table whitespace appeared in integration tests; this patch does not modify that table.

## Pattern / learning opportunities

The shared group projection consumes existing permission-filtered sections, while shared link handling preserves route-transition and dirty-form behavior. No new permission or persistence subsystem is introduced. Browser fixtures must mirror dirty-form cleanup when testing route lifetimes.

## Executed checks

- `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx`: 88 passed during integration verification.
- Combined six-file run after extending history coverage: 107 passed; one new Forward assertion found two legitimate Create team buttons. The assertion was corrected to accept the existing multi-control page without weakening route/active-state checks.
- `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx --testNamePattern="restores browser Back|pending destination in mobile|rapid section changes"`: all 3 transition tests passed after that correction (85 unrelated tests skipped).
- `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/components/AppPageShell/AppWorkspaceShell.test.tsx src/pages/Teams/components/TeamsMobileShortcuts.test.tsx src/pages/Teams/components/TeamsSidebarNav.test.tsx src/pages/Teams/teamsNavSections.test.ts src/pages/Teams/TeamsNavigationGuardContext.test.tsx`: final run, 20 passed across 5 suites.
- `npm.cmd run lint:check --prefix client`: passed, zero warnings.
- `npm.cmd run type-check --prefix client`: passed.
- From `client/`, `node e2e/responsive-navigation.mjs` with `PLAYWRIGHT_MODULE_PATH` pointing to the locally installed Playwright package: final run passed all six viewports, menu confirmation, resize, reduced motion, simulated bottom inset, Home exit, and restricted-route fallback. Headless Chromium and Vite required execution outside the filesystem sandbox. The local server and browser were closed by the runner.
- `git diff --check`: passed.

## Completion

Implementation status: COMPLETE. Changes remain uncommitted on `in-progress-2`; no merge or deployment was performed.

Before: two desktop groups, mobile drawer-only section navigation, and an always-expanded header. After: Home plus three functional groups, one-click desktop links, persistent mobile primary/secondary navigation, and scroll-aware header behavior. Existing URLs, permission rules, lazy loading, page workflows, backend behavior, and excluded layouts remain intact.

Changed implementation areas: shared section/group definitions, Teams sidebar and drawer, new shortcut/link components, TeamsAndServices composition, opt-in AppWorkspaceShell behavior, HomeToolbarMenu renderer support, history discard handling, and fixed service-editor recovery-action clearance. No route destinations were added or removed.

Clarification resolved: the bottom bar does not extend onto Home. Known required follow-ups: none. Optional additional-confidence checks are listed above.

## Final readiness

Ready for the reviewed navigation workflow; this is not a deployment or whole-branch production-readiness review.

- Cross-boundary review: Yes; route identity, lazy completion, history, and dirty-form lifetime.
- Sibling-pattern search: Yes; Account/Resources workspace shells, full menu, service-editor fixed controls, and schedule sticky regions.
- Legacy/persisted compatibility: Yes; existing URLs, route persistence, compatibility redirects, and data shapes retained.
- Identity-switch and unmount tests: Yes; deferred imports and route interruption, dirty-source removal, ResizeObserver cleanup.
- Contract round trip: Yes for navigation definitions → permission projection → groups → links → route guard. No data/schema changes.
- Validate/use and authorization: Yes; links consume existing authorized destinations and direct-route enforcement remains intact.
- Retry authority, owner-retirement handoff, external compensation: Not applicable; no durable tasks, retries, publication, or external side effects introduced.
- Production entry point/runtime/test composition compared: Yes, with fixture boundaries documented above.
