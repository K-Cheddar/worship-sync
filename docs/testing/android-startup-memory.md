# Android Startup Memory Investigation

> **Release blocker:** Startup diagnostics, DevTools controls, experiment modes, and this staging procedure are temporary investigation code. Remove the temporary diagnostic controls, modes, and instrumentation before merging or deploying to production. Retain only performance changes supported by physical-device evidence and independently justified lifecycle fixes.

## Findings so far

The crash on the T65 EEA is **not confirmed as fixed**. The physical device's memory trace and Chromium crash evidence are still required to identify the cause.

1. **Original startup replication workload:** An authenticated startup can run content and Bible pulls concurrently. The original settings allow up to 2,250 content documents (`150 × 15`) and 25,000 Bible documents (`1,000 × 25`) in flight. This is the default `normal` diagnostic mode so the staging experiment measures the existing workload.
2. **Bounded comparisons:** `bounded-batches` caps both startup pulls at 200 documents (`100 × 2`). `reduced-batches` caps both at 50 documents (`25 × 2`). These are diagnostic comparisons, not a permanent throughput decision.
3. **Local cache hydration:** Content startup reads local documents with `allDocs({ include_docs: true })` before hydrating Redux. Diagnostics retain counts and timings, never document contents.
4. **Concurrency comparison:** Content and Bible startup replication overlap in `normal`, `bounded-batches`, and `reduced-batches`. `sequential` waits for content cache hydration and the successful initial content pull before starting the Bible pull.
5. **Other contributors to measure:** authentication, Firebase subscriptions, global and route managers, local database opening, browser startup work, and long main-thread tasks. These measurements are clues for follow-up, not proof of the native crash mechanism.

No diagnostic mode clears or recreates the authenticated workstation's local databases. Switching modes saves the selection and reloads the tab.

## Staging deployment

Deploy through the existing Heroku staging process using the usual application build. Diagnostics start automatically when no mode has been selected. No additional Heroku config var, `VITE_STARTUP_DIAGNOSTICS_STAGING`, or Vite `staging` build mode is required.

A previously selected `off` mode remains stored for that staging origin. Use the DevTools command below to return to `normal` before capturing a run.

## Connect DevTools to the tablet

1. Install or update the staging PWA through its normal update flow. Do not clear site data, IndexedDB, or unlink the workstation between comparisons. Close other WorshipSync tabs and display windows before a run.
2. On Android, enable Developer Options and USB debugging. Connect the unlocked tablet to the workstation and accept its debugging prompt if shown.
3. In desktop Chrome, open `chrome://inspect/#devices`, enable **Discover USB devices**, find the tablet's staging Chrome tab, and click **Inspect**. See [Remote debug Android devices](https://developer.chrome.com/docs/devtools/remote-debugging/).
4. In the remote DevTools Console, enable **Preserve log**. The console entries beginning with `[WorshipSync startup]` continue across reloads and are the durable capture path if the renderer becomes unstable.
5. Before the first pairing, select the first isolation run so the full content pull does not start early:

   ```js
   window.__worshipSyncStartupDiagnostics.setMode("skip-databases")
   ```

   The command saves the mode and reloads the pairing tab. Then pair the tablet as a workstation, sign in, and select the operator normally. Authentication, permissions, and readiness checks are unchanged.

## Chrome DevTools commands

Check the selected mode:

```js
window.__worshipSyncStartupDiagnostics.getMode()
```

Switch modes. This stores the choice for the staging origin and reloads the tab:

```js
window.__worshipSyncStartupDiagnostics.setMode("normal")
window.__worshipSyncStartupDiagnostics.setMode("skip-databases")
window.__worshipSyncStartupDiagnostics.setMode("content-only")
window.__worshipSyncStartupDiagnostics.setMode("bible-only")
window.__worshipSyncStartupDiagnostics.setMode("bounded-batches")
window.__worshipSyncStartupDiagnostics.setMode("reduced-batches")
window.__worshipSyncStartupDiagnostics.setMode("sequential")
```

Get a live snapshot and copy its JSON to the clipboard:

```js
window.__worshipSyncStartupDiagnostics.snapshot()
copy(JSON.stringify(window.__worshipSyncStartupDiagnostics.snapshot(), null, 2))
```

Disable diagnostic logging while keeping ordinary application behavior:

```js
window.__worshipSyncStartupDiagnostics.setMode("off")
```

Restore the default diagnostic run and ordinary application screens:

```js
window.__worshipSyncStartupDiagnostics.setMode("normal")
```

`normal` and `off` both use ordinary application screens. `normal` logs the original baseline workload; `off` stops diagnostic logging. The selection persists across reloads. Isolation modes leave pairing, sign-in, and operator selection available, then lock routes that require both databases. `normal`, `bounded-batches`, `reduced-batches`, and `sequential` allow the regular application to run through its existing authentication and readiness checks.

## Recommended test sequence

Run the sequence on the tablet, keeping the same church, workstation, account, network, and installed staging release. Capture a snapshot after each mode has settled. Use DevTools Preserve log so mode reloads do not discard console evidence.

1. **Authenticated startup without databases — `skip-databases`.** Starting with the pairing flow in this mode, observe auth, pairing, operator selection, Firebase, and manager events without initializing content or Bible databases. This mode does not start CouchDB session retries.
2. **Content initialization — `content-only`.** Observe content database opening, local document count, item-cache hydration, the content checkpoint, and content's initial pull. Operational routes remain locked because Bible is omitted.
3. **Bible initialization — `bible-only`.** Observe Bible database opening and replication without creating/opening the content database. Operational routes remain locked because content is omitted.
4. **Original concurrent baseline — `normal`.** Use content `150 × 15` and Bible `1,000 × 25` startup replication settings while using the regular application.
5. **Bounded concurrent comparison — `bounded-batches`.** Use `100 × 2` for both startup pulls.
6. **Reduced concurrent comparison — `reduced-batches`.** Use `25 × 2` for both startup pulls.
7. **Scheduling comparison — `sequential`.** Use the original per-database batch settings, hydrate the complete local content cache, finish the initial content pull, then start Bible replication.

The first completed content pull writes the existing local checkpoint. Later experiments on that same local database are checkpointed startups, even if they use a different batch mode. Record `content/checkpoint.checked.exists` for every run; do not compare a first-time content pull as if it were equivalent to a checkpointed pull. Bible has no equivalent application checkpoint, so record its pre-pull local document count and processed document count separately. Do not erase local data to manufacture a first-time comparison.

For first-time versus subsequent comparison, use separate staging workstation storage that has not yet synced that church for the first pull. Preserve the tablet's existing local database. Keep the same data origin and document set when comparing batch settings; note when the state differs.

## Reading the measurements

- `runtime/memory.sample` is logged every five seconds. `snapshot().heap.peakUsedMb` is the highest supported heap sample since this page load. `snapshot().heap.settledUsedMb` is the median of the latest five samples (about 25 seconds); wait until synchronization and navigation settle before treating it as settled usage. `supported: false` means this Chrome context does not expose `performance.memory`.
- `startup/database-plan` states whether each database initializes, the mode's per-database initial-pull batch size and limit, maximum documents in flight, and whether startup is sequential. The actual content live sync retains its existing settings and reports them separately on `replication.started`.
- `database/open.completed` reports local document count and open duration. `redux/item-cache.hydrated` reports the hydration count and duration without retaining document bodies.
- `content/replication.finished` and `bible/replication.finished` report outcome, batches, documents, and duration. `replication.started` includes the actual batch settings and active instance count. Compare their elapsed times and active counts to see whether pulls overlap.
- `startup/application.ready` marks the existing content startup readiness signal when the mode initializes both databases. Its event elapsed time is time since this page loaded; `startupDurationMs` is time in the current database session. `bible/database-setup.ready` marks successful initial Bible setup separately. Isolation runs do not claim the full application is ready.
- Content's existing live synchronization behavior is preserved (including its 413 recovery). Subsequent Bible synchronization remains active through its existing local-change feed and debounce; its runs are logged as `kind: "live-sync"`.
- `auth/*`, `route/changed`, Firebase subscription events, manager events, and the long-task fields help correlate lifecycle milestones with heap growth. Route events use fixed route categories and do not retain path segments, query strings, or pairing tokens.

A heap increase during `skip-databases` points to work outside the two local databases. Growth during isolated database runs helps identify which initialization or replication phase is involved. A stable bounded run compared with an unstable original baseline suggests a batch-size contribution; stable isolated runs but growth during concurrent runs suggests overlap. These observations guide follow-up and do not alone prove why Chromium crashed.

## Evidence still required

Test the actual tablet through pairing, operator selection, Home, Presentation Controller, Current Service Viewer, page navigation, repeated startup, and extended normal use. Capture whether the run was a first content pull or checkpointed, peak and settled heap if available, both database replication durations, time to the existing application-ready event, and whether synchronization overlapped. The tablet crash remains unresolved until physical-device evidence is reviewed.
