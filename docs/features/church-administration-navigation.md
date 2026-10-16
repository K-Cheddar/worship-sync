# Church Administration navigation

**Status:** Confirmed product intent. **Source:** WorshipSync — Church Administration Responsive Navigation Redesign request, 2026-10-15.

## Purpose and behavior

Church administrators can reach every existing administration page directly on desktop and move between related pages quickly on mobile. The three approved groups are Access, Service Tools, and Settings.

| Group | Ordered pages | Mobile shortcut default |
| --- | --- | --- |
| Access | People (`/account/people`), Devices & security (`/account/setup`) | People |
| Service Tools | Controllers (`/account/controllers`), Workspace (`/account/workspace`) | Controllers |
| Settings | Branding (`/account/branding`), Integrations (`/account/integrations`), Data export (`/account/data-transfer`) | Branding |

Desktop keeps all seven pages visible as one-click sidebar links, grouped under compact headings. Mobile keeps the compact 48px application toolbar visible, places text-only route tabs directly beneath it, and provides exactly three fixed bottom shortcuts. A shortcut opens its group's default page. The active group follows the current route, including direct links and browser history navigation. The selected route tab is kept in view when the tab strip scrolls horizontally.

The mobile menu retains Home, What's New, About, and Interface Zoom and includes all seven administration routes under the same group headings. The bottom shortcuts supplement this complete menu.

The route table, labels, groups, defaults, sidebar links, mobile tabs, and shortcuts share the Account navigation definition. Existing route paths, page features, `/account` default-to-People behavior, and supported legacy `?tab=` redirects remain stable. Existing Church Administration authorization remains enforced at the route layout; navigation does not grant access.

The compact toolbar and route tabs remain outside the scrollable page content. The administration content uses the remaining viewport height and reserves the bottom bar and device safe area once. Existing page components continue to render as routed pages rather than tab panels.

## Boundaries

This contract covers Church Administration navigation and the shared shell behavior required to support it. It does not combine or change administration pages, their workflows, data models, permission rules, or deep links. Teams, Services, and other controller, workspace, media, and public page layouts are outside scope.

## Product decisions

- **2026-10-15 — Use three administration groups for responsive navigation.** Approved groups and defaults are Access → People, Service Tools → Controllers, and Settings → Branding. Desktop shows all seven destinations without collapsible groups; mobile shows the three group shortcuts and each group's route tabs. **Approval source:** Church Administration Responsive Navigation Redesign request, 2026-10-15.
- **2026-10-15 — Preserve existing administration workflows and access checks.** Routes, page names, deep links, legacy account-tab redirects, `/account` default behavior, and authorization remain stable. **Approval source:** Church Administration Responsive Navigation Redesign request, 2026-10-15.

## Verification references

`client/src/pages/Account/accountConstants.test.ts`, `client/src/pages/Account/components/AccountSidebarNav.test.tsx`, `client/src/pages/Account/components/AccountMobileNavigation.test.tsx`, `client/src/pages/Account/components/AccountMobileShortcuts.test.tsx`, and `client/e2e/account-responsive-navigation.mjs` cover grouping, desktop direct access, mobile navigation, and responsive layout behavior.
