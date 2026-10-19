# Feature Contract: Service-plan overlay synchronization

**Contract status:** Confirmed for the Phase 1 native service-plan path. Legacy URL-import behavior and existing live-output behavior remain unchanged.

**Approval source:** Product-owner requests, 2026-10-10 and 2026-10-18; the Phase 1 native-path decisions are recorded under **Product decisions**.

**Last reviewed:** 2026-10-18

## Purpose

Refresh reusable participant overlays for a service plan. An overlay represents an event or role, such as Sabbath School Host or Scripture Reading, and can be reused across plan occurrences.

## Operator workflow

For a native saved plan, an operator opts individual items into participant overlays in Services, optionally sets each reusable event label, then reviews the Controller preview and chooses **Sync Overlays** or **Sync All**. Native plans do not need legacy People entries or element rules. The URL importer continues to use its existing mapping rules.

## Confirmed product outcomes

- A previous plan association does not prevent reuse of an overlay for the same event or role in a later plan.
- Manual edits to mapped values remain until an explicit sync. An explicit sync replaces mapped values with the current plan values.
- Native items are excluded by default. Only items explicitly enabled for participant overlays contribute their assigned people.
- Native assignees with `memberId` resolve to the current Teams member name, including the optional prefix, and the member's `TeamRole.name`. A known item team context scopes role lookup; ambiguous or unavailable roles leave the title blank and show a preview notice.
- Free-text guests without a Teams member ID keep their entered name and receive a blank title.
- Native item labels default to the item title and can be overridden per item. Duplicate selected item labels and duplicate exact target overlay labels are skipped with an explanation; native matching does not use fuzzy person or event matching.
- The preview shows names, titles, event labels, and planned update, clone, create, and skip actions before an explicit sync.
- Native roster data comes from a plan-scoped, contact-free server projection for opted-in items. A restricted or failed lookup is distinguishable from an empty assignment and cannot produce executable overlay changes.
- The participant projection carries the saved plan revision it read. If separate plan and assignment requests return different revisions, the Controller treats participant details as unavailable and blocks syncing until a refresh returns a matching revision.
- The existing overlay sync runner, persistence path, explicit action boundary, and live audience behavior are retained. Updating a participant overlay continues to patch only mapped name, title, and event fields, preserving unrelated formatting and properties.

## Important scenarios

| Scenario | Confirmed outcome | Current implementation | Status |
| --- | --- | --- | --- |
| Same event in a later plan | Reuse the event/role overlay across plan occurrences, regardless of its previous plan association. | Matcher ignores legacy plan-source fields. | Confirmed |
| Manual edit to a mapped value | Keep it until explicit sync; then apply the current plan value. | Explicit sync replaces mapped `name`, `title`, and `event` only. | Confirmed |
| Native inclusion and roster resolution | Use only opted-in items; resolve current Teams names and role titles in assignment order; preserve guest names; expose no contacts or unrelated roster. | Controller receives only the enabled items' contact-free name/role projection. | Confirmed |
| Native event matching | Use item title or its override; skip duplicate source labels and duplicate exact target matches. | Native matching is normalized exact matching only. Legacy URL matching remains unchanged. | Confirmed |
| No available overlay / repeated participants | Keep the existing explicit-sync clone/create path and preview its actions; repeated participants consume distinct overlays in order. | Shared runner reuses the first matching overlay, clones the existing event template, or creates an overlay. | Confirmed for Phase 1 |
| Active participant overlay | Preserve the existing live-output behavior. | Phase 1 uses the existing persistence and overlay update path without adding a new live-output action. | Confirmed as unchanged |

## Product decisions

- **Question/problem:** Should a previous plan's source association block reuse of an overlay for the same event?
  - **Approved behavior:** No. Event/role identity is reusable across plan occurrences.
  - **Why:** Weekly service plans routinely assign new people to the same ordered set of reusable roles.
  - **Material alternative rejected:** Treating a source association as ownership of one overlay by one plan occurrence.
  - **Approval source/date:** Product-owner request, 2026-10-10.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.
- **Question/problem:** Should manually edited mapped values survive an explicit sync?
  - **Approved behavior:** No. Manual values remain until an explicit action; explicit sync replaces mapped values with the current plan values.
  - **Why:** Sync is an intentional operator action to refresh the current service.
  - **Material alternative rejected:** Preserve edited values across sync by comparing baselines and overrides.
  - **Approval source/date:** Product-owner request, 2026-10-10.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.
- **Question/problem:** How should a native plan select people and titles?
  - **Approved behavior:** Use only explicitly enabled items. Resolve current Teams member names (including prefix) and `TeamRole.name` through the assigned member's membership; use the item's position IDs only to identify team context. Preserve guests as names with no title. An ambiguous, archived, missing, or unavailable role produces a blank title and a preview notice; unresolved member IDs are skipped.
  - **Approval source/date:** Product-owner request, 2026-10-18.
  - **Affected workflow/contract:** Native saved-plan overlay preview and explicit sync.
- **Question/problem:** How should native event labels and duplicate matches behave?
  - **Approved behavior:** Default the event label to the item title, with an optional per-item override. Match normalized labels exactly. Skip every selected native item sharing a duplicate event label and skip when more than one saved overlay has the exact target label. Legacy URL imports retain their existing behavior.
  - **Approval source/date:** Product-owner request, 2026-10-18.
  - **Affected workflow/contract:** Native saved-plan overlay preview and explicit sync.
- **Question/problem:** What happens when a native participant has no available overlay?
  - **Approved behavior:** Reuse the existing explicit-sync behavior: update an available exact match, clone an exact-event template, or create an overlay. Show the action in the preview first; do not create or persist overlays during plan editing or background refresh.
  - **Approval source/date:** Product-owner request, 2026-10-18, including the requirements to preserve the explicit Sync workflow and preview create/update/skip actions.
  - **Affected workflow/contract:** Native saved-plan overlay preview and explicit sync.
- **Question/problem:** Does Phase 1 change live audience output behavior?
  - **Approved behavior:** No. Continue using the existing overlay persistence and live presentation path without introducing a new audience-output behavior.
  - **Approval source/date:** Product-owner request, 2026-10-18.
  - **Affected workflow/contract:** Native saved-plan overlay sync and live presentation.

## Implementation references

- Entry point: `client/src/pages/Services/ServicePlanContentPanel.tsx`, `client/src/pages/Controller/useCurrentServicePlanSource.ts`, and `client/src/pages/Controller/ServicePlanningSyncFloatingWindow.tsx`
- Implementation: `server/teamsAuthHandlers.js` (`getServicePlanAssignments` projection), `client/src/integrations/servicePlanning/mapNativeServicePlanParticipants.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.ts`, `client/src/hooks/useServicePlanningImport.ts`, `client/src/hooks/useServicePlanningSync.ts`, `client/src/integrations/servicePlanning/servicePlanningOverlayClone.ts`
- Tests: `server/teamsApi.test.js`, `client/src/integrations/servicePlanning/mapNativeServicePlanParticipants.test.ts`, `client/src/integrations/servicePlanning/findBestOverlayMatch.test.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.test.ts`, `client/src/hooks/useServicePlanningImport.test.ts`, `client/src/pages/Controller/useCurrentServicePlanSource.test.tsx`, and `client/src/pages/Controller/ServicePlanningSyncFloatingWindow.test.tsx`

## Technical design notes (current implementation; not product requirements)

- Native event labels are lowercased and repeated whitespace is collapsed before exact comparison. Native matching has no fuzzy fallback; duplicate exact target overlays are ambiguous and skipped. URL imports retain their legacy fuzzy fallback and first-exact behavior.
- Repeated native participants claim available overlays in assignment order. When there is no unclaimed exact match, the existing template clone/create behavior is shown in the preview and used only after explicit sync.
- Existing-overlay updates patch mapped fields (`name`, `title`, `event`) and leave other overlay properties intact. Preview and execution share the matcher; execution reads the current overlay list before acting.
- Participant projections are revision-bound to the saved plan they read; a schedule refresh that sees a newer plan revision reloads the plan before rebuilding its preview.
- Legacy `servicePlanSource`, `servicePlanBaseline`, and `servicePlanOverrides` fields may remain in stored documents for compatibility. Current matching and explicit-sync behavior do not consult them.
