# Shared volunteer bulk responses

## Goal
Use one pending-only acceptance operation for human and personal volunteer identities.

## Existing architecture
Phase 1B `volunteerOperations.acceptPendingAssignments` owns bounded discovery, upcoming primary targets, preservation-oriented response decisions and independent schedule transactions. The older unanswered adapter uses the individual-response writer instead. Personal sessions provide an authoritative transaction callback. The signed-in React workflow already consumes paginated canonical totals.

## Before behavior
The unanswered path includes past occurrences and normalizes unrelated response records. Its client does not paginate or use the canonical partial-completion feedback.

## After behavior
Both paths use canonical eligibility, response preservation, per-schedule authority checks, pagination and retry behavior. Personal sessions remain isolated from human accounts.

## Product Decision Check
Authorized by the current bulk-response fix request and `features/team-scheduling.md` / `features/volunteer-my-schedule.md`. Upcoming-only acceptance and exact unrelated-response preservation are explicit requirements. Existing individual and schedule-link response semantics must remain stable. No unresolved product choice.

## Behavior intentionally unchanged
Individual Accept/Decline, legacy response links, credential lifecycle, notification delivery, publication, time off, and portal activation remain unchanged.

## Acceptance criteria
- Both identities persist identical response maps for identical eligible schedules.
- Past, Draft, reassigned, accepted and declined slots remain unchanged.
- Every personal schedule transaction reads current credential/member authority.
- Independent failures preserve successful commits; retries skip durable answers.
- Both browser paths follow bounded server pages and stop after authority changes.

## Proposed implementation
Extract the existing canonical handler's post-commit adapter for all bulk routes. Retain legacy `results` fields alongside canonical totals for compatibility. Remove pending-only support from the individual writer/helper. Reuse the existing paginated React action for personal access, retaining its label.

## Affected surfaces
Express human and gated personal POST routes, shared Firestore transactions, MySchedule renderer and its two API transports. Production public and authenticated compositions need coverage. Display, Electron IPC and full scheduling rendering are unaffected.

## Risks / edge cases
Concurrent declines, reassignment, publication changes, revocation/replacement between commits, page failures, identity retirement, and uncertain committed responses. Transaction-time reads and persisted pending state remain authoritative; notifications follow committed changes only.

## Questions requiring user input
None.

## Verification
Run focused response/helper/API tests; actual Firestore boundary and cross-identity parity tests; built HTTPS personal bootstrap and authenticated routing/component tests; client type-check and strict lint/build. Review the complete diff and callers, recording exact results and remaining limitations separately.
