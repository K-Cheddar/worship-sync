# Presentation Controller E2E lifecycle

Run against the local Vite renderer with an already reusable saved session:

```powershell
npm.cmd run test:e2e:controller:headed
```

`playwright.config.ts` keeps `workers: 1`, retries disabled, and the authentication setup dependency. Setup only validates/reuses the saved session. It cannot request a verification code. The controller project must execute the five tests in `e2e/controller.spec.ts`; a successful setup alone is not success.

## What changed

Previously, every case created a browser context with an empty content IndexedDB. The saved authentication state contains Firebase authentication, not a synchronized church PouchDB. Each context downloaded the church library again. `ensureSongExists()` interpreted an empty virtualized result list after `aria-busy=false` as absence and created a randomly identified song. That flag covered only local search work. The loading overlay can also disappear when replication progress reaches 100%, before replication's `complete` callback publishes the database. Repeated per-test setup, delayed results, and title matching made duplicate creation possible. Teardown removed outline entries but left songs and outline documents, and sometimes suppressed cleanup failures.

`controllerFixtures.ts` now owns one browser context per worker. Each case gets a fresh page; test teardown closes the pages explicitly, because Playwright's normal page fixture relies on closing its context. The context's IndexedDB and replication checkpoints survive between pages. Reload opens a new PouchDB handle over the same local data. No live PouchDB instance is shared between browser processes. A failing case causes Playwright to restart the worker; the new worker gets a new fixture identity and a new context.

This uses the supported [worker fixture lifecycle](https://playwright.dev/docs/test-fixtures#worker-scoped-fixtures), leaving the common authentication/diagnostic fixtures intact.

## Readiness and ownership

The test bridge instruments the **loaded Vite modules**, including their HMR URLs. Importing those modules separately can create a second provider/store and yield misleading state. No E2E globals or bypasses are shipped in production source.

The four checks are separate:

1. The controller route and shell are mounted, and the startup overlay is hidden.
2. `globalDb` is published by the initial replication `complete` callback.
3. Redux's full-song-document hydration action has completed; outline/library initialization has completed. Search results expose the query committed with their rows through `data-search-query`. Busy remains true while that query differs from the requested input.
4. Song creation resolves through the actual UI, then the exact document ID, ownership metadata, contents, and autosave acknowledgement are checked in PouchDB. Absence decisions use hydrated durable document identities rather than empty search rows.

Each worker has a UUID in its outline ID and display titles. Song IDs remain the application's ordinary generated IDs. Before a fixture-song write, its ID is recorded in a local manifest and the document receives:

```json
{ "e2eFixture": { "owner": "presentation-controller-v1", "outlineId": "e2e-controller-outline-<uuid>" } }
```

The outline uses the same ownership marker. Songs are created once per worker. Setup **selects the owned outline before creating songs**, because Create Song also adds the new song to the selected outline. Each case starts and ends with an empty owned outline; fresh pages reset the editor and drawer state. Library row selection uses the recorded document IDs. All five behavioral assertions are retained, including reload persistence and active output transition contents.

Worker `finally` cleanup checks ownership and outside references, removes only exact fixture IDs from the library/outline registries, restores the previous outline selection only if it still points at this fixture, deletes the owned documents, pushes those IDs and registry revisions, and checks remote absence. It refuses to delete a fixture that became an operator's active outline. Cleanup errors fail the run and report IDs plus the manifest path, even if a case already failed.

## Output isolation

The worker bridge prevents shared Firebase writes before the application mounts and takes the test's Realtime Database connection offline. The test pages use their local Redux/localStorage output previews. Before and after each case, local outputs are cleared and disarmed. This preserves the tenant's actual projector, monitor and stream contents and avoids overwriting concurrent operator changes with a saved snapshot.

The projector tests continue to exercise the real controller actions, slide selection, transition stages and active-lane contents. They do not verify cross-device Firebase delivery. Production rendering and stream transparency are unchanged. Running against a bundled/production deployment is unsupported by this bridge; missing instrumentation fails the readiness checks instead of permitting a live output test.

Email-generating auth POSTs and MailSlurp requests are blocked for both worker setup and test pages. Only trusted-origin session renewal with `requestNewCode: false` is allowed. Per-test browser diagnostics and worker manifests report violations.

## Inventory and interrupted runs

Manifests live under ignored `playwright/.fixtures/`. They contain the exact IDs, tenant database, prior outline selection, cleanup status, startup durations and per-page database download counts. Preserve manifests for interrupted or failed runs. A hard process kill cannot run `finally`; the manifest is its recovery record.

The CLI reads the configured server CouchDB credentials without printing them. Always specify the exact database. Its inventory queries only E2E-named/marked documents and their known content-database reference fields, and saves full fixture contents and referencing documents locally:

```powershell
npm.cmd run test:e2e:controller:fixtures -- --database worship-sync-demo
```

Inspect the saved JSON and the manifest before cleanup. Check Service Plans or other consumers outside the content database before cleaning long-lived stale fixtures; the CLI does not inventory Firestore or Firebase presentation references. Never infer ownership from a title. A legacy document without this manifest/marker remains ambiguous, even if its lyrics match. Preserve it and request explicit ID/revision-based cleanup after reviewing its contents and references. Do not run a title-based delete.

For exact owned fixtures with no outside references:

```powershell
npm.cmd run test:e2e:controller:fixtures -- --database worship-sync-demo --cleanup --manifest 'playwright/.fixtures/<manifest>.json'
```

Cleanup uses current revisions; conflicts stop it. Outside references block it. If a person explicitly approves removing particular outline entries, `--remove-reference '<exact-outline-id>'` removes only entries referencing the manifest IDs and preserves other entries. Unknown reference shapes remain blocked. This option is a deliberate operator action, never automatic suite teardown. A failure reports affected and remaining IDs; rerunning with the same manifest handles documents already removed by an interrupted cleanup.

## Persistence across separate executions

A dedicated persistent Chromium profile could reuse the **on-disk** IndexedDB and PouchDB replication checkpoints across runs. It would require one exclusive profile owner, stable renderer origin and tenant identity, protected authentication files, the same no-email guards, and fresh-page/state-reset/fixture cleanup on every run. Do not reuse an operator's everyday browser profile or share one profile between concurrent browser processes. Authentication still needs validation; cached data alone is not readiness.

That extra persistence is not implemented. A normal execution performs one cold download per worker, then reuses it for all five cases and reload. A small dedicated tenant remains useful: provision it manually, assign one E2E user sufficient controller/library access, perform one explicit auth refresh for that account, and set `E2E_BASE_URL`/saved session to that tenant. The suite creates its own temporary songs and outline. No additional seeding or church-provisioning service is required.

## Focused checks

```powershell
npm.cmd run test:e2e:controller:fixture-policy
npm.cmd run test:e2e:auth-policy
npm.cmd test --prefix client -- --runInBand src/components/FilteredItems/FilteredItems.test.tsx
npm.cmd run lint:check --prefix client
npm.cmd run type-check --prefix client
```

The cleanup-policy checks cover title ambiguity, wrong-run ownership, operator adoption, unknown reference shapes and resuming partial cleanup. The controller suite's coverage remains five cases.
