# Controller startup and saves

Confirmed scope: the current data-integrity request, 2026-10-29. This contract covers automatic bootstrap documents and service-list field saves; it does not redefine presentation or other settings workflows.

## Operator outcome
An existing church opens its saved content safely, including offline, and overlapping outline/overlay edits retain the latest intended values.

## Startup
- Expose local PouchDB and the existing document cache early. Existing local documents remain readable while the first pull stalls or fails.
- A local 404 before successful initial replication is unverified absence. It cannot authorize persistent defaults, including outline registry/details, preferences, controller media folders, or auxiliary-outline seeding.
- Use the existing content replication session to grant bootstrap eligibility only after successful completion for that concrete database/church session. Connectivity, cache availability, and progress percentages do not establish it. Cancelled/failed or retired pulls cannot grant eligibility.
- Refresh bootstrap readers after verification. Show replicated content without navigation, retain operator edits, and create defaults only when the post-pull authoritative state still lacks the document. Preserve guest/demo seeding.
- Register/select a newly created outline only after its detail document is saved successfully. Only a genuine missing-document read permits creation; other read failures must propagate without writing. This durable-success boundary also applies to copied outlines. (Current follow-up request, 2026-10-29.)

## Saving
- Capture concrete database and outline ownership at operation start. Serialize local writes by database, outline, and field; independent items and overlay order remain concurrent.
- Superseded intentions cannot resume a read/write/retry and overwrite the latest intention. An entered put must settle before the newer same-field put. Keep conflict retries bounded and genuine failures visible.
- Complete legitimate outgoing-outline saves against their original owner. A church/database change cannot redirect persistence, pending/saved acknowledgments, cleanup opportunities, or broadcasts to the new owner.
- Acknowledgments and publication describe the exact persisted intent; an older save cannot clear a newer pending draft.

## Historical outline revisions
Authorized by the November 11, 2026 outline revision conflict strategy request and the November 12, 2026 concurrent-editing follow-up:
- Read and display the winning outline without blocking on historical losing leaves. Historical leaves are not necessarily older edits and remain available for separately authorized maintenance.
- Save genuine current edits against their loaded baseline and the latest winner. A successful CAS extends that leaf; replication carries the new descendant and preserves other leaves. A disconnected writer extending another leaf may create another historical conflict; it is preserved rather than automatically discarded.
- Active edits that overlap the latest winner require focused decisions, with compatible edits retained. The draft remains visible until the choice is durably acknowledged.
- Independent row moves are rebased from their recorded drag destinations onto the latest winner, then merged by stable outline occurrence IDs. A move to the same row's incompatible destination or an ambiguous legacy reorder retains the draft and opens a focused order choice. Move metadata is runtime-only and follows the outline owner across refreshes and navigation.
- A successful order-only save may carry an optional `outlineMoveIntent` field on that revision. It records the exact parent revision, baseline row order and persisted move destinations only when stable row bodies match the loaded baseline and those destinations reproduce the saved order. The field is revision-local provenance, not a separate registry, and a later ordinary save or merge clears it.
- An authorized Controller may automatically incorporate exactly two direct sibling leaves only when both contain valid move provenance for the same parent and baseline order, their stable row bodies match, all non-order document fields match, and the moves are compatible. The merge uses both persisted destinations, writes with the current winning revision, verifies the revision graph, and retires the incorporated sibling only after the merged winner is confirmed. The baseline order in the markers allows this narrow merge when a newly opened replica has the leaf revisions but not the ancestor body.
- Missing or malformed markers, historical or multi-leaf graphs, changed row content or document fields, ambiguous ordering, incompatible destinations, read-only access, failed compare-and-swap, and changed owner/session boundaries never trigger an automatic merge. Those branches remain available through the existing focused review path; ordinary loading still presents the winner.
- Retire loaded outline identity and baseline atomically with content on owner changes. Initialization and replication alone never create a draft. Intentional removal of all initialized rows remains a valid edit.

## Switching outlines
- Dirty content belongs to a concrete database and outline, not to the current selection alone. A refresh of that same owner preserves local drafts; selecting another owner loads its items, overlays, and service-plan binding independently of outgoing saves.
- Retire old rows and binding atomically with every selection path, including scope changes and remote registry fallback. Loading or failed reads cannot leave the prior outline editable under the new selection. Outline-specific undo history cannot cross this boundary.
- Preserve outgoing pending drafts for rapid return while saves finish on the original database/document. Only the exact saved array may be acknowledged; retired completions cannot publish an update for the newly selected owner.
- Empty overlay initialization resets membership, initial IDs, initialization, and pending state while retaining overlay history. Retired overlay-editor selections stay hidden and disabled; already accepted editor drafts retain their original database.

Authorization: current outline-switch request, 2026-10-29. Runtime ownership and pending draft metadata are not stored in PouchDB; the narrowly scoped persisted move marker above is written only on a verified order-only saved revision.

## Evidence
`controllerBootstrap.integration.test.tsx` mounts the real ControllerInfoProvider, Outlines, controller lifecycle, and Redux together (overriding Jest's usual mocked context). It covers delayed remote content, verified-empty creation, offline reads, aux scopes, and retained edits. Provider tests cover failure/cancellation, progress, guest mode, and church switches. Bootstrap/media-folder helper tests cover eligibility and missing-document ownership boundaries. `persistServiceListField.test.ts` controls reads/puts/conflicts; `store.test.ts` covers acknowledgments, broadcasts, independent fields, outgoing outlines, and same-ID database switching.
