# Controller E2E verification — 2026-10-13

Implementation status: COMPLETE

## Before behavior

Per-test contexts discarded content IndexedDB. Repeated setup inferred absence from incomplete search rows and created randomly identified songs by title. Songs and outline documents remained afterward. Cleanup sometimes suppressed failures and only disarmed a projector it had enabled, without restoring its content.

## After behavior

One worker context, fresh explicitly closed pages, separate replication/library/search/persistence signals, shared owned songs, one owned outline, durable-ID assertions, exact-ID cleanup with remote readback, isolated local outputs, and no-email guards. All five controller assertions remain.

## Behavior intentionally unchanged

Production database initialization, authentication, creation, output rendering and stream transparency. Production changes identify library rows/results and make aria-busy accurate for the current search. No live database is shared across browser processes. workers remains 1; playwright.config.ts and common auth/diagnostic fixtures are unchanged.

## Root causes and initial inventory

The code-level duplicate mechanism was repeated random-ID creation after a temporarily empty local search, without waiting for initial replication/full library hydration or tracking ownership. aria-busy reflected the search debounce, and the loading overlay could disappear at 100% progress before replication's complete callback. Fresh contexts lacked the content database and checkpoints, causing repeated full downloads. Teardown left durable song/outline records behind.

Both the scoped remote inventory and actual browser registries found zero existing E2E fixtures in worship-sync-demo at the start. The previously reported duplicates were absent; their IDs and individual provenance cannot be established. No unmarked legacy record was deleted.

The first development run passed all five cases but failed worker cleanup, so it is **not counted as success**. Creation added songs to the previously selected outline because setup had not yet selected the owned outline. Cleanup stopped on those outside references. With the user's explicit approval, controlled cleanup removed the two exact references from Item List 1 (1) and the three owned records, preserving its other entries. Setup now selects the owned outline first.

## Exact final browser results

Both executions used npm.cmd run test:e2e:controller:headed, with list/HTML/JSON reporters added to retain durations. Each executed five actual controller cases plus saved-session setup, one worker and zero retries.

| Test | Final run 1 | Final run 2 | Result |
| --- | ---: | ---: | --- |
| requires the saved WorshipSync session to be reusable | 1.960 s | 1.972 s | Passed twice |
| searches for a known song, adds it once, and opens that outline entry | 12.704 s | 12.100 s | Passed twice |
| opens exact known song details without changing the outline | 10.154 s | 10.912 s | Passed twice |
| navigates song slides and verifies the active projector output | 17.686 s | 17.423 s | Passed twice |
| switches rapidly between known songs without stale editor, slides, or output | 20.110 s | 19.646 s | Passed twice |
| persists the dedicated outline order across a browser reload | 21.418 s | 22.300 s | Passed twice |

- Final run 1: 6 passed; 0 failures, skips or flaky results; total 129.692 s. Cold controller readiness 22.188 s; mean subsequent test-page readiness 4.532 s. Initial content download: 20 bulk requests / 4762 requested document revisions. Every later page, including reload and cleanup: **0 bulk requests / 0 revisions**. Cleanup: cleaned.
- Final run 2: 6 passed; 0 failures, skips or flaky results; total 129.662 s. Cold controller readiness 20.559 s; mean subsequent test-page readiness 4.475 s. Initial content download: 20 bulk requests / 4765 requested document revisions. Every later page, including reload and cleanup: **0 bulk requests / 0 revisions**. Cleanup: cleaned.

Warm-page readiness demonstrates faster startup through context reuse. No successful legacy-suite runtime baseline exists; no exact overall suite speedup is claimed. Separate executions still perform one cold sync. Revision counts include replication history/tombstones and are not live fixture counts.

Final per-test diagnostics show **0 email-generating auth requests, 0 MailSlurp requests, and 0 untrusted auth requests** for all five cases. Saved-session setup reused authentication. These executions generated no verification emails; the MailSlurp inbox itself was not queried.

A temporary fault-injection test intentionally failed after adding a song, without an afterEach UI cleanup hook. Worker finally removed both songs and the outline. The expected failing case took 10.2 s excluding worker setup/teardown. No permanent controller coverage was added.

## Removed records

All 18 documents below are owned fixtures created during this work, now deleted. Recovery manifests remain in ignored playwright/.fixtures/.

| Run | Outline ID | Song IDs | Final status |
| --- | --- | --- | --- |
| Initial development; approved cleanup | e2e-controller-outline-055f1d0a-c2ee-441b-8eae-3aaa98365f38 | song-1k4rni6rqe49qnbfdmr8<br>song-1k4rnias18mtgodf3l78 | cleaned |
| Corrected development | e2e-controller-outline-41b53a57-6f60-489b-97e6-9925acdd22aa | song-1k4rnu4jav9aihmb2gtk<br>song-1k4rnu97prnl9fe3fvfs | cleaned |
| Repeat development | e2e-controller-outline-11758052-ed90-4af0-9c5e-3c809c84a2aa | song-1k4ro3gmv0ndtrm1i3a8<br>song-1k4ro3lioi08ukh2bkfc | cleaned |
| Intentional failure check | e2e-controller-outline-c9e70d4b-d94d-4685-9136-729502cb7db6 | song-1k4ro8ujbg3f6jsjjo58<br>song-1k4ro934s5l3g2ejoee4 | cleaned |
| Final run 1 | e2e-controller-outline-f91bd20e-04ca-4b16-88c8-c5d1f2e447f4 | song-1k4robpjk5j9q97hg9ek<br>song-1k4robtraj9sf5d8pj6o | cleaned |
| Final run 2 | e2e-controller-outline-fe27450c-e116-49ad-8c0f-a6bd235c4526 | song-1k4rohd70fre36g7v9tc<br>song-1k4rohhslg991659dhck | cleaned |

Final remote inventory: **0 fixture documents, 0 E2E outline-registry matches, 0 E2E library matches, 0 references**. Remaining fixture IDs: **none**. PouchDB's normal deletion tombstones remain; no database destruction/compaction was performed. The previous selected outline remained Item List 1 (1); no fixture was made the church's active outline.

## Implemented / files changed

- e2e/controllerFixtures.ts and controllerRuntime.ts: worker context, manifests, exact ownership, fresh-page disposal, real readiness and isolated local outputs.
- e2e/controllerTestData.ts and controller.spec.ts: shared seeding, durable identity/acknowledgements, state resets, preserved five assertions and reported cleanup failures.
- e2e/controllerFixtureCleanup.ts, controllerFixtureCleanup.test.ts and scripts/controller-fixtures.ts: scoped inventory, explicit stale cleanup and six ownership/reference policy checks.
- client/src/components/FilteredItems/FilteredItems.tsx, FilteredItem.tsx and FilteredItems.test.tsx: atomic result/query identity, truthful busy status, row document IDs and readiness regression checks.
- package.json and .gitignore: fixture inventory/policy commands and ignored manifests.
- docs/controller-e2e.md and this verification report: lifecycle, cleanup, profile/tenant setup and evidence.

Unrelated pre-existing edits were preserved.

## Verified (required)

- Initial scoped remote and non-destructive browser inventories; saved-session setup passed (3.2 s overall, 2.1 s case).
- Two final headed runs above: all five controller cases, reload, clean repeat execution and remote cleanup.
- Final remote inventory, including orphaned registry/library matches.
- Intentional individual failure with successful exact-ID worker cleanup.
- Fixture policy: 6/6 passed, 200.636 ms runner duration.
- Auth policy: 8/8 passed, 4033.267 ms runner duration.
- FilteredItems focused Jest suite: 15/15 passed, latest run 4.840 s.
- Client lint:check, type-check and build:strict passed. Vite build 44.21 s and service-worker build 261 ms; existing bundle-size warning.
- Focused strict E2E/CLI TypeScript check (ESNext/bundler resolution) and scoped git diff --check passed.
- Final code-review passes traced fixture identity, worker/page lifetime, failed/interrupted cleanup, persistence, output isolation, auth and real runtime composition.

Production context checked: the actual local Vite renderer, real auth, ControllerInfoProvider, Redux library/outline hydration and church PouchDB replication. Shared realtime outputs were deliberately isolated; UI/controller assertions use the real implementations.

## Limitations / Not verified (optional)

- The bridge supports local Vite, not production bundles. Output assertions verify local active rendering, not cross-device Firebase delivery.
- No persistent browser profile was implemented. A dedicated exclusive profile could reuse on-disk IndexedDB/checkpoints across runs with stable origin/tenant and valid guarded authentication; see controller-e2e.md.
- Stale CLI reference checks cover the content database, not Firestore Service Plans or Firebase presentation state. Inspect those external consumers before deliberate cleanup of long-lived stale fixtures. Ambiguous unmarked legacy content remains protected.
- Background demo service-plan-microphones requests return 403; Mux media requests sometimes abort during disposal. Diagnostics remain visible. These requests are outside this focused fix; intended assertions passed.
- No exhaustive client/server suite or remote-projector/Electron execution was run.

A dedicated small tenant would further reduce cold download time: manually provision one tenant/user with controller/library access, explicitly authenticate it once, and configure the saved E2E session and renderer URL. The suite creates its temporary songs/outline. No provisioning code was added.

## Known follow-ups

None required for the requested repeatable local controller suite.
