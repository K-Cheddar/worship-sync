# Teams and Services navigation

**Status:** Confirmed product intent. **Source:** Responsive Navigation Redesign request, 2026-10-13, refined by the Mobile Navigation Refinement request, 2026-10-14, and the Compact Mobile Toolbar and Navigation Layout request, 2026-10-14.

## Purpose and behavior

Desktop retains direct, uncollapsed access to every authorized page, grouped under Services, Scheduling, and Teams, plus the existing icon-only sidebar option. Mobile and tablet widths below the desktop sidebar breakpoint use three persistent bottom shortcuts and text-only, horizontally scrollable route tabs. The active secondary tab stays visible when navigating. Navigation controls remain available during lazy loading, immediately select the requested destination, and retain existing unsaved-change confirmation.

| Primary destination | Ordered pages | Default URL |
| --- | --- | --- |
| Services | Services, Templates, Equipment, Service setup | `/teams-and-services/services` |
| Scheduling | Schedules, Forms, Messages | `/teams-and-services/schedules` |
| Teams | Teams, Members, Positions, Team roles, Qualifications | `/teams-and-services/groups` |

The mobile bottom bar contains Services, Scheduling, and Teams only. Home remains on its existing route and is available through the universal Menu on desktop and mobile. Existing page URLs are unchanged, including Equipment at `microphones` and Teams at `groups`. Permissions filter pages before grouping; empty groups are omitted and a partially accessible group opens its first authorized page. Scoped team editors retain the existing Availability label for their restricted Forms workflow.

The full Menu drawer uses the same utilities and functional groups on all viewport sizes: Home, What's New, About, and interface zoom remain accessible. Menu → Home resolves to the existing Home page. The bottom bar ends when leaving this shell, including when opening Home.

For Teams and Services below the desktop sidebar breakpoint, a compact 48px application toolbar stays visible while scrolling. It contains the universal Menu and compact sync/account controls; the page title and icon are omitted because the secondary route tabs identify the page. Route tabs stay directly below the toolbar in normal layout flow. Only the page's content scrollport moves. The Service Plan keeps its own compact details affordance and plan actions available. At desktop widths, the existing full toolbar, title, icon, and church branding remain unchanged. Other shared-shell consumers keep their current layout; optional header collapse support remains available to pages that explicitly opt in. The shell reserves the fixed bottom bar and safe-area height, and the fixed service-plan action bar uses the same clearance.

Secondary route tabs use the shared Tabs primitive; labels never compress, horizontal scrolling keeps the selected tab visible, and browser history controls the selected state. The mobile bottom bar and menu behavior are unchanged.

Teams and Services use the shared temporary pending-route mechanism to select a requested destination before its lazy page is ready. The Teams navigation guard continues to own unsaved-edit confirmation separately.

## Boundaries

No pages are combined. Authorization and direct-route enforcement, data models, persisted navigation routes, lazy loading, workflows, and API behavior remain unchanged. Controller, projector, monitor, stream, public pages, authentication, and Home layouts are outside this redesign.

## Product decisions

- **2026-10-14 — Keep the Teams and Services toolbar visible while scrolling.** Approved behavior: use a compact, always-visible toolbar below the desktop sidebar breakpoint, remove the page title/icon from that row, keep route tabs directly below it, and let only the content scrollport move. Preserve the current desktop toolbar and other shared-shell layouts. The request identifies header collapse and sticky collisions as the source of layout instability and asks for more space in Service Plan while keeping its controls accessible. **Approval source:** Compact Mobile Toolbar and Navigation Layout request, 2026-10-14.

## Verification references

`teamsNavSections.test.ts`, `TeamsSidebarNav.test.tsx`, `TeamsMobileShortcuts.test.tsx`, `TeamsNavigationGuardContext.test.tsx`, `TeamsAndServices.test.tsx`, `AppWorkspaceShell.test.tsx`, and `client/e2e/responsive-navigation.mjs` cover the three destination mapping, selected icon treatment, shared route tabs, responsive shell, route transitions, and content clearance.
