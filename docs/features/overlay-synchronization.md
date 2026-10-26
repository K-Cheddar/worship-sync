# Feature Contract: Service-plan overlay synchronization

**Contract status:** Confirmed for the Phase 1 native service-plan path. Legacy URL-import behavior and existing live-output behavior remain unchanged.

**Approval source:** Product-owner requests, 2026-10-10, 2026-10-18, 2026-10-23, and 2026-10-25; the native-path decisions are recorded under **Product decisions**.

**Last reviewed:** 2026-10-25

## Purpose

Refresh reusable participant overlays for a service plan. An overlay represents an event or role, such as Sabbath School Host or Scripture Reading, and can be reused across plan occurrences.

## Operator workflow

For a native saved plan, items with people assigned in **Led by** automatically contribute participant overlays. An operator can optionally set each reusable event label in Services, then expands the Controller overlay preview and chooses **Sync Overlays** or **Sync All**. Sync All synchronizes both eligible overlays and the service outline. Native plans do not need legacy People entries or element rules; existing element rules apply to native event labels when present. The URL importer continues to use its existing mapping rules.

## Confirmed product outcomes

- A previous plan association does not prevent reuse of an overlay for the same event or role in a later plan.
- Manual edits to mapped values remain until an explicit sync. An explicit sync replaces mapped values with the current plan values.
- Native items with assigned participants are included automatically. Items without people, including microphone-only slots, contribute no participant overlays. Existing plans work without migration or resaving; previously saved `participantOverlay.enabled` values are ignored.
- Native assignees with `memberId` resolve to the current Teams member name, including the optional prefix, and the member's `TeamRole.name`. A known item team context scopes role lookup; ambiguous or unavailable roles leave the title blank and show a preview notice.
- Free-text guests without a Teams member ID keep their entered name and receive a blank title.
- Native event labels use the per-item override first, then a matching integration rule's effective event label and configured split suffixes, then the item title. Rules match the original `sourceElementTypeRaw` when available, otherwise the item title (falling back to the internal type for an empty title). A matching rule with `overlaySyncEnabled === false` excludes the item; unmatched items remain automatically eligible. Repeated item labels and repeated overlays are eligible for deterministic one-to-one matching; native overlay matching does not use fuzzy person or event matching.
- The overlay preview starts collapsed with summary counts visible. Expanding it shows names, titles, event labels, and planned update, clone, create, and skip actions before an explicit sync.
- Native roster data comes from a plan-scoped, contact-free server projection for items with assigned people. A restricted or failed lookup is distinguishable from an empty assignment and cannot produce executable overlay changes.
- The participant projection carries the saved plan revision it read. If separate plan and assignment requests return different revisions, the Controller treats participant details as unavailable and blocks syncing until a refresh returns a matching revision.
- The existing overlay sync runner, persistence path, explicit action boundary, and live audience behavior are retained. Updating a participant overlay continues to patch only mapped name, title, and event fields, preserving unrelated formatting and properties.

- If refreshing the selected saved plan fails, keep the last preview available for review but block overlay and outline sync until a successful refresh (owner decision, 2026-10-19, carried from in-progress-2).

## Important scenarios

| Scenario | Confirmed outcome | Current implementation | Status |
| --- | --- | --- | --- |
| Same event in a later plan | Reuse the event/role overlay across plan occurrences, regardless of its previous plan association. | Matcher ignores legacy plan-source fields. | Confirmed |
| Manual edit to a mapped value | Keep it until explicit sync; then apply the current plan value. | Explicit sync replaces mapped `name`, `title`, and `event` only. | Confirmed |
| Native inclusion and roster resolution | Automatically include items with assigned people; resolve current Teams names and role titles in assignment order; preserve guest names; expose no contacts or unrelated roster. | Controller receives only assigned items' contact-free name/role projection. | Confirmed |
| Native event matching | Use item override, matching integration rule event/split suffixes, then item title; reserve exact participant/song matches across all candidates before assigning remaining same-event slots in stable order. | Native overlay matching is normalized exact matching only. Legacy URL matching remains unchanged. | Confirmed |
| No available overlay / repeated participants | Keep the existing explicit-sync clone/create path and preview its actions; repeated participants consume distinct overlays in order. | Shared batch planner reserves distinct current-list or saved-library matches, then uses the existing clone/create path when slots are exhausted. | Confirmed for Phase 1 |
| Active participant overlay | Preserve the existing live-output behavior. | Phase 1 uses the existing persistence and overlay update path without adding a new live-output action. | Confirmed as unchanged |

## Native matching and preservation (confirmed 2026-10-25)

The current product-owner request replaces the earlier Phase 1 duplicate-label rejection:

- Only sections in the effective `main` phase contribute overlay candidates. As in the section editor, an omitted phase defaults to `main`. `pre` and `post` items produce no overlay operations; outline synchronization is unchanged.
- Reserve exact normalized event/participant-name matches (plus the song title for songs) across the batch first, then remaining song-title identities within that exact event, then remaining same-event slots in stable occurrence order. Participant role titles are updated fields, not slot identity. Prefer current-list matches at each priority; each slot can serve at most one candidate.
- Search the saved overlay library before creating a new slot. Copy library-only matches with a new identity and their saved formatting and unrelated configuration, leaving source overlays and other lists untouched. Exhausted event slots may supply a clone template.
- Participant names and configured linked Teams role titles come from the contact-free projection; guests retain their names and a blank title. Song overlays use the attached song title rather than the generic item heading or a Teams role. A song without a usable song title is skipped with a specific explanation.
- Preview, readiness, and run preparation use the same batch planner. A run freezes its target decisions before execution; native steps validate their assigned target instead of rematching after earlier writes. Repeated sync and partial-failure retry re-evaluate the complete batch against current overlays so durable earlier work is reused.
- Updates preserve existing IDs and patch only name, title, and event through the existing conflict-retrying persistence helper. Blank participant titles intentionally clear stale titles. Formatting and unrelated fields remain intact.
- Sync never deletes, removes, hides, clears, or cleans up unused overlays in the controller list or saved library. Live audience output and the legacy URL import rules remain unchanged.

**Approval source/date:** Current user request, 2026-10-25.

Regression coverage: `mapNativeServicePlanParticipants.test.ts`, `findBestOverlayMatch.test.ts`, and `useServicePlanningImport.test.ts` (production hook with Controller/Global contexts, Redux reducers, and persisted library reads; includes repeated sync, partial failure, database switch, and unmount).

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
  - **Approved behavior:** Automatically include items with assigned participants (the October 23 request supersedes the October 18 opt-in requirement). Resolve current Teams member names (including prefix) and `TeamRole.name` through the assigned member's membership; use the item's position IDs only to identify team context. Preserve guests as names with no title. An ambiguous, archived, missing, or unavailable role produces a blank title and a preview notice; unresolved member IDs are skipped.
  - **Approval source/date:** Product-owner requests, 2026-10-18 and 2026-10-23.
  - **Affected workflow/contract:** Native saved-plan overlay preview and explicit sync.
- **Question/problem:** How should native event labels and duplicate matches behave?
  - **Approved behavior:** Use an explicit per-item event label first, then the existing integration rule's effective event label and split suffixes, then the item title. Match rules against the original source element type when available, otherwise the native item title. Honor a matching rule's disabled overlay sync flag without requiring unmatched items to opt in. Split suffixes apply in assignment order and repeat only when `repeatLastEventSuffix` requests it; overrides receive no rule suffix. Teams projection remains authoritative for names and titles. Match normalized overlay labels exactly. Skip every eligible native item sharing a duplicate event label and skip when more than one saved overlay has the exact target label. Legacy URL imports retain their existing behavior.
  - **Approval source/date:** Product-owner requests, 2026-10-18 and 2026-10-23 (Native Overlay Event Mapping and Preview Default).
  - **Affected workflow/contract:** Native saved-plan overlay preview and explicit sync.
- **Question/problem:** Should the overlay preview initially occupy space for participant details?
  - **Approved behavior:** Start collapsed, retaining summary counts and the existing expand/collapse control.
  - **Approval source/date:** Product-owner request, 2026-10-23 (Native Overlay Event Mapping and Preview Default).
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
