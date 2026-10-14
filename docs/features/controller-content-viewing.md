# Feature Contract: Controller content viewing from service plans and libraries

**Contract status:** Confirmed product intent

**Approval source:** Current user request, 2026-10-11.

**Last reviewed:** 2026-10-11

## Purpose

Let controller operators inspect the content attached to a service-plan item or shown in the item library, using WorshipSync's established viewers.

## Operator workflow

An operator opens a saved Service Plan in the Presentation Controller, then selects an attached song, scripture passage, custom document, or previewable resource. The selected content opens in its existing viewer or in the Controller's Bible route. In Filtered Items, the operator can view song or custom-item details without adding or deleting an outline item.

## Expected behavior

- Service-plan attachments remain in their saved order. Each attachment is a separate action, including repeated songs, scripture passages, and custom documents.
- Resolve library songs and custom documents by their saved IDs. A display title is not a substitute when an ID exists.
- Library songs open the existing song-details drawer with their lyrics, arrangements, and saved details. Pending songs with lyrics open the existing plain-lyrics drawer.
- Scripture references use the Controller's existing Bible route parameters and openBibleAtLocation behavior to select the saved book, chapter, verse range, and translation.
- Custom documents open the established read-only slide preview, including slide backgrounds, text, and formatting.
- Other supported resources continue to use ContentPreviewDialog and its existing resource handling.
- Filtered Items offers **View details** for songs and custom items in their applicable filters, including **All Items**. Add to outline and Delete retain their existing behavior.
- Missing library references show a clear unavailable-content state.

## Behavioral boundaries

Viewing an attachment or item does not add content to the outline, change the selected live outline item, start Service Plan Sync, transmit content to any output, or modify the service-plan or referenced library document.

The Bible route keeps its existing explicit Send actions. Navigating to a passage does not automatically send it or add it to the outline.

Opening or closing a details viewer keeps the selected Service Plan, its filters, and its scroll position where the current controller composition permits.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Library song | Open the matching library document by ID in the song-details drawer. | Controller previously displayed the song as a non-interactive resource; Filtered Items already reuses the drawer. | Confirmed by current request. |
| Pending or missing song | Show attached pending lyrics, or explain that a missing library song is unavailable. | The existing plain-lyrics drawer supports plan lyrics and an empty-state message. | Confirmed by current request. |
| Scripture | Navigate to the existing Bible route with the complete saved reference. | Bible route already accepts book, chapter, version, and verses. | Confirmed by current request. |
| Custom document | Open the original library document by ID in the read-only slide preview, or show an unavailable state. | The Services editor already resolves custom documents by ID and uses the shared slide renderer. | Confirmed by current request. |
| Other resources | Keep URL, text, and media previews available through the existing preview dialog. | Controller currently opens previewable public-snapshot resources. | Confirmed by current request. |
| Presentation state | Viewing does not mutate the outline, run sync, transmit content, or write either document. | New behavior must remain local viewer state or route navigation. | Confirmed by current request. |

## Product decisions

- **Question/problem:** How should operators inspect content attached to a saved Controller Service Plan?
- **Approved behavior:** Open the existing song drawer, Bible route, custom-document slide preview, or resource preview. Use saved IDs for library documents and preserve the attachment order.
- **Why:** Operators need to review content without triggering live presentation actions.
- **Material alternative rejected:** Sending or adding selected content automatically would conflate viewing with explicit presentation actions.
- **Approval source/date:** Current user request, 2026-10-11.
- **Affected workflow/contract:** Presentation Controller Service Plan and Filtered Items.

## Implementation references

- Entry point: Presentation Controller Service Plan and Filtered Items.
- Implementation: client/src/pages/Controller/ControllerServicePlanView.tsx, client/src/components/FilteredItems/FilteredItems.tsx, shared song and custom-document viewers.
- Tests: client/src/pages/Controller/ControllerServicePlanView.test.tsx, client/src/components/FilteredItems/FilteredItems.test.tsx.

## Technical design notes (separate from product requirements)

The public service-flow snapshot intentionally omits attachment IDs and structured song/scripture references. The authenticated controller view should pair its display rows with the original plan element resources returned by getServicePlanElementContentResources.
