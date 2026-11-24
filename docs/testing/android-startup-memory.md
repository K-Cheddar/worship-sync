# Android Startup Memory Investigation

## Findings so far

The crash on the T65 EEA is **not confirmed as fixed**. The physical device's heap and Chromium crash trace are still required to identify the root cause.

1. **Verified high-likelihood peak-memory contributor: startup replication queue sizes.** After an authenticated session becomes available, `ControllerInfoProvider` starts a full content pull and a Bible pull independently. The old initial-pull settings allowed up to 2,250 content documents (`150 × 15`) and 25,000 Bible documents (`1,000 × 25`) to be queued in memory. PouchDB documents `batch_size × batches_limit` as its maximum in-flight document count, and specifically recommends reducing both values on low-memory devices. The new normal settings cap each initial pull at 200 documents (`100 × 2`); the comparison mode caps each at 50 (`25 × 2`). This bounds each initial pull while retaining replication and checkpoints.
2. **Verified workload before the operator screen: local cache hydration.** The content database opens on an authenticated workstation route, and `startItemCacheSync` reads all local documents with `allDocs({ include_docs: true })`, derives the item and song collections, then hydrates Redux. This occurs before an operator name is entered. Diagnostics record only counts and elapsed time, never document contents.
3. **Verified concurrency: content and Bible startup overlap.** Content replication and Bible replication were started by independent effects once the database session was ready. The sequential experiment now waits for the cache snapshot, then the complete content initial pull, before starting Bible replication.
4. **Other plausible contributors to measure:** shared Firebase authentication and presentation subscriptions, global chat and route managers, local Pouch/IndexedDB opening, and browser/PWA startup work. Manager/subscription milestones and long tasks are logged so these can be correlated with heap growth.
5. **Unconfirmed:** there is no evidence yet that a retry loop, duplicate subscription, recursive processing, Redux selector, device-specific defect, or Chromium native fault caused this tablet's crash. A desktop heap peak does not establish the Android failure's cause.

## Build for staging

From PowerShell:

```powershell
cd client
$env:VITE_STARTUP_DIAGNOSTICS_STAGING = "true"
npm.cmd run build -- --mode staging
Remove-Item Env:VITE_STARTUP_DIAGNOSTICS_STAGING
```

The mode is enabled only when **both** Vite mode is `staging` and the explicit flag is `true`. Ordinary development and production builds cannot enable the panel or its controls. Publish the resulting staging build through the usual staging process; this change does not deploy it.

## Prepare the tablet and capture startup

1. Install/update the staging PWA through its normal update flow. Do not clear site data, IndexedDB, or unlink the workstation between comparisons. Close other WorshipSync tabs and display windows before beginning; staging tabs reload into the route lock when the mode changes.
2. On Android, leave Developer Options and USB debugging enabled. Connect the unlocked tablet to the unlocked workstation and accept its debugging prompt if shown.
3. On desktop Chrome, open `chrome://inspect/#devices`, enable **Discover USB devices**, find the tablet's staging Chrome tab, then choose **Inspect**. Chrome's remote-debugging guide describes these steps: [Remote debug Android devices](https://developer.chrome.com/docs/devtools/remote-debugging/).
4. In the remote DevTools Console, enable **Preserve log**. Before pairing, run one of these commands to select the mode and reload the current pairing route:

   ```js
   window.__worshipSyncStartupDiagnostics.setMode("normal")
   ```

   Replace `normal` with any supported value below. The setting is local to that staging origin and survives reloads. The same API is available from the diagnostic panel after pairing.
5. Pair the tablet as a workstation using the normal pairing flow. Authentication and permissions are unchanged. After pairing, the current tab and other open staging tabs show a diagnostic lock instead of controller or display screens; pairing and sign-in remain available.
6. Watch console entries beginning with `[WorshipSync startup]`. Every event includes elapsed milliseconds and a short subsystem/event name. Memory samples are spaced five seconds apart. When the device stays stable long enough, collect a bounded snapshot:

   ```js
   copy(JSON.stringify(window.__worshipSyncStartupDiagnostics.snapshot(), null, 2))
   ```

   Paste it into the investigation notes. The snapshot includes at most 200 recent scalar events and aggregate replication counters. It excludes credentials, tokens, church content, and personal data. `performance.memory` is not available in every Chrome context; if `heapSupported` is false, use event timing and the remote DevTools timeline/Memory tools and note that the heap figures are unavailable.

## Modes and recommended order

Select one mode before pairing. To change modes, use `setMode("value")` in DevTools or the panel's selector; it saves the choice and reloads without clearing local databases.

| Mode | Startup exercised |
| --- | --- |
| `skip-databases` | Authentication and globally mounted app work, with both local content and Bible database initialization and controller-route managers suppressed. It does not start CouchDB session retries. |
| `content-only` | Authenticated content database setup, local cache hydration, content initial pull and subsequent content sync; no Bible database. |
| `bible-only` | Authentication/session prerequisite and Bible database setup/replication; no content database or content cache. |
| `reduced-batches` | Both initial pulls with `25 × 2` queue settings. |
| `normal` | Both database initializations with the new normal `100 × 2` initial-pull settings. |
| `sequential` | Content local cache snapshot, content initial pull, then Bible setup/pull. Each wait uses successful lifecycle completion, not a timer. |
| `off` | Leaves diagnostic mode and reloads the normal application. |

Suggested sequence: `skip-databases`, `content-only`, `bible-only`, `reduced-batches`, `normal`, then `sequential`. Stop an experiment if several consecutive memory samples rise sharply toward the device's previously observed crash range; capture a snapshot first if DevTools remains responsive. Do not repeat a crash just to obtain another trace.

## Read the trace

- If memory rises in `skip-databases`, compare the timestamps for `auth/bootstrap.*`, `firebase/*`, `chat/*`, and `manager/*`. This points to work outside the two local databases, but does not by itself identify a specific manager.
- If growth starts at `database/open.*` or `redux/item-cache.hydrated`, compare open/hydration duration and document counts. This can distinguish local IndexedDB/cache cost from remote transfer.
- If growth starts at `content/replication.started` or `bible/replication.started`, check `maximumDocumentsInFlight`, active counts, cumulative `*Documents`/`*Batches`, retries, and finish outcomes. Compare single-database modes to the combined modes.
- If `reduced-batches` remains stable while `normal` does not, the bounded queue size is implicated. If each isolated mode is stable but `normal` grows, concurrency is implicated. These are evidence for follow-up, not proof of the native crash mechanism.
- `content/checkpoint.checked` reports whether the existing verified initial content checkpoint was present. `database/open.completed.documents` records local document counts before replication. Replication event totals show what was processed in that run. Bible startup has no equivalent app-level first-sync checkpoint, so use its pre-pull local count and observed changes as evidence and label the result as an estimate.

## Compare platforms and repeat startup

Use the same staging release, church, workstation session kind, route (`/workstation/operator` after pairing), account permissions, network, and approximate local data state on desktop and tablet. Do not copy pairing tokens or browser storage between devices. If pairing is one-use, pair each device normally to the same church and compare equivalent workstation sessions.

Record whether each run is a first content pull (`checkpoint.checked.exists: false`) or a later startup (`true`). For a later-startup comparison, reload/reopen the same installed app with its local database intact. For first-sync comparison, use a staging workstation that has not previously synced that church's content; preserve the tablet's existing data and do not reset it just to manufacture a first-sync state. Note the Bible local count and actual processed documents separately because it has no matching checkpoint signal.

## Changes and regression coverage

Normal initial-pull queue settings are now `100 × 2`; the diagnostic reduced mode is `25 × 2`. The live content sync retains its existing batch/retry behavior. The sequential mode adds hydration and initial-pull completion gates only for that experiment. Automated tests cover the staging build gate, each database policy, no database retry in `skip-databases`, Bible-only prerequisites, both batch settings, sequential cache/pull ordering, and the item-cache hydration callback.
