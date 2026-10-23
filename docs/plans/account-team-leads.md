# Account Team Leads implementation plan

## Goal
Use account team edit scopes for Team Lead access and routine notifications, with reliable digest delivery.

## Existing architecture
Membership permissions already contain global Teams/Services access and teamScopes. Account access drafts edit those scopes. Intake has durable batch claims, delivery keys and recovery; schedule response digests currently retain only a pending timestamp. Personal category preferences live on memberships.

## Before behavior
Admin normalization erases scopes; global editing hides/clears selections. Intake uses roster flags and links; schedule responses include broad editors. Debug email fallback can count as delivery, and schedule send errors are swallowed.

## After behavior
Explicit active-church team edit scopes designate leads, independently of global access and roster identity. Both digests select the same leads, honor personal opt-outs and deduplicate. Provider failures retain retryable pending work.

## Product Decision Check
Authorization: the October 23, 2026 account-based Team Leads request. Existing church-administration navigation, roster, scheduling and availability contracts were inspected. The scheduling contract confirms empty form teamIds means all teams. Record the new account/notification contract separately. No unresolved product decisions.

## Behavior intentionally unchanged
Global authorization, service-plan grants, church boundaries, roster scheduling/qualifications, personal notifications, SMS/manual messaging, private individual emails and 20-minute batching. No migration or parallel assignment field.

## Acceptance criteria
- Invites, pending edits, acceptance, bootstrap and existing-account saves retain validated edit/view scopes, including admins/global editors.
- Only admins assign leads; demotion removes global grants and retains valid explicit scopes.
- Account checkboxes remain visible and survive role/access changes; roster lead controls disappear.
- Recipients require active membership, relevant active-church edit scope, account email and enabled category. Empty explicit scopes never subscribe broad editors.
- Digest success requires provider acceptance; partial failure/restart retries preserve work and skip already accepted deliveries.

## Proposed implementation
Correct existing normalization and draft serialization. Share account-based matching between the two recipient paths. Retain intake infrastructure and extend schedule digests with a durable frozen batch, lease, existing delivery ledger and stable provider keys; recover pending schedules with the existing recovery lifecycle.

## Affected surfaces
Church Administration People -> access drawer/invite form -> auth APIs -> membership/invite documents -> session bootstrap and permission guards. Teams member/profile editors lose only obsolete lead controls. Server startup owns recovery. Node tests exercise real handlers/in-memory store plus faithful Firestore transaction fixtures; React tests use the existing account context wrapper. No display/IPC changes.

## Risks / edge cases
Role changes, preserved view scopes, deleted/archived/foreign teams, pending invite edits before acceptance, opt-outs during retries, concurrent responses during sends, partial acceptance, lost ledger acknowledgment, worker leases and restart recovery. Frozen schedule payloads keep provider idempotency keys stable across retries.

## Questions requiring user input
None.

## Verification
Run modified/new server recipient, auth lifecycle, permissions, preference, intake/schedule digest tests, affected Teams API tests; account access/invite and roster editor client tests; client TypeScript and lint. Trace actual account context and server startup/dispatch composition. Review complete diff, failure transitions, contracts and unchanged authorization. No claim of real provider/inbox verification without evidence.
