# Responsive navigation review

## Findings

No unresolved Critical, High, Medium, or Low findings in the navigation workflow review.

Resolved during review: history-only discard confirmation returned before applying its saved history delta. `TeamsNavigationGuardContext` now permits that path, and its regression test confirms the requested delta. Browser fixture and Testing Library query issues were corrected without changing product expectations.

## Product authorization status

Authorized by the Responsive Navigation Redesign request and the 2026-10-14 Mobile Navigation Refinement request: three application groups, Equipment under Services, direct desktop destinations, three mobile shortcuts, text-only route tabs, collapsing header, consistent Menu, and immediate guarded navigation. The current request explicitly keeps Home in Menu rather than the bottom bar. Existing permission filtering and scoped Availability wording are preserved. See [the feature contract](features/responsive-navigation.md).

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

Optional additional confidence: the current refinement's browser viewport run, physical iOS/Safari home-indicator/browser-chrome behavior, a live authenticated backend, and native Electron windows were not exercised. The responsive browser script was updated, but this worktree has no Playwright package and the computer-use browser inventory has no connected browser. No backend, Electron, presentation-output, or persisted data behavior changed. Existing React warnings about schedule table whitespace appeared in integration tests; this patch does not modify that table.

## Pattern / learning opportunities

The shared group projection consumes existing permission-filtered sections, while shared link handling preserves route-transition and dirty-form behavior. No new permission or persistence subsystem is introduced. Browser fixtures must mirror dirty-form cleanup when testing route lifetimes.

## Executed checks

- Initial redesign checks included a six-viewport browser run before the 2026-10-14 refinement; that run does not cover the three-item bar or shared route-tab styling added here.
- Current focused run: `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx src/pages/Teams/components/TeamsMobileShortcuts.test.tsx src/pages/Teams/components/TeamsSidebarNav.test.tsx src/pages/Teams/teamsNavSections.test.ts src/pages/Teams/TeamsNavigationGuardContext.test.tsx src/components/AppPageShell/AppWorkspaceShell.test.tsx src/components/SectionTabs/SectionTabs.test.tsx`: 114 passed across 7 suites.
- `npm.cmd run lint:check --prefix client`: passed, zero warnings.
- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run build --prefix client`: passed; Vite reported large-chunk advisory warnings.
- `git diff --check` and `node --check client/e2e/responsive-navigation.mjs`: passed.
- The updated `client/e2e/responsive-navigation.mjs` browser run was not available: the target worktree has no Playwright package and no browser is connected in this session.

## Completion

Implementation status: COMPLETE. Changes remain uncommitted on `in-progress-2`; no merge or deployment was performed.

Before: two desktop groups, mobile drawer-only section navigation, and an always-expanded header. After the initial redesign: three functional groups, one-click desktop links, persistent mobile primary/secondary navigation, and scroll-aware header behavior. The current refinement removes Home from the bottom bar, uses three evenly sized destinations and shared Tabs for secondary route navigation, and tightens the shared Teams scroll region's bottom inset. Existing URLs, permission rules, lazy loading, page workflows, backend behavior, and excluded layouts remain intact.

Changed implementation areas: shared section/group definitions, Teams sidebar and drawer, new shortcut/link components, TeamsAndServices composition, opt-in AppWorkspaceShell behavior, HomeToolbarMenu renderer support, history discard handling, and fixed service-editor recovery-action clearance. No route destinations were added or removed.

Bottom-spacing cause: the Equipment page's shared Teams outlet added a 12 px phone / 20 px tablet bottom gutter on top of the Equipment panel's 16 px inner padding. The shell and fixed bar already reserved the same bar height plus safe area, so that outer gutter was additional whitespace. The shared outlet now keeps an 8 px mobile/tablet gutter; desktop retains its existing 20 px inset, and the Equipment panel keeps its content padding.

The current request supersedes the initial four-item bottom bar and keeps Home accessible through Menu on desktop and mobile. Focused tests, lint, type checks, and the production build passed. The updated browser viewport check remains an optional follow-up because no browser or Playwright package was available in this worktree.

## Final readiness

Ready with minor follow-up for the reviewed navigation workflow; the updated browser viewport check remains unverified. This is not a deployment or whole-branch production-readiness review.

- Cross-boundary review: Yes; route identity, lazy completion, history, and dirty-form lifetime.
- Sibling-pattern search: Yes; Account/Resources workspace shells, full menu, service-editor fixed controls, and schedule sticky regions.
- Legacy/persisted compatibility: Yes; existing URLs, route persistence, compatibility redirects, and data shapes retained.
- Identity-switch and unmount tests: Yes; deferred imports and route interruption, dirty-source removal, ResizeObserver cleanup.
- Contract round trip: Yes for navigation definitions → permission projection → groups → links → route guard. No data/schema changes.
- Validate/use and authorization: Yes; links consume existing authorized destinations and direct-route enforcement remains intact.
- Retry authority, owner-retirement handoff, external compensation: Not applicable; no durable tasks, retries, publication, or external side effects introduced.
- Production entry point/runtime/test composition compared: Yes, with fixture boundaries documented above.
