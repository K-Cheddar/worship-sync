# Scheduling Foundation — Phase 3A

**Scope:** Safe schedule reuse, additive inclusion of current service occurrences, and prevention of duplicate active ownership.
**Authorization:** Product-owner request supplied for this implementation on 2026-10-14, consistent with the confirmed [Team Scheduling Contract](features/team-scheduling.md).
**Phase boundary:** This record covers Phase 3A only. Broader reconciliation and Phase 4 publication remain separate work.

## Reported regression and cause

The client required a saved schedule to already contain every current occurrence before reuse. When two services were added after an October schedule had been staffed, the saved five-row schedule failed that check and the normal schedule view fell back to a render-only virtual seven-row period. A virtual period has no assignments and is not a persisted document. The server used the same exact-coverage rule and could reject an attempted extension. A separate overlap-list filter could also hide a source-less legacy schedule beside a same-bounds generated record.

This selection path explains the empty view without assuming an empty generated document had been saved. The client and server now handle persisted empty records and existing duplicate owners separately.

## Selection and reuse

- Candidates belong to the selected church and team, are active, and cover the selected period's dates. An occurrence match alone does not turn a one-day schedule into a full-month schedule.
- A populated candidate can be reused when at least one current occurrence matches by canonical service/group identity, church-local date, and exact group membership. Names and timestamps never establish ownership.
- An exact, canonical generated record with no occurrences and no operational data may be reused when no current occurrence matches it. A populated matching schedule ranks ahead of an empty generated record.
- A schedule selected explicitly from the overlap list is only reconciled if it is also applicable to the current period. Selecting a partial event does not add rows outside that schedule's saved bounds.
- Source-less legacy schedules remain visible beside generated schedules. Applicable saved schedules are selected automatically when their ownership is clear. Genuine duplicate owners remain selectable for review and show a conflict message.
- If identity or group membership is ambiguous, reconciliation stops. The saved schedule and its data remain available for review.

## Additive reconciliation

For an applicable owner, the client and server append only current occurrences that the owner does not already contain and that no other active schedule owns for that team. Existing occurrence records and their saved `occurrenceId` keys remain in place. The resulting rows are ordered by start time. New service membership is added without removing saved service IDs.

The server keeps existing assignments, shadow assignments, guests, responses, microphones, IEMs, extra and optional slots, public-link values, send history, publication fields, and archive history. It does not re-key or rebuild those maps. Matched position requirements can grow to the current maximum requirement; existing assignment values are not changed. Repeated ensures are idempotent and do not send notifications.

Generated service definitions and the selected team's positions are rechecked before persistence. Firestore transactions also read the position query and schedule records in the commit transaction. Service definitions currently live in Realtime Database, so Firestore cannot provide one atomic transaction across both stores; a definition change after the final recheck is a remaining cross-store race.

## Ownership and conflicts

The server enforces one active owner per church, team, and logical occurrence. Firestore writes a deterministic claim document in `teamScheduleOccurrenceOwners` in the same transaction as the schedule create or update. The claim key is scoped by church, team, and logical occurrence, so another team can schedule the same combined service. Same-team schedules may have overlapping date ranges when they own different occurrences.

The ensure, schedule create/update, and portable schedule import paths check existing active schedules before changing ownership. Older schedules are scanned directly, so no bulk claim backfill is needed to detect a conflict. The in-memory server store serializes mutations by scoped occurrence and schedule keys; this protects that single process and is not the production cross-instance boundary.

If an operation would add or move an occurrence into duplicate ownership, the server returns a conflict and changes neither schedule. The client keeps both visible, selects a populated matching schedule for review, and disables automatic reconciliation while the conflict is present. A metadata edit that leaves occurrence ownership unchanged can still proceed. No schedule is merged, archived, deleted, or re-keyed. Operators can inspect the schedules through the period overlap picker; a dedicated duplicate-repair workflow remains later Phase 3 work.

## Authorization and lifecycle preserved

Existing team-scoped edit checks remain on ensure, create, update, and import mutations. Combined-group membership does not grant access to another team's schedules or assignments. Reading or switching periods does not persist a virtual schedule; the first edit still creates a saved schedule. Legacy schedules without publication metadata retain their current Published visibility. Reconciliation does not publish, unpublish, or send SMS or email.

## Verification status and limitations

The October regression is covered at the period utility, Teams UI entry point, and server API layers. The integration fixtures preserve 55 assignments and additional operational data, add two missing occurrences, assert no duplicate schedule and no notification intent, and repeat ensure to check idempotence. Concurrent overlapping windows are exercised against the in-memory server store.

Verification run for this change:

- Server API suite: `node --import tsx --test --test-reporter=dot server/teamsApi.test.js` passed.
- Client schedule identity, period, and reuse tests passed (120 tests); the October reuse and delayed-response UI regressions passed (2 tests).
- Client type-check and ESLint on the changed schedule sources passed. `npm run build` passed.
- The complete `TeamsAndServices.test.tsx` suite passed 88 of 89 tests. The existing "keeps an October 3 assignment visible after reopening Upcoming on September 30" case could not find the schedule cell after remount; the rendered route shell had no schedule content. The cause is unresolved, so this suite is not fully green.
- `npm run build:strict` is blocked by lint errors in other existing working-tree edits: `ServicePlanEditor.test.tsx`, `TeamsMobileShortcuts.test.tsx`, and `TeamsMicrophonesPage.tsx`.
- The workspace Node runtime is 22.23.1 while the repository verification guidance calls for 24.12.0.

The Firestore transaction branch is not exercised by the in-memory API suite or a Firestore emulator in this work. The RTDB service-definition read also cannot be made atomic with Firestore schedule writes. These are deployment verification and cross-store consistency limits; they do not change the duplicate-preserving conflict behavior.

## Remaining work

- Later Phase 3: audit and operator tools for resolving historical duplicate owners; regrouping and ungrouping with explicit conflict choices; a planned claim backfill if it becomes useful for scale or audit.
- Phase 4: publication controls and member visibility behavior. No publication UI or endpoint was changed here.
- Before production readiness, verify the Firestore transaction path under the Firestore emulator or an equivalent transaction test, and review the RTDB/Firestore service-definition consistency boundary.
