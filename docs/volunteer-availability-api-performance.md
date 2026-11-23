# Volunteer availability API performance record

**Scope:** Routine volunteer reads from signed-in and personal-link sessions. The change does not delete closed history or alter administrative reads, public intake forms, answer storage, revisions, or Auto-fill.

## Confirmed read-path costs

The previous routine read queried every recipient for the member, then processed each row sequentially through the recipient-context helper. For 13 recipients this repeated recipient, form, member, and Team reads for each row, even though the recipient documents were already in the query result and forms/Teams were shared. It then projected all 13 requests, including closed forms, and could run historical grouped-occurrence reconciliation for forms that the routine list no longer needs.

The code path explains avoidable database work, but it does not establish the source of the reported four-second local latency. The old path was measured with the in-memory store; no Firestore network latency was present in that measurement.

## Measurements

Measurements ran on 2026-11-20 using Node v22.23.1 and the repository's in-memory Auth/Firestore test store. Durations include request identity resolution and server handler work, and exclude browser/network latency. They are useful for comparing work performed in this test process, not for predicting production response time.

| Scenario | Before | After |
| --- | --- | --- |
| 1 current request + 12 expired/closed forms and recipients | 13 requests; 60 observed database operations; 9,410-byte response; 3 runs: 3.05, 1.48, 1.18 ms | 1 request; 12 operations; 910-byte response; 3 runs: 2.93, 0.89, 1.09 ms |
| 65 current forms + 66 recipient records, with one repeated form and Team | Not measured on the previous implementation | 66 requests; 14 operations; 3 form queries, 3 recipient queries, 1 deduplicated Team read, 0 schedule queries; 40,639-byte response; 5.35 ms |
| No current requests, one expired recipient, preferences present | Not measured on the previous implementation | 0 requests; preferences returned; 10 operations; 231-byte response; 3 runs: 0.79, 0.51, 0.59 ms |

The before run preceded adding grouped and standalone historical occurrence data to the closed-form fixture. The after run includes that extra closed historical data, so the database-operation and payload comparison is directional rather than a byte-for-byte identical fixture. Durations varied at this scale; the measured evidence is the lower work and smaller response, not a reliable sub-millisecond latency claim.

The four-second delay was not reproduced: the before handler ran in 1.18–3.05 ms in memory. A Firestore emulator was unavailable (`FIRESTORE_EMULATOR_HOST` was unset and Java was not installed), and this environment runs Node 22 although the repository declares Node 24. No remote or emulator query timings are claimed.

## Unified My Schedule review (2026-11-23)

This review did not capture end-to-end durations for assignment load, availability
summary/detail, preference save, Time Off save, or assignment response. The
workspace still has no `FIRESTORE_EMULATOR_HOST` and no Java runtime, so the
Firestore-backed paths could not be benchmarked here. The figures above remain
the November 20 in-memory handler comparison; they do not measure production
network latency or frontend rendering and must not be read as production timing.

## Work removed and bounded

- Routine forms are fetched only when active, for `team_availability`, and current under the configured church calendar date. Three indexed queries cover the current `responseDeadline`, legacy `endDate`, and blank-response-deadline cases.
- Recipient rows are fetched only for those current forms, with server-side church and member filters and selected fields. Up to 30 form IDs are queried per batch; recipient query concurrency is capped at six. A single in-flight batch is limited to 5,001 rows per query, and reads fail if the accumulated result exceeds 5,000 recipients.
- Form documents are deduplicated by ID and capped at 5,000 current forms after at most three form queries, each limited to 5,001 rows. Team scope is read once per unique Team and capped at 5,000 unique Team references. Firestore or authorization failures surface as failures; they do not become empty request lists.
- In the measured 13-recipient case, repeated per-recipient recipient/form/member/Team document reads were replaced by 3 form queries, 1 recipient query, one current member read, and one Team read. Total observed operations, including authorization/session reads, fell from 60 to 12.
- Routine full reads reconcile only returned active requests; active summaries and past-request summaries skip reconciliation. Opening one past request can reconcile that selected form. Services and team schedules are reused within the read, and closed history triggers no reconciliation during routine loading. Canonical occurrence, conflicting-answer, revision-snapshot, and integrity-safe fallback checks remain in the projection.
- `summary=1` omits occurrence projection and revision details while returning current request summaries and preferences. The full response remains the default for existing callers. A full `recipientId` read fetches only that recipient and form by document ID, verifies ownership before reading form details, and retains the same Team scope checks.
- Past requests are an explicit `summary=1&history=1` read. It reads a bounded, church/member-scoped recipient set only after the volunteer asks for history, fetches deduplicated forms in chunks, and returns summary rows without occurrences. Opening a row requests only that recipient and form; the detail remains read-only and still checks current member and Team scope. Revoked and archived rows stay excluded.

## Required Firestore indexes

`firestore.indexes.json` now declares:

- `teamIntakeForms`: `churchId`, `purpose`, `active`, `responseDeadline`
- `teamIntakeForms`: `churchId`, `purpose`, `active`, `endDate`
- `teamIntakeRecipients`: `churchId`, `memberId`, `formId`

The indexes must be deployed before the new Firestore query paths are used in production. This change updates repository configuration only; it does not deploy indexes.

## Unified-page integration

The unified My Schedule page starts the assignment/Time Off/member read and `loadAvailability({ summary: true })` independently. It renders each section when its data is ready, with separate loading and retry boundaries so either read can fail without blocking the other. The routine summary carries active request cards and scheduling preferences, including when no active requests exist, so no separate preference read is needed. An explicit preference conflict or uncertain-save refresh can request a safe member snapshot from that same existing roster read; routine startup and request-detail payloads do not include it. The page loads full occurrence details and revisions only after the volunteer opens a request, using that authorized `recipientId`.

The existing schedule response carries member identity/revision, blockout dates, and service timezone. Its signed-in member projection includes preference fields; the accountless member projection intentionally omits them. The page uses signed-in schedule preferences when available, otherwise it uses the availability summary, and it keeps the summary read independent from assignment processing.

Past availability summaries remain an explicit `summary=1&history=1` read and are not requested while opening past assignments. This UI integration does not deploy the declared Firestore indexes or provide real Firestore/network timing; production verification remains required before making latency claims.
