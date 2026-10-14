# Teams and Services navigation

**Status:** Confirmed product intent. **Source:** Responsive Navigation Redesign request, 2026-10-13, and explicit clarification limiting the bottom bar to Teams and Services.

## Purpose and behavior

Desktop retains direct, uncollapsed access to every authorized page, plus the existing icon-only sidebar option. Mobile and tablet widths below the desktop sidebar breakpoint use persistent bottom shortcuts and horizontally scrollable secondary links. The active secondary link stays visible when navigating. Navigation controls remain available during lazy loading, immediately select the requested destination, and retain existing unsaved-change confirmation.

| Primary destination | Ordered pages | Default URL |
| --- | --- | --- |
| Home | Home | `/home` |
| Services | Services, Templates, Equipment, Service setup | `/teams-and-services/services` |
| Scheduling | Schedules, Forms, Messages | `/teams-and-services/schedules` |
| Teams | Teams, Members, Positions, Team roles, Qualifications | `/teams-and-services/groups` |

Existing page URLs are unchanged, including Equipment at `microphones` and Teams at `groups`. Permissions filter pages before grouping; empty groups are omitted and a partially accessible group opens its first authorized page. Scoped team editors retain the existing Availability label for their restricted Forms workflow.

The full Menu drawer uses the same utilities and functional groups on all viewport sizes: Home, What's New, About, and interface zoom remain accessible. Menu → Home and the new Home shortcuts resolve to the existing Home page. The bottom bar ends when leaving this shell, including when opening Home.

Mobile downward scrolling collapses the main header; upward scrolling, focus, and navigation reveal it. Secondary navigation sits outside the existing content scrollports, so schedule grid headers remain within their own scroll context. Focused editing and open overlays prevent scroll-driven collapse. Motion preferences and bottom safe areas are respected; the shell reserves bottom-bar space and the fixed service-plan action bar uses the same clearance.

## Boundaries

No pages are combined. Authorization and direct-route enforcement, data models, persisted navigation routes, lazy loading, workflows, and API behavior remain unchanged. Controller, projector, monitor, stream, public pages, authentication, and Home layouts are outside this redesign.

## Verification references

`teamsNavSections.test.ts`, `TeamsSidebarNav.test.tsx`, `TeamsMobileShortcuts.test.tsx`, `TeamsNavigationGuardContext.test.tsx`, `TeamsAndServices.test.tsx`, `AppWorkspaceShell.test.tsx`, and `client/e2e/responsive-navigation.mjs` cover the shared mapping, responsive shell, route transitions, and interruption behavior.
