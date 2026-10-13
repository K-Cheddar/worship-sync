# Feature Contract: Generate Credits

**Contract status:** The operator workflow, explicit regeneration, overlay source rules, schedule availability, empty assignments, assigned-position creation, and ambiguity handling are confirmed.

**Approval sources:** Product-owner requests dated October 10, 2026 (feature-contract task); October 11, 2026 (overlay source and concurrent-edit decisions); and October 13, 2026 (schedule-credit creation and generation-run ownership). The dated sources below identify which request approved each decision.

**Last reviewed:** October 13, 2026

## Purpose

Help operators prepare a credits list from participant overlays and available serving information, then make it accurate to the people who actually served. Credits are editable records of participation, not continuously synchronized copies of plans or schedules.

## Operator workflow

1. Prepare the schedule, overlays, and service information.
2. Explicitly press **Generate Credits** to create or refresh credits from authoritative information.
3. Manually adjust credits before, during, or after service to reflect who actually served.
4. Keep those edits until an operator changes them or explicitly generates credits again.

Source changes alone do not regenerate credits.

## Confirmed operator-visible behavior

- An explicit **Generate Credits** action refreshes matching credits from the available generated result, replacing prior generated or manually edited credit text.
- A matching participant overlay with an explicitly blank name is an authoritative empty result and clears the matching credit text. If the overlay does not match, or its name value is missing, leave the credit text unchanged and report it as **Unmatched**.
- Create a visible credit for an assigned scheduled position when no corresponding existing credit is identified. Use the scheduled position heading and assigned names, and append it after existing credits. Do not create an empty credit for a position with no assigned people.
- Preserve an existing credit's current heading, visibility, and other fields when generated text is saved, including when those fields changed during generation.
- Operators may refine generated credits and correct them after service. A later explicit generation refreshes matching text; a source change alone does not.
- A fully loaded schedule position with assigned members updates its matching credit; a fully loaded empty position clears that credit's text.
- A missing, failed, incomplete, or unhydrated schedule must not change schedule-dependent credits or create schedule-dependent credits. Do not treat missing assignments as empty, or substitute imported service-plan assignments for unavailable schedule data. Continue generating from independent available sources such as participant overlays, and show a warning plus skipped schedule results.
- Stable schedule position IDs take precedence over heading matches. Heading matching applies only when the full relationship is one-to-one. If a credit could match multiple positions, or a position could match multiple credits, leave all affected credits unchanged, report the ambiguity, and do not create a potentially duplicate credit.
- Generation progress belongs to the church, content database, outline, and run that started it. An older run must not update a newer run after navigation or unmount; writes already underway remain scoped to their original database and outline.

### Results in the Generated Credits window

The window reports **Updated**, **Created**, **Unchanged**, **Unmatched**, **Skipped**, or **Failed** for each result:

- **Updated**: a matching credit's generated text was saved and changed.
- **Created**: the credit row is saved and its ID is present in the persisted outline index.
- **Unchanged**: the generated text matches the saved credit text.
- **Unmatched**: no source result was applied because an overlay was missing or the schedule-to-credit relationship was ambiguous. The reason is shown, and ambiguous entries are not changed or duplicated.
- **Skipped**: schedule data was missing or unavailable, so schedule-based updates and creates were left out. Independent available sources can still run.
- **Failed**: saving the credit or its outline entry did not complete.

## Persistence, ordering, synchronization, and customization

**Confirmed behavior:** New credits are appended after existing credits; existing credits retain their order and presentation fields. Show **Created** only after both the credit row and the outline index are persisted. A failed or interrupted creation can be retried without creating duplicate credits. Created credits become ordinary editable credits: operators may refine them, while a later explicit generation refreshes matching generated text.

**Current implementation observation:** Schedule-created rows use a stable identity derived from the scheduled position. The persistence path reuses an existing row and appends its ID only if it is not already in the outline index, so retry after a row-only or index-only partial success can finish without duplicating the credit or index entry. After persistence, the current flow updates the local outline and broadcasts saved credit/index documents to the active clients for that outline. These implementation details describe the in-progress code; the approved requirements are the visible ordering, save-before-Created, retry safety, and customization behavior above.

Existing generated credits are updated through field-scoped persistence so unrelated heading, visibility, and presentation edits are preserved. A later explicit regeneration may replace their participant text, as approved above.

## Scheduled-position matching and grouping

### Approved requirement

Prefer stable position IDs. Otherwise, update a corresponding existing credit only when normalized heading matching identifies exactly one credit and one scheduled position. Create a credit for an assigned position only when there is no matching credit and no ambiguous relationship. Do not combine, split, or rename grouped roles.

### Current matching implementation

The implementation recognizes stable generated schedule-position identities first, then evaluates all normalized heading matches. Existing plural and generic role variations remain supported when they resolve one-to-one. Ambiguous connected matches remain unchanged and are reported as **Unmatched**; no duplicate credit is created.

### Ambiguous matches

If one credit matches multiple positions, or one position matches multiple credits, leave all affected credits unchanged, report why the match is ambiguous, and do not create a potentially duplicate credit. An assigned position with no match and no ambiguity gets a new credit. Empty positions never create credits.

## Decisions and approval sources

| Decision | Confirmed behavior or status | Approval source |
| --- | --- | --- |
| Explicit regeneration and operator workflow | Refresh matching text, including prior manual edits; prepare before service, refine manually, correct after service, and regenerate only by explicit action. | Product-owner request, October 10, 2026. |
| Participant overlay missing versus blank | Missing match/name leaves text unchanged and is unmatched; a present overlay with a blank name clears text on explicit generation. | Product-owner request, October 11, 2026. |
| Concurrent credit edits | Preserve current heading, visibility, and other fields while applying generated text. | Product-owner request, October 11, 2026. |
| Schedule unavailable or incomplete | Missing schedule data is not an authoritative empty assignment and must not itself blank schedule-backed credit text. | Product-owner request, October 10, 2026 (feature-contract task). |
| Fully loaded empty schedule position | Clear matching credit text on explicit generation; do not create an empty credit. | Product-owner request, October 13, 2026. |
| Schedule unavailable while other sources are available | Leave schedule-dependent credits unchanged, do not use imported service-plan assignments as a fallback, continue independent participant overlays, and show a warning with skipped results. | Product-owner request, October 13, 2026. |
| Ambiguous schedule heading | Prefer stable IDs; otherwise apply only one-to-one heading matches. Preserve and report ambiguous credits and positions without duplicate creates. | Product-owner request, October 13, 2026. |
| Assigned scheduled position has no corresponding credit | Create a visible credit with its heading and assigned names, append after existing credits, report **Created** after row and index are saved, and make retries duplicate-safe. | Product-owner request, October 13, 2026. |
| Generation run ownership | Progress and results remain scoped to the originating church, database, outline, and run; writes in flight remain scoped to the original database and outline. | Product-owner request, October 13, 2026. |

All product decisions for this workflow are confirmed by the approval sources above. The implementation should preserve explicit regeneration and operator edits between runs.

## Implementation references

- Entry points: [CreditsEditor](../../client/src/pages/CreditsEditor/CreditsEditor.tsx); [OverlayController](../../client/src/pages/OverlayController/OverlayController.tsx)
- Generation and schedule matching: [useGenerateCreditsFromOverlays](../../client/src/hooks/useGenerateCreditsFromOverlays.ts); [teamScheduleCredits](../../client/src/utils/teamScheduleCredits.ts)
- Manual editing and persistence: [Credit](../../client/src/containers/Credits/Credit.tsx); [creditsSlice](../../client/src/store/creditsSlice.ts); [dbUtils](../../client/src/utils/dbUtils.ts)
- Generated result state and window: [generatedCreditsSlice](../../client/src/store/generatedCreditsSlice.ts); [GeneratedCreditsFloatingWindow](../../client/src/pages/CreditsEditor/GeneratedCreditsFloatingWindow.tsx)
- Evidence of current implementation, not product approval: [generation tests](../../client/src/hooks/useGenerateCreditsFromOverlays.test.tsx); [schedule matching tests](../../client/src/utils/teamScheduleCredits.test.ts); [persistence tests](../../client/src/utils/dbUtils.test.ts); [window and status tests](../../client/src/pages/CreditsEditor/GeneratedCreditsFloatingWindow.test.tsx); [result state tests](../../client/src/store/generatedCreditsSlice.test.ts).
