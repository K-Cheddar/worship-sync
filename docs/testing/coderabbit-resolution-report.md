# CodeRabbit finding resolution

Implementation status: COMPLETE

Review scope: supplied findings and affected schedule, timezone, and browser-navigation workflows on `in-progress`. This is not an exhaustive production-readiness audit of all changes on the branch.

## Commit inspection

The clean local branch was two commits behind origin. A fetch followed by a fast-forward incorporated the exact supplied commits without creating a merge commit or rewriting them:

- `043b066ec9caed0d681bb2a925d82ff721c77b7a`: verified the persisted-document spread in `buildSchedule`, array conversion for imported occurrence locks, and stale-claim group normalization. The first two fixes were retained unchanged. Legacy group normalization needed two additional comparisons corrected.
- `7826b174d4b5784920ba76d830ac3490850a60b8`: verified guards before ensure, after ID remapping, inside the assignment queue, on failure, and at retry. Retained them and fixed sequence reuse, toast retirement, and retry lifetime.

No new commit, push, merge, or application deployment was performed. All implementation changes are local.

## Before behavior

The supplied commits fixed schedule metadata replacement and the missing imported-occurrence lock. Remaining problems included reusable edit sequence numbers after successful clears, orphaned shadow retry actions, inconsistent legacy group comparison, stale delayed refresh identity, virtual schedules being treated as persisted owners, and smoke assumptions that failed for scoped permissions or an empty period.

## After behavior

Operational schedule fields survive validated metadata edits; competing import/create operations leave one active occurrence owner. Superseded and unmounted shadow retry actions cannot issue a save. Accepted saves retain their original queued execution after navigation; newer pending choices overlay earlier responses. Refresh requests use current authorized church identity. Smoke tests require explicit disposable-church scope and correctly navigate editable teams and empty or populated periods.

## Behavior intentionally unchanged

Editable schedule payload semantics, schedule identity and creation metadata, update timestamps, occurrence matching, real group conflicts, edit-mode ownership behavior, authorization, publication, sending, and schedule reconciliation remain intact. No messaging automation was enabled. The full responsive runner retains its existing real-page passthroughs.

## Implemented: finding-by-finding evidence

| Finding | Classification | Root cause and resolution | Verification and remaining limits |
| --- | --- | --- | --- |
| 1. Schedule operational data loss | Already fixed by `043b066` | `buildSchedule` previously reconstructed the document from editable fields. Retained the current persisted document spread before applying validated fields and protected identity/timestamps. No duplicate implementation. | New real-handler name-only form-edit tests cover persisted and returned assignments, responses, both public token fields, publication/sending history, unknown operational fields, creation metadata and detail reads in memory and the Firestore transaction branch. Untrusted token/creation fields are ignored. Actual emulator optional; not configured. |
| 2. Shadow retry resurrection | Valid; partially fixed by `7826b17` | Its pending identity checks correctly suppress superseded queued operations. Per-cell sequences could restart at 1 after clear, allowing a retained old retry to match a new failed edit. Added one monotonic counter, registered shadow toasts with the existing cell registry, retired obsolete actions and prevented retry/failure UI after unmount. Accepted queued work still completes. | Seven focused shadow cases pass, including fail/retry, removal, retained old callback after newer failure, conflicting in-flight response, queued supersession, virtual-to-persisted ID remapping, and callbacks after unmount. Existing rapid independent-slot/choice tests also passed in the larger client batch. |
| 3. Imported occurrences lack locks | Already fixed by `043b066` | A Map iterator was rejected by the array-only ownership helper, omitting new occurrence lock keys. Retained its array conversion. | New controlled import-versus-create race pauses claim reads and verifies one owner, one claim and preservation of existing assignments/public link in both storage branches. Removing the supplied fix reproduces two owners. |
| 4. Standalone stale claim identity | Valid; partially fixed by `043b066` | The stale-owner comparison was fixed, but same-schedule and same-claim comparisons still treated absent and null group IDs differently. Normalized both remaining comparisons. | Both stores accept compatible undefined/null standalone claims and same-schedule legacy claims, while rejecting genuine conflicting groups and preserving the former owner's assignments. |
| 5. Smoke read-only claim | Valid | Opening Schedules can create/reconcile persisted schedules and ownership claims. Corrected documentation; fixture now requires `E2E_SMOKE_DISPOSABLE_CHURCH_ID` and rejects church-scoped API traffic outside it. | Isolated synthetic-browser validation passed; saved-auth smoke discovery and e2e TypeScript passed. The full saved-auth suite was deliberately not run because no disposable church ID is configured. This suite is explicitly documented as capable of writes. |
| 6. First team assumed editable | Valid | First active row can be view-only. Shared smoke assertion selects the first active-list row with an accessible Edit button and scopes detail assertions to the editor. Default TeamManager filter excludes archived teams. | Chromium uses real Teams management UI with a read-only first row and editable second row; passes. Missing editable-team permission remains a failure. |
| 7. Empty scheduling period rejected | Valid | The test required controls in every period. Also, Next changes the label into a custom-date input, invalidating the original range locator. Accept only the explicit no-occurrences state or controls, compare dates across both representations, and verify controls return. | Chromium passes populated?empty?restored and populated?populated?restored. Arbitrary error text is rejected as an empty period. No catch-all loading/error acceptance. |
| Pointer focus fallback timeout | Valid | Repeated pointer completion events replaced the timer handle without cancelling the old timer. Clear the prior timeout first. | Existing AppWorkspaceShell focus/scroll/lifecycle suite passed; full responsive browser runner exercised real shell behavior. |
| Forms retained-ready mock | Valid | The test modeled an error status with a retained confirmed timezone, although the provider deliberately keeps that church ready. Updated only this fixture to ready. | TeamsFormsPage and real provider retention tests passed. No production contract/expectation was weakened. |
| Virtual schedule ownership in create/copy form | Valid | Generated virtual/local previews were included as persisted ownership conflicts. Filter with existing `isPersistedScheduleId`. Edit-mode bypass remains intact. | Four cases cover virtual ID, local ID, persisted owner and edit mode. ScheduleEditForm suite passed. |
| Reconnect fake-timer cleanup | Valid | An assertion failure could skip timer restoration. Added try/finally. | Timezone suite passed; test restoration is unconditional. |
| Delayed refresh church identity | Valid | A dequeued reconnect callback could use a captured church ID after scope changed. Read current ID when it runs and refuse unauthorized, stale-owner or unmounted loads. | Controlled callback survives church A?B, requests only B, and makes no request after unmount. Existing retained-ready, device change and stale-response tests passed. |
| Unused responsive-navigation entry | Valid | No runner, build, HTML fixture, import or tracked source referenced it; the real runner generates its entry in memory. Removed the unused file. | Repository reference search, both production builds and the original responsive runner verify the removal. |

## Verified (required)

- Client Jest batch: **157 passed across seven suites**:
  - `client/src/pages/Teams/TeamsAndServices.test.tsx`
  - `client/src/pages/Teams/schedule/ScheduleEditForm.test.tsx`
  - `client/src/pages/Teams/pages/TeamsFormsPage.test.tsx`
  - `client/src/components/AppPageShell/AppWorkspaceShell.test.tsx`
  - `client/src/context/churchServiceTimeZone.test.tsx`
  - `client/src/pages/Teams/components/ChurchServiceTimeZoneGate.test.tsx`
  - `client/src/pages/Teams/pages/TeamsSchedulesPage.test.tsx`
- After the final lifetime guard refinement, `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/pages/Teams/TeamsAndServices.test.tsx --testNamePattern=shadow` from `client/`: **7 passed**, actual process exit 0.
- `node --import tsx --test server/teamScheduleOccurrenceOwnershipTransaction.test.js server/scheduleResponses.test.js`: **21 passed**.
- `node --import tsx --test --test-name-pattern='generated schedule|occurrence ownership|overlapping custom|portable schedule import' server/teamsApi.test.js`: **14 passed** using the production auth handlers, seeded auth, in-memory persistence and disabled external email credentials.
- `node e2e/responsive-navigation.mjs --smoke` from `client/`: **all four checks passed** using shared smoke assertions, real pages and isolated fixtures.
- `node e2e/responsive-navigation.mjs` from `client/`: **passed, actual process exit 0**. This includes Schedules/Messages/Teams, Forms, Services/Plans, Equipment retry checks and mobile/tablet/desktop navigation; the injected HTTP 500 is an expected retry fixture.
- `npm.cmd run test:e2e:smoke -- --list`: setup plus four smoke tests discovered successfully; no authenticated test execution implied.
- `npm.cmd run lint:check --prefix client`: **passed, zero warnings**.
- `npm.cmd run type-check --prefix client`: **passed**.
- `node client/node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --types node --skipLibCheck e2e/smoke.spec.ts e2e/smokeFixtures.ts e2e/smokeNavigation.ts`: **passed**.
- `node --check server/teamsAuthHandlers.js` and `node --check server.js`: **passed**.
- `npm.cmd run build:heroku --prefix client`: **passed**, production web/PWA output, Sentry plugin omitted by existing mode.
- `npm.cmd run build:electron --prefix client -- --config .codex-review-electron.vite.config.ts`: **passed**, main/preload/renderer production output. Temporary config copied the actual Electron configuration with only Sentry disabled (`disable: true`, `telemetry: false`); removed after validation.
- `git diff --check`: **passed**.

Regression strength: temporarily removing each relevant correction and restoring it immediately after the test reproduced (a) metadata loss in both stores, (b) duplicate in-memory occurrence ownership, and (c) a fourth stale shadow save after sequence reuse. The restored code passes the corresponding cases. These temporary mutations are not in the working diff.

Production context: **Pass** for the reviewed workflows. Traced TeamsAndServices?TeamsPageProvider?TeamsSchedulesPage?ScheduleTab, editor open actions, actual auth API endpoints, persistence/claim writers, shared timezone provider and auth scope. Jest runs actual Teams route/provider composition with API fixtures. Chromium runs actual page/shell components with synthetic context and responses and shares the smoke assertion implementation. Firestore tests exercise actual handler transaction code using an optimistic transaction double that rejects reads after writes and retries stale reads. These fixtures do not claim live authentication or live Firestore coverage.

## Not verified (optional)

- Live Firestore emulator execution: no emulator is configured. Transaction-double tests cover both the API behavior and the controlled contention, but do not replace deployed backend validation.
- Full saved-auth smoke suite against a real disposable church: no explicit disposable church ID is configured. The affected navigation assertions were executed against isolated synthetic data instead.
- Exhaustive client/server suites and CI were not run. Runtime here is Node 22.23.1; the repository declares Node 24, so CI remains the Node 24 verification point.

## Build side effects and approval review

An initial successful standard Electron build used its existing Sentry plugin and automatically uploaded source maps. No application was deployed. Automatic review then rejected an attempted final rerun because merely clearing an environment variable could still allow token loading from the plugin's local environment file. A safer final build explicitly disabled the plugin with no-op hooks; that action was accepted and both final production builds succeeded. No approval request remains pending.

## Final code review

Findings: Critical: None remaining. High: None remaining in the supplied scope. Medium: None remaining. Low: None remaining.

Product authorization: **Authorized** by the current request and `docs/features/team-scheduling.md`; the approved preservation, retry and ownership guarantees are recorded there. No new product restriction, automatic sending or migration was introduced.

Open questions / assumptions: None blocking. A name-only form edit uses the existing full validated schedule payload with only the name changed; this work does not add a partial PATCH contract.

Verification gaps: no required finding-specific checks remain. Optional live environment and exhaustive CI coverage are explicitly separated above.

| Invariant | Controlled transition | Code path | Evidence | Result |
| --- | --- | --- | --- | --- |
| Operational data survives edits | Existing responses/tokens/history ? editable name save ? persistence/detail read | buildSchedule, updateTeamSchedule, response synchronization | both-store metadata tests; pre-fix mutation fails | Pass |
| One active occurrence owner | Import pauses after claim read ? rival create runs ? release and commit/retry | import occurrence locks, ownership claims, Firestore transaction | both-store controlled race; old iterator produces two owners | Pass |
| Removed shadow stays removed | Add fails ? remove succeeds ? newer edit fails ? retained old retry invoked | monotonic edit sequence, pending identity, toast registry | controlled shadow recovery test; old sequence issues fourth save | Pass |
| Current choice survives older saves | Block earlier save ? newer shadow removal staged ? earlier response completes | assignment queue and pending-cell overlays | in-flight and queued shadow cases | Pass |
| Retry follows persisted identity | Primary and shadow staged under virtual ID ? ensure remaps ID ? shadow fails ? removal ? old callback | ensureActiveSchedule remapping and queue guards | virtual remapping integration case | Pass |
| Retired actions cannot save | Failed current edit ? unmount ? invoke retained callback | retry entry mounted guard and toast cleanup | shadow cases after unmount | Pass |
| Church identity is current | Capture reconnect callback ? A?B ? run callback ? unmount ? run callback | current church/readability refs and load guard | timezone callback test | Pass |

Cross-boundary review performed: Yes. Sibling-pattern search performed: Yes (primary, batch, equipment, queue and retry paths; refresh/interval/online paths). Legacy/persisted-state compatibility reviewed: Yes. Identity-switch test reviewed/added: Yes. Unmount/lifetime test reviewed/added: Yes. Contract round trip traced: Yes. Validate/use boundary reviewed: Yes (validated edits and transaction/lock ownership). Retry-state authority reviewed: Yes. Owner-retirement handoff reviewed: Yes (accepted queued saves continue; retry UI retires). External side-effect adoption/compensation: Not applicable to the changed schedule operations; no new external resource creation was added. Authorization/data projection reviewed: Yes. Production entry point/runtime/test composition compared: Yes.

Complexity reassessment: production changes are small local guards, normalized comparisons, one monotonic ref and reuse of the existing retry registry/helper. The larger added surface is controlled regression coverage for two persistence branches and browser fixtures; no new mutation subsystem was added.

Pattern / learning opportunities: existing mutation and review guidance already covers these failure shapes; no new policy is needed. No release fragment was added for these refinements to the unreleased workflow.

Known follow-ups: None required for these findings.

Final readiness: Ready for the supplied finding-resolution scope.

Merge recommendation: READY.
