# Scheduling verification — October 20, 2026

## Result

The three scheduling workflows passed twice consecutively against the existing `demo` church using saved authentication. Both runs included the existing saved-session setup check (four passing tests per command). All six final test manifests ended `cleaned`.

| Run | Started (America/New_York) | Command wall time | Result |
| --- | --- | --- | --- |
| 1 | October 20, 10:37:32 PM | 81.231 s | 4 passed |
| 2 | October 20, 10:38:54 PM | 77.049 s | 4 passed |

Command: `E2E_DEMO_CHURCH_ID=demo npm run test:e2e:scheduling` (PowerShell environment syntax is documented in smoke-coverage.md). Logs: `.codex-scheduling-final-1.log`, `.codex-scheduling-final-2.log`. Local evidence is retained under `artifacts/scheduling-verification-run-1/`, `artifacts/scheduling-verification-run-2/`, and ignored `playwright/.fixtures/` manifests. These artifacts contain no authentication tokens.

## Exact records and cleanup

Stable fixtures intentionally retained:

- Team: `e2e-scheduling-2a97516c354b6884`
- Position: `e2e-scheduling-2a97516c354b6884-position`
- Contact-free member: `e2e-scheduling-2a97516c354b6884-member`

Created and deleted during each run:

- Schedule: `generated_62c4dd26610602dc4b71849c3eeca3e4768352b85d0f60549141babe8430b9ca`. The same canonical ID was reused without duplicate documents; each run covered four creation/deletion cycles, including regeneration in C.
- Temporary service A: `e2e-scheduling-2a97516c354b6884-service-a` (A, B, C).
- Temporary service B: `e2e-scheduling-2a97516c354b6884-service-b` (B).
- Occurrence claims were checked in authoritative Firestore after each deletion and were absent. Final backend inspection found `schedules: []`, `claims: []`, and `services: []` in the reserved scope.

| Run / case | Fixture run ID (manifest suffix) | Fixture lifetime | Cleanup |
| --- | --- | --- | --- |
| 1 / A | `0d67a2a4-e9da-4942-a460-7e84b079b29e` | 24.335 s | verified |
| 1 / B | `609577fa-a8d7-446d-adca-a2f2f760a807` | 20.324 s | verified |
| 1 / C | `4f38fe25-3adb-4794-a1e4-197ef9565194` | 26.747 s | verified after simulated failure |
| 2 / A | `c8a162e3-1199-4cc3-ac33-ca9a5fcc3307` | 23.899 s | verified |
| 2 / B | `e0825511-3079-45c1-8fb7-09d90c108d85` | 20.798 s | verified |
| 2 / C | `26d5bd0f-0c8f-4307-966b-c911e42368e7` | 21.483 s | verified after simulated failure |

Every final case compared unrelated teams, positions, roster members, schedules, occurrence claims, and service definitions with its baseline and reported them unchanged. Explicit recovery also verified an interrupted setup from this session, and a cleanup-completed-before-final-journal condition; no ambiguous records were automatically deleted. All debug fixtures were cleaned.

The saved account initially had no Teams edit access. Verification used a temporary grant only for the reserved E2E team, with the prior field journaled. The account's original permission was restored and verified afterward. The suite itself never grants permissions. Future runs require an operator to configure normal edit access to this exact team; insufficient access fails before provisioning.

## Behavior verified

- A: Viewing generated occurrences created no schedule or claims. A real assignment edit persisted a Draft (`published: false`); reload retained it; ensure reused the same document.
- B: Adding the second service triggered normal reconciliation. Existing assignments and a nonempty additional-position-slot map survived, along with equipment maps, guests, creator/time, publication state, and fixture ownership. Repeated ensure duplicated no occurrences, schedules, or claims.
- C: Normal deletion removed the exact schedule and released claims. Viewing remained virtual, another real edit regenerated the same period, and cleanup succeeded in finally after a simulated assertion failure.
- No publication, message, invite, public-link, or archive endpoint was admitted. Saved authentication was reused without password login or verification email. Successful workflow diagnostics reported zero blocked email-generating auth requests, session-renewal attempts, MailSlurp requests, or untrusted auth requests. The local API ran without Resend/Twilio send credentials and with bulk SMS dispatch disabled; test members had no contact destinations.

## Focused checks

| Check | Result |
| --- | --- |
| `node --import tsx --test server/teamScheduleOccurrenceOwnershipTransaction.test.js` | 18 passed; 2.413 s in final run |
| `node --import tsx --test server/teamScheduleOccurrenceOwnership.firestore.test.js` with local emulator | 3 passed; 10.457 s |
| `node --import tsx --test server/teamsApi.test.js` | 279 passed; 9.355 s |
| Scheduling scope, shared-data auth guard, session policy, and auth recovery tests | 16 passed; 14.232 s |
| Strict TypeScript check of changed E2E files and recovery CLI | passed |
| Playwright scheduling discovery | setup plus three workflow tests |
| Playwright smoke discovery | six separate navigation cases |
| `git diff --check` | passed |

The ownership regression was observed failing before the fix in both memory and transaction-backed storage. The missing Draft flag was likewise reproduced before correction. Tests cover concurrent create/ensure/delete, replacement-owner preservation, exact church/team ownership, more than 100 stale claims, and repeated regeneration. Real Firestore emulator tests exercise persistence and atomic deletion. No application client source was changed for this task; browser acceptance exercised the actual local renderer, auth/permissions, API entry points, Firestore, and RTDB.

## Separate smoke result

The complete smoke command was executed independently with all church-scoped writes blocked. It was **not green**: initial failures were a 15-second controller-loading-overlay timeout, missing Services/Equipment/Templates access, absent member-edit permission, and an ambiguous Teams heading introduced by the current navigation. No scheduling write or unsafe authentication request was admitted.

The Teams locator was narrowed to the actual team-list panel, and the Members check now verifies the current Members region and member list. The focused Teams smoke rerun passed in 4.9 seconds; evidence is in `.codex-scheduling-smoke-team.log`. The other smoke prerequisites/controller-loading issue remain outside this scheduling change; no broad account permissions were granted, production behavior altered, or smoke assertions weakened to hide them. Full repository/client suites were not run; focused server, emulator, policy, type, and live scheduling checks were used.

## Review

Before: deletion left stale occurrence claims; generated-period creation omitted the Draft flag; Scheduling smoke depended on disposable-church isolation.

After: transactional deletion releases only exact owned claims; in-memory create/ensure/import/delete share locks and deletion joins the existing schedule-write queue. Generated periods start as private Drafts. The reserved demo team, ownership manifests, explicit recovery, and finally cleanup support repeatable workflows.

Unchanged: ordinary team deletion leaves schedules intact; existing schedules retain assignments, operational fields and publication metadata; viewing a virtual schedule remains unsaved; publishing and sending remain deliberate separate actions.

Self-review followed the repository code-review and mutation-safety guidance. It traced authorization to the original team, transaction reads before writes, replacement ownership, stale claims outside the occurrence list, local serialization, lost responses, fixture adoption, interrupted cleanup, unmount-before-delete, and the saved-session shared-data token guard. Required scheduling acceptance checks passed. Residual verification limits are the separately reported smoke prerequisites/controller timeout and the unrun exhaustive suites.
