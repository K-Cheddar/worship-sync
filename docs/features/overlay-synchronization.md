# Feature Contract: Service-plan overlay synchronization

**Contract status:** Confirmed product intent

**Approval source:** Current product request, 2026-10-10

**Last reviewed:** 2026-10-10

## Purpose

Service-plan synchronization refreshes reusable participant overlays for the current service. An overlay represents an event or role, such as Sabbath School Host or Scripture Reading, rather than one occurrence of that role in a particular weekly plan.

## Operator workflow

Operators maintain an ordered list of participant overlays and mapping rules. They load a service plan and choose **Sync Overlays** or **Sync All**. Manual edits remain in place until a later explicit synchronization.

## Expected behavior

- Match participant overlays by the configured event label, normalized for case and repeated whitespace. A previous plan association does not prevent an event match.
- Prefer an exact configured event match. When a repeated role has multiple candidates, assign distinct matching overlays in their existing list order.
- When no event label is configured, use a unique best fuzzy match. If equally strong matches remain, leave the candidate unresolved and explain that the event mapping needs attention.
- An explicit sync applies the current incoming values to mapped name, title, and event fields, including values that replace manual edits.
- Updating an overlay preserves its ID, list position, formatting, and unrelated fields. New overlays are created only when no suitable unclaimed match exists; existing insertion behavior remains in effect.
- Repeating **Sync Overlays** or **Sync All** updates the same reusable overlays and does not create copies.
- Preview and execution use the same event matching rules. Execution rechecks the current overlay list before updating or creating.
- Sync changes the overlay list and persisted overlay documents. It does not change the active participant overlay being shown to the audience.

## Behavioral boundaries

- Legacy `servicePlanSource`, `servicePlanBaseline`, and `servicePlanOverrides` fields may be present in stored overlay documents. They are compatibility data only and do not own an overlay, protect manual text from an explicit sync, or change event matching.
- Synchronization changes only fields produced by the configured mapping. Formatting, timing, and other overlay settings remain operator-owned.
- A new event uses the existing insertion behavior; established overlays keep their relative order.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | A saved overlay for an event is updated from the current plan even when the plan ID changes. | `buildServicePlanningPreview` and `findOverlayForServicePlanningCandidate`; weekly-plan regression test. | Confirmed by current request |
| Repeated explicit action | Re-running either sync action reuses the same event overlays. | Shared Controller preview and `executeOverlaySyncStep`; repeat-sync regression coverage. | Confirmed by current request |
| Manual change | A manual mapped-field edit remains until explicit sync; sync then applies the mapped plan value. | Overlay editor persists values directly; sync patch applies mapped fields. | Confirmed by current request |
| Missing or ambiguous data | An exact event label is preferred. An ambiguous fuzzy match is not assigned arbitrarily. | Preview marks ambiguous matches as skipped with a reason. | Confirmed by current request |
| Multiple participants | Split and repeated roles use distinct existing overlays; additional participants may use the existing clone/create path. | Claimed overlay IDs and ordered list matching. | Confirmed by current request |
| Legacy data | Old source fields and overlays without those fields remain readable and match by event. | `OverlayInfo`, normalization, and legacy-data tests. No migration is required. | Confirmed by current request |
| Persistence and live output | Updated values survive persistence and list order is unchanged; sync does not put an overlay on air. | Pouch writer and overlay reducer tests; Controller sync action path. | Confirmed by current request |

## Product decisions

- **Question/problem:** Should a previous plan's source association block reuse of an overlay for the same event?
  - **Approved behavior:** No. Event/role identity is reusable across plan occurrences.
  - **Why:** Weekly service plans routinely assign new people to the same ordered set of reusable roles.
  - **Material alternative rejected:** Treating a source association as ownership of one overlay by one plan occurrence.
  - **Approval source/date:** Current product request, 2026-10-10.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.
- **Question/problem:** Should manually edited mapped values survive an explicit sync?
  - **Approved behavior:** No. Manual values stay until an explicit action; explicit sync replaces mapped values with the current plan values.
  - **Why:** Sync is an intentional operator action to refresh the current service.
  - **Material alternative rejected:** Preserve edited values across sync by comparing baselines and overrides.
  - **Approval source/date:** Current product request, 2026-10-10.
  - **Affected workflow/contract:** Weekly service-plan overlay sync.

## Implementation references

- Entry point: `client/src/pages/Controller/ServicePlanningImportPanel.tsx` and `client/src/pages/Controller/ServicePlanningSyncFloatingWindow.tsx`
- Implementation: `client/src/integrations/servicePlanning/findBestOverlayMatch.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.ts`, `client/src/hooks/useServicePlanningImport.ts`, `client/src/hooks/useServicePlanningSync.ts`, `client/src/integrations/servicePlanning/servicePlanningOverlayClone.ts`
- Tests: `client/src/integrations/servicePlanning/findBestOverlayMatch.test.ts`, `client/src/integrations/servicePlanning/buildServicePlanningPreview.test.ts`, `client/src/integrations/servicePlanning/servicePlanningOverlayClone.test.ts`, `client/src/hooks/useServicePlanningImport.test.ts`

## Technical design notes (separate from product requirements)

- `servicePlanSource`, `servicePlanBaseline`, and `servicePlanOverrides` are retained in the persisted TypeScript shape for compatibility with old documents. Current synchronization neither creates nor consults baseline/override state, and source metadata never filters matches.
- Updates are field patches against the latest Pouch document, so unrelated stored properties survive conflicts and concurrent changes.
