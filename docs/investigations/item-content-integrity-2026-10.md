# Item content integrity investigation — October 12, 2026

## Executive summary

**A reproducible production-code mechanism can copy one song's entire arrangements into another document while retaining the destination's title, ID, and type.** In SlideEditTools, a font-color callback captures Song A, waits 250 ms, then dispatches content-only mutations against the currently active item. Switching to B before that callback runs puts A's Master, medley, lyric sections, slide IDs, and order IDs into B. The normal autosave then durably writes this contaminated B state. Tests reproduce song → song and song → custom item using the real toolbar, formatter, Redux thunks, reducer, and autosave listener.

This is a demonstrated defect and a strong explanation for the **shape** of the reported incident. **It is not a confirmed reconstruction of that incident.** The three production JSON exports, earlier revision bodies, backups, and operator logs were not found in the available inputs. No production connection, credential use, migration, merge, deployment, or data repair occurred. The number of affected production records is **unknown**.

Other demonstrated failures: delayed rich-text color changes copy A's slides into B; delayed section-text reformatting copies A's song arrangements or applies A's text to B's custom sections; missing custom sections inherit previous content; another item's edit can cancel a pending save; stale V1 drafts overwrite newer same-document edits after fetching their revision; an external creation import can finish after the draft is renamed and create a document with the new title and old query's lyrics. Creation silently returns an existing exact-ID document, including one of a different type.

No application fixes were applied. This change adds characterization tests, this report, and an offline read-only audit. Passing characterization tests intentionally establish existing failures; they do not mean those failures are fixed.

## Evidence and branch scope

Inspected local refs: in-progress `faf9dcc1`, production master `ac9cea87`, in-progress-2 `061a65b4`, in-progress-3 `78913224`. No remote fetch was performed. Master is the available production reference, not an independently verified record of every installed browser/Electron version.

The toolbar callbacks, custom-section fallback, creation helper, lyrics-panel draft lifecycle, and song-library utilities are identical between master and in-progress. The item autosave is also identical across those two refs; other store changes concern capabilities. The investigated core files also match in-progress-2. in-progress-3 changes slide ownership and song persistence; it still has delayed toolbar callbacks without a matching item/database ownership guard.

Source locations below refer to in-progress application files, which were not edited.

### Known stored incident, supplied by the user

| Document | Identity and evidence |
| --- | --- |
| A | `183 - I Will Sing of Jesus' Love`; revision `36-34739dac5edd2661757104d3fad12f56`; praise-song Master lyrics; arrangements `1j12bje3pkr07ikp55mk` and `1jcatf0fr4fpffhaasfo`; October 10 update |
| B | `183 – I Will Sing of Jesus' Love`; revision `134-bce0ac91cafe97a2917722cdefaf9245`; correct hymn and different arrangement IDs |
| C | `Just want to praise you ` (trailing space); revision `60-178c414b5e829c02c5a56830d1fd2b1a`; same two arrangements as A; 32 distinct nested identifiers shared with A |

The stored mismatch is accepted as user-supplied evidence, not independently reverified from JSON. This establishes one reported incorrect-title document (A); shared identifiers do not by themselves make C corrupt, and B is reported correct. The count of additional affected documents is unknown. Searches for the incident revision and arrangement ID in attachments found only copies of the investigation request. Filename searches of available workspace exports/backups found no matching incident exports. No missing fields or excerpted lyrics were invented.

## Confirmed defects and minimum fixes to propose

### High: delayed slide toolbar mutates the next item's content

Evidence: `client/src/containers/Toolbar/ToolbarElements/SlideEditTools.tsx:254` (`updateItem`), `:371` (`_updateFontColor`), `:273` (`runWithFormatting`), `:306` (font-size delay), `:341` (typed font-size delay), `:452` (unmount cleanup). `client/src/utils/formatter.ts:29` retains source arrangements while changing box properties. `client/src/store/itemSlice.ts:639` reads the current item for an arrangement payload that carries no source ID; `:1013` does the same for slides.

Exact interleaving:

1. A is active; choose font color. Callback closes over A's full ItemState.
2. Select B; the toolbar remains mounted on item routes. Only local control values reset.
3. After 250 ms, updateBoxProperties produces A's arrangements; updateItem dispatches those arrays with no A identity.
4. The reducers modify B's content while retaining B's name, ID, and type.
5. Autosave captures B and writes the contaminated payload to B's latest revision.

Exact executed test: `writes all A arrangements under B's title after delayed slide color, destination=%s` (song and free) in `FormattedTextEditor.integrity.test.tsx`. It asserts final stored A unchanged and B containing A's Master/medley IDs, lyric section and words, and slide ID.

Unmount clears the shared color timeout, but does not protect an identity change while mounted. The separate typed font-size timer is not cleared by that cleanup. Alignment/bold/italic formatting has a zero-delay boundary; the same ownership mechanism applies by inspection, but those variants were not separately reproduced.

Production composition confirms this is a meaningful transition: `Toolbar.tsx:411` keeps SlideEditTools mounted, using CSS to hide inactive tools, and `:415` does likewise for FormattedTextEditor. `Controller.tsx:177` uses the same Item route element as its parameters change; `Item.tsx:140` does not key SlideEditor by document ID. Continuous selection dispatches the next document before navigation and skips redundant loading. The tests change Redux identity while retaining these component instances, matching that ownership boundary. Full/view permission gating and actual color-picker popover rendering are inspected/mocked respectively, not reproduced in a full browser session.

**Smallest fix proposal:** make deferred toolbar work belong to its captured database and item ID; enforce that ownership again before dispatching item mutations. Apply the intended formatting field to the latest matching owner's state rather than replacing unrelated arrays from a closed-over snapshot. Clear all owned timers on identity change and unmount. Keep regressions for all supported delayed formatting entry points. Whether to finish or preserve the old item's pending formatting instead of canceling it requires the unsaved-work decision below.

### High: delayed rich-text toolbar copies slides across custom items

Evidence: `FormattedTextEditor.tsx:98` (`runUpdate`), `:138` (250 ms color timer), `formatter.ts:137`. The callback retains A's slides and rich-text payload; updateSlides applies them to active B. There is no timeout cleanup on unmount.

Exact test: `writes A slides into B after a color change, unmounted=%s` (false and true). Final B retains B's name but stores A's slide ID, body, and rich-text text; A remains unchanged.

**Smallest fix proposal:** capture/revalidate owner and cancel or deliberately complete pending color work at ownership boundaries, including unmount. Avoid dispatching A's whole slide array against B.

### High: previous custom sections can be persisted to a different item

Evidence: `itemSlice.ts:208` retains missing name/type/ID/list/background fields; `:234` uses `payload.formattedSections || state.formattedSections`. Arrays for arrangements/slides clear, so ordinary setActiveItem does **not** inherit another song's arrangements. Empty section arrays clear sections; absent sections retain them. Autosave at `store.ts:1003` persists inherited sections.

Executed tests:

- `persists stale free-A sections into free-B when the incoming doc lacks them`.
- `carries custom sections through a song and back into another custom document`.

These assert stored section contamination, including a slide/section disagreement. They do not themselves establish that visible B slides were overwritten. Later formatting can consume the inherited section text.

**Runtime qualification:** normal Item route loading (`pages/Controller/Item.tsx:79`) and continuous/neighbor selection via `utils/outlineSlideSections.ts:639` derive missing custom sections from that document's own slides. Those paths protect ordinary legacy custom selection. Direct creation/selection and remote reducers are different boundaries. For example, `createNewFreeForm` at `itemUtil.ts:604` skips formatting for empty live-input items, and `useMediaLibraryController.tsx:837` / `:871` immediately selects that result. The reducer/listener tests control direct setActiveItem calls; they do not mount the entire Media flow.

**Smallest fix proposal:** distinguish selecting a new document from patching the same document. Clear/default optional content fields on identity change, deriving custom sections only from the incoming document. Preserve existing partial-update workflows only where identity remains the same. Test normal route, continuous selection, live-input creation, and remote reload separately before shipping.

### High: V1 saves adopt a new revision without checking the authored baseline

Evidence: `store.ts:980` reads the newest document and `:987` replaces numerous authored fields from the older editor snapshot; `ViewSongSectionsDrawer.tsx:141` and `ServicePlanSongDetailsPanel.tsx:101` fetch the newest revision before replacing arrangements. They do not compare it to the revision/content opened by the editor. A same-ID/type check alone cannot detect this.

Executed tests:

- `overwrites a second client's newer content by fetching its latest revision`.
- `buffers replicated A while local edits are pending, then stale autosave replaces it`.
- `a stale library lyrics draft overwrites a newer arrangement using its newest revision` (real Service Plan writer and real lyrics panel; formatting preview mocked).
- `preserves the remote revision when a second client writes between get and put`.

The first three demonstrate meaningful concurrent edits lost **before** the fresh read. The fourth establishes that a competing write **after** the read is rejected by revision comparison. Revision CAS cannot detect intent already rebased onto a fresh revision.

**Smallest fix proposal:** retain owner and authored baseline at draft creation, compare the fields being changed with the durable baseline, and reject/preserve conflicts rather than silently rebasing. For simple metadata edits, patch only intended fields. Keep explicit operator conflict resolution; do not invent an automatic winner.

### Medium: editing B cancels A's pending autosave

Evidence: `store.ts:954` requires current hasPendingUpdate; setActiveItem clears it in `itemSlice.ts:83` / `:256`. Thus the listener's supposed previous-item switch-save branch normally cannot run. Nevertheless, the previous A listener remains alive and retains A's pre-delay state (`store.ts:971`). Switching alone saves A under A. A new B edit calls cancelActiveListeners, canceling A.

Executed tests: `saves captured A under A after switching to B during debounce`, `loses A edits when an edit of B cancels A before debounce completes`, `cancels A after its delayed get resolves when B starts a newer save`, and `rapid back-and-forth navigation keeps the last surviving payload paired with its ID`.

**Preliminary finding A is partly refuted:** the effect does not read the current item after waiting, on master or in-progress. No A-under-B write or unnecessary B save occurs from ordinary switching alone in these tests. The confirmed failure here is lost A edits when another edit supersedes the shared listener.

**Smallest fix proposal:** make pending saves item/database owned and separate their completion from active presentation reconciliation. Decide flush/preserve/discard behavior before changing navigation semantics.

### Medium: async import survives a changed creation draft

Evidence: `CreateItem.tsx:238` patches the latest draft ref; `:343` and `:388` resolve external lyrics. The request counter distinguishes searches but is not advanced when the name/artist/album changes. A returned result can populate a differently titled draft.

Executed test: `creates a B-titled document with A import lyrics after renaming the pending creation draft`. It runs a deferred external search, changes Song A to Song B, resolves A's lyrics, invokes Create Song, and uses the real createNewSong writer to inspect the created database document. Existing A and B documents are unchanged; the newly generated song ID has B's title and A's content.

This creation path does not account for reuse of C's two arrangement IDs: creation generates a new arrangement and section/order IDs. The active-item lyrics import drawer (`AddSongSectionsDrawer.tsx:313`) imports existing sections synchronously and generates new imported section IDs in LyricsEditorPanel; it is not an asynchronous external import into an existing song.

**Smallest fix proposal:** bind external result adoption to the query/draft generation and explicit target draft. Decide whether name changes cancel a pending import or offer deliberate adoption.

### Medium: exact legacy-ID creation silently returns an existing document

Evidence: `itemUtil.ts:752` gets item._id and returns the existing document regardless of requested type. Its catch treats any read error as absence before attempting a create. `createNewFreeForm` uses supplied ID or name; the CreateItem duplicate check depends on the currently available library, not an authoritative cross-type existence check. Current createNewSong uses generated `song-` IDs.

Executed tests: `returns an existing legacy ID even when creation requested a different type, existing=%s` (song/free), `uses exact Unicode and whitespace document identities without aliasing`, and `propagates a rejected create write rather than reporting a durable new item`.

The first tests demonstrate wrong operation resolution, **not** overwrite of existing stored content. Punctuation variants/trailing spaces remain distinct exact IDs; there is no fuzzy ID alias in this writer.

**Smallest fix proposal:** only treat 404 as absence; validate existing type/identity explicitly; use collision-resistant IDs for new custom documents. Existing ID reuse/idempotency behavior must be decided before changing it.

## Lyrics editor identity findings

`LyricsEditor.tsx:52` unmounts its panel when closed; `LyricsEditorPanel.tsx:329` resets local arrangements on item ID changes or editor opening, even with unsaved changes. An ordinary mounted switch and a changed library song prop both reset the draft in executed tests:

- `keeps the controller editor open across song selection and saves only the new draft`.
- `resets an unsaved library draft on song prop change before the real writer saves B`.
- Existing `shows the newly selected song immediately when reopening edit lyrics after switching items`.

The library test persists through the real ServicePlanSongDetailsPanel callback and checks both final stored documents. The controller test isolates panel dispatch; its final persistence is covered separately by store tests, not by one fully mounted controller route.

**Not every save verifies original draft identity.** Current save (`LyricsEditorPanel.tsx:945`) sends arrangements and metadata without a source ID or baseline. currentItemIdRef protects remote reload (`:822`), not Save. Parents capture their song at callback invocation, so an already started async save stays on its original DB/song ID; however, completion can close a newer editor, and unguarded post-save publication can enter a newly selected scope. Those completion variants remain code-audit risks, not separately reproduced cross-document corruption.

## Content-changing path inventory

All V1 Pouch item puts are whole-document revision replacements even when the application prepares a field patch. “Latest revision” below means no original authored baseline is enforced. The inventory is grounded in searches of put/bulkDocs/remove, Redux mutations and their callers; it is not a claim that every path received an end-to-end race test.

| Supported path / source → destination | Identity, baseline, async ownership, write/conflict behavior | Verification |
| --- | --- | --- |
| Create song / pasted or imported draft → new song | CreateItem → createSections → createNewSong; generated ID before await; DB captured argument; no baseline for new doc; full initial put; failure surfaced | Creation/import/ID tests |
| Create custom / text, media, live input, Canva → custom | createNewFreeForm; supplied or unique-name ID; list can be partial; DB captured; empty live-input shape can omit sections; Canva checks church/DB after creation; initial put or silent existing-ID return | Helper tests; Media selection inspected, not mounted |
| Create Bible/timer/countdown → item | itemUtil creation uses stable/name identities; Bible text comes from parsed reference/verse DB; Item route has guarded load sequence and special countdown creation | Existing itemUtil/store tests; no new Bible race test |
| Lyrics edits, order edits, arrangement add/copy/delete → active song | Local panel draft → updateArrangements → current Redux item → autosave; no ID in mutation; baseline not enforced | Current editor reset tests plus store persistence |
| Library/Service Plan lyrics → supplied song ID | Parents capture DB/song, fetch latest doc, replace arrays; new revision races rejected, older authored intent not detected; completion broadcasts globally | Real panel/writer stale-draft test; sibling writer inspected |
| Arrangement copy → another arrangement in same song | Arrangement.tsx:86 generates new arrangement ID; retains section, order, slide and box IDs within the song; library import generates new section IDs | Existing editor copy tests; copies must not be flagged merely for in-document IDs |
| Individual box/slide/section edit, rename/remove/add slide → active item | SlideEditor + itemSlice; payloads lack expected-owner ID; immediate edits synchronous; box debounce clears on ID/slide/arrangement change; section reformat debounce only clears on unmount | Existing SlideEditor tests plus two real reducer/listener/formatter section-reformat corruption tests |
| Font size/color/alignment and rich-text formatting → active item | SlideEditTools/FormattedTextEditor capture arrays across timer boundaries; no original-owner guard at dispatch | Four persisted cross-item corruption reproductions |
| Details/title/links/audio → same song/item | ItemDetailsModal local fields reset on props; library/Service Plan field patches read current revision; active details dispatch to Redux; audio helper merges intended audio into durable item, ordinary autosave preserves latest audio | Existing details/audio/store tests; no broad audio refactor proposed |
| External lyric lookup → creation draft → generated item | Request sequence/query and latest draft can diverge; imports do not directly put existing song lyrics | Deferred import plus real creation reproduction |
| Existing-song section import → local arrangement → owner save | AddSongSectionsDrawer selection synchronous; panel assigns new section IDs; intentional medleys possible | Existing import tests |
| Service Plan/external plan import → preview/outline refs | buildServicePlanningPreview matches library entries; servicePlanningOutlineImport inserts captured matched IDs, headings/Bible docs/custom refs; itemListImports patches outline/binding; does not replace an existing song's lyrics | Code trace and existing import tests inspected; full import suite not run |
| Service Plan YouTube/resource patch → song links | ServicePlanEditor:2242 reads captured song ID and merges link intent into current document; lyrics unchanged | Inspected; not a lyric corruption explanation |
| Continuous/neighbor item selection → Redux only | OutlineItemSlidesScroller:664 and ItemSlides:1285 use prepareItemForEditor; document identity from docsById and listId; sections derive from incoming custom slides; route skips redundant load if already active | outlineSlideSections tests; scroller full mounted tests not rerun |
| Undo/redo → restored item snapshot → autosave | redux-undo tracks whole item state; switch actions excluded with syncFilter; undo listener forces update after clearing transient UI; destination uses restored snapshot ID | Executed `undo and redo after changing items persist each restored snapshot under its own identity`; UI routing after undo not asserted |
| Remote replication/broadcast → allDocs/active state → later save | controllerInfo captures local/remote DB; Pouch replication preserves _id; changed-doc events refresh Redux; dirty/open editor buffers remote; buffer is not a persistence baseline check | Remote buffering/overwrite and between-read-and-put CAS tests; no live replication client |
| Library index reconciliation → allItems only | mergeSongLibraryItems keys exact IDs; stale index name can override displayed name; repair fills missing rows, not authored item content; reused same-ID different-type entries can coexist | songLibrary/index tests; title listing alone does not prove content corruption |
| Format/legacy migrations → same retrieved document | dbUtils formatAllDocs/formatAllSongs, free sections, font-size/docType migrations; retain source _id/rev and format that document; formatItemInfo generates many replacement nested IDs; callable utilities not ordinary autosave | Inspected; none executed; no found migration path assigning another song's content |
| Local image attachment/cloud copy/media replacement → referencing docs | localImageAssets reads explicit captured DB/item/asset IDs, retries 409 while applying narrow patch; mediaReferenceSweep changes matching media fields across same-ID documents; it does not select lyrics by current item | Inspected scoped helper patterns; not exhaustively race-tested here |
| Delete library item → same document tombstone/index/outline removal | FilteredItems:514 gets exact ID then removes current revision; cleanup updates references; failures return before index removal; dbUtils unused Bible/heading cleanup has separate direct deletes | Inspected; no deletion or migration run |
| Guest seed/direct administrative writes → explicitly keyed docs | offlineGuestSeed bulkDocs uses fixture IDs; direct console/export/backups could create deliberate copies; server/song-artist backfill patches metadata, not another song's lyrics | Seed/migration sources located; no seed/backfill run |

### High: delayed section-text reformatting crosses selection

SlideEditor's section reformat timer (`:1162`) captures old song data, while its custom branch reads itemRef.current with captured old text. Identity-change cleanup at `:874` clears box-edit work but not this timer. Executed test `section reformat work crosses item selection, source=%s` (song/free) invokes the real handler, changes the real store's item during the 300 ms delay, and checks final documents after the real formatter/thunks/listener run. In the song case B stores A's arrangement ID and pending edited text. In the custom case B stores the old A input text in B's section. Stored A remains unchanged in both.

The test mocks the text-editor control and display preview, retaining SlideEditor, the real formatting utilities, and all application mutation/persistence composition. An initially insufficient one-slide song fixture hit a formatter template error; adding the normal title/body template made the meaningful payload assertions pass. This is a demonstrated sibling defect, **not** proof it caused the reported incident.

**Smallest fix proposal:** include section-reformat work in the item/slide/arrangement ownership boundary and enforce original-owner checks at dispatch. As with toolbar work, decide explicitly how accepted pending edits should be finished/preserved/canceled. Keep regressions for both the captured-song and latest-custom-ref branches.

## Historical findings and origin questions

Relevant repository history:

| Change | Significance |
| --- | --- |
| `484d4b77`, November 26, 2024 | Autosave state capture precedes delay. The preliminary “late current item read” is not supported by this implementation lineage. |
| `f6664c75`, May 26, 2025; `cb16751a`, June 29, 2025 | Delayed slide font-color callback and captured whole-item formatter route predate both reported arrangement identifiers. Commit timestamps are not deployment records. |
| `09fbd147`, June 24, 2025 | Rich-text color debounce has the same captured-item mechanism. |
| `8e0fb2ac`, March 29, 2026 | Dirty lyrics drafts were preserved using a hasPendingChanges guard without an item identity boundary. |
| `30aa33a7`, March 29, 2026 | “fix edit lyrics opening wrong lyrics” adds ID/open transition reset. Older parent implementation could preserve another song's arrays during a dirty switch; this is historical code evidence, not an executed old-version reproduction. |
| `cea5ac5b`, May 4, 2026 | Song creation moves to generated song IDs; older title IDs remain valid. |
| `350aadfb`, April 12, 2026 | formattedSections previous-state fallback and typed font-size delay appear in lineage. |

`generateRandomId.ts` concatenates Date.now().toString(32) and random suffix. Interpreting the first nine characters under that implementation gives `1j12bje3p` → July 26, 2025 03:14:38.841 UTC and `1jcatf0fr` → December 13, 2025 03:53:23.707 UTC. This is an inference about identifier generation, not a document creation/corruption timestamp or proof the IDs were generated by that version.

Unanswered: A's first creation, whether A ever contained the hymn, whether shared IDs were present initially or added later, which device/version wrote the change, and whether a deliberate copy/medley/import/rename preceded it. The toolbar mechanism naturally retains C's arrangement/section IDs under another title; async creation import and formatItemInfo regeneration do not naturally retain both existing arrangement IDs.

Read-only evidence collection, only after explicit production authorization:

1. Export church metadata from Firestore `churches`, taking actual contentDatabaseKey values. Resolve/deduplicate them with the existing server helper, retaining all owning church IDs. Do not derive content DB names from Firestore church IDs.
2. Capture database update sequence before/after paginated GET `/{db}/_all_docs?include_docs=true&conflicts=true`; record coverage and consistency. Keep exports in a restricted evidence location.
3. For A/B/C, preserve exact IDs (dash and trailing space included), GET current document with `revs=true&revs_info=true&conflicts=true`, GET `open_revs=all`, and individually GET available revision bodies with `rev=`. Do not resolve/delete conflict leaves.
4. Compare earliest available snapshots/backups and all retained bodies by title/type, arrangement hashes and nested IDs. Record the first *observed* mismatch separately from inferred origin; search existing logs for hashed identities, revision transitions, app versions and writer operations without emitting full content.
5. Reconstruct source/destination and first changed revision only if bodies support it. If unavailable, record missing evidence and any chronological bounds.

CouchDB revision metadata is not durable application history: compaction may retain ancestry while removing non-leaf bodies; ordinary reads show the deterministic winning leaf, and replication does not retain peer provenance. Missing bodies cannot prove a past event did or did not occur. [Apache CouchDB conflict/revision documentation](https://docs.couchdb.org/en/stable/replication/conflicts.html).

## Offline integrity audit prepared for review

Files: `scripts/audit-item-content-integrity.mjs` and adjacent `.test.mjs`. This tool reads local manifests/exports and emits JSON to stdout. It contains no connection configuration, credentials, datastore mutations, or repairs. It imports only the existing database-name helper, not the server runtime.

Manifest shape (replace placeholders with actual exported metadata; paths relative to manifest):

```json
{
  "churches": [
    {
      "churchId": "<actual Firestore church ID>",
      "contentDatabaseKey": "<actual church contentDatabaseKey>",
      "exportPath": "exports/content.json"
    }
  ]
}
```

Run:

```text
node scripts/audit-item-content-integrity.mjs path/to/manifest.json
node --test scripts/audit-item-content-integrity.test.mjs
```

Accepted exports: document array, `{docs: [...]}`, Couch `{rows: [{doc: ...}]}`, or a single document. Use one current winning document per ID, not a mix of historic bodies. Shared databases are deduplicated and conflicting export paths for the same database are rejected.

Detection includes whole arrangements/individual substantive lyric sections/slides, cross-document nested ID reuse, near-identical Unicode/punctuation/whitespace titles, legacy ID/title divergence, invalid type/shape/docType, missing expected fields, custom section/body disagreement, allItems metadata/missing index/unindexed documents, outline items/registries/import-preview references, and conflict leaf counts.

Ranking: exact substantial overlap with differing normalized titles **and** at least three shared nested IDs is high; partial overlap, ID-only reuse and duplicate titles are medium; legacy ID/title drift is low. Content units require at least 80 characters and 12 distinct whitespace-separated tokens to reduce common-line false positives. These thresholds are conservative heuristics, not semantic validation. Reports contain exact document IDs, counts, full SHA-256 fingerprints and recommendations; no full lyrics or rich-text bodies. Parsing errors do not echo input excerpts.

The audit compares only within each database. It does not flag repeated IDs inside one song merely because arrangement copies legitimately reuse them. Intentional copies can still rank high; a human must compare content and history. Medleys with additional substantial content stay medium. No automatic title correction is inferred. Very short/shared verses, fuzzy lyric changes without ID overlap, markup/layout differences and partial exports limit precision/recall. Large shared-ID groups can generate many pairwise candidates; run against snapshots with sufficient memory and retain report output privately.

V2 manifests/children are explicitly reported as needing hydration; this tool does not silently claim V2 coverage. Before auditing a V2 database, use the in-progress-3 schema hydrator to validate song/arrangement/slide ownership and analyze hydrated items as a separate reviewed extension.

**Run scope/results:** synthetic fixtures only; seven audit tests pass. No all-church registry export or production content snapshot is available; no real-data audit was run. Production candidate count, affected count, false-positive rate and whether A/C are the only pair are unknown.

## V2 comparison and data at risk

in-progress-3's `songV2Writer.ts:65` / `:81` derives changes from the original baseline and rejects mismatched song identity. It compares authored content rather than audit/revision-only differences, preserves independent edits, validates child ownership, and tracks durable partial-write progress. Existing writer/persistence suites pass (60 tests).

These protections address stale baseline/meaningful concurrent edit failures for V2. They do **not** establish that an upstream arrangement payload came from the correct UI draft: if a delayed toolbar already injected A into Redux B, both desired._id and baseline._id can be B. The writer sees a structurally legal intention to replace B's arrangements. V1 fallback still can load currentSong immediately before saving. Schema separation is not a replacement for UI/action ownership.

Songs on master/in-progress/in-progress-2 are at risk through mounted delayed toolbar callbacks and stale V1 writers. Custom items additionally face rich-text callbacks and missing-section inheritance. Mixed song/custom writes can produce custom documents with song arrangements. Global publication after a church switch deserves separate review. All database copies/devices can replicate an already contaminated revision; replication itself is not evidence that the wrong ID was synthesized.

## Recommended integrity protections and observability

Prioritize the demonstrated delayed-toolbar ownership defects, then safe section initialization and baseline-aware saves. Preserve operator workflows with narrow changes; no broad persistence rewrite is justified by this investigation alone.

Permanent safeguards should include:

- Source database/church, item ID, draft generation and baseline in deferred work and mutation payloads; enforce ownership at reducer/write/publication boundaries.
- Field intent and authored baseline checks; revisions from the editor or an explicit field merge, rather than unconstrained fresh-revision adoption.
- Separate durable save success from active UI reconciliation; pending saves should not vanish because another item starts editing.
- Explicit type checks on creation/loading, generated IDs for future content where approved, and index validation without silently rewriting content.
- Structured writer diagnostics: operation/source/target fingerprints, database/church scope, baseline/result revisions, app build, changed fields, arrangement counts, lifecycle outcome and error/conflict category. Avoid full content; content hashes supplement explicit identity, never infer title correctness.
- Retained application-level provenance/backups for authored content and intentional copy/import/rename operations. Couch revisions alone cannot establish incident history.
- A periodically reviewed read-only audit, reviewed intentional-copy exceptions, and a report of unprocessed databases/schema versions/export completeness.

## Product decisions still required

No behavior was changed, so these questions did not block the investigation:

1. Switching with unsaved edits: finish the original item's save, preserve a recoverable draft, or require explicit discard? Current behavior is inconsistent depending on the next edit.
2. Delayed formatting on navigation: finish under the original owner, preserve pending work, or explicitly cancel? Blocking the wrong-owner mutation is required; silently dropping accepted work is a separate decision.
3. Concurrent authored changes: preserve both drafts and prompt, or allow explicit operator overwrite? No automatic winner is approved.
4. Query/title changes during import: cancel, or show an explicit adoption choice?
5. Existing-ID creation: reject collision or deliberately attach an existing matching-type document? Different-type return must not be silently presented as successful creation.
6. Intentional medleys/copies: what provenance and review exceptions should distinguish them from unexplained full-array reuse?

## Planning and verification record

### Goal

Determine demonstrable defects, distinguish incident provenance from reproducible mechanisms, and prepare repeatable read-only evidence collection.

### Existing architecture / Before behavior

React/Redux local drafts and timer callbacks feed a current-item slice; V1 autosave replaces many fields after reading latest Pouch revision. Pouch replication and global broadcasts refresh caches. Multiple UI entry points write lyrics directly.

### After behavior / Behavior intentionally unchanged

Application behavior is unchanged. Added tests expose current failures; the offline tool reports candidates without network access or repairs. Production documents, branch history, migrations and unrelated concurrent server edits remain untouched.

### Product Decision Check

Relevant feature registry entries for live presentation/song/custom editing are inventory-only; there is no confirmed contract deciding discard/flush/conflict policies. The current request authorizes investigation, regression coverage, audit preparation and proposals. It does not authorize speculative persistence changes or live credential use. Open choices are listed above.

### Acceptance criteria / Proposed implementation

Use clearly distinct fixtures and nested identifiers, deterministic timers/deferred operations, final stored-document assertions, branch/history comparison, provenance limitations, severity-ranked offline audit and narrow corrective proposals. Added code is confined to tests, analysis tool and documentation. The size reflects the requested investigation matrix and audit, not a product fix/refactor.

### Affected surfaces / Risks and edge cases

Inspected browser/Electron shared client store, controller Item and toolbar composition, library Drawer, Service Plan details, deferred LyricsEditor mounting, Media selection and replication. Browser/Electron use the same application mutation paths; no installed app/service was operated. Tests mock color-picker/popover rendering and external I/O, retaining real toolbar/formatter/store mutation behavior. Library tests retain the real lyrics lifecycle/writer but mock canvas formatting and view children. Databases are revision-aware in-memory maps; there is no new real Pouch replication/IndexedDB or full browser route race test.

### Required tests run

- Eleven focused in-progress suites: store, itemSlice, LyricsEditor, FormattedTextEditor integrity, CreateItem, itemUtil, songLibrary, songLibraryIndexRepair, ViewSongSectionsDrawer, ServicePlanSongDetailsPanel and outlineSlideSections: **300 tests passed** before the final two store cases were added.
- Final `store.test.ts --testNamePattern='item content integrity investigation'`: **12 passed**, 83 unrelated cases skipped.
- Final `FormattedTextEditor.integrity.test.tsx`: **6 passed** (four delayed toolbar cases plus two section-reformat cases).
- `node --test scripts/audit-item-content-integrity.test.mjs`: **7 passed**.
- in-progress-3 `songV2Writer.test.ts` and `songPersistence.test.ts`: **60 passed**.
- Final `npm.cmd run lint:check --prefix client` and `npm.cmd run type-check --prefix client` after all client additions: **passed**. `git diff --check`: **passed**. Lint was rerun after correcting an introduced no-throw-literal warning.

Initial new toolbar harness failed because its mocked controller module omitted the shared Button context; the context export was supplied and all four cases then passed. Initial library harness imported global initialization before its ID mock was initialized; scoped context/publication mocks fixed the harness. Those were harness failures, not evidence of product corruption. No existing expectations were weakened.

### Minimum requested scenario mapping

| Requested scenario | Executed evidence / limitation |
| --- | --- |
| 1. A edit, immediate switch B, timer | Captured A saved under A; B edit cancels A test separately |
| 2. A save started, switch before response | Held A put plus canceled held A get tests; final A/B docs checked |
| 3. Editor stays open on song change | Controller panel resets to B; dispatch isolated; store persistence separately tested |
| 4. Dirty library draft, changed song prop, Save | Real Service Plan writer checks final A/B docs |
| 5. Async import, target changes | Deferred external lookup + rename + real new-document creation; existing-song import is synchronous |
| 6. Custom B lacks sections | Reducer/listener final DB contamination reproduced; normal route prepares sections |
| 7. Song/custom switch | Section inheritance plus real delayed toolbar song → custom corruption |
| 8. Two clients/revisions | Simulated remote before read silently overwritten; remote after read rejected |
| 9. Undo/redo after switching | Restored snapshots persisted under their own IDs; routing/presentation not asserted |
| 10. Legacy creation collision/different type | Existing exact-ID doc returned without mutation; both song/free tested |
| 11. Unicode/trailing spaces | Exact distinct IDs resolved in writer; audit groups titles for review only |
| 12. Failure/replication/cancellation/rapid switches | Failed put dirty retention, replicated doc buffering/overwrite, held-read cancellation, rapid navigation tests |

### Questions requiring user input / unavailable evidence

Production access and exports/history are required to determine existing affected counts and incident-specific origin. No full suite/build, live replication, master checkout test run, historical deployment reproduction, or full Media creation context was performed. The main corruption paths were exercised through real shared application mutation composition with controlled external boundaries; the inventory identifies narrower coverage explicitly.

## Final review

Scope: investigation workflow review, not production readiness or fix verification.

Findings: high data-integrity defects above remain in the product; medium lost-edit/import/creation-resolution defects also remain. Low audit candidates such as legacy ID/title divergence are review clues, not repair instructions. Product authorization for added tests/offline audit/report: **Authorized by this request**. Runtime behavior changes: **Not applicable**.

| Invariant | Controlled transition / code evidence | Test evidence | Result |
| --- | --- | --- | --- |
| Content stays with original owner | Toolbar A color or section A input → select B → timer → updateSlides/updateArrangements → autosave | Six real-store toolbar/section cases | Finding |
| Stale authored content cannot silently replace remote edits | New remote revision before V1 get → local put uses remote rev | Store and real library-writer tests | Finding |
| Ordinary item autosave does not mix identities | Captured A listener → select B → A write completion | Held put/debounce tests | Pass for tested interleaving |
| Custom content initializes from its own document | Direct missing-sections payload → reducer fallback → save | Missing-section and mixed-type tests | Finding; normal route guarded |
| New external result belongs to current creation query | Search A → rename draft B → resolve A → Create Song | Deferred import/real writer test | Finding |
| Existing production scope and origins are established | Current snapshots + historical bodies | Not available/not authorized | Unverified |

Cross-boundary, sibling-pattern, legacy compatibility, identity-switch, unmount/lifetime, read/write round-trip and production-composition reviews: **Yes, within the coverage described above**. Retry authority reviewed at autosave cancellation/failure and V2 durable-progress boundaries; no new retry behavior. Owner-retirement/external adoption reviewed for color work/import results; no remote asset side effects introduced. Authorization/data projection: offline local exports only; tool reports fingerprints instead of content. Security validate/use: actual database-key helper validates manifest keys; no live access. Broader unrelated SMS/media/overlay workflows: not applicable to this patch.

**Final readiness: Not ready for a claim of incident root cause or release remediation.** Repository reproductions and the offline audit are reviewable; historical provenance, production scope, and additional sibling runtime coverage remain unresolved. No claim is made that passing tests protect production until their defect assertions are converted to preservation assertions alongside approved fixes.
