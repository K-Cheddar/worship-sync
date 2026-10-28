# Feature Contract: Service-plan import and refresh

**Contract status:** Mixed; cross-section matching, relocation, and saved-plan outline sync rules are confirmed, broader workflow remains inventory only

**Approval source:** User requests, 2026-10-16 (cross-section matching, review, selection, and ordering) and 2026-10-18 (saved-plan outline fallbacks and whole-chapter Scripture)

**Last reviewed:** 2026-10-27

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
- Planning Center PDF duplicate-title identities are assigned only to source-owned items. A changed duration may reuse an identity when exact matches or unique neighboring items identify one occurrence in the same section. Occurrence index alone is not evidence when the count of an identical-title-and-duration group changes; uncertain occurrences remain in place and appear as individually confirmable review suggestions.
- Planning Center PDF refresh preserves missing items by default. When removal review is enabled, only source-owned items absent from the PDF are proposed for removal. Unmarked items in a legacy PDF plan remain because their source ownership cannot be confirmed.
- Selected moved and new items follow source order relative to confidently matched items. Existing item order stays intact unless a selected relocation requires placement.
- A confidently matched relocation is not represented as a separate removal and addition. Skipped changes remain untouched.

## Behavioral boundaries

- An ambiguous match must not relocate, replace, or delete an existing item.
- An existing item reserved for an individual match review is excluded from automatic identity, title, order, and cross-section matching, removal, and PDF ordering. Only its selected `legacy_match` suggestion may associate it with an incoming row. Each existing item participates in at most one proposed association. (Confirmed by the current request, 2026-10-27.)
- When another change is approved, an unapproved PDF match retains its review-required protection through save/reload even if collision resolution removed its synthetic key. PDF source position identifies keyless review candidates. (Confirmed by the current request, 2026-10-28.)
- Import does not apply every item's position as a blanket reorder.
- Changes beyond the selected additions, removals, updates, and moves remain untouched.

## Live-adjusted timing display (confirmed 2026-10-27)

The current user request confirms these live timing display rules across the Service Plan Editor, Current Service Workspace, Controller Service Plan, public service plan, and Current Service Viewer:

- Use the existing service-flow timeline calculations for live and planned item times. An anchored **Make Live** action adjusts its selected item and later items; items before it keep their planned times.
- Keep saved `startTime` values as the editable planned schedule. View mode may display adjusted times, but live timing is never written into those fields.
- Continue showing normal planned times when no live adjustment is active. Use a blue time color only when its displayed value differs from the scheduled timeline, and expose the planned time as accessible context for changed values.
- Reflect remote live-state updates in every view. Keep the existing live-item highlight and badge separate from the timing color.
- Preserve automatic advancement, manual pinning, pause/resume, and Return to Planned Schedule behavior. Projected live times remain separate from recorded actual start times.
- Public snapshots continue deriving their planned baseline from existing timeline utilities; no public data shape or persisted field changes are required.

Regression coverage: `ServicePlanElementRow.test.tsx`, `ServicePlanEditor.test.tsx`, `ControllerServicePlanView.test.tsx`, `ServicePublicView.test.tsx`, and `CurrentServiceViewer.test.tsx`.

## Saved-plan outline sync (confirmed 2026-10-18)

The current user request authorizes these rules for syncing a saved Service Plan to the Controller outline:

- Insert actionable attachments beneath their resolved mapped heading when it exists. If an explicitly mapped heading is missing, append the content at the outline end in Service Plan order. Do not create a heading or substitute a similarly named heading.
- Recheck placement against the latest outline after asynchronous item creation. If the destination heading was removed, append to that same outline only while its original context remains valid. Stop requests finish the active item and leave later items untouched.
- Count successful fallbacks as added content and explain the missing heading in the added item's summary. Report the fallback only after insertion, including in partial-success or combined outline/overlay summaries.
- Accept whole-chapter Scripture such as Psalms 105 alongside explicit verse ranges. Use the existing Bible loader and requested version; invalid or unavailable passages must not produce empty items.
- Retain stable attachment/list IDs and skip already-present items on repeated sync. Preserve saved Service Plan data.
- Library refreshes caused by indexing imported Bible items do not interrupt the remaining saved-plan attachments; outline, database, source-plan, and component ownership checks still apply.

Regression coverage: `servicePlanOutlineBridge.test.ts`, `useServicePlanOutlinePush.test.tsx`, `ServicePlanningSyncFloatingWindow.test.tsx`.

## Controller saved-plan source (confirmed 2026-10-27)

**Approval source:** Current user request, 2026-10-27.

- Services owns plan creation, import, and maintenance. Its Service Planning URL, Planning Center account, and Planning Center PDF imports remain available.
- The Controller automatically selects the current service's saved plan and allows a deliberate selection of another saved plan. No saved plan means an empty Controller plan view, with no independent URL import.
- Retire Configurations > Service Planning. Redirect `/controller/service-planning` to `/controller`; discard the removed route when remembering configuration navigation.
- The Service Plan floating window keeps Refresh, Sync All, Sync Outline, Sync Overlays, overlay preview, and sync results. A compact Outline preview starts collapsed and reports native attachment identity, duplicate prevention, unresolved references, and section placement using `planServicePlanOutlineItems`.
- Live updates, reconnects, and Refresh update previews only. Presentation outline and overlay changes require an explicit sync action. Native outline sync continues through `useServicePlanOutlinePush`; existing overlay sync rules remain unchanged.
- Historical URL previews cannot become the Controller source or appear beneath an unrelated service. Preserve historical documents, outline content, `servicePlanBinding`, Credits Editor's historical data access, permissions, and independent controller profiles. No database migration is required.

**Product decision:** Saved Services plans replace the independent Controller URL source. The rejected alternative is keeping a second Controller import workflow that can override the saved plan.

Regression coverage: `useCurrentServicePlanSource.test.tsx`, `useCurrentServicePlanSource.stale.test.tsx`, `ServicePlanningSyncFloatingWindow.test.tsx`, `ServicePlanOutlinePreview.test.tsx`, route/navigation tests, and the native outline bridge/push tests.

## Native WorshipSync transfer (confirmed 2026-10-25)

The current user request confirms these native transfer behaviors:

- Export the current editable draft as a versioned WorshipSync JSON file. Exclude publication, live playback, revisions, share tokens, and server-only metadata.
- Import a supported WorshipSync JSON version or import the snapshot returned by an existing public service-plan link. A Current Service link resolves once at import time.
- Preserve the destination occurrence identity, date, service association, and publishing settings. Re-key imported items and remove outline-push and external-sync tracking.
- Keep usable same-church library references. When churches differ, match songs by title when possible, retain usable content, and show unresolved song references for review.
- Ask before replacing content in a populated destination. Apply the accepted import as one `updateDraft()` edit so undo and autosave remain available.
- Native transfer is a one-time copy and must not create continuous source-refresh tracking. Existing public links and Planning Center / Service Planning behavior remain unchanged.

**Approval source/date:** Current user request, 2026-10-25.

Regression coverage: `servicePlanNativeTransfer.test.ts` and the public-link replacement flow in `ServicePlanEditor.test.tsx`.

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

- **Question/problem:** A Make Live timeline adjustment was visible on the public service plan, while internal plan views could keep showing the saved schedule or lose adjusted times after automatic advancement.
- **Approved behavior:** Use the shared timeline calculations across the editor, current workspace, controller, public plan, and current viewer. Keep the original schedule editable and persisted, distinguish only visibly changed times in blue, and retain existing live-state controls and indicators.
- **Why:** Operators and viewers need a consistent timeline while keeping the saved schedule available for editing and recovery.
- **Material alternative rejected:** Persist projected times into the planned schedule or show blue merely because a plan is anchored.
- **Approval source/date:** Current user request, 2026-10-27.
- **Affected workflow/contract:** Service-plan live timing display.

- **Question/problem:** An item present in the source plan changes sections, or a template-origin item has no durable external identity.
- **Approved behavior:** Match uniquely by durable source identity first. For template-origin items without source IDs, match by normalized title and compatible type only when the match is unambiguous. Review relocation as an independent selectable change and place selected moves/additions from source-relative order.
- **Why:** The two rows represent the same logical item, while ambiguous matches and operator edits must remain safe.
- **Material alternative rejected:** Treat the old item as removed and the incoming item as a new addition, or infer a title match against an arbitrary manual item.
- **Approval source/date:** Current request, 2026-10-16.
- **Affected workflow/contract:** Service-plan import and refresh.

- **Question/problem:** Planning Center PDF duplicate-title rows have no durable source item IDs, and item durations can change between imports.
- **Approved behavior:** Match duplicate rows by their stable duration identity when possible. If that evidence changes, reuse the identity only when unique neighboring items or another reliable existing identifier identify the source-owned occurrence within its section. When an identical-title-and-duration group changes in count, do not use shifted occurrence indices as a match; preserve existing rows and show uncertain matches individually for confirmation. Keep operator-created items outside PDF identity matching and exclude unconfirmed candidates from automatic ordering.
- **Why:** A duration edit should not orphan local work, while an uncertain occurrence must not inherit notes, assignments, equipment, attachments, or identity without operator review.
- **Material alternative rejected:** Treat every changed duplicate duration as an unrelated addition or silently choose one same-title occurrence based on its new position.
- **Approval source/date:** Current user request, 2026-10-27.
- **Affected workflow/contract:** Planning Center PDF refresh.

- **Question/problem:** A declined ambiguous PDF match could be automatically associated on the next refresh, and an ordering pass could use a candidate omitted from its source-order calculation.
- **Approved behavior:** Preserve the unconfirmed row at its existing location and carry its review-required state through save/reload. Repeated refreshes continue to offer that candidate individually until approved. Apply the same eligibility rule when selecting source-owned rows and when reordering them; manual rows and their relative positions remain intact.
- **Why:** Each review choice must affect only its selected change, and repeated refreshes must neither duplicate nor lose existing or proposed items.
- **Material alternative rejected:** Let a declined row fall back into exact-position matching or include it in one half of a reorder operation.
- **Approval source/date:** Current user request, 2026-10-27.
- **Affected workflow/contract:** Planning Center PDF refresh.

- **Question/problem:** Planning Center PDF refresh cannot remove source items that are no longer present, while automatic removal risks deleting local work.
- **Approved behavior:** Keep removal off by default. When enabled, show source-owned missing items in the existing import review and apply only the removals the operator selects. Never propose unmarked legacy PDF items for removal because ownership is unknown.
- **Why:** Operators can clean up a tracked source refresh without losing manually created items or legacy items whose ownership is not recorded.
- **Material alternative rejected:** Delete missing rows automatically or infer source ownership for unmarked PDF items.
- **Approval source/date:** Current user request, 2026-10-27.
- **Affected workflow/contract:** Planning Center PDF refresh.

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

Template-to-plan cloning stores the original template element ID and item type on each cloned element. Existing sections use the shared placement helper in reconciliation and selected-change application. A newly created destination section uses the already source-ordered reconciled element list directly, since moved items retain local IDs that may differ from the incoming IDs used as placement anchors.
