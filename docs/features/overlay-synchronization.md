# Feature Contract: Service-plan overlay synchronization

**Contract status:** Mixed. Only the outcomes under **Confirmed product outcomes** are owner-confirmed; matching, creation, and live-output behavior remain unresolved. Implementation notes below describe current behavior and are not product approval.

**Approval source:** Product-owner requests, 2026-10-10 and 2026-10-19; the approved outcomes are recorded under **Product decisions**.

**Last reviewed:** 2026-10-19

## Purpose

Refresh reusable participant overlays for a service plan. An overlay represents an event or role, such as Sabbath School Host or Scripture Reading, and can be reused across plan occurrences.

## Operator workflow

Current UI observation: operators maintain participant overlays and mapping rules, load a service plan, then choose **Sync Overlays** or **Sync All**. The available UI and its implementation do not independently establish the intended behavior of matching, creation, or live output.

## Confirmed product outcomes

- A previous plan association does not prevent reuse of an overlay for the same event or role in a later plan.
- Manual edits to mapped values remain until an explicit sync. An explicit sync replaces mapped values with the current plan values.
- If refreshing the selected saved plan fails, keep the last preview available for review but block overlay and outline sync until a successful refresh.

## Important scenarios

| Scenario | Confirmed outcome | Current implementation observation | Status / open question |
| --- | --- | --- | --- |
| Same event in a later plan | Reuse the event/role overlay across plan occurrences, regardless of its previous plan association. | Matching does not use the legacy plan-source fields. | Confirmed by the product decision below. |
| Manual edit to a mapped value | Keep it until explicit sync; then apply the current plan value. | The sync patch covers mapped `name`, `title`, and `event` fields. | Confirmed by the product decision below. |
| Selected plan refresh fails | Keep the last preview visible for review and disable overlay and outline sync until a refresh succeeds. | The controller retains the prior preview, marks it stale, and disables sync actions. | Confirmed by the product decision below. |
| Matching and ambiguity | No product decision specifies normalization, fuzzy fallback, tie handling, or which duplicate event entry to use. | Configured events use case/whitespace-normalized exact matching. Fuzzy matching is used only when no event is configured; equal best fuzzy matches are skipped. Repeated candidates claim available overlays in list order. | Unresolved; see Product decisions. |
| No available match / repeated role | No product decision specifies whether sync may create or clone overlays. | The current path clones an exact-event template or creates a participant overlay when it finds no match. | Unresolved; see Product decisions. |
| Active participant overlay | No product decision specifies whether sync should affect an overlay currently shown to the audience. | The sync path updates the reusable overlay list and writes persisted overlay documents when the Pouch database is available; this contract does not treat that implementation path as approval of the live-output outcome. | Unresolved; see Product decisions. |

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
- **Question/problem:** May an operator sync a selected saved plan after its live refresh fails?
  - **Approved behavior:** Keep the last plan preview visible for review, but disable overlay and outline sync until a later refresh succeeds.
  - **Why:** A preview from before a plan update may contain outdated participants or content; sync must use successfully refreshed plan data.
  - **Material alternative rejected:** Allow sync from the retained preview while the church's live plan data is unavailable.
  - **Approval source/date:** Current user request, 2026-10-19.
  - **Affected workflow/contract:** Service-plan overlay and outline sync.
- **Question/problem:** What matching policy should determine which saved overlay receives a participant's values?
  - **Unresolved options:** Keep the current exact-event and fuzzy fallback rules, or require an explicit mapping/operator resolution when the configured event does not identify one overlay. The current rules can select a different saved record when labels collide or are incomplete; requiring resolution can leave a participant unsynced until an operator fixes the mapping.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.
- **Question/problem:** May synchronization create or clone overlays when no unclaimed match is available?
  - **Unresolved options:** Keep automatic template cloning/creation, which prepares more participants but adds saved overlays, or skip and require operators to create/map overlays first, which avoids automatic records but leaves those participants unsynced until setup is complete.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.
- **Question/problem:** Should syncing an overlay that is currently being shown to the audience change the live output?
  - **Unresolved options:** Keep sync scoped to saved overlays, or have a matching active overlay reflect the new mapped values immediately. The former avoids a service-time display change; the latter makes the on-air overlay reflect the updated plan without another operator action.
  - **Affected workflow/contract:** Weekly service-plan overlay sync and live presentation.

## Implementation references

- Entry point: `client/src/pages/Controller/ServicePlanningImportPanel.tsx` and `client/src/pages/Controller/ServicePlanningSyncFloatingWindow.tsx`
- Plan freshness: `client/src/pages/Controller/useCurrentServicePlanSource.ts`
- Implementation: `client/src/integrations/servicePlanning/findBestOverlayMatch.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.ts`, `client/src/hooks/useServicePlanningImport.ts`, `client/src/hooks/useServicePlanningSync.ts`, `client/src/integrations/servicePlanning/servicePlanningOverlayClone.ts`
- Tests: `client/src/integrations/servicePlanning/findBestOverlayMatch.test.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.test.ts`, `client/src/integrations/servicePlanning/servicePlanningOverlayClone.test.ts`, `client/src/hooks/useServicePlanningImport.test.ts`

## Technical design notes (current implementation; not product requirements)

- Event labels are lowercased and repeated whitespace is collapsed before exact comparison. Fuzzy matching scores planning text against event labels only when the plan has no configured event label; equally scored best matches are treated as ambiguous and skipped.
- Exact duplicate event labels resolve to the first available overlay in list order. The sync run excludes IDs already claimed by another candidate, so repeated roles can target distinct existing overlays.
- Existing-overlay updates patch mapped fields (`name`, `title`, `event`) and leave other overlay properties intact. Preview and execution share the matcher; execution reads the current overlay list before acting.
- If no match is found, the current implementation clones a matching event template or creates a participant overlay. Placement follows the existing clone/create path.
- Legacy `servicePlanSource`, `servicePlanBaseline`, and `servicePlanOverrides` fields may remain in stored documents for compatibility. Current matching and explicit-sync behavior do not consult them.
