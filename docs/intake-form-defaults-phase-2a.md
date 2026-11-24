# Phase 2A: reusable intake form defaults

## Goal

Configure reusable church preferences within the existing form editor. New
manual forms and suggested forms copy those preferences independently of their
scheduling scope. There is no template-management system.

## Existing architecture and investigation

Fetched `origin/in-progress-3` and `origin/in-progress` before editing.
`in-progress-3` was `e278d19a946c04c22a9933b18a5896feeae763ea`, matching the
Phase 1 audit commit. Its only unique commit is that Phase 1 work. The other
branch is `e6701783deef286766bcef5ccc054734010d345d` and has three unique Song V2
commits (`1e3a06cc`, `d4e73acd`, `e6701783`). No commits were merged. Intake editor
and suggestion behavior had not changed since the supplied investigation.

Read AGENTS.md, the Phase 1 audit, both intake/SMS feature contracts, and the
planning, React quality, persisted mutation safety, reliable mutation, brand
voice and code review skills. Church service timezone settings provide an
existing church-document persistence pattern; access revisions provide an
existing conflict-checking precedent. Forms already support wording overrides,
and the public renderer already resolves blanks against built-in text.

## Before behavior

Manual forms start with all general fields or availability alone, and blank
wording. Team suggestions use blank wording; general suggestions may inherit
another form's fields and wording. The availability editor hides wording.
There is no reusable church-level form preference.

## After behavior

Opening manual creation copies the matching loaded church preferences once.
Administrators select Teams, dates and services as before. Both form purposes
remain individually editable. Availability forms expose welcome and availability
instructions; personal-information controls remain excluded.

**Save as default** persists only reusable settings for the current purpose.
It has its own pending lock, success/error feedback, and API. It does not create
or save the form and does not replace the draft, including edits made while the
request is pending. Create/Save form remains separate. Reload defaults refreshes
preferences and revisions without replacing draft settings.

Suggestions receive defaults as an input, with no network request in the
calculation. New forms use preferences; existing-form updates use their saved
settings and purpose. Generated dates, Teams, services and occurrences retain
authority, and issued-request protections remain in place.

## Product Decision Check

Authorized by the current Phase 2A request and recorded in
`features/personalized-team-intake.md` and `features/team-availability-sms.md`.
Separate purpose defaults, church ownership, broad write/scoped read permissions,
new-form copying, existing-form immutability and availability-only restrictions
are explicit requirements. Creation waits for a successful load rather than
silently saving a blank fallback after a load failure. No consequential product
question remains unresolved.

## Behavior intentionally unchanged

Phase 1 field-presence, explicit clearing, occurrence-scoped replacement,
transaction, member concurrency and completed-recipient retry logic is untouched.
Public and recipient authorization, general/public form links, recipient scope,
coverage detection, scheduling and SMS dispatch retain their existing paths.
No production data, real SMS, response prefilling or Phase 2B work was performed.

## Acceptance criteria and implementation

- Church document: `intakeFormDefaults` holds optional `general_intake` and
  `team_availability` settings; `intakeFormDefaultsRevisions` holds independent
  opaque purpose revisions. Missing preferences use built-in creation settings.
- GET/POST `/api/churches/:churchId/team-intake/defaults` use existing auth/CSRF
  infrastructure. Broad Teams editors and church admins can save. Scoped Team
  editors can read and use defaults; read-only viewers do not request them.
- The server rejects unknown fields, invalid types and messages over 500
  characters, normalizes legacy field aliases and trims wording. Availability
  defaults accept only two wording properties.
- Firestore reads current preferences and compares revisions inside a transaction.
  Same-purpose stale writes return 409. Different-purpose and unrelated settings
  survive transaction retries. The existing church settings lock serializes the
  development memory fallback.
- Defaults contain no scheduling, response or recipient data. Saving them writes
  only the two preference fields on the church document.
- The client gates creation while loading, offers retry on failure, cancels old
  loads, suppresses retired save acknowledgments, and keys the manager by church.
  Dirty comparison uses the initial creation snapshot, independently of defaults
  saves/reloads; closed panels cannot leave a stale navigation guard.

The added source covers an API boundary, validation/concurrency, two purpose
settings, shared creation copying and the editor lifecycle. A small shared pure
helper prevents manual and suggested creation from diverging. No independent
store, collection, subsystem, hook framework or template UI was added.

## Affected surfaces

- `server.js`, `server/teamsAuthHandlers.js`: routes, authorization, validation,
  church preference reads and transactional writes.
- `client/src/api/auth.ts`, `authTypes.ts`: typed authenticated API contract.
- `intakeFormDefaults.ts`, `intakeAvailabilitySuggestion.ts`: shared creation
  copying and pure suggestion input; existing update settings preserved.
- `managers/IntakeManager.tsx`, `pages/TeamsFormsPage.tsx`: editor controls,
  loading/recovery, draft ownership and church retirement.
- Adjacent server/client suites, both feature contracts and the release fragment.

The production route uses GlobalInfoContext, TeamsPageProvider, toast and Teams
navigation guard providers. Page integration tests mount TeamsFormsPage with
faithful church, permissions, data and navigation/toast boundaries, mocking API
transport. Server suites compose the real auth handlers and permission guards;
the concurrency mock retries transactions when a read version changes.
Browser/Electron use the same React/API path. Display outputs and IPC are not
changed.

## Risks / edge cases

A lost save acknowledgment can leave the client with an old revision. A retry
receives a conflict rather than overwriting; Reload defaults updates the revision
while preserving the draft. An in-flight write belongs to its original church;
a late success after church retirement cannot update another editor.

Defaults refresh on Forms entry or Reload defaults, not through a live
cross-device subscription. Another administrator's changes are durable and
available after refresh; revisions protect stale saves. The development memory
store remains process-local and volatile. Deploy server and client together;
no migration, index, new collection or production setup is required.

## Questions requiring user input

None.

## Verification

Commands below ran from the repository root (native `cmd.exe` was used for final
client checks to avoid PowerShell treating Jest stderr summaries as shell errors).

```text
node --import tsx --test --test-name-pattern="intake defaults" server/teamsApi.test.js server/teamIntakeRecipientConcurrency.test.js
```

5 passed. Covers memory overlap, strict validation, tenant isolation, scoped
reader/broad writer permissions and both controlled Firestore conflict races.

```text
node --import tsx --test server/teamsApi.test.js server/teamIntakeTransactionDigest.test.js server/teamIntakeRecipientConcurrency.test.js server/teamAvailabilityWorkflow.test.js server/teamIntakeRecipientToken.test.js server/intakeSubmissionDigest.test.js
```

375 passed, 0 failed, 3 skipped. Skips require the Firestore emulator: the existing
intake map-semantics, contact-index and schedule-SMS tests. No new test is skipped.

```text
npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/intakeAvailabilitySuggestion.test.ts src/pages/Teams/managers/IntakeManager.test.tsx src/pages/Teams/pages/TeamsFormsPage.workspace.test.tsx src/pages/Teams/TeamIntakePublic.test.tsx src/pages/Teams/intakeFormFields.test.ts src/pages/Teams/TeamsAndServices.test.tsx
```

265 passed across 6 suites at that implementation checkpoint. After adding the
last tests and fixes, executed the five intake suites again:

```text
npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/intakeAvailabilitySuggestion.test.ts src/pages/Teams/managers/IntakeManager.test.tsx src/pages/Teams/pages/TeamsFormsPage.workspace.test.tsx src/pages/Teams/TeamIntakePublic.test.tsx src/pages/Teams/intakeFormFields.test.ts
```

127 passed across 5 suites. After the final read-only viewer fix, reran both
editor suites (51 passed):

```text
npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/managers/IntakeManager.test.tsx src/pages/Teams/pages/TeamsFormsPage.workspace.test.tsx
npm.cmd run lint:check --prefix client
npm.cmd run type-check --prefix client
npm.cmd run build:heroku --prefix client
node --check server.js
node --check server/teamsAuthHandlers.js
git diff --check
```

Lint, TypeScript, server syntax and whitespace checks passed. Heroku build passed
with existing CSS URL/minification and chunk-size warnings. The initial sandboxed
build could not read Vite configuration; the successful builds used filesystem
access approved for this command. Earlier test runs exposed old-contract
expectations and test-fixture issues; these were corrected and rerun. Updated
expectations are authorized by the request: availability wording is now editable,
and new general suggestions use church preferences instead of another form.

## Final code review

### Findings

Critical: None. High: None. Medium: None. Low: None remaining in scope.
Review found and fixed a stale closed-panel dirty baseline and an unnecessary
forbidden defaults load for read-only viewers. Existing-form suggestion updates
also retain their own purpose instead of borrowing a prior form's purpose.

### Product authorization status

Authorized: persistence, editor controls, copy-on-create and suggestion changes
are explicitly requested. Load/failure behavior enforces the requested asynchronous
safety. Existing scope and response contracts remain unchanged.

### Open questions / assumptions

None blocking. Live preference subscriptions were not requested; refresh and
revision conflict handling provide the scoped settings boundary.

### Verification gaps

Required gaps: None. Production-context verification: Pass for this workflow
review. Optional checks not performed: real-browser visual inspection, real
Firestore emulator rerun, production traffic, full repository suites and CI.
The new whole-field preference transaction does not alter Phase 1 nested-map
replacement semantics.

| Invariant | Production owner / consumer and writer | Controlled sequence / executed evidence | Result |
| --- | --- | --- | --- |
| Concurrent settings survive | Church document, defaults API | First transaction pauses before commit; competing purpose and timezone commit; retry preserves both (`teamIntakeRecipientConcurrency.test.js`) | Pass |
| Stale same-purpose writes fail | Purpose revision, defaults API | Competing same-purpose save commits before first transaction retry; first returns 409 (same suite) | Pass |
| No tenant leakage | Auth guards and church-keyed manager | Church A read/save against B rejected (`teamsApi.test.js`); A-B-A load and late save into B (`TeamsFormsPage.workspace.test.tsx`) | Pass |
| Draft edits survive | IntakeManager draft | Save starts, wording edited, acknowledgment arrives; reload during dirty draft; failed save, edit, reload, retry (`IntakeManager.test.tsx`) | Pass |
| Defaults cannot change existing forms | Dedicated church writer and suggestion update builder | Form snapshot/token unchanged (`teamsApi.test.js`); both suggestion purposes preserve wording (`intakeAvailabilitySuggestion.test.ts`) | Pass |
| Phase 1 integrity | Existing intake member/recipient transactions | Existing field-presence, scoped clearing and completed-request digest regressions in executed server suites | Pass |

Comparison coverage: **Entire change set inspected**. Scope: **workflow review**,
not release-wide production readiness. Tests listed above were inspected and
executed; related runtime auth error formatting, server registration, provider
composition, public copy resolution and sibling church-setting writers were
also inspected.

| Workflow / changed path | Production path and downstream consumer | Test evidence | Excluded area |
| --- | --- | --- | --- |
| Defaults storage/access | server.js -> composed auth handlers -> church document | Full modified server suites and controlled transaction races | Production data and real messaging, prohibited |
| Manual creation/save defaults | TeamsFormsPage -> IntakeManager -> auth API | Both editor suites, including deferred loads/saves and church switches | Browser visual QA, optional |
| Suggested creation/update | Loaded defaults -> pure suggestion -> existing editor | Suggestion suite plus existing manager scope/issued-request tests | Scheduling changes, out of scope |
| Public wording and Phase 1 | Saved form -> public preview/render; existing recipient/member writers | Public form, field, workflow, digest and transaction suites | Phase 2B, out of scope |
| Documentation/release | Both contracts, this report and release JSON | Complete text and diff inspected | None |

### Pattern / learning opportunities

Keep creation preferences separate from scheduling authority and draft baselines.
Retain controlled transaction retries and A-B-A lifecycle tests; no additional
repository policy or framework is needed.

### Final readiness

Ready for this Phase 2A workflow scope.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; church settings and both creation paths.
- Legacy/persisted-state compatibility reviewed: Yes; absent defaults retain built-ins.
- Identity-switch test reviewed or added: Yes; A-B-A read and late-save retirement.
- Unmount/lifetime test reviewed or added: Yes; keyed manager retirement.
- Contract round trip traced: Yes; editor -> API -> normalization -> church -> copied draft -> form -> public wording.
- Validate/use security boundary reviewed: Yes; original church and current edit guard.
- Retry-state authority reviewed: Yes; purpose revision and retained draft.
- Owner-retirement handoff reviewed: Yes; server write may finish for original owner; local publication is suppressed.
- External side-effect adoption/compensation reviewed: Not applicable; no provider work added.
- Authorization/data-projection reviewed: Yes; scoped readers receive preference settings only.
- Production entry point, runtime context and test composition compared: Yes.
