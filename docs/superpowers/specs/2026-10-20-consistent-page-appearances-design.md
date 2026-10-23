# Consistent Page Appearances Design

**Status:** Proposed implementation design

**Source:** WorshipSync — Consistent Page Icons and Colors request, 2026-10-20.

## Goal

Use one typed definition for the icon and Tailwind color of each fixed homepage destination so its launcher card and existing destination header share the same identity. This is a consistency change only; it does not redesign page layouts or alter navigation behavior.

## Design

Add a small shared page-appearance module independent of `Home.tsx` and the page shells. It will export a typed map keyed by stable destination identifiers. Each entry contains only the Lucide icon component and its Tailwind color class:

| Destination key | Icon | Color |
| --- | --- | --- |
| `churchAdministration` | `Building2` | `text-amber-300` |
| `teamsAndServices` | `Users` | `text-cyan-300` |
| `resources` | `FolderOpen` | `text-violet-300` |
| `mySchedule` | `CalendarClock` | `text-teal-300` |
| `myTeams` | `Users` | `text-cyan-300` |
| `serviceWorkspace` | `LayoutDashboard` | `text-blue-300` |
| `currentServiceViewer` | `ListChecks` | `text-indigo-300` |
| `boardModeration` | `MessagesSquare` | `text-blue-300` |
| `creditsEditor` | `ScrollText` | `text-pink-300` |

`Home.tsx` will consume the shared icon/color entries for these fixed cards. Its route paths, labels, descriptions, permission filtering, grouping, ordering, controller and display-output logic remain local and unchanged. Home section-heading icons remain section identities rather than destination-header identities.

The existing `AppWorkspaceShell` and `AppPageShell` APIs will gain an optional icon color class. Omitting it preserves each shell's current orange class, maintaining compatibility for existing or future consumers. Explicit page identities will pass the corresponding shared color. Shell layout, toolbar dimensions, title content, branding, responsive behavior, and controls remain unchanged.

Update the existing headers for Church administration, Teams and Services, Resources, My schedule, and Discussion Board. The My schedule header changes to `CalendarClock`; calendar icons inside schedule workflows stay untouched. Board moderation retains the Discussion Board title and its current 48px toolbar. No identity icon is added to controllers, the Service Workspace, Current Service Viewer, Credits Editor, or display surfaces.

## Boundaries

- No route, permission, access, controller-order, controller-configuration, sync, persistence, or display-link changes.
- Controller identity continues to come from saved controller profiles and the existing configurable icon renderer.
- Internal navigation icons, active states, status colors, section icons, and church branding remain independent.
- The shared map owns visual identity only. Home descriptions and route metadata remain in `Home.tsx` because they are not duplicated in the affected headers.
- No new theme system or shell-side route inference.

## Verification

Add focused tests for the appearance map and Home card usage; each named destination header's icon/color; shell fallback colors when no color is supplied; and unchanged toolbar dimensions, responsive header behavior, permission-aware Home navigation, and controller appearance configuration. Run affected Jest tests, client linting, and type-checking. Use the existing browser infrastructure where practical to compare the homepage and destination header identity at desktop and mobile sizes.
