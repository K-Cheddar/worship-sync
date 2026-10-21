# Availability forms workspace plan

## Goal
Two tabs, one primary action, and progressive disclosure for existing availability forms.

## Existing architecture
TeamsFormsPage supplies either administrator intake data or the server's restricted team availability projection. IntakeManager owns selection, editing, links and history refresh. AvailabilityFormSendFlow owns recipient selection and reviewed batch state; AvailabilityBatchReview renders exact messages. Shared Tabs, Modal and DropdownMenu provide established interaction patterns.

## Before behavior
Selected forms occupy a split panel. Availability tracking, link checkboxes, delivery counts and an embedded sending section compete for attention. Administrators see intake submissions while scoped editors see an availability matrix.

## After behavior
Existing team_availability forms open a full-width detail workspace with compact metadata, Recipients and Responses tabs, and Send requests opening one selection/review dialog. Personal links and history move to row menus. General links move to the header menu. Responses support search, incomplete/unanswered filters, desktop scrolling and expandable mobile rows.

## Product Decision Check
The current redesign request explicitly authorizes these UI and workflow placements. docs/features/team-availability-sms.md remains authoritative for eligibility, retries, explicit confirmation and uncertainty. No automatic sends, new resend permission, schema or credential changes are authorized or introduced.

## Behavior intentionally unchanged
Other intake types retain their current review/link/send workflows. Existing form editing, issued-scope locks, private/general link separation, revocation, consent/STOP checks, approval versions, durable claims, dispatch and idempotency remain unchanged.

## Acceptance criteria
All availability entry points use the two-tab workspace; persisted recipient/message/response evidence drives status; filtering preserves SMS selection; only final confirmation sends; mobile responses remain readable; existing permissions and refresh paths remain effective.

## Proposed implementation
Extract workspace, recipients and responses components. Compose existing sending component in a dialog variant, preserving its default Messages/other-intake behavior. Derive response display from existing response records or recipient-linked submissions, never from name matching or a new store.

## Affected surfaces
Teams Forms in browser/Electron; TeamsPageContext, GlobalInfoContext, ToastProvider, current-member identity and navigation guard. Server APIs and persisted shapes stay stable. Messages shares selection/review components and needs regression coverage. Display outputs and IPC are not involved.

## Risks / edge cases
History refresh failure must remain visible and block sends. Prepared messages do not establish invitation/delivery. Accepted-but-undelivered and uncertain outcomes must remain blocked. Form/church changes invalidate review. Link creation must remain member-scoped and must not copy revoked links. Refresh must retain canonical server data and prevent old entity results from replacing new state.

## Questions requiring user input
None.

## Verification
Focused Jest suites for workspace, IntakeManager, Forms page, send flow, batch review, selection, history, batch actions and Messages; TypeScript, lint, strict build and git diff --check. Trace real administrator/scoped page composition and deferred dialog/menu interactions. Inspect responsive markup and mobile behavior, loading/error/empty states, permissions and refresh. Final review follows code-review skill.
