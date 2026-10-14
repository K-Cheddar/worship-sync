# Team Scheduling Foundation — Phase 2 Implementation Record

**Branch:** `in-progress-2`  
**Date:** 2026-10-12  
**Scope:** Canonical occurrence identity, complete combined-service generation, church-authoritative timezones, and alignment of schedule, availability, and service-plan lookups.

Phase 2 implements the approved decisions in the [Team Scheduling Contract](features/team-scheduling.md). It does not implement transactional rekeying, ownership claims, publication, or broad conflict-resolution workflows.

## Canonical identity and saved records

- A standalone service occurrence has logical identity `{serviceId}@{church-local-date}`.
- A combined occurrence has logical identity `group:{groupId}@{church-local-date}` and a sorted, explicit `serviceIds` membership set.
- `logicalOccurrenceId` records logical identity separately from `occurrenceId`, which remains the key used by assignment and equipment maps. A new schedule can use the canonical key for both. When a populated saved schedule has one safe identity match, the client keeps its stored `occurrenceId` so related map keys remain addressable.
- Matching requires service/group IDs, church-local service date, and exact group membership. Display name and start timestamp never prove that two services are the same. A same-name, same-instant collision is reported as ambiguous, not mapped.
- Existing timestamp-based IDs are resolved read-only when service/group identity, date, and membership provide a unique match. Group-membership changes, duplicate candidates, invalid dates, or conflicting identity metadata are surfaced as ambiguous; refresh is blocked rather than rekeying assignments, responses, guests, microphones, IEMs, or extra slots.
- An unmatched saved occurrence with requirements or saved slots relevant to the selected team remains visible under its saved ID. Its displayed positions are filtered to that team's positions, preserving access to the old keyed rows while the schedule warns that identity cannot be reconciled safely.
- Phase 2 does not migrate populated schedules or claim unique schedule ownership. Transactional reconciliation and conflict resolution remain Phase 3 work.

## Generation, authorization, and timezone

The client expands the complete active church service set, resolves combined groups, then projects only the selected team's requirements and slots. A group therefore has the same identity and membership for every team view, while each view contains only its own positions. The server independently validates the complete group membership and church-local date, then persists only requirements relevant to the selected team.

The existing team-scoped authorization checks remain the gate for edits. Group membership is server-derived schedule data; it does not grant access to another team's assignments, roster, positions, or equipment. A scoped editor can ensure their own slice of a combined occurrence, but cannot edit the other participating team's schedule. Church administrators retain access, and read-only users remain unable to ensure schedules.

Client generation and server validation use the same shared wall-clock conversion. The server loads the church's configured IANA timezone and disregards the timezone supplied by a request when deriving occurrence identity, date, and validity. The same authority is used in affected service-plan and portable schedule paths. This keeps dates stable across browser/editor timezones and dates near UTC midnight.

Per D1, a spring-forward wall time that does not exist is omitted by the generator and rejected by server validation; a fall-back wall time resolves to the earlier instant. Historical saved rows are not rewritten or deleted by this behavior.

Per D2, `overrideDateTimeISO` remains available to live countdown/timer controls. Occurrence generation, team schedules, availability suggestions, and service-plan association use the scheduled service definition and ignore this temporary override.

## Verification

All commands below ran with the repository's Node 24 runtime (`v24.12.0`).

- Before behavior changes: six focused client suites passed, 160/160 tests; `server/teamsApi.test.js` passed, 240/240 tests. The Phase 1 audit's service-plan snapshot failure at the then-reported line 8040 passed on this Node 24 baseline and also passed in the final full server run.
- After changes: six focused client suites passed, 170/170 tests.
- The existing live-service timer suite passed, 27/27 tests; countdown override behavior remains covered.
- After changes: the full `server/teamsApi.test.js` suite passed, 244/244 tests.
- Client TypeScript check passed.
- Client lint check passed with zero warnings.
- `git diff --check` passed.

The added regressions exercise actual client-built combined occurrence JSON through the server ensure handler, team-scoped edits, administrator and read-only access, team-specific requirements, browser-timezone mismatch, UTC-midnight dates, spring gaps, fall folds, legacy IDs, and service-plan/availability agreement. The earlier snapshot failure was not reproducible on the Node 24 baseline and is not present in the final suite.

## Remaining Phase 3 work

- Add transactional occurrence ownership and safe, bounded reconciliation for existing owners.
- Design explicit conflict handling before changing keys for assignments, responses, guests, microphones, IEMs, and extra position slots.
- Keep unresolved or non-unique legacy references visible and operator-resolvable; do not bulk-migrate them automatically.

Phase 4 publication/visibility behavior and Phase 5 cleanup are also outside this implementation. No notification delivery, database migration, or schedule-publication behavior was added here.
