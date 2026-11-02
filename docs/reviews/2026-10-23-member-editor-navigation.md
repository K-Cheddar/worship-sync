# Member editor navigation review — 2026-10-23

Scope: fix verification and workflow review of editor dismissal, explicit return, history, dirty drafts, and pending saves. This is not a release-wide production-readiness review.

## Findings

Remaining Critical / High / Medium / Low findings in the changed workflow: None.

Root cause: `MemberManager.cancelEditing` called `finishEditing(reset)` when return context existed. The same handler owned both the footer's Close/Cancel and the contextual Back action. Consequently, a panel dismissal became a route exit. `TeamManager` contained the same coupling.

The correction keeps dismissal local and gives contextual Back its own guarded handler. Member dismissal reuses `updateMemberEditRoute` to remove only `editMember` and `teamId` with history replacement. Search, filters, other query parameters, return state, and the existing list scrollport survive. Only the open form or the closed list renders the return action. Back is disabled during the current global member save; scoped saves continue to use the existing navigation guard. Background member editing and save completion ownership are preserved.

`finishEditing` now consumes both session storage and the source history entry's return metadata before pushing the destination. Browser Back retains the source URL and unrelated state without reviving the consumed return action. No navigation abstraction, data shape, API, or permission change was introduced.

The production delta remains local: separate handlers, conditional placement, an optional disabled prop on the existing return controls, and history-state cleanup. Most added lines are regression coverage and review documentation.

## Product authorization status

Authorized: the current Member Editor Navigation and Navigation Antipatterns request specifies local Close/Cancel, explicit Back, preserved list context, save guards, consumed return metadata, the sibling audit, and reusable guidance. These decisions are recorded in `docs/features/team-roster.md` and `docs/features/responsive-navigation.md`, with a link from Church Administration navigation. Existing save, archive, permission, and persistence behavior is otherwise retained.

## Open questions / assumptions

No unresolved decision blocks the requested fix. Existing contextual labels such as “Back to Worship” are retained.

## Navigation audit

| Area | Evidence and disposition |
| --- | --- |
| Members | Confirmed Close/Cancel-to-origin defect fixed; list return action retained; hidden-form duplicate removed. |
| Teams | Confirmed matching defect fixed; local dismissal and explicit Back now have separate guarded handlers. |
| Positions, Team Roles, Qualifications | Existing Cancel handlers already call `requestDiscardAction(reset)` separately from `returnToOrigin`; no matching dismissal-routing fix needed. |
| Schedules and Forms | Schedule form Cancel discards local form state; drawer/modal dismissal closes local state. Schedule return is an explicit Back control. No matching defect found. |
| Services | Inspected editor, picker, import/conflict review, template, email, and preview close/cancel paths, including callers in Teams Plans. These dismiss local content or abandon the current operation; no origin-driven Close/Cancel routing found. |
| Church Administration | Access-sheet `handleClose` checks saving, clears its draft, and closes the sheet; setup/delete modal dismissals clear local state. No matching routing defect found. |
| Archive success (broader workflow observation) | Member, Team, Position, TeamRole, and Qualification managers call `finishEditing(reset)` after successful archive, so an origin can cause return navigation. This is outside the ordinary Close/Cancel/Save correction. The roster contract explicitly leaves archive workflows unchanged. Whether archive should return needs a separate product decision; existing code is not proof of intended behavior. No archive refactor was made. |

## Verification gaps

Final verification status: all required checks passed.

Production-context review: **Pass**. `App.tsx` uses HashRouter. `TeamsAndServices` composes `TeamsPageProvider` and `TeamsNavigationGuardProvider`, then lazy routed Groups and Members pages. Members derives global/scoped permissions and filters scoped team data before mounting its manager. New tests exercise Manage, Close, a second member, and explicit Back through these actual routed pages for both administrator and scoped-manager contexts. API/auth responses remain controlled fixtures; this is not a live server authorization test. The standalone scoped workflow fixture was corrected to match production's filtered team data.

| Invariant | Adversarial transition | Code and test evidence | Result |
| --- | --- | --- | --- |
| Dismissal retains identity and list context | Team-origin member → search/filter/scroll → Close → another member → dirty Cancel → Stay/discard → explicit Back | `cancelEditing`, `updateMemberEditRoute`, MemberManager return-navigation tests; real-route administrator/scoped tests | Pass |
| Saving never becomes an implicit exit | Hold member save → attempt Back/Close → settle save → remain in Members → explicit Back | Deferred global save in MemberManager tests; deferred scoped profile save and guard dialog in TeamManager permissions test | Pass |
| Old work cannot replace a new editor | Save A → open B → resolve A; switch team/church while profile load is pending | Existing full MemberManager lifecycle tests retained and run | Pass |
| Return metadata is consumed once | Explicit Back → browser Back → browser Forward | `finishEditing`; MemoryRouter and production HashRouter history tests preserve source query/unrelated state and verify storage cleanup | Pass |
| Remount/reload cannot cause automatic return | Close → unmount → remount with state, or simulated reload using stored context → reopen member | MemberManager parameterized remount/reload tests; stale persisted-context hook test | Pass |

Executed verification:

- Nine full affected Jest suites: **258 tests passed**. Selection: `MemberManager.test.tsx`, `TeamManager.navigation.test.tsx`, `TeamManager.permissions.test.tsx`, `useTeamsReturnNavigation.test.tsx`, `PositionManager.navigation.test.tsx`, `TeamRoleManager.navigation.test.tsx`, `teamsReturnNavigation.test.ts`, `TeamsNavigationGuardContext.test.tsx`, and `TeamsAndServices.test.tsx`, all under `client/src/pages/Teams/` (manager/hook subdirectories as named).
- New real-route cases after their addition: `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx --testNamePattern='keeps Member Close'` — **2 passed**.
- Final full rerun of `MemberManager.test.tsx`, `TeamManager.navigation.test.tsx`, `TeamManager.permissions.test.tsx`, and `useTeamsReturnNavigation.test.tsx` using `npm.cmd test --prefix client -- --runInBand --runTestsByPath` with their paths — **108 passed**.
- `npm.cmd run lint:check --prefix client` — passed with zero warnings.
- `npm.cmd run type-check --prefix client` — passed.
- `git diff --check` passed.

Optional confidence checks not performed: live browser/Electron click-through, live API testing, and exhaustive client/server suites. No runtime display, sync, IPC, or server code changed.

## Pattern / learning opportunities

The existing code-review skill now explicitly checks dismissal versus navigation and consumption of return metadata. The shared navigation contract defines Close, Cancel, Back, Save, return context, and documented workflow exceptions. The existing team-membership release note describes the completed operator outcome.

## Final readiness

Ready for the stated fix-verification and workflow-review scope. No required follow-up remains. Archive-success return behavior is reported separately as an optional broader product review.

- Cross-boundary review performed: Yes — route identity, history/session storage, async save ownership, and remount boundaries.
- Sibling-pattern search performed: Yes — Teams, Services, Church Administration, and all `finishEditing` callers.
- Legacy/persisted-state compatibility reviewed: Yes — unchanged return-state shape and reload-only fallback; consumed source state preserves unrelated fields.
- Identity-switch test reviewed or added: Yes — another-member, pending save, team/church/profile identity tests.
- Unmount/lifetime test reviewed or added: Yes — MemberManager remount/reload and existing stale-request cases.
- Contract round trip traced: Yes — Manage origin → route state/storage → Members → explicit return → team restore state → original team editor.
- Validate/use security boundary reviewed: Yes — production scoped projection and unchanged authorization paths compared with fixtures; no new authorization behavior.
- Retry-state authority reviewed: Not applicable — no retry or durable mutation behavior changed.
- Owner-retirement handoff reviewed: Not applicable — no new background owner or handoff; existing save ownership tests retained.
- External side-effect adoption/compensation reviewed: Not applicable — no external side effects introduced or changed.
- Authorization/data-projection reviewed: Yes — global and scoped page composition and tests.
- Production entry point, runtime context, and test composition compared: Yes — actual routed page cases plus HashRouter history coverage.
