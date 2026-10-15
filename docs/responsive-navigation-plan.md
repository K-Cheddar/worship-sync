# Responsive navigation implementation plan

## Goal
Keep every desktop destination one click away and add persistent mobile primary and secondary navigation.

## Existing architecture
TeamsAndServices owns a bounded AppWorkspaceShell, permission-filtered section definitions, nested lazy routes, per-section Suspense, and a navigation guard with immediate pending selection. Managers and schedules use nested scrollports. Home is a separate top-level route. HomeToolbarMenu supplies utility actions; only phones currently receive the full section drawer.

## Before behavior
Desktop has Services and Teams groups. Mobile uses a drawer without persistent section shortcuts. Tablet menu and sidebar breakpoints differ. The header stays expanded.

## After behavior
Services, Scheduling, and Teams organize the application navigation. Home remains in the universal Menu. Mobile gets three bottom shortcuts and horizontally scrolling text-only route tabs above page scrollports. Below the desktop breakpoint, a compact 48px Teams toolbar and the route tabs stay visible while only page content scrolls.

## Product Decision Check
The 2026-10-13 responsive navigation request authorized the shell. The 2026-10-14 Mobile Navigation Refinement request supersedes the earlier four-group mobile shortcut presentation: the bottom bar now has Services, Scheduling, and Teams; Home stays in Menu. The 2026-10-14 Compact Mobile Toolbar and Navigation Layout request supersedes the initial header-collapse behavior: the toolbar remains visible while page content scrolls. The team-scheduling contract governs adjacent workflows, which do not change. Existing scoped Forms/Availability labeling and permissions remain authoritative.

## Behavior intentionally unchanged
URLs, route persistence, authorization, dirty-form confirmation, lazy loading, page data, mutations, scheduling, public routes, presentation surfaces, authentication, and Electron behavior.

## Acceptance criteria
All existing destinations visible on desktop; consistent menu utilities and sections; correct mobile defaults and nested active states; authorized fallback destinations; interruptible loading; back/forward; safe-area clearance; keyboard access; sticky navigation without competing page scrolling.

## Proposed implementation
Extend section metadata with a shared ordered group projection. Reuse the navigation guard for all links. Render the existing full drawer on both viewports in this shell only. Add secondary and bottom links from the same filtered groups. Keep this shell's compact toolbar and route tabs visible while the content scrollport moves; reserve bottom-bar space in the bounded layout and offset the existing fixed plan action.

## Affected surfaces
App's protected TeamsAndServices entry, TeamsPageProvider, navigation guard, AppWorkspaceShell, HomeToolbarMenu, sidebar, mobile navigation, and a scoped service-editor fixed-action offset. No backend or persistence changes. Tests must include the real shell and providers with mocked remote APIs, plus browser layout checks.

## Risks / edge cases
Nested scrollports, sticky schedule headers, focus and portals, small landscape height, zoom, viewport changes, stale lazy completion, browser history, denied defaults, and scoped availability labels.

## Questions requiring user input
None. The 2026-10-14 request explicitly confirms Home stays in Menu and not the bottom shortcuts.

## Verification
Focused navigation metadata/component/guard/shell tests; existing delayed-import and history integration tests; client lint and type check; browser checks at phone, landscape, tablet, desktop sizes with real shell composition. Verify no overlap at final content/actions and exercise menu, scroll, and active-tab visibility.
