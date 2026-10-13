# Feature Contract: Generate Credits

**Contract status:** Confirmed operator workflow; explicit regeneration behavior is implemented. Scheduled-role creation is approved by the current request. Empty loaded assignments and ambiguous grouped-role matching remain unresolved.

**Approval source:** Product-owner request, October 10, 2026: “Existing matching credits are updated, even when they contain previously generated or manually edited text.” The same request describes credits as editable records of participants, calls for post-service corrections to reflect who actually served, and says regeneration is explicit rather than triggered by source changes.

**Additional approval source:** Product-owner request, October 13, 2026: pressing **Generate Credits** updates matching credits and creates credits for assigned scheduled positions that have no corresponding credit. New credits use the scheduled position heading, include assigned names, append after existing credits, and report **Created** only after both the credit row and its outline index are saved. Creation failures remain safe to retry without duplicates.

**Last reviewed:** October 13, 2026

## Purpose

Help operators prepare a credits list from participant overlays and available serving information, then make that list accurate to the people who actually served. Credits are editable records of participation, not a permanently synchronized copy of planned assignments.

## Operator workflow

1. Before a service, prepare overlays, schedules, and other participant information that is available.
2. Intentionally press **Generate Credits** to populate or refresh matching credits from that information.
3. Manually refine names, ordering, or presentation text as needed.
4. During the service, account for real changes: an absence, a substitution, or someone serving in a different role.
5. After the service, correct credits to reflect who actually served.
6. Keep those corrections unless an operator edits the credits again or intentionally generates them again.

Changes to source data do not automatically regenerate credits.

## Expected behavior — confirmed product intent

- Pressing **Generate Credits** is an explicit request to refresh matching credits. It replaces their contents with the generated result, even when the existing text was previously generated and then manually edited.
- If a credit's heading, visibility, or other fields change while generation is running, preserve those current fields while applying the generated text and provenance.
- For participant overlays, a matching overlay with an explicitly blank name is an authoritative empty result; when no overlay matches the event or its name is missing, there is no valid result and the existing credit text remains unchanged.
- Manual edits after generation are allowed and remain in the editable credits record until an operator changes that record or intentionally regenerates it.
- The operator may correct a plan-derived list after the service so it records who actually served.
- Generation does not run automatically when an overlay, plan, or schedule changes.
- Missing or not fully loaded schedule data must not be mistaken for a confirmed empty assignment and used to blank schedule-backed credits. Preserve the safeguards that distinguish unavailable schedule data from a loaded schedule.
- On an explicit generation, create a visible credit for each assigned scheduled position that has no corresponding existing credit, using the position heading and assigned names. Append new credits after existing credits; do not create a credit when the position has no assigned names.
- Report **Created** only after the new row and its outline index are persisted. A failed or interrupted create can be retried without producing another credit. Existing credit formatting, visibility, and order remain unchanged.
- Preserve the existing schedule-to-credit matching and grouping rules. If those rules cannot distinguish a genuinely missing credit from a grouped heading that could cover multiple scheduled positions, leave that case unresolved until the product owner clarifies it.

The replacement rule applies when there is a valid generated result for a matching credit. It does not decide what an empty but fully loaded assignment means; see [open questions](#known-mismatch-and-open-product-questions).

## Behavioral boundaries

- Generated credits are not continuously synchronized copies of plans or schedules.
- A planned roster is preparation information, not proof of who ultimately served; operators may correct the credits afterward.
- Unavailable/incomplete data and a loaded empty assignment are distinct states. The former must not silently be treated as an authoritative empty result.
- The previous conflict between explicit regeneration and manual-edit preservation is resolved. The open schedule decisions below remain unresolved.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| First generation from available participant information | Populate matching credits from available sources. | `useGenerateCreditsFromOverlays` builds entries from participant overlays and team schedule data; hook tests cover generated values. | Confirmed workflow; exact source matching remains an implementation detail unless it changes operator-visible results. |
| Assigned scheduled position has no corresponding credit | Append a credit with the scheduled position heading and assigned names; report **Created** only after saving the row and index. | `useGenerateCreditsFromOverlays` and `putGeneratedCreditDoc` are the generation and persistence paths; focused tests cover creation, index recovery, and stable position IDs. | Confirmed by the product-owner request, October 13, 2026. Ambiguous grouped-role cases remain unresolved. |
| Matching credit has no participant overlay source or the match has no name value | Leave its text unchanged and report that the participant overlay source was unmatched. | The hook records an unmatched result without persisting the credit; tests cover missing sources and present-but-blank values. | Confirmed by the product-owner request, October 11, 2026. |
| Matching participant overlay is present with an explicitly blank name | Treat the blank value as authoritative when Generate Credits is explicitly requested. | The hook produces an empty generated result and persists it; regression tests distinguish it from missing names. | Confirmed by the product-owner request, October 11, 2026. |
| Same-outline credit fields change while generation is running | Preserve the current heading, visibility, and other fields while applying generated text. | The hook merges into latest Redux state; field-scoped Pouch writes preserve other document fields and retry once after a revision conflict. Focused hook, editor, and persistence tests cover these interleavings. | Confirmed by the product-owner request, October 11, 2026. |
| Explicit regeneration after an operator edited generated text | Refresh the matching credit from the current source data, replacing the previous manual text. | The hook applies and persists the generated text and refreshes its provenance; focused tests cover edited text, persisted override flags, and failed saves. | Confirmed and implemented. |
| Operator corrects credits after service; no regeneration occurs | Keep the operator's corrected record. | Credits are edited and persisted through the credits editor; inspect the implementation references below. | Confirmed workflow. |
| Source changes after generation, with no button press | Do not regenerate automatically. | Generation is invoked by the editor/toolbar action; no source-change-triggered regeneration is part of this contract. | Confirmed. |
| One existing heading can match multiple scheduled position headings | Do not invent a grouping or split-role mapping when the current rules cannot identify which positions the credit covers. | `teamScheduleCreditHeadingMatches` removes generic role terms and `findTeamScheduleCreditEntryForHeading` selects the first matching schedule entry. | **Open product decision**, raised for clarification in the October 13, 2026 request. |
| Matching service schedule is only a summary or its assignments are unavailable | Do not treat missing cells as an empty roster and write blank credits on that basis. | `teamScheduleCredits.ts` returns `scheduleUnavailable: true` for an unhydrated matching schedule; its test asserts this distinction. | Confirmed safeguard. Other independently available source behavior during a partial load is not fully specified. |
| Matching schedule is fully loaded but the assignment row is empty | Product owner has not yet specified whether explicit generation should clear matching credit text or leave it untouched. | Current code emits empty entries and the hook treats a matching loaded schedule entry as authoritative; the hook test expects `nextText: ""` instead of stale imported names. | **Open product decision.** The test and implementation are not approval. |
| A source request errors while other inputs are available | Preserve protection against using unavailable schedule data as proof of an empty roster. | The hook displays a schedule warning and continues; for three team headings it can still use imported service-plan assignments when the Teams schedule is unavailable. | The intended scope and source fallback for partial generation need review; see open question below. |

## Product decisions

### Explicit regeneration replaces manual edits

- **Question/problem:** Should an explicit Generate Credits action preserve manually edited text or refresh it from available source information?
- **Approved behavior:** Refresh matching credits, replacing existing generated or manually edited text with the current generated result.
- **Approved workflow:** Prepare available participant information before service; explicitly regenerate matching credits; refine names, order, or presentation text; then correct the list after service to record who actually served. Manual corrections remain until another edit or explicit regeneration, and source changes alone do not trigger regeneration.
- **Why:** Credits are editable records of actual participants, not continuously synchronized copies of planned assignments. An explicit regeneration means the operator chose to refresh the matching contents; preserving manual text would make that action silently skip the requested refresh.
- **Material alternative rejected:** Silently preserve a manual override during explicit regeneration, which would prevent the action from refreshing all matching credits.
- **Approval source/date:** Product-owner request, October 10, 2026; see the approved wording and workflow above.
- **Affected workflow/contract:** Credits preparation and post-service correction; this contract.

### Participant overlay source presence and empty names

- **Question/problem:** Should a missing participant overlay match be treated like an empty participant name during explicit generation?
- **Approved behavior:** A missing match or missing name value is not a valid generated result, so the matching credit is left unchanged and shown as unmatched. A matching participant overlay with an explicitly blank name is an authoritative empty result and clears matching credit text on explicit generation.
- **Why:** This prevents absent overlay data from erasing existing names while keeping an intentional blank source meaningful.
- **Material alternative rejected:** Convert every missing overlay match to an empty string, which could clear text without an authoritative source.
- **Approval source/date:** Product-owner request, October 11, 2026.
- **Affected workflow/contract:** Generate Credits from participant overlays.

### Concurrent credit edits during generation

- **Question/problem:** Should a delayed generation save overwrite credit fields unrelated to generated participant text?
- **Approved behavior:** No. Generation refreshes text and provenance while preserving the latest heading, visibility, and other credit fields from the same outline.
- **Why:** An explicit refresh of participant names must not undo an operator's concurrent presentation or visibility edits.
- **Material alternative rejected:** Save a captured full credit object after an asynchronous delay, which can revert newer edits.
- **Approval source/date:** Product-owner request, October 11, 2026.
- **Affected workflow/contract:** Generate Credits and concurrent credit editing.

### Create missing assigned schedule credits

- **Question/problem:** Should an explicit generation stop at reporting assigned schedule positions without matching credit headings, or add credits for them?
- **Approved behavior:** Update appropriate existing credits first, then create a credit for every assigned scheduled position that has no corresponding credit. Use the scheduled position heading and assigned names, and append the new credit after existing credits. Do not create empty credits. Show **Created** only after both the row and outline index are saved; failures must be retriable without duplicates.
- **Why:** The operator explicitly asked to generate credits from assigned schedule positions, and a missing heading should not silently omit assigned people from the generated result.
- **Material alternative rejected:** Leave assigned positions unmatched until an operator manually adds a credit, which makes Generate Credits incomplete for the approved schedule input.
- **Approval source/date:** Product-owner request, October 13, 2026.
- **Matching boundary:** Preserve current matching/grouping rules. The current request directs clarification when those rules cannot distinguish a missing credit from an ambiguous grouped role; this does not authorize new role mappings.
- **Affected workflow/contract:** Explicit Generate Credits from scheduled assignments.

## Open product questions

The September 25, 2026 change [a684f99f4](https://github.com/K-Cheddar/worship-sync/commit/a684f99f49239f408b6a39888fbb608ac06ca886) (commit subject: `feat: modernize service plan controller sync and credits`, authored 08:36 local time) added `preserveManual` detection in `useGenerateCreditsFromOverlays`. It skipped state updates and persistence for manually edited generated credits. That behavior conflicted with the confirmed meaning of explicit regeneration and has been removed; matching generated text now persists regardless of prior edits.

Current code also handles a fully loaded empty schedule differently from an unavailable summary. The September 30, 2026 follow-up [0466505c5](https://github.com/K-Cheddar/worship-sync/commit/0466505c562db4f65bc893000b1ab71ff7e80e04) and its tests treat a matching loaded empty row as authoritative, so a generation can clear a matching credit. Product intent for this case is not established by that implementation or its tests.

Questions for the product owner:

1. When the matching schedule is fully loaded but has no assigned names for a position, should explicit generation clear the matching credit text (reflecting the empty schedule but potentially erasing an operator correction), or leave it unchanged (protecting the correction but possibly keeping stale names)?
2. If the schedule cannot be loaded, should generation preserve schedule-backed credits while applying independent overlay data, or may it use imported service-plan assignments as a fallback for those headings (which could be stale)? Current code can use the imported assignments for three headings, continues other generation, and shows a schedule warning.
3. If one existing heading matches multiple distinct scheduled positions after generic role words are removed (for example, “Audio” matching “Audio Engineer” and “Audio Technician”), should generation combine those assignments in the existing credit, create a separate credit for the additional position, or leave the additional position unmatched? The current request explicitly defers this case for clarification.

## Implementation references

- Entry points: [CreditsEditor.tsx](../../client/src/pages/CreditsEditor/CreditsEditor.tsx); [OverlayController.tsx](../../client/src/pages/OverlayController/OverlayController.tsx)
- Generation and schedule source handling: [useGenerateCreditsFromOverlays.ts](../../client/src/hooks/useGenerateCreditsFromOverlays.ts); [teamScheduleCredits.ts](../../client/src/utils/teamScheduleCredits.ts)
- Manual editing and persistence: [Credit.tsx](../../client/src/containers/Credits/Credit.tsx); [creditsSlice.ts](../../client/src/store/creditsSlice.ts); [dbUtils.ts](../../client/src/utils/dbUtils.ts)
- Generated result state and presentation: [generatedCreditsSlice.ts](../../client/src/store/generatedCreditsSlice.ts); [GeneratedCreditsFloatingWindow.tsx](../../client/src/pages/CreditsEditor/GeneratedCreditsFloatingWindow.tsx)
- Focused evidence (not product approval): [useGenerateCreditsFromOverlays.test.tsx](../../client/src/hooks/useGenerateCreditsFromOverlays.test.tsx); [teamScheduleCredits.test.ts](../../client/src/utils/teamScheduleCredits.test.ts); [dbUtils.test.ts](../../client/src/utils/dbUtils.test.ts) for index append, retry, partial persistence recovery, and controller races; [GeneratedCreditsFloatingWindow.test.tsx](../../client/src/pages/CreditsEditor/GeneratedCreditsFloatingWindow.test.tsx) and [generatedCreditsSlice.test.ts](../../client/src/store/generatedCreditsSlice.test.ts) for outcome display and progress state.

## Technical design notes (not product requirements)

The current flow reads participant overlays, the selected service-plan assignment preview, and the Teams bootstrap; schedule rows can be hydrated or summary-only. The generated-credit state tracks per-credit progress and persistence errors. These details may change as long as the confirmed workflow and unresolved decision boundaries are respected.
