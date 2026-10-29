# Controller startup and saves

Confirmed scope: the current data-integrity request, 2026-10-29. This contract covers automatic bootstrap documents and service-list field saves; it does not redefine presentation or other settings workflows.

## Operator outcome
An existing church opens its saved content safely, including offline, and overlapping outline/overlay edits retain the latest intended values.

## Startup
- Expose local PouchDB and the existing document cache early. Existing local documents remain readable while the first pull stalls or fails.
- A local 404 before successful initial replication is unverified absence. It cannot authorize persistent defaults, including outline registry/details, preferences, controller media folders, or auxiliary-outline seeding.
- Use the existing content replication session to grant bootstrap eligibility only after successful completion for that concrete database/church session. Connectivity, cache availability, and progress percentages do not establish it. Cancelled/failed or retired pulls cannot grant eligibility.
- Refresh bootstrap readers after verification. Show replicated content without navigation, retain operator edits, and create defaults only when the post-pull authoritative state still lacks the document. Preserve guest/demo seeding.

## Saving
- Capture concrete database and outline ownership at operation start. Serialize local writes by database, outline, and field; independent items and overlay order remain concurrent.
- Superseded intentions cannot resume a read/write/retry and overwrite the latest intention. An entered put must settle before the newer same-field put. Keep conflict retries bounded and genuine failures visible.
- Complete legitimate outgoing-outline saves against their original owner. A church/database change cannot redirect persistence, pending/saved acknowledgments, cleanup opportunities, or broadcasts to the new owner.
- Acknowledgments and publication describe the exact persisted intent; an older save cannot clear a newer pending draft.

## Evidence
`controllerBootstrap.integration.test.tsx` mounts the real ControllerInfoProvider, Outlines, controller lifecycle, and Redux together (overriding Jest's usual mocked context). It covers delayed remote content, verified-empty creation, offline reads, aux scopes, and retained edits. Provider tests cover failure/cancellation, progress, guest mode, and church switches. Bootstrap/media-folder helper tests cover eligibility and missing-document ownership boundaries. `persistServiceListField.test.ts` controls reads/puts/conflicts; `store.test.ts` covers acknowledgments, broadcasts, independent fields, outgoing outlines, and same-ID database switching.
