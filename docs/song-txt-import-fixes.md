# TXT import corrections — October 19, 2026

## Goal
Preserve ambiguous lyrics and keep duplicate selection inside the Service Plan.

## Existing architecture
The parser extracts local-file metadata before the existing section pipeline.
ServicePlanElementRow opens ServicePlanLibraryPicker, whose onSelectSong callback
adds/replaces a plan reference. Its existing handleAttachSong closes/reset the
picker. CreateItem is shared with controller routes and currently navigates for
every duplicate action. The canonical library combines index rows with documents.

## Before behavior
A one/two-line final stanza can be moved into authors; an embedded duplicate action
navigates away from the Service Plan instead of calling its attachment callback.

## After behavior
Unlabelled footer blocks stay in lyrics with a warning. Labelled credits and known
CCLI/copyright/publisher footer fields still extract. Embedded duplicate selection
attaches through the picker; controller duplicate opening retains navigation.

## Product Decision Check
Authorized by the October 19 request and features/song-txt-import.md: ambiguous
content must remain in lyrics; duplicate choices must respect the current picker.
Unlabelled names are indistinguishable from lyrics without external evidence, so
even plausible names remain available for review. No new storage or schema choice.

## Behavior intentionally unchanged
Draft replacement confirmation, search/manual paste, metadata shapes, section and
arrangement generation, creation/persistence, explicit separate-song creation,
and controller routing. No v2, server, IPC or shared overlay changes.

## Acceptance criteria
Reproduce lyric loss before fixing; cover one/two-line endings and labelled credits;
exercise the real picker->CreateItem->duplicate path, unchanged route and existing
attachment callback; preserve draft on return, library documents and arrangements.

## Proposed implementation
Remove credit reclassification while retaining its candidate-block warning;
add an optional embedded song-selection callback, wired to the existing picker
attachment path and hydrated metadata. No new workflow or writer.

## Affected surfaces
Browser/Electron parser and shared CreateItem; ServicePlanLibraryPicker modal under
its normal Redux, router, ControllerInfo and GlobalInfo providers. Integration tests
use the real picker/CreateItem and a router location probe, with mocked DB/session
contexts and native file content. No new provider or portal primitive.

## Risks / edge cases
Unlabelled actual credits require review rather than being guessed away. Attach
must not create a song, change the live outline, modify library data or navigate.
Return to editing must leave all draft fields intact. An embedded consumer without
an attachment callback must not expose a controller-navigation action.

## Questions requiring user input
None.

## Verification
Run new regressions against the original implementation, then focused parser,
CreateItem, picker, section/item and library tests plus client lint/type checking.
Review callers, full diff, and preserved draft/metadata/arrangement assertions.
Manual native dialogs and full repository suites are optional confidence checks.

## Scoped workflow review

### Findings
- High, fixed: songTxtImport.ts reclassified a final stanza as authors based only
  on footer position/length. Removed reclassification; warning-only detection.
- Medium, fixed: CreateItem used controller navigation inside the Service Plan
  picker. The contextual callback now uses its existing attachment path instead.
- Critical / Low: None. No remaining findings in the changed workflow.

### Product authorization status
Authorized by the current correction request; decisions recorded in the feature
contract. The former unlabelled-author fixture expectation deliberately changes:
ambiguous names must remain in lyrics just like ambiguous lyric lines.

### Open questions / assumptions
None. No reliable distinction between unlabelled names and lyrics is assumed.

### Verification gaps
No required gaps. Production-context check: Pass. Followed ServicePlanElementRow's
selection callback, which replaces the target song reference or appends a new one.
The real picker/CreateItem modal test uploads TXT, applies, opens duplicates,
returns to editing, then attaches. Its location probe reproduced navigation into
`/controller/item/...` before the fix and unchanged plan routing afterward.

| Invariant | Adversarial scenario / code evidence | Test evidence | Result |
| --- | --- | --- | --- |
| Lyrics survive | One/two-line endings directly precede CCLI and copyright; parser now only warns | Both new regressions failed before fix with missing ending text, pass after | Pass |
| Known metadata extracts | Explicit Authors, Songwriters, Words and Music by; CCLI, copyright, publisher and two existing fixtures | Parser suite including updated ambiguous-name expectation | Pass |
| Draft is preserved | Import metadata/lyrics, open duplicates, return to editing | Full Redux draft equality in title/CCLI integration cases; existing replacement and cancellation tests | Pass |
| Selection remains contextual | Title and CCLI match; callback resolves canonical document and passes reference to handleAttachSong | Both route regressions failed before fix; attach callback fires once with existing ID and stored key | Pass |
| Library is unchanged | Attach while imported lyrics/metadata differ from original | Full document/arrangement snapshot unchanged, index unchanged, no create, no live-outline addition | Pass |
| Controller remains navigable | Nonembedded duplicate opens existing song using goToItem | Existing CreateItem CCLI duplicate routing test | Pass |
| Callback absence is safe | Embedded create has no selection callback | Duplicate names remain visible, no controller action; return preserves draft | Pass |

Checks run successfully from client/:

```text
npm.cmd test -- --runInBand src/utils/songTxtImport.test.ts src/containers/CreateItem/CreateItem.test.tsx src/pages/Services/ServicePlanLibraryPicker.test.tsx src/utils/itemUtil.test.ts src/utils/lyricsSectionInference.test.ts src/utils/songLibrary.test.ts src/store/songLibrarySelectors.test.ts
7 suites, 162 tests passed
npm.cmd run type-check
npm.cmd run lint:check
```

`git diff --check` passed. Initial type checking exposed the hydrated document's
missing listId; the attachment handler now accepts the canonical reference builder's
input shape, which does not need a controller outline ID. No casts were added.

Optional checks not performed: manual browser/Electron dialogs and full repository
suites. Existing round-trip and arrangement tests passed; no schema/storage code
changed. Residual limitation: actual unlabelled credits require manual review.

### Pattern / learning opportunities
Position and block length cannot establish authorship. Keep the warning without
using it to authorize content removal. Use the owning picker's selection callback.
No new abstractions or repository policies are needed.

### Final readiness
Ready for these two fixes and their immediate workflows; not a release-wide audit.

- Cross-boundary review and sibling-pattern search: Yes; other embedded creators,
  controller navigation, normal picker attach, and section processing inspected.
- Legacy/persisted compatibility and contract round trip: Yes; no shape changes;
  metadata/arrangement round-trip tests passed and selected keys are preserved.
- Identity-switch and unmount/lifetime coverage reviewed: Yes; existing creation
  and TXT-read lifecycle tests passed. No new asynchronous boundary was added.
- Validate/use boundary: Yes; local immutable file parsing and current canonical
  song documents only; no new network access or permissions.
- Retry-state authority / owner retirement: Yes; existing draft/creation lifecycle
  unchanged; selection is synchronous and owned by the mounted picker.
- External compensation / authorization projections: Not applicable; no new
  external side effects, deletion, writers or permission-dependent projections.
- Production runtime and test composition compared: Yes; real picker and CreateItem
  under existing providers, simulated file contents and observed router location.
