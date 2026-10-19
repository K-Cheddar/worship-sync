# My Schedule time-off correctness plan

## Goal
Prevent unsaved time-off drafts from acquiring another revision and establish an actionable, inactive pilot checklist. Owner authorization: Final Correctness and Pilot Readiness brief, October 19, 2026.

## Existing architecture
MySchedule owns fetched member dates/revision and a request counter. MyScheduleBlockouts owns draft values and a signature baseline but saves with the live revision prop. Existing clean-only reconciliation and Discard controls are reused. Human and personal adapters use the same Firestore compare-and-swap transaction. ScheduleEditForm and the identity-keyed local drafts pattern establish the analogous dirty-draft policy.

## Before behavior
Bulk/409 refresh retains dirty values but changes their save precondition. A successful save does not retire older page loads. The human/personal keys also lack an authentication-mode discriminator when their IDs coincide.

## After behavior
Baseline dates and baseline revision are adopted together. A dirty draft keeps its original revision; a 409 preserves it and shows the latest saved dates with deliberate discard/re-edit. Clean refreshes and confirmed saves adopt values/revision together. Successful saves invalidate older loads. Authentication mode is part of view ownership.

## Product Decision Check
The confirmed volunteer-my-schedule contract preserves atomic stale-write protection. The current owner brief explicitly authorizes revision ownership, inline conflict review/discard, interruption audit and an inactive pilot runbook. No policy, authority, lifetime, activation or dispatch change. No consequential questions remain.

## Behavior intentionally unchanged
Server transactions/archive/field-limited writes, all schedule and availability business rules, authentication/CSRF, 90-day policy, legacy links, consent/STOP and sending gates. No broad synchronization layer, new guest UI, deployment, activation or branch merge.

## Acceptance criteria
Reproduce tests A-E through the actual shared page and operations. A dirty or rejected draft never uses a newly received revision. Discard explicitly adopts current values/revision. Confirmed save cannot be undone by an older load. Old identity completion never updates replacement scope. Real Firestore checks retain stale/archive/contention/field preservation and reject delayed mutations after personal revocation.

## Proposed implementation
Store baseline ranges/revision together locally; derive dirty/conflict status. Reuse existing editor with an inline saved-date review and deliberate Discard. Keep editor mutation pending state and prevent edits during save. Increment the existing page request counter after confirmed time-off mutation. Prefix human/personal identity keys. Test before/after with deferred promises, not timing races. A local conflict-refresh retry exposes pending/failure state. Separate personal API errors preserve personal-link guidance instead of invoking human sign-in toasts; human behavior stays unchanged.

## Affected surfaces
Shared React MySchedule and its blockout editor, both auth adapters and existing public Redux/Toast/BrowserRouter composition. Server behavior stays unchanged, with additional Firestore regression evidence. No Electron IPC or presentation-output changes.

## Risks / edge cases
Bulk/individual/availability refreshes, 409 retry, save versus old load, reconnect, unmount/identity changes, expiry/revocation, hidden historical dates and normalized save results. Review contact proof, delivery, origin/cookies, logging and index configuration without printing secrets or activating anything.

## Questions requiring user input
None. Operational activation is out of scope.

## Verification
Required: regression tests A-E; modified and existing MySchedule/public portal tests; actual demo Firestore concurrency/authorization suites; relevant teams API/legacy-link/privacy regressions; TypeScript, ESLint, strict production build and built HTTPS browser test; diff/caller and adversarial review. Add a pilot prerequisites/checklist/rollback document distinguishing local evidence from unverified live infrastructure. Full CI and live delivery are additional confidence gates, not actions authorized here.
