# Intake data integrity audit

## Goal

Preserve member information that a form does not collect, including omitted
fields, while retaining explicit clearing and form-scoped replacement.

## Existing architecture

`submitTeamIntake` validates public responses and saves them for administrative
processing. Recipient links call `submitTeamIntakeRecipient`: Firestore commits
member, response, recipient and team updates in one transaction; the fallback
persists the deterministic response before applying it. Administrative processing
and fallback recipient submissions share `applyTeamIntakeSubmissionToMember`.
The client posts its initialized payload, including empty collections.

## Before behavior / confirmed failure paths

- Validation emits `positionIds: []` for disabled positions. General recipient
  transactions and shared application unconditionally assign desired positions.
  Public responses reproduce this when subsequently linked to an existing member.
- Validation emits `occurrenceAvailability: {}` for disabled or absent availability.
  All application paths remove the form's occurrence keys before overlaying this
  map. Stored occurrence snapshots survive disabling the field, making this a
  real clearing path. Explicit partial maps currently represent complete answers
  for the form: missing dates become unanswered. The client also deliberately
  submits `{}` to clear the response. Preserve that contract.
- Enabled but omitted blockouts, recurring availability and serving frequency
  normalize to empty/default values. Blockouts replace the form period; the
  scheduling fields overwrite member preferences in general intake.
- Shared application reads and rewrites member collections outside a Firestore
  transaction. A concurrent writer between read and commit can lose newer dates
  or profile details. The in-memory path already shares the roster-member queue.
- Recipient identity is deterministic, but a completed repeated request reapplies
  member changes and can undo an intervening administrator edit.
- New members have no existing values to lose. Notes are stored on the response
  and copied only when creating members; existing-member notes and eligibility
  are not replaced. Missing personal details already use fill-only semantics.
- Firestore merge-set recursively merges nonempty availability maps. Unlike the
  fallback's shallow replacement, it can retain in-scope answers intentionally
  removed by a complete response. An empty resulting map can instead clear the
  field. The emulator regression reproduced this inconsistency against the
  original implementation. Use top-level `transaction.update` to implement the
  existing complete-replacement contract consistently.

### Exact implementation locations

| Path | Location after fix |
| --- | --- |
| Disabled/omitted values normalized to clearing/default values | `server/teamsAuthHandlers.js:8050`, `validateTeamIntakeSubmissionPayload` |
| Unconditional availability scope deletion | `server/teamsAuthHandlers.js:3747`, `replaceServiceAvailabilityForForm` |
| Existing-member application and former nontransactional read/write | `server/teamsAuthHandlers.js:9206`, `applyTeamIntakeSubmissionToMember` |
| Recipient transaction and former merge-set availability persistence | `server/teamsAuthHandlers.js:9452`, `submitTeamIntakeRecipientWithFirestoreTransaction` |
| Recipient fallback and completed-request retry handling | `server/teamsAuthHandlers.js:9739`, `submitTeamIntakeRecipient` |

## After behavior / acceptance criteria

Only enabled, explicitly present response fields may replace member values.
Explicit empty positions, availability and blockouts retain their clearing
semantics. Availability replacement affects only the form occurrence scope;
blockouts affect only the form period. Both persistence paths read current member
state within their transaction or existing local serialization boundary.
Completed identical recipient requests do not reapply member changes.

## Product Decision Check

Authorization: the November 10, 2026 data-integrity request, together with
`features/personalized-team-intake.md` and `features/team-availability-sms.md`.
The request explicitly authorizes preservation of omitted/disabled fields and
requires retaining intentional complete availability replacement. No unresolved
product choice is needed for these corrections.

## Behavior intentionally unchanged

Recipient token, church/team/member checks, public review workflow, deterministic
recipient submission identity, complete availability replacement, new-member
defaults, fill-only personal details and availability-only purpose restrictions.
No UI, messaging, consent, login or production-data changes.

## Proposed implementation / affected surfaces

Retain field presence during validation and guard persisted writes using current
server form enablement. Make shared member application transactional in Firestore
and retain the existing fallback member queue. Add regression coverage through
composed auth handlers rather than a UI workaround. Runtime entry points are
the public intake and administrative routes registered by `server.js` and
`authService.js`; no rendering, Electron or provider changes are needed.

## Risks / edge cases

Old saved responses have normalized empty fields; current form enablement must
still prevent their application. Missing/deleted forms must not authorize
replacement. A complete response intentionally overwrites answers inside its
scope; a transaction must preserve concurrent dates outside that scope.
Fallback persistence has multiple durable steps and no cross-process atomicity.

## Questions requiring user input

None.

## Verification

Reproduce disabled/omitted-field failures before the fix. Exercise positions
selection and clearing, complete availability maps and clearing, repeated and
partial requests, public administrative application, new members, both purposes,
transaction retries and fallback application. Run focused server and client
intake suites, lint, TypeScript and the applicable client build. Check emulator
tooling availability and document actual execution and remaining gaps.

## Implemented result

Validation retains absence for positions, availability, blockouts, serving
frequency and recurring availability. Application requires both server enablement
and field presence, including when reviewing legacy responses. Partial requests
retain prior response answers in the deterministic audit record but apply only
the fields in the current request. Explicit availability maps still replace the
whole form scope. Notes retain their existing response/default behavior.

Shared application now reads the member in a Firestore transaction and uses
top-level map replacement. A relevant form configuration change before commit
returns 409 rather than applying stale field authority. Fallback application
retains the shared member queue. Identical completed recipient requests use a
canonical request digest to avoid replaying member writes; interrupted final
recipient bookkeeping resumes from the applied response checkpoint.

The source fix adds roughly 120 lines and removes roughly 90. The additional
code covers the existing independent write paths, current-state validation and
the retry checkpoint. It introduces no service, queue, endpoint or form system.
The bulk of added lines are regression tests and this audit.

## Executed verification

- Before fixing field writes, the new transaction tests had five failures:
  disabled/omitted general fields, disabled/omitted availability-only fields and
  replay over an intervening member edit.
- Against the original `HEAD` implementation, both administrative concurrency
  regressions lost the concurrent availability key, and the actual Firestore
  emulator regression retained an intentionally removed in-scope answer. The
  fixed source was restored immediately after this controlled comparison.
- With `FIRESTORE_EMULATOR_HOST=127.0.0.1:8091`, ran:

  ```powershell
  node --import tsx --test server/teamsApi.test.js server/teamIntakeTransactionDigest.test.js server/teamIntakeRecipientConcurrency.test.js server/teamAvailabilityWorkflow.test.js server/teamIntakeRecipientToken.test.js server/intakeSubmissionDigest.test.js server/firestoreNestedMapSemantics.test.js
  ```

  Result: **374 passed, 0 failed, 0 skipped**, including every test in each
  modified server test file and the real emulator boundary. The emulator used
  synthetic demo projects; no production data was used.
- `npm.cmd test --prefix client -- --runInBand --runTestsByPath src/pages/Teams/TeamIntakePublic.test.tsx src/pages/Teams/intakeFormFields.test.ts src/pages/Teams/managers/IntakeManager.test.tsx`:
  **58 passed across 3 suites**.
- `npm.cmd run lint:check --prefix client`: passed, no warnings.
- `npm.cmd run type-check --prefix client`: passed.
- `npm.cmd run build:heroku --prefix client`: passed. Existing CSS URL and chunk
  size warnings remain; this task does not alter their sources. The initial
  sandboxed attempt failed to read the Vite configuration; the successful build
  ran with the required filesystem access and a native command shell.
- `node --check server/teamsAuthHandlers.js` and `git diff --check`: passed.

## Separate architectural observations for the next phase

These are existing boundaries, not additional implementations in this fix:

- Historical responses do not record whether an old normalized empty value was
  explicitly entered or produced by disabled fields. Current enablement blocks
  disabled-field writes; no historical-data repair or inferred migration is
  attempted. Newly stored absent fields remain distinguishable.
- An explicitly submitted availability map is a complete response, even if it
  contains only some dates. Existing clients initialize and send the full map.
  Reopening a link does not prefill saved answers. Editable/prefilled responses
  will need to distinguish a deliberate complete response from a dirty-field
  patch and should carry response revisions for stale-editor conflicts.
- The request digest fences retries of the latest completed recipient request.
  Without a client operation ID or response revision, an older distinct request
  arriving after another response is indistinguishable from a deliberate new
  complete response. No historical request ledger is introduced here.
- Public general links still create independent review records. Administrative
  new-member creation, team membership updates and review status are separate
  durable operations. They do not acquire recipient-style identity or a new
  cross-document processing architecture in this fix.
- The fallback is process-local and volatile. It provides local serialization,
  not Firestore's cross-process transaction guarantees.

## Final code review

### Findings

Critical: None. High: None. Medium: None. Low: None within this fix's scope.
The architectural observations above are future response-editing design inputs.

### Product authorization status

Authorized by the November 10 request: field absence preservation, explicit
clearing, server authority, concurrent unrelated-data preservation and retry
safety. Complete availability replacement remains intentional. The personalized
intake feature contract records the clarification. No unapproved UI or messaging
behavior was introduced.

### Open questions / assumptions

No blocking product questions. A present availability map remains a complete
response under the existing contract; omission of the whole field is preservation.

### Verification gaps

Required verification: none. Production-context verification: Pass for this
workflow review. Traced `server.js` public `/api/team-intake/submit`, recipient
`/a/` API routing and authenticated submission review through composed
`authService.js` handlers. The server tests use those handlers with real auth
fixtures; the emulator test covers actual nested-map write behavior. Client
routes continue to use the existing public form and normalized review data.
Live production traffic and exhaustive repository-wide CI were not exercised.

| Invariant | Production owner / consumers and writers | Adversarial sequence and exact evidence | Result |
| --- | --- | --- | --- |
| Uncollected fields survive | Intake validator and roster member; public review and recipient handlers | `general_intake` / `team_availability` transaction preservation matrix; fallback application and recipient tests | Pass |
| Outside dates survive intentional clearing | Member availability map; complete form responses | Emulator `Firestore emulator intake replaces only explicit form-scoped availability`; fallback and transaction selection/clearing tests | Pass |
| Concurrent newer unrelated values survive | Member transaction; admin and volunteer writers | Both `administrative intake application retries against concurrent member changes` tests; concurrent recipient transaction test | Pass |
| Current form authority governs commit | Form configuration and administrative application | `administrative intake application rejects form enablement changed before commit` | Pass |
| Completed retry cannot undo a later edit | Deterministic recipient response; both persistence paths | Transaction lost-ack test and both fallback recipient tests, including interrupted final recipient bookkeeping | Pass |

Comparison coverage: **Entire change set inspected**. Review scope: **workflow
review**, not a release-wide production-readiness audit.

| Workflow / changed path | Production path and downstream consumer | Tests inspected and executed | Excluded area |
| --- | --- | --- | --- |
| Public review and member application | Public submit -> stored response -> authenticated apply -> roster | Entire `teamsApi.test.js`; new-member and legacy-response tests included | New processing architecture, explicitly outside scope |
| Recipient responses | Recipient/volunteer authorization -> transaction or fallback -> member/response/recipient | Transaction, concurrency, availability workflow, token and digest suites; emulator | Future prefilling/editing UI |
| Client response shapes | Public payload and normalized Forms review records | Public form, field resolution and intake manager suites; lint/types/build | Unchanged rendering and Electron workflows |
| Contract and release note | Documentation and product update feed | Complete text and JSON inspected | None |

### Pattern / learning opportunities

Field presence and form enablement are independent write requirements. In-memory
shallow merge tests cannot establish Firestore nested-map replacement semantics;
retain the emulator regression for future response editing.

### Final readiness

Ready for the next phase within this data-integrity fix's scope. The next phase
must explicitly design dirty-field and revision semantics before response editing.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; all intake member-write paths reviewed.
- Legacy/persisted-state compatibility reviewed: Yes; historical ambiguity noted.
- Identity-switch test reviewed or added: Yes; existing token, church/team/member
  rejection tests and transaction membership-removal regression executed.
- Unmount/lifetime test: Not applicable; no client lifecycle changes.
- Contract round trip traced: Yes; request, validation, persisted response, member
  application, bootstrap normalization and review display.
- Validate/use security boundary reviewed: Yes; current transactional scope and
  form configuration checks occur before write or successful duplicate return.
- Retry-state authority reviewed: Yes; applied response checkpoint and digest.
- Owner-retirement handoff: Not applicable; no long-lived client operation added.
- External side-effect adoption/compensation: Not applicable; no provider change.
- Authorization/data-projection reviewed: Yes; existing projections unchanged.
- Production entry point, runtime context and test composition compared: Yes.
