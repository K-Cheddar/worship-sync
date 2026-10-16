# Feature Contract: Service-plan import and refresh

**Contract status:** Mixed; cross-section matching and relocation are confirmed, broader workflow remains inventory only

**Approval source:** Current request, 2026-10-16 (cross-section matching, review, selection, and ordering requirements)

**Last reviewed:** 2026-10-16

## Purpose

Bring an external service plan into an editable WorshipSync plan while retaining local planning work and making source changes reviewable.

## Operator workflow

An operator imports or refreshes a plan, reviews the proposed item changes, selects the changes to apply, then continues editing and saving the service plan. Other workflow details remain inventory only pending product-owner review.

## Expected behavior

- A uniquely identified external item can match an existing item across sections. If no current item has that external identity, a template-origin item can match when normalized title and compatible type identify one item on each side, even when the incoming row has an external identity.
- An unmarked legacy item can be suggested as a match only when normalized title and compatible type identify exactly one current item and one incoming item. The suggestion is unchecked and must be confirmed individually in review, even when other plan items are source-tracked. Cross-section suggestions are shown as **Moved**.
- Two different nonempty external identities are never equivalent through title or position. The existing item and its local information remain intact; the incoming row is handled separately.
- With legacy suggestions enabled for review, unmarked rows are excluded from automatic same-section title and position matching. Confirmed unique matches are applied only when selected.
- An ambiguous title or duplicate external identity does not claim an existing item. Manually created items are not claimed through title-only matching.
- A matched item retains its WorshipSync item ID and operator-managed information. External fields continue to follow the existing import field ownership options.
- Selecting a move also keeps its incoming source identity when field updates are skipped. For a same-section identity adoption with no move, review offers a separate **Linked** change.
- A relocation appears as a selectable **Moved** change that names the prior and destination sections. Operators can select the move separately from updates to the item's fields.
- Selected moved and new items follow source order relative to confidently matched items. Existing item order stays intact unless a selected relocation requires placement.
- A confidently matched relocation is not represented as a separate removal and addition. Skipped changes remain untouched.

## Behavioral boundaries

- An ambiguous match must not relocate, replace, or delete an existing item.
- Import does not apply every item's position as a blanket reorder.
- Changes beyond the selected additions, removals, updates, and moves remain untouched.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Template-origin item moves to another section | Keep its ID and local information; show one selectable move; honor imported relative placement | `servicePlanImportSync.test.ts`, `servicePlanImportSummary.test.ts`, `ServicePlanImportReviewWindow.test.tsx` | Confirmed by current request |
| Unique durable source identity moves | Match across sections before local title/order reconciliation | Existing durable-ID relocation test and current request | Confirmed by current request |
| Duplicate or missing identity and duplicate title | Match only with safe, unique template provenance; otherwise retain existing items without silent relocation or deletion | Duplicate-ID and duplicate-title regression tests | Confirmed by current request |
| Template plan created before item provenance was stored | Offer a unique title/type match for individual confirmation; leave it untouched if skipped | Earlier template clones stored no template-item provenance; current clone path now stores it | Confirmed by owner reply and current request, 2026-10-16 |
| Import field update alongside a move | Apply the move and selected imported fields independently | `servicePlanImportSync.test.ts` and selected-apply summary test | Confirmed by current request |
| Repeated import | Preserve identity and avoid duplicate items | Reconciliation idempotence tests | Confirmed by current request |
| Broader import, save/sync, and publication behavior | Existing behavior pending a complete workflow contract | Feature registry inventory | Open; outside this contract's confirmed scope |

## Product decisions

- **Question/problem:** An item present in the source plan changes sections, or a template-origin item has no durable external identity.
- **Approved behavior:** Match uniquely by durable source identity first. For template-origin items without source IDs, match by normalized title and compatible type only when the match is unambiguous. Review relocation as an independent selectable change and place selected moves/additions from source-relative order.
- **Why:** The two rows represent the same logical item, while ambiguous matches and operator edits must remain safe.
- **Material alternative rejected:** Treat the old item as removed and the incoming item as a new addition, or infer a title match against an arbitrary manual item.
- **Approval source/date:** Current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

- **Question/problem:** An operator selects a relocation but skips the imported field changes, or a matched item receives a new external identity without other visible changes.
- **Approved behavior:** A selected move adopts the incoming source identity independently of field updates. A same-section identity-only adoption appears as a separately selectable **Linked** change.
- **Why:** Future imports need the durable association, while operators must be able to skip unrelated content updates.
- **Material alternative rejected:** Couple external identity adoption to the visible field update, making the selected move lose its future source match when that update is skipped.
- **Approval source/date:** Current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

- **Question/problem:** A plan created from a template before item provenance was stored has an unmarked same-title item, which may instead be manual.
- **Approved behavior:** Leave unmarked items untouched rather than using title/type alone to relocate them across sections.
- **Why:** Avoid claiming or moving arbitrary manually created items.
- **Material alternative rejected:** Automatically relocate a unique title/type match without evidence that it came from a template.
- **Approval source/date:** Owner reply to current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

- **Question/problem:** Some legacy template clones have no stored template-item marker, but their source row may have moved.
- **Approved behavior:** Offer unique title/type matches for unmarked legacy items as individual, initially unchecked review changes. Show suggestions in first-import and mixed-provenance plans; apply a match only when that specific change is selected.
- **Why:** Operators can confirm a likely template match without silently claiming a manually created item.
- **Material alternative rejected:** Silently infer template ownership from title/type alone, or hide candidates because other items already have source provenance.
- **Approval source/date:** Current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

- **Question/problem:** An incoming row has the same title as an existing source-managed item but a different external identity.
- **Approved behavior:** Do not pair the rows by title or position, and protect the existing item and its local data from removal based on that conflicting row.
- **Why:** External identities are durable ownership evidence and must not be reassigned to a different source row.
- **Material alternative rejected:** Reuse the existing item and overwrite its external identity based on a matching title.
- **Approval source/date:** Current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

## Implementation references

- Entry point: `client/src/pages/Services/ServicePlanEditor.tsx`
- Implementation: `client/src/pages/Services/servicePlanImportSync.ts`, `servicePlanImportSummary.ts`, `servicePlanFromImport.ts`, `servicePlanDraftUtils.ts`
- Tests: `client/src/pages/Services/servicePlanImportSync.test.ts`, `servicePlanImportSummary.test.ts`, `servicePlanDraftUtils.test.ts`, `ServicePlanImportReviewWindow.test.tsx`

## Technical design notes

Template-to-plan cloning stores the original template element ID and item type on each cloned element. A shared placement helper is used by reconciliation and selected-change application so preview and apply use the same source-relative placement behavior.
