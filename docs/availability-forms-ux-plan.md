# Availability forms workspace plan

## Visual and send-flow refinement (2026-10-21)

Goal / Before / After: retain the current Forms route and legacy classification, but replace the weak tab-local progress line with three compact callouts and one completion bar directly below the header. Integrate refresh there, use existing CTA and line-tab styles, tighten roster rows/filters and bound list height. Give the existing send dialog an explicit two-step indicator, a concise selection step and a clear footer. Exact message content remains confined to reviewed messages.

Product Decision Check: the current visual-polish request authorizes these presentation and interaction refinements. Existing team-availability SMS contract, source records, eligibility, automatic first-time selection, explicit definitive-failure retries, uncertainty/accepted-send blocks, consent, approval versions, permissions and links remain unchanged. No new Forms architecture, persistence, delivery policy or data source.

Implementation / affected surfaces: compose existing Workspace, RecipientsTab, ResponsesTab, FormSendFlow and BatchReview. Use Button cta and canonical line tabs; shared primitives and default advanced Messages behavior stay stable. Summary derives from the same unfiltered progress rows, never filtered results. History-dependent counts remain unknown until full history loads. Keep diagnostics collapsed and individual exclusion explanations available progressively without making blocked rows selectable.

Risks / verification: counts during loading/error, zero recipients, refresh, switching tabs, preserved selection across filters/Back, excluded final review recipients, and small-screen footer visibility. Test these through the real Forms page plus existing focused send/eligibility/history/approval suites; inspect actual-route browser screenshots on desktop/mobile. Run TypeScript, lint, strict build and diff check, then code-review. No unresolved product question.

## Legacy classification correction (2026-10-21)

Goal / Before / After: the purpose-only detail gate skips general_intake and purpose-less records with service-date availability. Use the workspace for explicit team_availability forms, or forms with a resolved availability field and saved occurrences or service selections. Names do not determine classification. Ordinary onboarding without service-date coverage keeps its existing view.

Product Decision Check: the current repair request authorizes a presentation change only. Preserve stored purpose, general-intake editing, additional fields, matching, public links, submission processing, permissions and SMS rules. General submissions remain in the Responses tab. Service-selection-only legacy records need a derived date view without writing a new snapshot.

Architecture / affected surfaces: TeamsAndServices forms route mounts TeamsFormsPage, which passes administrator forms to IntakeManager. Row selection preserves the original record; its purpose-only detail gate causes this defect. The suggestion generator's supported general-scope branch defaults to general_intake and keeps template fields. Scoped team editors intentionally receive only server-authorized team_availability forms; do not broaden that authorization filter.

Implementation / risks: reuse resolveIntakeFormFields for a shared presentation predicate. Leave editor/server purpose checks unchanged. Generate missing display occurrences from existing service selections/time zone without persisting that projection. Do not bind public submissions to roster members by name.

Verification: real Forms route selection with explicit general_intake, omitted purpose/fields, extra fields and submissions, plus onboarding negatives; public/private links, editing, member processing, response tracking and final SMS review. Run classification, suggestion, sending/history and affected UI suites, TypeScript, lint, strict build, browser checks and diff review. No consequential open questions.

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
