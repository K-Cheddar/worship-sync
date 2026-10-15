# WorshipSync browser smoke coverage

Run the lightweight authenticated browser suite with:

```powershell
npm.cmd run test:e2e:smoke
```

The smoke project uses the saved `playwright/.auth/worshipsync-user.json` state and the existing auth setup check. Setup validates that the session is reusable; it does not run the explicit auth refresh command or request a verification email. A worker-scoped browser context keeps synchronized IndexedDB/PouchDB data available to fresh pages across the four cases. Run only against isolated disposable test-church data, with `E2E_SMOKE_DISPOSABLE_CHURCH_ID` set to that church ID and a matching saved account. The fixture rejects church-scoped API traffic for any other church.

This suite is **not read-only**. Opening Schedules with edit permission runs `ensureActiveSchedule`: it can create a generated schedule, add newly configured occurrences to an existing schedule, and write occurrence ownership claims. These automatic writes can happen in both visited periods. Controller startup can also synchronize local PouchDB/IndexedDB state. Tests do not explicitly save team edits, assign members, publish schedules, or send messages. Use a separate test account and church with no real recipients; dispose of its data after the run.

## Intended core coverage

- Open the authenticated app and move between the Presentation controller and Teams and Services workspace.
- Load dated Services, open a saved service plan, and check its plan view and primary controls.
- Load Teams, open an existing team, and check its position and member UI.
- Load scheduling for a selected period, move to the next period (which may have no occurrences) and back, and verify the original schedule controls return.

## Covered now

| Area | Smoke coverage |
| --- | --- |
| Core navigation | Home to Presentation controller, then back to Home and into Teams and Services |
| Services | Service results and plan status finish loading; open a dated saved plan and verify plan view, summary, and return control |
| Teams | Open the first active row with an accessible Edit button and verify position and member-related UI |
| Scheduling | Check the selected date range, next-period change, accept the explicit no-occurrences state in the next period, return to the original range, and check loaded schedule controls |

The deeper Presentation Controller suite remains separate under `npm run test:e2e:controller`.

## Future categories

These categories are intentionally not implemented in Phase 1:

- Service templates
- Members
- Equipment
- Forms
- Messages
- Song editing
- Schedule assignments
- Service-plan editing

## Environmental prerequisites

- Run from the repository root with the configured local WorshipSync Vite/server environment available at `E2E_BASE_URL`.
- Provide the matching `E2E_TEST_EMAIL` and saved auth state under `playwright/.auth/`; the state must match the configured app origin and account.
- The saved account needs access to the Presentation controller, Teams and Services, and edit access to at least one active team.
- Set `E2E_SMOKE_DISPOSABLE_CHURCH_ID` to the isolated disposable church used by the saved account. Never point this suite at a live church.
- The connected church needs at least one dated service with a saved plan, one active team, and a schedulable service occurrence with positions in the selected period. Missing required records or permissions fail with an explicit prerequisite message; tests do not silently skip.
- The first browser context may perform one cold PouchDB synchronization. Data and replication checkpoints are reused between smoke cases in that run; a later command starts a new context and may synchronize again.
