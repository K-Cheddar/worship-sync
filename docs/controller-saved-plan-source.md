# Controller saved Service Plans: implementation and review

## Checkout correction

The completed work was transferred to `worship-sync` on `in-progress` at the user's request. Selective corrective commit `58c32c8b` on `in-progress-3` removes the misplaced committed changes without rewriting history or changing unrelated Song v2 work. The target's newer library/cache and lifecycle changes were retained; the new preview test uses the target's `allDocs` document cache. Pre-existing target edits were verified byte-for-byte unchanged. The transferred work is uncommitted in the target checkout.

## Goal

Use saved Services plans as the Controller's plan source and keep presentation changes explicitly operator-triggered.

## Existing architecture

`useCurrentServicePlanSource` owns automatic/manual selection, authoritative reads, SSE/reconnect reconciliation, and freshness. `useServicePlanOutlinePush` uses the pure native planner; `useServicePlanningImport` supplies shared saved-plan and overlay utilities. Credits Editor also reads historical outline imports.

## Before behavior

Configurations and the floating window offered separate URL imports. An explicit URL selection could override the saved plan. The retired workspace's outline summary used legacy matching.

## After behavior

The Controller selects saved plans only. Legacy navigation redirects home, remembered configuration links fall back to Preferences, and the floating window shows a collapsed native Outline preview alongside existing overlay preview/results.

## Product Decision Check

Authorized by the October 27, 2026 user request and recorded in `features/service-plan-import.md`. Services owns imports; saved plans own Controller previews; syncing remains manual. No unresolved consequential choices.

## Behavior intentionally unchanged

Services URL/account/PDF imports; native insertion and overlay synchronization rules; progress/cancellation; permissions; independent controllers; outline bindings and stored historical content. Credits Editor retains its historical restoration behavior. Controller rendering and sync eligibility exclude historical URL previews.

## Acceptance criteria

- No Controller import controls or legacy workspace.
- Current/manual saved-plan selection, live reconciliation, reconnect, errors, and stale-response safety remain functional.
- Native attachment identities, already-present items, unresolved references, and placement appear in Outline preview.
- Explicit outline/overlay/combined sync stays idempotent and preserves existing content.

## Proposed implementation

Remove obsolete URL controls/state/loader and Controller lifecycle restoration. Retain the shared preview/overlay utilities and Credits restoration. Extend the native planner result with preview entries; render those entries in a small collapsible component. No database migration, new import architecture, or display renderer changes.

## Affected surfaces

Main Controller, floating window, toolbar/preferences/route guard, shared import state/hook, and native planner. Inspected real main/overlay/Credits/auxiliary entry points, active-controller contexts, service permissions, controller database context, and canonical song-library selectors. Browser/Electron share these paths; no IPC, server, or display-output changes.

## Risks / edge cases

Stored URL previews, no saved plan, deleted/inaccessible plans, failed refreshes, scope changes during requests, duplicate attachments, legacy push IDs, unresolved references, and missing headings. The existing generation/owner/freshness gates remain; native sync execution is unchanged.

## Questions requiring user input

None.

## Verification

Required: focused source/window/native-sync/navigation/reducer tests; shared hook/lifecycle and Credits/overlay/auxiliary consumers; full Services editor tests; client type checking and lint. The floating-window suite opens deferred controls and checks responsive picker behavior. The new summary test uses real Redux/library selectors, expands the preview, changes library/outline inputs, and asserts no presentation mutations from plan changes. Browser/Electron visual smoke testing is optional additional confidence.

Executed successfully in `worship-sync` after transfer: 500 tests across these 18 Jest files (run with `npm.cmd test --prefix client -- --runInBand --silent`, in focused groups):

```text
src/components/ControllerViewRouteGuard/ControllerViewRouteGuard.test.tsx
src/containers/Toolbar/Toolbar.test.tsx
src/hooks/useServicePlanningImport.test.ts
src/pages/AuxController/AuxControllerRoute.test.tsx
src/pages/Controller/ControllerServicePlanView.test.tsx
src/pages/Controller/ServicePlanOutlinePreview.test.tsx
src/pages/Controller/ServicePlanningSyncFloatingWindow.test.tsx
src/pages/Controller/useControllerPageLifecycle.test.tsx
src/pages/Controller/useCurrentServicePlanSource.test.tsx
src/pages/Controller/useCurrentServicePlanSource.stale.test.tsx
src/pages/Controller/useServicePlanningSyncRunner.test.tsx
src/pages/CreditsEditor/__tests__/CreditsEditor.test.tsx
src/pages/OverlayController/OverlayController.test.tsx
src/pages/Services/ServicePlanEditor.test.tsx
src/pages/Services/servicePlanOutlineBridge.test.ts
src/pages/Services/useServicePlanOutlinePush.test.tsx
src/store/preferencesSlice.test.ts
src/store/servicePlanningImportSlice.test.ts
```

`npm.cmd run type-check --prefix client`, `npm.cmd run lint:check --prefix client`, and `git diff --check` passed. The window/summary suites were rerun after final fixture and refresh-feedback changes. This was focused verification, not the complete client suite.

# Workflow review

## Findings

Critical: None. High: None. Medium: None. Low: None remaining after correcting fixture types and requiring saved-plan details for native Sync Outline.

## Product authorization status

Authorized: all observable changes follow the current request. The feature contract records ownership, redirects, historical-data preservation, and explicit synchronization.

## Open questions / assumptions

No open product decisions. Historical shared data may remain available to Credits Editor, but cannot render as the Controller source or enable its sync controls.

## Verification gaps

Production-context check: Pass by entry-point inspection and representative context/store tests. New UI uses existing React/Redux/global contexts and native planner inputs; no new provider or portal requirement. Main, overlay, Credits, and auxiliary call sites were inspected. Physical browser/Electron visual smoke testing was not performed.

| Invariant | Controlled transition | Code/test evidence | Result |
| --- | --- | --- | --- |
| Saved plan remains authoritative | Restore URL state after saved-plan selection; change target binding | `useCurrentServicePlanSource` reconciliation; both source suites | Pass |
| Old requests cannot replace new scopes | Church/controller/outline or selected-plan switch during pending reads | Existing generation and owner guards; source stale tests and native push interruption tests | Pass |
| Preview agrees with native sync | Same song attached twice; one already present; invalid song/scripture/custom references; missing mapped heading; repeat sync | Native planner preview regression and existing bridge/push tests | Pass |
| Services updates do not present content | Plan/library preview updates before explicit sync | Source live-update tests and `ServicePlanOutlinePreview.test.tsx` | Pass |
| Independent consumers retain behavior | Credits restoration, overlay-only use, auxiliary outline-only controller | Shared reducer, Credits/overlay/auxiliary suites and scoped source tests | Pass |

Review scope: workflow review of this change, not a release-wide production-readiness review. Exact executed checks and outcomes are reported in the task handoff.

## Pattern / learning opportunities

Keep preview and commit on one pure planner. No new enforcement or policy is needed.

## Final readiness

Ready for the reviewed workflow scope. Required checks passed.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; inspected all floating-window consumers and historical restoration writers.
- Legacy/persisted-state compatibility reviewed: Yes; no durable data deletion or migration.
- Identity-switch and unmount/lifetime tests reviewed: Yes; existing source/push suites retain controlled interruptions.
- Contract round trip traced: Yes; saved plan to shared preview to native outline push/overlay sync.
- Validate/use security boundary reviewed: Yes; existing service permissions and owner/freshness gates retained.
- Retry-state authority reviewed: Yes; saved-plan refresh and attachment-level insertion remain authoritative/idempotent.
- Owner-retirement handoff reviewed: Not applicable; no new long-lived operation/action ownership.
- External side-effect adoption/compensation reviewed: Not applicable; no changed external creation/deletion workflow.
- Authorization/data-projection reviewed: Yes; existing service/participant access gates unchanged.
- Production entry point, runtime context, and test composition compared: Yes.
