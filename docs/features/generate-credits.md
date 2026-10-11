# Feature Contract: Generate Credits

**Contract status:** Confirmed operator workflow from the product-owner request; current implementation conflicts with one confirmed behavior. Empty loaded assignments remain unresolved.

**Approval source:** Product-owner request, October 10, 2026 (the feature-contract task).

**Last reviewed:** October 10, 2026

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
- Manual edits after generation are allowed and remain in the editable credits record until an operator changes that record or intentionally regenerates it.
- The operator may correct a plan-derived list after the service so it records who actually served.
- Generation does not run automatically when an overlay, plan, or schedule changes.
- Missing or not fully loaded schedule data must not be mistaken for a confirmed empty assignment and used to blank schedule-backed credits. Preserve the safeguards that distinguish unavailable schedule data from a loaded schedule.

The replacement rule applies when there is a valid generated result for a matching credit. It does not decide what an empty but fully loaded assignment means; see [open questions](#known-mismatch-and-open-product-questions).

## Behavioral boundaries

- Generated credits are not continuously synchronized copies of plans or schedules.
- A planned roster is preparation information, not proof of who ultimately served; operators may correct the credits afterward.
- Unavailable/incomplete data and a loaded empty assignment are distinct states. The former must not silently be treated as an authoritative empty result.
- This contract documents product intent. It does not implement the conflict described below.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| First generation from available participant information | Populate matching credits from available sources. | `useGenerateCreditsFromOverlays` builds entries from participant overlays and team schedule data; hook tests cover generated values. | Confirmed workflow; exact source matching remains an implementation detail unless it changes operator-visible results. |
| Explicit regeneration after an operator edited generated text | Refresh the matching credit from the current source data, replacing the previous manual text. | Current hook preserves an override and skips updating/persisting that credit. Test `preserves a genuinely manually edited generated credit during regeneration` asserts this behavior. | **Known product/implementation conflict.** Current implementation does not match confirmed intent. |
| Operator corrects credits after service; no regeneration occurs | Keep the operator's corrected record. | Credits are edited and persisted through the credits editor; inspect the implementation references below. | Confirmed workflow. |
| Source changes after generation, with no button press | Do not regenerate automatically. | Generation is invoked by the editor/toolbar action; no source-change-triggered regeneration is part of this contract. | Confirmed. |
| Matching service schedule is only a summary or its assignments are unavailable | Do not treat missing cells as an empty roster and write blank credits on that basis. | `teamScheduleCredits.ts` returns `scheduleUnavailable: true` for an unhydrated matching schedule; its test asserts this distinction. | Confirmed safeguard. Other independently available source behavior during a partial load is not fully specified. |
| Matching schedule is fully loaded but the assignment row is empty | Product owner has not yet specified whether explicit generation should clear matching credit text or leave it untouched. | Current code emits empty entries and the hook treats a matching loaded schedule entry as authoritative; the hook test expects `nextText: ""` instead of stale imported names. | **Open product decision.** The test and implementation are not approval. |
| A source request errors while other inputs are available | Preserve protection against using unavailable schedule data as proof of an empty roster. | The hook displays a schedule warning and continues; for three team headings it can still use imported service-plan assignments when the Teams schedule is unavailable. | The intended scope and source fallback for partial generation need review; see open question below. |

## Product decisions

### Explicit regeneration replaces manual edits

- **Question/problem:** Should an explicit Generate Credits action preserve manually edited text or refresh it from available source information?
- **Approved behavior:** Refresh matching credits, replacing existing generated or manually edited text with the current generated result.
- **Why:** The operator deliberately chose to regenerate; manual corrections serve the actual-service record until another intentional edit or regeneration.
- **Material alternative rejected:** Silently preserve a manual override during explicit regeneration, which would prevent the action from refreshing all matching credits.
- **Approval source/date:** Product-owner request, October 10, 2026.
- **Affected workflow/contract:** Credits preparation and post-service correction; this contract.

## Known mismatch and open product questions

The September 25, 2026 change [a684f99f4](https://github.com/K-Cheddar/worship-sync/commit/a684f99f49239f408b6a39888fbb608ac06ca886) (commit subject: `feat: modernize service plan controller sync and credits`, authored 08:36 local time) added `preserveManual` detection in `useGenerateCreditsFromOverlays`. It skips both the state update and persistence for a manually edited generated credit, and reports it as preserved. This conflicts with the confirmed meaning of an explicit regeneration above. The present task records the conflict; it does not change the code.

Current code also handles a fully loaded empty schedule differently from an unavailable summary. The September 30, 2026 follow-up [0466505c5](https://github.com/K-Cheddar/worship-sync/commit/0466505c562db4f65bc893000b1ab71ff7e80e04) and its tests treat a matching loaded empty row as authoritative, so a generation can clear a matching credit. Product intent for this case is not established by that implementation or its tests.

Questions for the product owner:

1. When the matching schedule is fully loaded but has no assigned names for a position, should explicit generation clear the matching credit text (reflecting the empty schedule but potentially erasing an operator correction), or leave it unchanged (protecting the correction but possibly keeping stale names)?
2. If the schedule cannot be loaded, should generation preserve schedule-backed credits while applying independent overlay data, or may it use imported service-plan assignments as a fallback for those headings (which could be stale)? Current code can use the imported assignments for three headings, continues other generation, and shows a schedule warning.

## Implementation references

- Entry points: [CreditsEditor.tsx](../../client/src/pages/CreditsEditor/CreditsEditor.tsx); [OverlayController.tsx](../../client/src/pages/OverlayController/OverlayController.tsx)
- Generation and schedule source handling: [useGenerateCreditsFromOverlays.ts](../../client/src/hooks/useGenerateCreditsFromOverlays.ts); [teamScheduleCredits.ts](../../client/src/utils/teamScheduleCredits.ts)
- Manual editing and persistence: [Credit.tsx](../../client/src/containers/Credits/Credit.tsx); [creditsSlice.ts](../../client/src/store/creditsSlice.ts)
- Focused evidence (not product approval): [useGenerateCreditsFromOverlays.test.tsx](../../client/src/hooks/useGenerateCreditsFromOverlays.test.tsx); [teamScheduleCredits.test.ts](../../client/src/utils/teamScheduleCredits.test.ts)

## Technical design notes (not product requirements)

The current flow reads participant overlays, the selected service-plan assignment preview, and the Teams bootstrap; schedule rows can be hydrated or summary-only. The generated-credit state tracks per-credit progress and persistence errors. These details may change as long as the confirmed workflow and unresolved decision boundaries are respected.
