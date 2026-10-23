# Availability forms UX workflow review

## Visual and send-flow refinement review (2026-10-21)

### Findings and product authorization

No blocking or outstanding findings. The current visual-polish request authorizes the compact summary, clearer tabs, dense roster and guided dialog. The existing workspace and shared Button, Tabs, Modal, Select and menu primitives are reused. The browser review exposed a collapsed auto-height tab strip under the real page's flex constraints; an explicit local strip height fixes it without changing shared tabs. No new subsystem or persisted state was added. The production diff is presentation and composition; most additional lines supply accessible summary markup and regression coverage.

### Workflow and boundary review

TeamsFormsPage still supplies the original authorized records to IntakeManager and the selected workspace. Counts use the same unfiltered progress rows as the roster; pending history does not invent invitation counts, and zero recipients produce valid zero progress. Legacy classification, public submissions and processing remain unchanged. Changing the dialog's initial audience filter affects visible rows only: automatic first-time selection and explicit definitive-failure selection remain authoritative.

Traced selection -> prepare -> server-reviewed batch -> approval version -> explicit dispatch -> result/history. The new Continue and Send buttons call the existing guarded operations. Entity/eligibility/selection identities, stale-review invalidation, send lock, pending controls, consent/STOP and accepted/uncertain resend blocks are unchanged. Back retains selection; Cancel sends nothing. Exact previews appear only in review, while results use a concise status and existing history. Server exclusions remain visible in review, with individual explanations progressively exposed, and final Send uses the server-eligible count. Private links, shared-phone warnings, segment counts, permission projections and advanced Messages remain covered by existing suites.

Identity, lifetime, persistence/publication and durable retry boundaries retain their existing owners and checks; this refinement adds no asynchronous operation, schema change, external resource, synchronization or destructive action. Modal's owner-aware portal/focus implementation and explicit container semantics remain unchanged. The actual page and deferred dialog are exercised with representative provider/HTTP fixtures, rather than mounting the workspace alone. Browser actions use intercepted fixture requests; no real SMS or database write occurs.

### Verification and readiness

Twelve focused Jest suites passed: **169 tests** covering IntakeManager, TeamsFormsPage.workspace, TeamsFormsPage, TeamsMessagesPage, AvailabilityFormSendFlow, AvailabilityBatchReview, availabilityFormProgress, availabilityRecipientSelection, availabilityNotificationHistory, availabilityBatchActions, intakeFormFields and intakeAvailabilitySuggestion. New coverage includes unfiltered summary/refresh, zero-recipient pending history, collapsed eligibility diagnostics, disabled blocked recipients, review-only exact preview, server exclusions and eligible final count. Existing tests retain explicit retries, uncertainty/acceptance blocks, stale review and duplicate-send protections.

TypeScript and build:strict (including lint:check with zero warnings) passed. The strict build used the normal Vite loader outside the Windows sandbox and retained existing asset/chunk warnings. Actual Forms route browser coverage passes at 1280x800 and 375x640 with 30 persisted-style recipients, general-intake/missing-purpose forms, both tabs, expanded responses, selection, reviewed messages, Back and Cancel. Inspected screenshots confirm clear active tabs, no horizontal page overflow and visible Continue/Send footers. No browser errors or dispatch calls. git diff --check passed. Scope is this workflow, not release-wide verification or deployment.

Ready for the requested refinement; no remaining UI follow-ups. No separate release note: this polishes the existing unreleased availability-workspace concept without changing its product story, per release-notes/README.md.

## Legacy rendering repair review (2026-10-21)

### Findings
Critical: None. High: None. Medium: None. Low: None remaining in this repair.

Confirmed cause: IntakeManager selected the workspace only when purpose was team_availability. The supported legacy suggestion branch defaults to general_intake and preserves extra fields; older records may omit purpose altogether. A read-only, field-projected query scoped to churchId demo confirmed an October Availability record with missing purpose, general-intake fields including availability, three service selections and six saved occurrences. A separate October record has explicit team_availability. No documents were written.

Actual runtime check: ports 3000 and 5000 belong to the client/server in worship-sync-2, on in-progress-2 at merge 2212b260, which contains 13e4b30. That source contains both the redesigned workspace and the purpose-only gate. The missing-purpose record reproduces the old interface even with that redesign present; changing a cache does not correct its classification. No connected browser session was available to inspect the user's loaded client state; direct module retrieval was unavailable because Windows could not check the development certificate's revocation status. No TLS validation was disabled. The repair remains on the requested in-progress branch in worship-sync; the running other-worktree process has not been restarted or changed.

### Product authorization status
Authorized by the current legacy-availability repair request. The new predicate is for presentation only: explicit team_availability, or resolved availability field plus persisted service selections/occurrences. Names do not participate. Existing editor purpose checks and server/team-scoped authorization remain unchanged. No purpose migration, data mutation on opening, new API, source of truth, resend rule, or broader general-intake permission was introduced.

### Open questions / assumptions
None. Public general-intake submissions remain progressively accessible through the existing submission cards and processing actions in Responses. Matrix counts are labeled personal-link responses for legacy/general intake so they do not imply name-based matching of public submissions. General forms without enabled service-date availability retain the old intake experience.

### Verification gaps
Workflow scope only; no required verification remains. Optional: authenticated interactive inspection of the user's running browser was unavailable. The Forms route regression tests mount the real TeamsFormsPage and IntakeManager under representative router/global identity/toast/navigation contexts; the browser fixture now follows that same selection path rather than directly mounting AvailabilityFormWorkspace.

| Invariant | Scenario / code evidence | Executed evidence | Result |
| --- | --- | --- | --- |
| Legacy records reach workspace | Select general_intake, missing purpose with explicit fields, or missing purpose/fields through /teams-and-services/forms | All three new route tests failed with the original purpose-only gate restored temporarily, then passed with the fix | Pass |
| Ordinary intake remains ordinary | Availability disabled despite saved services, or no service-date coverage; names alone do not classify | intakeFormFields.test.ts negative cases and onboarding route test | Pass |
| Legacy capabilities survive | Open legacy editor, retain fields/wording/email and general_intake semantics; process public submission and update member/team | Route tests exercise save payload, public submission card, matching and original processing callbacks | Pass |
| Links and approval remain separate | Copy public link and private member link; prepare without dispatch; only reviewed Send dispatches | Real page/manager route test plus shared send-flow, selection, history, batch action and Messages suites | Pass |
| Personal responses stay canonical | Refresh recipient-linked submission; derive missing date snapshot without a write | Legacy response refresh and service-selection-only route tests; existing progress tests | Pass |
| Responsive deferred UI | Select general-intake form on desktop and missing-purpose form on mobile, switch tabs, expand answers, open/cancel one dialog | test:e2e:availability-workspace at 1280px and 375px; screenshots inspected; no browser errors or page overflow | Pass |

Executed: 12 Jest suites, 166 tests passed using --runInBand --silent: intakeFormFields, intakeAvailabilitySuggestion, IntakeManager, TeamsFormsPage.workspace, TeamsFormsPage, TeamsMessagesPage, AvailabilityFormSendFlow, AvailabilityBatchReview, availabilityFormProgress, availabilityRecipientSelection, availabilityNotificationHistory and availabilityBatchActions. Final type-check, lint:check, build:strict, browser suite and git diff --check passed. The normal strict build used approved execution outside the Windows sandbox and retained existing CSS/chunk-size warnings. No server or provider protocol changed and no real SMS was sent.

### Pattern / learning opportunities
The original standalone workspace browser fixture could not expose an entry-point classification defect. It now opens a saved legacy record through the real Forms page and row-selection path. The production correction is fewer than forty lines; the larger diff supplies the requested workflow regression coverage rather than a new subsystem.

### Final readiness
Ready for this workflow scope. The checklist below remains satisfied; this repair adds no new async state owner, durable mutation, schema or external resource lifecycle. The running dev process still uses the other worktree and needs the updated source to show the fix there.

## Findings
Critical: None. High: None. Medium: None. Low: None remaining.

The review found and corrected two lifecycle issues in the affected paths: late link results could publish to a different selected workspace, and a recreated recipient could temporarily inherit an older cached response projection. Owner/form guards and response timestamp/recipient matching now prevent those results.

## Product authorization status
Authorized by the 2026-10-21 redesign request and the confirmed availability SMS contract: full-width detail workspace, exactly two tabs, row actions, single selection/review dialog, explicit send confirmation, responsive responses, and existing permission boundaries. No new persisted schema, dispatch mechanism, resend override, or My Schedule credential behavior.

## Open questions / assumptions
None. Export and archive were not existing form actions and have not been introduced. Form open/closed settings remain available through Edit. General form links still require broad Teams edit permission; scoped editors receive personal-link actions only.

## Verification gaps
Scope: workflow review, not a release-wide production-readiness review.

Production-context verification: Pass. `TeamsFormsPage.workspace.test.tsx` mounts the real Forms page, manager, workspace and deferred response UI under the router, global identity, toast and navigation guard composition. It covers administrator bootstrap/submission records and scoped REST availability responses, including explicit refresh after submission. Existing page tests cover team/range filtering; shared Messages tests exercise the unchanged advanced consumer. The browser fixture mounts the real workspace, tabs, menus and dialog primitives with actual app CSS at 1280px and 375px. It verifies no page overflow, responsive matrix/card visibility, expansion, one dialog, cancel, and absence of browser errors; screenshots were visually inspected.

| Invariant | Adversarial scenario | Code evidence | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Explicit approval | Prepare, Back, adjust filters, review again, final Send; cancel prepared review | Existing review/selection identities, approval version and dispatch lock in AvailabilityFormSendFlow; dialog changes presentation only | Dialog filter/Back/final-send and cancellation tests; rapid confirmation test | Pass |
| No accidental retries | Accepted-but-undelivered or uncertain attempt; definitive failure mixed with first-time recipients | Unchanged getAvailabilityRecipientRows and batch action API | Recipient selection tests and explicit-failure-selection send-flow test | Pass |
| Fresh history | Older load resolves after a newer open; history refresh fails | IntakeManager refresh sequence plus church/form/mount guards; selection requires historyLoaded | Reopen/older-response, unmount/error and complete paginated history tests | Pass |
| Entity ownership | Personal link pending; navigate to another form; old result resolves | Captured church and recipient.formId checked before callbacks/clipboard | Controlled pending personal-link test in IntakeManager.test.tsx | Pass |
| Response validity | Revoke/recreate same recipient ID while old projected answer remains cached | Progress derivation requires matching current recipient timestamp and member; administrator answers use submissionId, never name | Recreated-link projection and recipient-linked submission tests | Pass |
| Restricted projections | Scoped editor opens details, refreshes responses, or opens review | Existing restricted endpoint and privacySafe flag; no general-link action; applicableMembers limits rows to form scope | Scoped page integration, read-only/scope manager test and privacy-safe send-flow test | Pass |

Checks: ten focused Jest suites passed (103 tests in the combined run); final modified manager/progress suites passed again (37 tests, including one added stale-projection regression). The final administrator/scoped page integration suites also passed after the lifecycle guards changed. Final TypeScript passed. Desktop/mobile browser checks passed. `npm.cmd run build:strict --prefix client` passed, including zero-warning lint; Vite emitted CSS URL/minification and large-chunk build warnings unrelated to this workflow. `git diff --check` passed.

The sandboxed standard build could not resolve the config because ancestor-directory access was denied; runner mode then encountered the existing config's `__dirname` usage. The normal strict build succeeded with approved execution outside that sandbox. No build configuration was changed.

Exact Jest scope: `IntakeManager.test.tsx`, `TeamsFormsPage.workspace.test.tsx`, `TeamsFormsPage.test.tsx`, `TeamsMessagesPage.test.tsx`, `AvailabilityFormSendFlow.test.tsx`, `AvailabilityBatchReview.test.tsx`, `availabilityFormProgress.test.ts`, `availabilityRecipientSelection.test.ts`, `availabilityNotificationHistory.test.ts`, and `availabilityBatchActions.test.ts`. Commands used `npm.cmd test --prefix client -- --runInBand --silent` with those file paths. Other checks: `npm.cmd run type-check --prefix client`, `npm.cmd run test:e2e:availability-workspace --prefix client`, and `git diff --check`.

Optional additional confidence: no real messages were sent and no authenticated production-server session was exercised. No server, provider protocol, schema, or credential changes are part of this patch.

## Pattern / learning opportunities
Use persisted provider evidence for delivery claims and bind projected answers to the current recipient record. Existing skills already cover these rules; no new general policy is needed.

## Final readiness
Ready for this workflow review. No required implementation or verification remains.

- Cross-boundary review performed: Yes (identity, preparation/approval, dispatch and result presentation).
- Sibling-pattern search performed: Yes (Forms, Messages, personal links, existing refresh and history readers).
- Legacy/persisted-state compatibility reviewed: Yes (legacy SMS attempts, optional recipient/submission fields, unchanged API shapes).
- Identity-switch test reviewed or added: Yes (form/church during preparation; personal link during navigation).
- Unmount/lifetime test reviewed or added: Yes (existing late history failure test; batch callbacks now reject retired manager owners).
- Contract round trip traced: Yes (recipient IDs, submission IDs, delivery outcome/status, batch approval version).
- Validate/use security boundary reviewed: Yes (existing server eligibility, consent, scope, token and approval checks remain authoritative).
- Retry-state authority reviewed: Yes (existing durable batch identity and explicit definitive-failure selection).
- Owner-retirement handoff reviewed: Yes (original API mutations can finish; retired UI callbacks are suppressed; history remains server-owned).
- External side-effect adoption/compensation reviewed: Not applicable; no new external resource creation or compensation path. Existing SMS dispatch remains unchanged.
- Authorization/data-projection reviewed: Yes (broad general-link endpoint versus restricted availability and private recipient endpoints).
- Production entry point, runtime context, and test composition compared: Yes (Forms page integration and deferred workspace/dialog paths).
