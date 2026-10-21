# Time-off conflict refresh correction

## Goal
Protect unsaved time off until confirmed saved dates can be reviewed.

## Existing architecture
MySchedule owns server dates/revision and request-version ordering. The editor owns draft/baseline and inline conflict UI. Bulk acceptance also refreshes the parent. Both human and personal routes use the same editor.

## Before behavior
A failed 409 refresh clears pending state and permits Discard against stale props.

## After behavior
Pending/failed loads cannot authorize conflict comparison or Discard. A current successful load with a different nonempty revision enables explicit resolution; dates and revision are adopted together.

## Product Decision Check
Contract: docs/features/volunteer-my-schedule.md. The October 20 attached request explicitly authorizes preserving drafts, blocking unsafe Discard/Save, retry, identity/request ownership, and personal-access guidance. No unresolved product decisions.

## Behavior intentionally unchanged
Original draft revision ownership, transaction protections, credentials, assignments, availability, SMS, publication, activation and deployment.

## Acceptance criteria
Failed refresh preserves draft and original precondition. Retry permits safe explicit adoption only after valid success. Superseded and retired identity completions cannot authorize recovery.

## Proposed implementation
Keep load status alongside the existing parent request guard, pass it to the editor, derive recovery eligibility from status and baseline revision. Remove competing editor pending ownership; retain parent server state as the only snapshot.

## Affected surfaces
Shared MySchedule human route and VolunteerPortal personal operations; production Redux/router/global context composition is represented by existing component and portal tests. No display/Electron changes.

## Risks / edge cases
Failed/retried/superseded loads, missing/unchanged revision, revoked access, identity switch/unmount, old load after confirmed save. Deferred promises reproduce ordering deterministically.

## Questions requiring user input
None.

## Verification
Failing regression first; concurrency, MySchedule and public portal component tests; Firestore volunteer mutation/operations tests; client TypeScript, ESLint, strict build, git diff --check. Final self-review using repository code-review guidance. No activation or deployment.
