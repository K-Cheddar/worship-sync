# Capacitor + PouchDB native SQLite proof of concept

## Scope and current result

This experiment lives in `client/mobile-poc`. It has its own React/Vite app, package manifest and lockfile, Capacitor Android and iOS projects, and a separate browser IndexedDB peer. It does not enter the normal web or Electron dependency graph. The normal WorshipSync app, service-plan writers, controller synchronization, song-v2 schema, server, and CouchDB configuration are unchanged.

The UI requires a native Android/iOS runtime and `window.sqlitePlugin.openDatabase`. It opens independent local content and board PouchDB databases, verifies their PouchDB tables and SQLite page metrics through `cordova-sqlite-storage`, and fails closed if that native check fails. It does not choose IndexedDB or WebSQL as a fallback. A separate browser peer intentionally uses IndexedDB.

The remote content database is fixed to `worship-sync-demo`. The board database is fixed to `worship-sync-boards` and filtered to `database: "demo"`. The app signs in through Firebase email/password plus WorshipSync's existing `/api/auth/session` and email-code verification routes. Before requesting `/api/getDbSession`, it checks `/api/auth/me` and requires `authenticated: true` and `database: "demo"`. It does not store the password or Firebase Auth session persistently. Other sign-in providers are not implemented in this small harness.

Initial remote replication is one-way into local storage, using `replicate.to(localDb)` with the existing content and board selectors. Outbound replication is a separate opt-in action that accepts only a locally registered `mobile-poc:test:` document, validates its demo-test type, and sends one explicit `doc_ids` value. The browser peer has the same exact-ID constraint. The POC never calls unrestricted `sync()` against demo.

The POC reuses WorshipSync's `discoverSongLibrary`, `loadSong`, song search enrichment, service-plan song reference formatter, song-v2 serialization in tests, and `getLocalBoardPosts`. Its diagnostics scan pages through local documents and only hydrates the selected song.

## Architecture findings

- The controller uses the authenticated API's `getDbSession` route with `credentials: "include"`, then starts live PouchDB sync with the content selector excluding `media`. Session failures trigger session renewal and a new live handle.
- The board provider bootstraps board access, renews the same CouchDB session, and uses a board-database selector. The POC keeps boards in a separate local database and keeps both flows read-only.
- Existing song-v2 roots, arrangements, slides, tombstones, rollback discovery, search, full-song hydration, and plan-reference formatting remain in the existing shared modules. The POC adds no replacement song schema.
- The server's credentialed CORS origins are assembled from `frontEndHost`, `AUTH_APP_BASE_URL`, `AUTH_ALLOWED_ORIGINS`, and a small existing local-development list. `getDbSession` returns a secure `.worshipsync.net` cookie with `SameSite=None`. Native WebView origins and cross-site cookie delivery still need staging and physical-device checks.

## Compatibility findings

The tested package set is Capacitor 8.6.2, PouchDB 9.0.0, `pouchdb-adapter-cordova-sqlite` 2.0.8, and `cordova-sqlite-storage` 7.0.0. Capacitor 8's Cordova-plugin bridge recognized the SQLite plugin during both Android and iOS sync. A Node probe confirmed that the adapter registers with PouchDB 9 and calls `window.sqlitePlugin.openDatabase`; the probe deliberately makes that mock API fail, so it does **not** prove a successful native database open.

The risk is the adapter's maintenance and internal dependency boundary. The community adapter README describes PouchDB 6-era support, waits for Cordova `deviceready`, and falls back to `openDatabase` (WebSQL) if opening its SQLite plugin fails. Its package depends on `pouchdb-adapter-websql-core` 7.x. That core package labels itself as an internal, non-semver API tied to a PouchDB version, has no 9.x package to override to, and is old. A trial override to 9.0.0 could not resolve from npm. The POC therefore does not force an unsupported internal-core override. Its additional file/table check is intended to detect fallback, but it has not run on a device.

Capacitor plugin recognition does not establish runtime compatibility with current Android System WebView or iOS WKWebView. The native SQLite plugin must open successfully after `deviceready`; Android SQLite tables and PRAGMA results, iOS Library-location behavior, cookies, replication, attachments, interrupted writes, restart durability, and file locking all remain device checks. The iOS Capacitor sync emitted a warning that the plugin's `-w` compiler flag is not supported by Swift Package Manager; Xcode compilation is required to determine whether that is harmless. The SQLite plugin documentation also warns against opening a database file concurrently through different SQLite plugins; this POC only uses this plugin for PouchDB and its read-only verification handle.

### Research sources

- [PouchDB adapter guide](https://pouchdb.com/adapters.html) recommends the browser's IndexedDB adapter for browser use and describes Cordova SQLite as an additional native adapter.
- [Cordova SQLite PouchDB adapter](https://github.com/pouchdb-community/pouchdb-adapter-cordova-sqlite) documents its native API detection, WebSQL fallback, and `deviceready` requirement.
- [Cordova SQLite Storage plugin](https://github.com/storesafe/cordova-sqlite-storage) documents platform setup and native SQLite behavior.
- [Capacitor Cordova plugin guide](https://capacitorjs.com/docs/plugins/cordova) documents the Cordova compatibility bridge; it does not certify every Cordova plugin with every Capacitor/runtime version.

## Setup

From the repository root:

```powershell
Set-Location client/mobile-poc
npm ci
Copy-Item .env.example .env.local
```

Fill `.env.local` with the desired API and CouchDB service origins and the public Firebase web-app configuration values used by WorshipSync (`VITE_FIREBASE_*`). These are client configuration values; do not add a password, Firebase service-account key, CouchDB credential, or other secret. The runtime form also lets the tester change and save service origins locally.

Before sign-in, add only the required native WebView origins to a **staging** API `AUTH_ALLOWED_ORIGINS` list and the staging CouchDB CORS `origins` list. This app uses `https://localhost` on Android and `capacitor://localhost` on iOS. The browser peer runs at `http://localhost:5173` by default. Do not add `*` or weaken production CORS. The app must be served securely for cookie authentication.

Build and create/synchronize the native projects:

```powershell
npm run build
npx cap sync android
npx cap open android
```

If the native platform folder is absent, create it once with `npx cap add android` before `npx cap sync android`. Android Studio needs a supported JDK, Android SDK/build tools, and a connected device or emulator. From a configured command-line environment, `npx cap run android` builds and deploys to a selected device. Keep the app origin at the configured Capacitor scheme; do not point the app at an untrusted live-reload server for auth/cookie tests.

For iOS, on macOS with Xcode:

```sh
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

If `ios/` is absent, run `npx cap add ios` once first. Resolve packages and build/run on an iOS simulator and real device from Xcode. A Windows host cannot validate this step.

For the desktop browser peer, start `npm run dev -- --port 5173` and open `http://localhost:5173/peer.html`. Add that exact origin to the staging API and CouchDB CORS lists for the browser-only sync scenarios. The peer's local store is IndexedDB, not SQLite.

## Test procedure

1. Sign in using an account whose `/api/auth/me` bootstrap resolves to the `demo` database. If the account is not `demo`, the POC rejects it before requesting a CouchDB session.
2. Pull demo content and boards. Confirm each local diagnostics card reports `cordova-sqlite`, the expected PouchDB tables, document count, and measured SQLite page size.
3. Create a local persistence sample, read/update/delete it, force-close the app, reopen, and read it again. Repeat after an Android device restart and with offline edits.
4. Load the library; check legacy and song-v2 counts, title and lyric queries, metadata/key, select one song, and inspect the constructed `ServicePlanSongReference`. Compare IDs and content with desktop WorshipSync.
5. Inspect a demo discussion board after board pull.
6. For remote-write scenarios only, create a namespaced test document, copy its ID to the desktop peer, and enable each client's explicit push control only when ready. Do not push the downloaded demo database. Pull to test mobile-to-desktop and desktop-to-mobile, then make offline and simultaneous edits. Inspect every conflict leaf; this POC does not auto-resolve conflicts.
7. Delete only the dedicated test document locally and explicitly push that exact tombstone. Confirm both clients retain the deletion. Clean up only that test ID.

## Results available in this environment

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Isolated POC TypeScript + Vite production build | Passed | `npm run build` in `client/mobile-poc`; builds both app and peer pages. |
| Focused POC tests | Passed, 13 tests | Memory-adapter CRUD, runtime fail-closed checks, mocked Cordova adapter registration/API call, demo selectors and auth gate, outbound ID restriction, desktop-created test-document inspection, song-v2 library paging/hydration/search/plan reference/tombstone/rollback and conflict leaves. Does not execute native SQLite. |
| Capacitor Android sync | Passed | Generated Android platform, bundled POC, and found `cordova-sqlite-storage@7.0.0`. |
| Capacitor iOS sync | Passed with warning | Generated iOS project and found the plugin; plugin's `-w` Swift Package Manager compiler flag was ignored. No Xcode build. |
| Android Gradle compile | Blocked | `gradlew.bat assembleDebug` stops because Java/JDK is unavailable. `ANDROID_HOME`, `ANDROID_SDK_ROOT`, Android SDK, and `adb` are absent. |
| Physical Android SQLite, restart, offline, background/force-close | Not run | No emulator/device or Android SDK/JDK. |
| macOS/iOS compile and device | Not run | This Windows environment has no Xcode/macOS. |
| Live demo login, remote replication, song/board reads, bidirectional test docs | Not run | No staging CORS allowlist/session or test account was supplied/configured in this environment. No remote database was created or written. |
| Normal WorshipSync web build | Passed | `npm run build` in `client`; existing CSS and dynamic-import warnings remain. |
| Normal WorshipSync Electron build | Passed | `npm run build:electron` in `client`; existing CSS warning remains. Its configured Sentry plugin uploaded build source maps as part of this existing build script. |

The automated PouchDB conflict test proves that the installed PouchDB 9 memory adapter preserves two competing leaves for inspection. It does not establish that the old Cordova SQLite adapter preserves those branches or behaves correctly under native interruptions. No measured native startup, replication throughput, SQLite file size, WebView heap, CPU, warm restart, or real-device comparison is available yet.

## Recommendation

**Use option 3 provisionally: keep PouchDB + CouchDB and use IndexedDB in Capacitor until native-device evidence or a maintained PouchDB 9 SQLite adapter exists.** The current POC is useful as a test harness, but the current Cordova adapter sits on a stale PouchDB 7 internal API, and successful Capacitor plugin discovery plus a mocked API call are not sufficient evidence for durable production data. PouchDB's own adapter guide favors IndexedDB for browser environments. This does not justify a move to RxDB or another synchronization system: it preserves CouchDB, PouchDB document formats, selectors, and conflict semantics while avoiding a premature native storage commitment.

To reconsider native SQLite, first build/run on Android and iOS, verify the native file/tables after create/write/restart/interrupted replication, exercise authenticated demo pulls and the exact-ID test-document scenarios, compare IndexedDB and SQLite on lower-end tablets, and resolve the adapter's PouchDB 9 internal-core dependency with a maintained upstream-compatible implementation. Do not adopt a fork or relax the file verification until those results are reviewable.
