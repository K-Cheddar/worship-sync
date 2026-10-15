# Goal
Resolve verified review findings locally on in-progress without merging, deploying, or sending messages.

# Existing architecture
Schedules use validated edits over persisted documents, Firestore transactions or in-memory occurrence locks, and queued client cell mutations. TeamsPageProvider owns the production Teams routes; the shared timezone provider owns church-scoped settings. Browser smoke uses saved authentication and shared IndexedDB.

# Before behavior
The two supplied commits preserve schedule metadata, acquire imported occurrence locks, normalize stale standalone claims, and guard shadow retries. Remaining risks include retry action retirement, sequence reuse after cleared edits, legacy claim normalization, reconnect closures, and incorrect smoke assumptions.

# After behavior
Persisted operational fields survive edits; one active schedule owns each occurrence; superseded shadow actions cannot replay or overwrite current choices. Refresh requests stay within the current church. Smoke navigation selects editable teams and accepts genuine empty periods.

# Product Decision Check
The current request explicitly authorizes every correction and isolated disposable smoke data. docs/features/team-scheduling.md confirms schedule identity, data preservation, and same-church retained timezone behavior. No new product policy or sending behavior is introduced.

# Behavior intentionally unchanged
Permissions, edit-mode occurrence behavior, publication and sending, existing schedule identity and creation timestamps, manual assignment semantics, and scheduling reconciliation remain intact.

# Acceptance criteria
Verify each numbered and additional finding against code; cover metadata in both stores, import/create contention, shadow failure/retry/removal/queue/remapping, current-church reconnect refresh, editable-team navigation, and empty/populated periods. Run affected client/server tests, lint, types and production builds; report all failures.

# Proposed implementation
Retain both supplied commits; use existing pending-cell/toast registries and persisted-ID helper, local lifecycle guards, and narrowly corrected smoke selectors/assertions. Remove the obsolete navigation entry only after reference search.

# Affected surfaces
Authenticated server schedule endpoints and portable imports; TeamsAndServices/TeamsPageProvider schedule editor and forms; shared timezone provider and workspace shell; saved-auth browser smoke plus isolated browser fixtures. No display composition, IPC, or messaging changes.

# Risks / edge cases
Failed add followed by removal and new edit, queued superseded operation, virtual ID remapping, old response after new intent, stale standalone versus genuine group claims, church switch during delayed refresh, empty versus failed loading.

# Questions requiring user input
None.

# Verification
Required: focused server handler/transaction tests; TeamsAndServices, ScheduleEditForm, timezone, Forms and shell tests; isolated browser navigation and smoke-fixture scenarios; client lint/type checks; web and Electron production builds. Firestore emulator availability and saved-auth isolated church availability will be checked and any unavailable required runtime validation reported.
