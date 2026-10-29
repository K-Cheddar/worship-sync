# Planning Center import reconciliation

## Goal

Refresh a saved PDF plan with four meaningful Update 1 operations, retaining IDs,
library links and local work across the API/storage round trip.

## Existing architecture

The editor parses PDF text, builds elements, prepares PDF fingerprints, refreshes
sections, orders PDF slots, calculates times, and diffs the result for review.
Selective apply then reconstructs placement from that result. `mergeElement` and
`servicePlanImportOwnership` own field provenance. Server normalization is a
separate allowlist and currently loses source type, PDF evidence, template
provenance, managed assignees and song mapping decisions.

Duplicated decisions: PDF preparation and refresh both associate rows; refresh
places additions before a second PDF ordering pass; summary infers every changed
index as a move; apply independently places approved rows. Raw source titles and
display titles have different meanings in these passes. PDF positions are copied
through saved elements despite being meaningful only within one source document.

## Before behavior

Raw song category prefixes can disagree with displayed matching titles. The PDF
ordering pass places disagreeing rows last. Index comparison inflates the review,
and selecting updates/additions can follow that incorrect order. Saves rewrite
the source enum and discard metadata needed by subsequent refreshes.

## After behavior

Resolve associations once, retain their local IDs in source order, and describe
field updates, associations, additions, removals and minimal relative moves.
Apply only approved operations to the original plan. Derive timing from that
exact result. Canonical PDF title meaning retains the raw category text.

## Product Decision Check

Authorized by the current task (2026-10-28) and
`docs/features/service-plan-import.md`: preserve operator data and unconfirmed
matches, require individual match approval, default removals off, keep the compact
review, treat timing as derived, and preserve source-relative placement. No new
product choices require approval.

## Behavior intentionally unchanged

Field-level note/assignee/resource ownership, equipment, song linking, account and
URL imports, templates, native transfer, autosave revisions, permissions and SSE.

## Acceptance criteria

Baseline -> save -> equipment edit -> save/reload -> Update 1 yields 12 rows,
all original IDs and local fields, three updates and one addition, then no changes
on reimport. Update 2 and partial selections preserve reservations and local work.

## Proposed implementation

Reuse parser normalization and element models. Consolidate source order at the
association boundary; compute relative moves with deterministic longest-common-
subsequence comparison. The existing summary is the proposed operation model;
review and selected apply consume it. Remove the separate PDF ordering pass.
Keep imported field merge rules in `servicePlanImportSync`, field formatting and
operations in `servicePlanImportSummary`, placement in the existing placement
module, and validated durable metadata in a shared client/server contract.

## Affected surfaces

Services editor PDF upload -> lazy pdfjs extraction -> real parser/builder ->
review checkboxes -> one draft mutation -> authenticated save/revision guard ->
servicePlans storage -> authenticated read -> next refresh. Server tests use the
real auth handlers and repository in-memory database, with real PDF extraction;
they do not require a production church or third-party API. Browser/Electron use
the same pure reconciliation and existing save/lifecycle guards.

## Risks / edge cases

Duplicate counts/durations, conflicting durable IDs, legacy missing metadata,
reserved candidates, manual items, section moves, skipped reorders, note conflicts,
save/reload and repeat imports. No new async owner or datastore writer is added.

## Questions requiring user input

None. Original PDFs/API snapshots are unavailable locally; the request explicitly
permits equivalent fixtures. Record fixture assumptions and pre-fix evidence.

## Verification

Failing regression before implementation, parser/builder and server save/reload
lifecycle, selective operation combinations, existing import/ownership/review/
editor/template/native suites, affected server suites, TypeScript, lint, Heroku
and Electron production builds. Finish with a separate adversarial code-review
pass against the request and complete diff.

## Confirmed results

The pre-change test used real PDFs, pdfjs text extraction, the production parser
and builder, `authHandlers.saveServicePlan`, datastore reads, and
`authHandlers.getServicePlan`. It failed with `[updated, added, removed, moved] =
[3, 1, 0, 10]`: the exact 14-operation failure, with all three songs last.

The fixed lifecycle passes:

| Scenario | Result |
| --- | --- |
| A: baseline -> save -> assign equipment -> save/read -> Update 1 | 12 items, all 11 IDs retained, three updates, one addition, no moves; exact source order |
| A: local data/timing | Three original library song IDs, microphone/IEM assignments retained; starts 10:00, 10:07, 10:11, 10:14, 10:18, 10:21, 10:24, 10:29, 11:04, 11:08, 11:11, 11:15 |
| B: save/read -> same Update 1 | No changes |
| C: representative Update 2 | One real reorder, changed duration, optional Special Music removal, duplicate Prayer additions, one individually confirmable David Cole occurrence |
| C: decline -> save/read -> reimport -> confirm -> save/read -> repeat | Only the declined match remains pending; no changes after confirmation; 14 source rows plus preserved manual cue |
| D: partial approvals | Update-only, addition-only, move-only, removal-only and ordinary changes excluding uncertain match preserve unrelated work; no selection returns original object |
| D: sequence coverage | All 24 four-item permutations execute correctly; addition-only preserves original relative order for each |
| E: metadata | All four source enums, account IDs, template provenance, note/assignee ownership, song mapping decisions, equipment and song keys survive server storage; transient match/position fields are omitted |
| E: legacy | Missing PDF metadata reconciles conservatively; a declined singleton with no old key stays reviewable |
| F: adjacent imports | Real account mapper -> reload -> refresh -> save retains occurrence/equipment/account IDs; URL parser, native transfer, template, merge, timing and account suites pass |

### Final module responsibilities

- `planningCenterPdfParser`: raw source title and the single category/display/
  matching-title interpretation; produces existing `EventData` source rows.
  The rows already carry source identity, fields and section/array position.
- `servicePlanFromImport`: the existing canonical row-to-element builder,
  imported source snapshots and initial ownership. It does not reconcile order.
- `servicePlanImportSync`: resolves PDF duplicate evidence once into transient
  local associations; resolves durable/template/legacy associations with a
  one-to-one claim table; merges fields using established ownership functions;
  expresses desired source order with resolved local IDs.
- `servicePlanImportSummary`: the existing proposed-operation model, semantic
  field descriptions, minimal relative moves, and execution of checked operations
  against the original plan. Apply never rematches rows.
- `servicePlanImportSectionPlacement`: shared relative placement, deterministic
  LCS comparison, and new-section insertion. Missing anchors preserve an existing
  confirmed occurrence's location. No absolute PDF index establishes identity.
- Review/editor: checkboxes and timing impact use the same selected executor;
  displayed selected move positions come from that executed result. An import
  remains one undo/autosave mutation. Stale previews cannot replace newer edits.
- `servicePlanImportOwnership`: existing note/resource/assignee provenance rules;
  deliberately retained because operator edits and explicit note decisions need
  that evidence.
- `shared/servicePlanImportMetadata.ts` / server: shared source/source-state types
  and validated normalization, plus the existing server's attachment and decision
  validation. No new datastore, writer, migration or review framework.

### Removed or consolidated

Removed `orderPlanningCenterPdfRefresh` and every caller, per-index move reporting,
`timing_shift` operations/flags/UI filters, duplicate source-text normalization,
the second section-pairing/rehoming/reconciliation pass, synthetic-key collision
repair passes, repeated existing/new-section selected-placement code, and an
unused copied managed-section construction. Duplicate context/duration safeguards
remain in a smaller resolver; field ownership remains separate from association.

### Persistence and compatibility

Durable: actual source type/URL/label and account IDs, source occurrence ID,
template ID/type, source-managed markers, observed/applied/pending snapshots,
managed notes/assignees and their fingerprints, PDF fingerprint evidence and
review-required decisions, song mapping resolutions and song keys.

Transient: PDF source position, `importMatchCurrentId`, and
`legacyImportMatchCandidateForId`. The server intentionally omits these; subsequent
imports resolve against stored provenance. Legacy title/duration keys remain
valid; missing keys are rebuilt only for source-owned rows. Malformed evidence
does not establish identity. Previously coerced source types cannot be recovered
reliably, so selecting PDF import explicitly remains the compatibility path.

### Verification commands actually run

- Client Jest, `--runInBand --runTestsByPath`: import sync, summary, review window,
  editor, import builder, PDF parser, native transfer, draft utilities, template
  resolution, merge and timing utilities: **11 suites / 421 tests passed** at the
  broad checkpoint. Final changed review/summary/draft suites: **74 tests passed**;
  final PDF/URL parser suites: **16 tests passed**. These runs overlap.
- `node --import tsx --test --test-name-pattern='service plan|Planning Center PDF'
  server/teamsApi.test.js`: **13 passed**, including the complete PDF lifecycle
  and all-source metadata/account integration tests.
- Public service plan, email and church integration server suites: **47 passed**.
- Planning Center service/account mapper suites: **8 passed**.
- `npm.cmd run type-check --prefix client` and
  `npm.cmd run lint:check --prefix client`: passed.
- `npm.cmd run build:heroku --prefix client` and
  `npm.cmd run build:electron --prefix client`: passed on final runtime source.
- `git diff --check`: passed.

Original task PDFs/snapshots were unavailable; the permitted equivalent fixtures
are documented in `server/fixtures/planning-center/README.md`. Tests use the real
server datastore adapter in its isolated in-memory mode, not deployed Firestore,
a live Planning Center account or a live church. Exhaustive repository-wide CI
and a separate human review remain additional confidence checks.
