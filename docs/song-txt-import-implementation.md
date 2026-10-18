# TXT import implementation plan and verification

## Goal
Import a local TXT song through the existing editable Create Song draft and writer.

## Existing architecture
CreateItem uses a Redux draft; LRCLIB search already fills lyrics and metadata.
The shared component runs in controller pages and the Service Plan library modal.
The canonical song selector merges the lightweight index with hydrated documents.
Metadata flows through item creation, reducers, document reconstruction, and editing.

## Before behavior
Only manual paste and lyrics search were available. Same-title songs could be
created directly; text before the first explicit section label was omitted.

## After behavior
Local file selection opens an editable inline review, then explicit apply. Draft
replacement and duplicate creation require decisions before the existing create.
Opening unlabeled text survives inference; Ending is a recognized section label.

## Product Decision Check
The current user request authorizes all new behavior; see the confirmed contract
in `features/song-txt-import.md`. No unresolved consequential choices. Ambiguous
content remains editable rather than being silently discarded or invented.

## Behavior intentionally unchanged
Search, manual paste, ad-lib toggle, arrangement reference handling, default
backgrounds/send targets, document identities, and all persistence writers.

## Acceptance criteria
Local TXT review/apply; editable metadata/lyrics; no selection auto-save; draft
protection; CCLI/title duplicates with open/edit/separate options; preserved lyric
wording; encoding/error handling; metadata round trip; both creation entry points.

## Proposed implementation
A bounded pure metadata parser/file reader and inline review component, composed
into CreateItem. Add optional SongMetadata fields and reuse the existing pipeline.
This necessarily adds parser, review UI and focused tests; a button-only change
cannot provide encoding, metadata, replacement and duplicate guarantees.

## Affected surfaces
Controller and auxiliary controller routes, embedded Service Plan library picker,
browser and Electron renderer file APIs, Redux drafts and Pouch documents. Existing
GlobalInfo/ControllerInfo providers, controller profiles and permissions remain
authoritative. No server, network, IPC, display-layer or synchronization writer change.
Tests use the existing production-shaped provider/store wrappers; real disk and
layout APIs are simulated in jsdom. No new overlay context is required.

## Risks / edge cases
Pending reads are cancelled on unmount/draft replacement, cancellation and newer
selection; editing the current draft during a read remains protected at apply.
Unrecognized credits need operator review. Duplicate matching is advisory and
cannot atomically prevent another device from creating concurrently.

## Questions requiring user input
None.

## Verification
Run parser, CreateItem, itemUtil, inference, and Service Plan picker tests; client
type checking and lint. Include controlled pending-read cancellation/reset tests,
review/cancel/replace, metadata persistence/reopen, CCLI/title duplicates and the
existing manual/search tests. Review the full diff and production entry points.

## Workflow review

### Findings
Critical: None. High: None. Medium: None. Low: None outstanding.

The review caught and fixed silent pre-section lyric loss, adjacent opening lyrics
being mistaken for a title, and stale creation completion resetting newer work.

### Product authorization status
Authorized by the current request: local review/apply, explicit draft replacement,
metadata extraction, CCLI/title duplicate decisions, no automatic save, and reuse of
the existing writer. No new server or migration contract. Existing duplicate tests
were deliberately updated because the request requires explicit separate creation.

### Open questions / assumptions
None requiring a product decision. Structurally inferred titles/credits carry
warnings and remain editable. Unknown text stays in the lyrics for review.

### Verification gaps

Production context: Pass. Inspected controller/auxiliary entry points and the real
ServicePlanLibraryPicker modal that mounts CreateItem after Create a new song.
The picker test opens that modal, selects TXT, applies, then creates and attaches.
Its existing provider/store composition supplies the same contexts consumed by the
new UI; no new portal provider or native Electron API is needed. DOM file contents
are simulated because jsdom does not implement File.arrayBuffer or disk dialogs.

| Invariant | Controlled scenario | Implementation / test evidence | Result |
| --- | --- | --- | --- |
| No selection auto-save | Upload, review, edit, apply, then Create | SongTxtImport / CreateItem TXT review test; picker import test | Pass |
| Existing draft survives | Apply requests replacement, then Cancel or explicit replace | hasDraft confirmation / CreateItem draft protection test | Pass |
| Late reads cannot replace a reset draft | Hold arrayBuffer, reset draft, resolve old read | draftId component key and mounted/request guards / pending TXT reset test | Pass |
| Cancel retires read intent | Hold read, cancel, resolve | request counter / pending TXT cancellation test | Pass |
| Existing library songs are preserved | CCLI matches different name; return, open, or explicitly create separately | canonical selector + findSongDuplicates / utility and CreateItem tests | Pass |
| Metadata survives normal document handling | Import, create, persist, reconstruct, edit, reload | existing createNewSong/createItemFromProps / parser round-trip test using in-memory Pouch-shaped contract | Pass |
| New owner is untouched by an old save | Hold actual createNewSong at database A put, rerender with database B, finish A | captured db + currentDatabaseRef / database-switch test | Pass |
| New draft and closed form are protected | Hold create; replace draft or unmount; resolve | create draft identity/mounted guards / two creation lifecycle tests | Pass |

Optional confidence checks not performed: manual native browser/Electron file
dialogs, physical PouchDB disk reload, visual mobile/device testing, execution of
Schema v2 tests on the separate branch, and repository-wide suites. V2 compatibility
was inspected read-only at `8ce013685ee08c80ee21b7accade166245ed6ba7`:
the codec preserves the metadata object wholesale, so additive fields fit its root
contract. No changes or merges were made to that branch.

### Pattern / learning opportunities
None requiring new policy or abstractions. Keep using the existing draft identity,
canonical song selector, metadata container, and creation writer.

### Final readiness
Ready for the scoped workflow review. This is not a whole-branch release review.

Final checks passed:

```text
npm.cmd test -- --runInBand src/utils/songTxtImport.test.ts src/containers/CreateItem/CreateItem.test.tsx src/pages/Services/ServicePlanLibraryPicker.test.tsx src/utils/itemUtil.test.ts src/utils/lyricsSectionInference.test.ts src/store/songLibrarySelectors.test.ts src/utils/songLibrary.test.ts
7 suites, 155 tests passed.
npm.cmd run type-check
npm.cmd run lint:check
git diff --check
```

The CreateItem suite also opens the deferred Formatted sections preview, and was
rerun after adding that interaction assertion.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; LRCLIB draft ownership, shared creation,
  canonical library selector, editor metadata and Service Plan picker inspected.
- Legacy/persisted-state compatibility reviewed: Yes; optional additive fields.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes.
- Contract round trip traced: Yes.
- Validate/use security boundary reviewed: Yes; immutable local file input only.
- Retry-state authority reviewed: Yes; failed read writes nothing; normal draft
  remains authoritative; create failure uses the existing writer and error path.
- Owner-retirement handoff reviewed: Yes; local read result retires; original-db
  creation may finish but cannot publish into the replacement form/owner.
- External side-effect adoption/compensation reviewed: Not applicable; no uploads,
  external providers, new remote writes, or compensating deletion.
- Authorization/data-projection reviewed: Not applicable; permissions unchanged,
  no new network or permission-dependent data projection.
- Production entry point, runtime context, and test composition compared: Yes.
