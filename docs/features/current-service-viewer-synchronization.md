# Feature Contract: Current Service Viewer synchronization

**Contract status:** Confirmed product intent

**Approval source:** Current request, 2026-11-02

**Last reviewed:** 2026-11-02

## Purpose

Keep the Current Service Viewer current during a live service across authorized browsers and paired workstations, including Electron clients.

## Operator workflow

An operator changes the authoritative service plan from the Service Workspace or Services editor. People viewing that service should see the updated item and timeline without reloading the page.

## Expected behavior

- Authorized human Services viewers and paired workstations with Services viewing or Service Workspace access receive current-service updates.
- A plan change invalidates only the affected plan. The viewer requests its current snapshot through the authenticated REST API and does not reconstruct plan state from an event.
- The server keeps service-plan state authoritative. The viewer preserves its last loaded plan during transient refresh failures and ignores older results after a newer refresh or service selection.
- When the live connection is healthy, the viewer reconciles periodically as a safety net. When it is disconnected or unavailable, it reconciles about every 45 seconds while visible. A successful connection or return after a meaningful background period triggers an immediate reconciliation.
- If the live subscription is unavailable while REST reads still work, the viewer indicates that live updates are delayed without presenting the whole application as offline.
- Browser and Electron paired workstations use the same authenticated stream and refresh behavior.
- Follow Live continues to track the current item when enabled. Intentional scrolling pauses following, and the existing control resumes it.

## Behavioral boundaries

- The Services event stream is church-scoped and authorizes with the existing Services view guard, including paired workstation permissions.
- Change events contain only the affected plan key and event type; church scope comes from the authenticated stream route. They do not contain plan documents, item content, roster/member information, or team assignments.
- Services access does not grant Teams stream, roster, or schedule permissions. Existing Teams stream consumers retain their event behavior.
- Service-plan persistence, the public service-share stream, and the existing Follow Live behavior remain unchanged.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Make Live or change live mode | Persist the new plan state, publish a plan-key invalidation, then refresh the active viewer from REST. | `server/teamsAuthHandlers.js`; `CurrentServiceViewer.test.tsx`; `server/teamsApi.test.js` | Confirmed by current request |
| Edit or remove a plan | Refresh only the matching active plan. A removal is confirmed through REST; a transient failure retains the prior loaded plan. | `CurrentServiceViewer.test.tsx`; `server/teamsApi.test.js` | Confirmed by current request |
| Services-only paired workstation | Subscribe successfully without broad Teams access; reject another church or a session without Services access. | `useServicePlanLiveSync.test.tsx`; `server/teamsApi.test.js` | Confirmed by current request |
| Disconnected stream or missed event | Reconcile while visible, then reconcile immediately after reconnect or meaningful resume. Ignore an older in-flight response. | `CurrentServiceViewer.test.tsx`; `useSyncOnReconnect.test.tsx` | Confirmed by current request |

## Product decisions

- **Question/problem:** Which permission boundary should authorize Current Service Viewer notifications?
- **Approved behavior:** Use the existing Services view permission, including paired workstation Services and Service Workspace access; keep the Teams stream restricted.
- **Why:** The viewer reads saved service plans, and Services access must not imply access to Teams roster or schedule data.
- **Material alternative rejected:** Requiring broad Teams access leaves authorized Services viewers without prompt updates and couples an unrelated permission to the viewer.
- **Approval source/date:** Current request, 2026-11-02.
- **Affected workflow/contract:** Current Service Viewer synchronization.

## Implementation references

- Entry point: `client/src/pages/CurrentServiceViewer.tsx`
- Implementation: `client/src/pages/Services/useServicePlanLiveSync.ts`, `client/src/utils/authenticatedSse.ts`, `server/teamsAuthHandlers.js`, `server/teamsSse.js`, `server.js`
- Tests: `client/src/pages/CurrentServiceViewer.test.tsx`, `client/src/pages/Services/useServicePlanLiveSync.test.tsx`, `server/teamsApi.test.js`, `server/teamsSse.test.js`

## Technical design notes

The Services stream uses `connectAuthenticatedSse` and sends plan-key invalidations. The viewer performs authenticated reads through `getServicePlanViewer`, preserves its cache and request-order guards, and uses one visibility-aware reconciliation timer. Existing `useSyncOnReconnect` handles online and foreground recovery.

## Manual verification

1. Pair one browser workstation and one Electron workstation with Services view access. For a second pass, pair one with Service Workspace access.
2. Open the same active service in Current Service Viewer on both clients. Confirm each stays connected without requiring Teams editing access.
3. From another authorized editor, use Make Live on successive items, pause/resume live progression, and return to the planned schedule. Confirm both viewers update the item and adjusted timeline promptly without a page refresh.
4. Block the `/services/stream` request temporarily in each client’s network tools. Confirm the loaded plan remains visible, the delayed-updates status appears, and a REST refresh catches up within about 45 seconds. Restore the request and confirm reconnect triggers an immediate refresh.
5. Change a different service plan and confirm it does not refresh the active viewer. Remove a disposable test plan and confirm the active viewer clears it after its REST refresh.
