# Android Startup Memory Investigation

> **Release blocker:** A fresh initial synchronization still needs validation on the low-end Android tablet. Startup diagnostics default to off and experimental mode selection is limited to the current browser tab.

## Findings so far

The crash on the T65 EEA is **not confirmed as fixed**. The physical device's memory trace and Chromium crash evidence are still required to identify the cause.

1. **Production replication workload:** Authenticated startup can run content and Bible pulls concurrently. Initial content uses `batch_size: 150`, `batches_limit: 15`; Bible uses `1000` and `25`. These nominally queue 2,250 and 25,000 change-feed rows, respectively, not document bodies. One feed row can contain multiple revision leaves, so these settings are not strict memory limits.
2. **Local cache hydration:** Normal content startup reads local documents with `allDocs({ include_docs: true })` before hydrating Redux. `replication-only` skips cache hydration to isolate the content replication interval. Diagnostics retain counts and timings, never document contents.
3. **Concurrency comparison:** Content and Bible startup replication overlap during normal startup. `sequential` uses the same initial-pull settings but waits for the content cache and initial pull before starting Bible replication.
4. **Other contributors to measure:** authentication, Firebase subscriptions, global and route managers, local database opening, browser startup work, and long main-thread tasks. These measurements are clues for follow-up, not proof of the native crash mechanism.

No diagnostic mode clears or recreates the authenticated workstation's local databases. Diagnostic selection uses `sessionStorage`, is scoped to the current tab, and reloads that tab when changed.

## Staging deployment

Deploy through the existing Heroku staging process using the usual application build. Diagnostics remain off unless explicitly enabled from the browser console. The PouchDB method instrumentation and payload sizing experiment have been removed.

An isolation mode ends with the browser tab session. Close the experimental tab to return to normal startup.

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

Switch modes. This stores the choice for the current tab and reloads it:

```js
window.__worshipSyncStartupDiagnostics.setMode("normal")
window.__worshipSyncStartupDiagnostics.setMode("skip-databases")
window.__worshipSyncStartupDiagnostics.setMode("content-only")
window.__worshipSyncStartupDiagnostics.setMode("replication-only")
window.__worshipSyncStartupDiagnostics.setMode("bible-only")
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

Run the full application with sampled startup diagnostics:

```js
window.__worshipSyncStartupDiagnostics.setMode("normal")
```

`normal` and `off` both use the production replication settings and ordinary application screens. `normal` records diagnostics; `off` is the default and disables diagnostic logging. The selection lasts only for the current tab session. Isolation modes leave pairing, sign-in, and operator selection available, then lock routes that require both databases. Set `off` and reload to end the diagnostic run without closing the tab.

## Recommended test sequence

Run isolation checks on the tablet with the same staging release, account, network, and church. Do not wipe its active local database to create a comparison. Use a separate staging workstation/profile for a true first-sync run when needed. Capture a snapshot after each mode settles, and use DevTools Preserve log so mode reloads do not discard console evidence.

1. **Authenticated startup without databases — `skip-databases`.** Starting with the pairing flow in this mode, observe auth, pairing, operator selection, Firebase, and manager events without initializing content or Bible databases. This mode does not start CouchDB session retries.
2. **Content initialization — `content-only`.** Observe content database opening, local document count, item-cache hydration, the content checkpoint, and content's initial pull. Operational routes remain locked because Bible is omitted.
3. **Bible initialization — `bible-only`.** Observe Bible database opening and replication without creating/opening the content database. Operational routes remain locked because content is omitted.
4. **Content replication isolation — `replication-only`.** Run the full content initial pull with settings `150 by 15`, while skipping Bible, cache hydration, and unrelated app managers. This mode is for measurement only; operational routes stay locked.
5. **Scheduling comparison — `sequential`.** Use the production settings, hydrate the local content cache, finish the initial content pull, then start Bible replication.
6. **Normal authenticated startup — `normal`.** Verify the regular app with concurrent content `150 by 15` and Bible `1000 by 25` initial pulls. Also capture a separate `off` run if measuring diagnostics overhead.

The first completed content pull writes the existing local checkpoint. Later experiments on that same local database are checkpointed startups, even if they use a different batch mode. Record `content/checkpoint.checked.exists` for every run; do not compare a first-time content pull as if it were equivalent to a checkpointed pull. Bible has no equivalent application checkpoint, so record its pre-pull local document count and processed document count separately. Do not erase local data to manufacture a first-time comparison.

For first-time versus subsequent comparison, use separate staging workstation storage that has not yet synced that church for the first pull. Preserve the tablet's existing local database. Keep the same data origin and document set when comparing batch settings; note when the state differs.

## Reading the measurements

- `runtime/memory.sample` is logged every five seconds. `snapshot().heap.peakUsedMb` is the highest supported heap sample since this page load. `snapshot().heap.settledUsedMb` is the median of the latest five samples (about 25 seconds); wait until synchronization and navigation settle before treating it as settled usage. `supported: false` means this Chrome context does not expose `performance.memory`.
- `startup/database-plan` states whether each database initializes, the production initial-pull batch sizes and limits, and whether startup is sequential. Its queued-row products are nominal change-feed rows, not maximum documents in memory. The actual content live sync retains its existing settings and reports them separately on `replication.started`.
- `database/open.completed` reports local document count and open duration. `redux/item-cache.hydrated` reports the hydration count and duration without retaining document bodies.
- `content/replication.finished` and `bible/replication.finished` report outcome, batches, documents, and duration. `replication.started` includes the actual batch settings and active instance count. Compare their elapsed times and active counts to see whether pulls overlap.
- `startup/application.ready` marks the existing content startup readiness signal when the mode initializes both databases. Its event elapsed time is time since this page loaded; `startupDurationMs` is time in the current database session. `bible/database-setup.ready` marks successful initial Bible setup separately. Isolation runs do not claim the full application is ready.
- Content's existing live synchronization behavior is preserved (including its 413 recovery). Subsequent Bible synchronization remains active through its existing local-change feed and debounce; its runs are logged as `kind: "live-sync"`.
- `auth/*`, `route/changed`, Firebase subscription events, manager events, and the long-task fields help correlate lifecycle milestones with heap growth. Route events use fixed route categories and do not retain path segments, query strings, or pairing tokens.

A heap increase during `skip-databases` points to work outside the two local databases. Growth during isolated database runs helps identify which initialization or replication phase is involved. Stable isolated pulls but growth during normal concurrent startup suggests overlap. These observations guide follow-up and do not alone prove why Chromium crashed.

## Evidence still required

Test the actual tablet through pairing, operator selection, Home, Presentation Controller, Current Service Viewer, page navigation, repeated startup, and extended normal use. Capture whether the run was a first content pull or checkpointed, peak and settled heap if available, both database replication durations, time to the existing application-ready event, and whether synchronization overlapped. The tablet crash remains unresolved until physical-device evidence is reviewed.
