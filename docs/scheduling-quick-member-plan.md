# Scheduling quick-member creation

## Goal
Create or select a roster member inside Scheduling without losing equipment settings, duplicating people on retry, or sending messages.

## Existing architecture
ScheduleTab owns schedule identity and its assignment queue. Roster creation already synchronizes position/team membership. The picker uses shared Input/Popover controls. Team-scoped candidate search returns names and avatars only; roster add and team-profile APIs preserve other teams. MemberManager supplies phone formatting, email validation, and the existing consent modal.

## Before behavior
Creation is offered only after a failed search, collects names only, performs a destructive whole-team update, and swallows failures before the picker clears its draft.

## After behavior
A visible Add new member action opens a compact validated form with optional contacts, team/position context and debounced safe duplicate suggestions. An explicit distinct-person choice permits matching names. Durable creation is retained across assignment failure; retry assigns that member. Omitted equipment flags preserve existing values. Optional consent remains separate and administrator-only.

## Product Decision Check
The current October 18 request explicitly authorizes these changes. Applicable contracts: team-scheduling.md and member-sms-consent.md. No consequential intent remains unresolved.

## Behavior intentionally unchanged
Guest, existing member, replacement, shadow, swap, occurrence identity, targeted assignment persistence, authorization, publication and notification dispatch.

## Acceptance criteria
Request parts 1?7, including durable retry, stale-owner protection, private candidate projection, contact validation and equipment preservation through handler reload.

## Proposed implementation
Remove the redundant team write. Extend omitted-field validation. Compose a small quick-member form into the existing picker, retaining a successful member checkpoint locally. Reuse roster/profile APIs for explicitly selected existing people. Scope all asynchronous UI work to its original church/team/period/slot.

## Affected surfaces
Teams route and provider, Scheduling picker, roster and team settings handlers; existing React/Jest and in-memory real-handler tests. No display, IPC, dispatch or schema changes.

## Risks / edge cases
Duplicate clicks; lookup response reordering; creation success followed by assignment failure; close/unmount or owner change during awaits; virtual-to-persisted schedule transition; safe scoped projections and consent eligibility.

## Questions requiring user input
None.

## Verification
Targeted picker and Teams integration tests; real-handler equipment, membership, assignment and permission regressions; strict TypeScript, changed-file lint and client build. Review full task diff and deferred-response/partial-failure scenarios. Browser visual inspection if a local UI is available.


## Implementation record and file inventory

The requested flow requires local draft/validation state, one debounced remote lookup, a durable member checkpoint and an optional consent follow-up. These are composed into the existing picker rather than adding roster schemas, global search or a second assignment queue. The obsolete whole-team mutation and picker-owned name-only form were removed.

Files changed for this request:

- client/src/pages/Teams/schedule/ScheduleTab.tsx
- client/src/pages/Teams/schedule/ScheduleAssignmentPicker.tsx
- client/src/pages/Teams/schedule/ScheduleAssignmentContext.tsx
- client/src/pages/Teams/schedule/ScheduleQuickMemberForm.tsx (new)
- client/src/pages/Teams/schedule/ScheduleMemberConsentFollowup.tsx (new)
- client/src/pages/Teams/schedule/ScheduleAssignmentPicker.test.tsx
- client/src/pages/Teams/TeamsAndServices.test.tsx
- server/teamsAuthHandlers.js
- server/teamsApi.test.js
- client/e2e/schedule-quick-member.mjs (new)
- client/e2e/schedule-quick-member-entry.tsx (new)
- client/e2e/run-browser-suite.mjs (one allowed-suite entry)
- client/package.json (one browser-test command)
- docs/features/team-scheduling.md
- release-notes/2026-10-18-scheduling-quick-members.json (new)
- docs/scheduling-quick-member-plan.md (new)

Other concurrent workspace edits were preserved. The Teams test API fixture also represents the pre-existing volunteer-access API so the Members route can mount faithfully.

## Final review

Review scope: workflow review of Scheduling quick creation and the omitted-equipment-flags fix; this is not a production-readiness review of other concurrent branch work.

### Findings

Critical / High: None in the requested changes.

Medium: The full project TypeScript command currently reports an unsupported `exact` option in the concurrently edited client/src/components/Modal/Modal.test.tsx. This file is outside this change and was left intact. It blocks an unrestricted all-project type-check and release readiness.

Low: None requiring a change. Existing production build chunk-size warnings and the Teams test table-whitespace warning remain outside this task.

### Product authorization status

Authorized by the October 18 product-owner request and the updated Team Scheduling contract. Optional consent retains the administrator-only, consent-needed, source/date/confirmation and STOP boundaries of the Member SMS Consent contract. No dispatch, invitation, account or profile-schema changes.

### Open questions / assumptions

No unresolved product choices. Candidate matches are suggestions; name/contact similarity never merges identities. Deliberately creating a different person with the same name remains supported.

### Verification gaps and evidence

Production-context verification: Pass for the actual Teams route/provider in Jest, the real in-memory server handlers, and Chromium using the real picker/Input/Popover composition with the controller context and candidate endpoint supplied as fixtures. No live church data was used.

| Invariant | Controlled transition | Code inspected | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Equipment survives | Create roster member, assign, save microphone/IEM, reload | validateTeamSettingsPayload, createTeamRosterMember, syncMemberTeamMembership | Real-handler quick member equipment regression | Pass |
| Retry does not recreate | Creation commits, assignment rejects, retry with returned member ID | createMemberForCell, ScheduleQuickMemberForm.submit | Teams quick member workflow: assignment failure; picker partial-success test | Pass |
| Unknown create is not repeated | API reachability failure, primary disabled, refresh roster, select existing/distinct person | submit, checkRoster | Picker uncertain-create test | Pass |
| Old owners cannot commit | Deferred create under church A, switch to B with same schedule fixture IDs, resolve A; separately unmount before resolving | quickMemberOwnerRef, assertCurrent | Teams church-change and unmount regressions | Pass |
| Search responses stay current | Query changes before old response resolves | candidate effect cleanup | Picker stale-lookup regression | Pass |
| Pending means accepted | Double activation before completion | synchronous lock and pending UI | Picker deferred duplicate-click test | Pass |
| Newer cell edits survive | Independent microphone changes resolve out of order; targeted writes overlap | existing assignment queue and publishScheduleSnapshot pending-edit merge | Teams out-of-order coverage; full teamsApi suite | Pass |
| Scoped lookup stays private | Team-scoped roster lookup and profile patch | requireTeamsEditForTeam, safe candidate projection, team-profile slice mutation | Existing real-handler scoped roster/profile permission tests, full suite | Pass |
| Consent stays optional | Current eligibility consent_needed vs opted_out/enabled; explicit modal confirmation | ScheduleMemberConsentFollowup, RecordSmsConsentModal | Picker consent follow-up tests | Pass |
| Form stays usable | 320x568 and 1280x800, type contacts, Tab, Enter, Escape, restore trigger focus | real picker and Input/Popover | schedule-quick-member browser suite and inspected screenshots | Pass |

Required checks executed:

- node --import tsx --test server/teamsApi.test.js: 273 passed, zero skipped.
- Six focused client suites (TeamsAndServices, ScheduleAssignmentPicker, useScheduleMemberPicker, schedulePickerOptions, ScheduleAssignmentPicker.placement, ScheduleMicrophoneSelect): 193 passed.
- Final picker/placement rerun: 30 passed; final route-level quick-member rerun covers the six affected success/failure/identity/selection scenarios.
- npm.cmd run lint:check --prefix client: passed, including changed-file lint.
- npm.cmd run build:strict --prefix client: passed; includes client lint and production/PWA build.
- npm.cmd run type-check --prefix client: earlier pass, then failed after the concurrent Modal test edit described above. A temporary tsconfig excluding only that unrelated test passes the remaining project, including every Scheduling source and test file. The temporary config was removed.
- Chromium: node e2e/run-browser-suite.mjs schedule-quick-member.mjs, both viewport sizes pass. Screenshots saved under ignored test-results/.
- Server syntax checks and git diff --check: passed.

Optional confidence checks not run: live Firestore/cross-device and physical mobile keyboard tests. Existing targeted-mutation concurrency and permission regressions were run; no production records were changed.

### Pattern / learning opportunities

The existing roster response and targeted assignment queue already provide the correct ownership boundaries. No new global mutation abstraction or policy is needed.

### Final readiness

Not ready for unrestricted release while the unrelated full-project TypeScript error remains. Requested Scheduling implementation is ready for review. No merge or deployment was performed.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; roster creation callers, team validators, candidate/profile APIs, other picker modes and assignment writers inspected.
- Legacy/persisted-state compatibility reviewed: Yes; existing API and record shapes retained.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes; optional contact payload through normalization and persisted roster, membership response and assignment reload.
- Validate/use security boundary reviewed: Yes; existing handlers reauthorize all mutations.
- Retry-state authority reviewed: Yes; form retains the server member ID, never editable replacement creation after partial success.
- Owner-retirement handoff reviewed: Yes; local work suppresses stale presentation and cannot offer cross-owner retries; durable members remain in the original server roster.
- External side-effect adoption/compensation reviewed: Not applicable; no uploads, messages or external resource creation. Durable roster members are never deleted as compensation.
- Authorization/data-projection reviewed: Yes.
- Production entry point, runtime context, and test composition compared: Yes.
